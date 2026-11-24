import express from 'express';
import { query } from '../db/db.js';
import { auth, adminOnly } from '../middleware/auth.js';
import { audit } from './audit.js';
import { familiesOfUser, currentFamilyId } from '../middleware/tenant.js';
import { config } from '../config/index.js';

const router = express.Router();

/** GET /api/families —— 我可访问的家族列表 + 当前家族 */
router.get('/', auth, async (req, res) => {
  const families = await familiesOfUser(req.user.id);
  const current = currentFamilyId();
  // 补充每个家族的统计（成员数），一次聚合查询
  const ids = families.map((f) => f.id);
  let counts = {};
  if (ids.length) {
    const { rows } = await query(
      `SELECT family_id, COUNT(*)::int AS n FROM person
       WHERE family_id = ANY($1::uuid[]) AND status = 'active'
       GROUP BY family_id`,
      [ids]
    );
    counts = Object.fromEntries(rows.map((r) => [r.family_id, r.n]));
  }
  res.json({
    current,
    families: families.map((f) => ({
      id: f.id,
      name: f.name,
      surname: f.surname,
      role: f.role,
      members: counts[f.id] || 0,
      isCurrent: f.id === current,
    })),
    multi: families.length > 1,
  });
});

/** POST /api/families —— 新建家族（仅系统管理员；首个家族随种子创建） */
router.post('/', auth, adminOnly, async (req, res) => {
  const name = String(req.body?.name || '').trim();
  const surname = String(req.body?.surname || '').trim();
  if (!name) return res.status(400).json({ error: '家族名称必填' });
  if (name.length > 60) return res.status(400).json({ error: '家族名称不能超过 60 字' });
  if (surname.length > 10) return res.status(400).json({ error: '姓氏不能超过 10 字' });

  const { rows } = await query(
    `INSERT INTO family (name, surname, privacy_policy, settings)
     VALUES ($1, $2, '{}'::jsonb, '{}'::jsonb) RETURNING id, name, surname`,
    [name, surname]
  );
  const family = rows[0];
  // 创建者成为该家族的 admin
  await query(
    `INSERT INTO user_family_role (user_id, family_id, role) VALUES ($1, $2, 'admin')`,
    [req.user.id, family.id]
  );
  await audit({
    familyId: family.id,
    actorUserId: req.user.id, actorLabel: req.user.username,
    action: 'create', entityType: 'family', entityId: family.id,
    after: { name, surname },
  });
  res.status(201).json({ ...family, role: 'admin' });
});

/** GET /api/families/current —— 当前家族详情（前端标题用） */
router.get('/current', auth, async (req, res) => {
  const fid = currentFamilyId();
  const { rows } = await query(
    'SELECT id, name, surname, settings FROM family WHERE id = $1', [fid]
  );
  if (!rows.length) return res.status(404).json({ error: '家族不存在' });
  const f = rows[0];
  res.json({
    id: f.id,
    name: f.name,
    surname: f.surname,
    dialect: f.settings?.dialect || 'standard',
    generationPoem: f.settings?.generationPoem || [],
  });
});

/**
 * PUT /api/families/current —— 修改当前家族基本信息（该家族 admin）
 * 注意：权限用「本家族角色」，不是全局 admin。
 */
router.put('/current', auth, async (req, res) => {
  const fid = currentFamilyId();
  const role = req.familyRole;
  if (role !== 'admin') return res.status(403).json({ error: '仅本家族管理员可修改' });

  const body = req.body || {};
  const fields = {};
  if (body.name !== undefined) {
    const n = String(body.name).trim();
    if (!n) return res.status(400).json({ error: '家族名称不能为空' });
    if (n.length > 60) return res.status(400).json({ error: '家族名称不能超过 60 字' });
    fields.name = n;
  }
  if (body.surname !== undefined) {
    const s = String(body.surname).trim();
    if (s.length > 10) return res.status(400).json({ error: '姓氏不能超过 10 字' });
    fields.surname = s;
  }
  const keys = Object.keys(fields);
  if (!keys.length) return res.status(400).json({ error: '没有要更新的字段' });

  const setClause = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
  const { rows } = await query(
    `UPDATE family SET ${setClause}, updated_at = now() WHERE id = $1
     RETURNING id, name, surname`,
    [fid, ...keys.map((k) => fields[k])]
  );
  await audit({
    familyId: fid,
    actorUserId: req.user.id, actorLabel: req.user.username,
    action: 'update', entityType: 'family', entityId: fid, after: fields,
  });
  res.json(rows[0]);
});

/** 默认家族 ID（供前端首次加载回退） */
router.get('/default-id', auth, (req, res) => {
  res.json({ familyId: config.familyId });
});

/**
 * DELETE /api/families/:id —— 删除家族（该家族 admin，且不能删最后一个）
 * 数据由外键 CASCADE 清理；要求二次确认（body.confirm = 家族名称）。
 */
router.delete('/:id', auth, async (req, res) => {
  const id = String(req.params.id || '');
  if (!/^[0-9a-f-]{36}$/i.test(id)) return res.status(400).json({ error: '家族 ID 格式无效' });

  // 必须在该家族有 admin 角色
  const { rows: roleRows } = await query(
    'SELECT role FROM user_family_role WHERE user_id = $1 AND family_id = $2',
    [req.user.id, id]
  );
  if (roleRows[0]?.role !== 'admin') {
    return res.status(403).json({ error: '仅本家族管理员可删除' });
  }

  const { rows: famRows } = await query('SELECT name FROM family WHERE id = $1', [id]);
  if (!famRows.length) return res.status(404).json({ error: '家族不存在' });

  // 不能删掉自己的最后一个家族
  const mine = await familiesOfUser(req.user.id);
  if (mine.length <= 1) {
    return res.status(400).json({ error: '不能删除最后一个有权限的家族' });
  }

  const confirm = String(req.body?.confirm || '').trim();
  if (confirm !== famRows[0].name) {
    return res.status(400).json({ error: `请输入家族名称「${famRows[0].name}」以确认删除` });
  }

  await query('DELETE FROM family WHERE id = $1', [id]);
  await audit({
    familyId: config.familyId,
    actorUserId: req.user.id, actorLabel: req.user.username,
    action: 'delete', entityType: 'family', entityId: id,
    before: { name: famRows[0].name },
  });
  res.json({ ok: true, deleted: famRows[0].name });
});

export default router;