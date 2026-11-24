import { logger } from '../modules/logger.js';
import express from 'express';
import { randomUUID } from 'crypto';
import { query } from '../db/db.js';
import { auth, editorUp, adminOnly } from '../middleware/auth.js';
import { audit } from './audit.js';
import { redactPerson } from '../modules/privacy.js';
import { encryptJSON } from '../modules/crypto.js';
import { validatePersonInput } from '../middleware/validation.js';
import { uuidParam } from '../middleware/params.js';
import { buildPersonUpdate, parseDate } from '../modules/personFields.js';
import { currentFamilyId } from '../middleware/tenant.js';

const router = express.Router();

/** 请求体必须是普通对象，否则返回 400 */
function readBody(req, res) {
  const b = req.body;
  if (b !== undefined && b !== null && (typeof b !== 'object' || Array.isArray(b))) {
    res.status(400).json({ error: '请求体格式错误，应为 JSON 对象' });
    return null;
  }
  return b || {};
}
router.param('id', uuidParam);

const COLUMNS = `id, family_id, family_name, given_name, courtesy_name, former_names, generation_name,
  generation_no, branch, gender, birth_date, birth_precision, birth_place,
  death_date, death_precision, death_place, burial_place, is_deceased,
  occupation, education, bio, contact, privacy_override, extra, status, created_at, updated_at`;

function viewerCtx(req, person) {
  return {
    role: req.user.role,
    isAdmin: req.user.role === 'admin',
    isSelf: !!req.user.personId && req.user.personId === person?.id,
  };
}

const DATE_FIELDS = ['birth_date', 'death_date'];

// ---------- 列表 / 检索筛选 ----------
// GET /api/persons?keyword=&gen=&branch=&deceased=&page=1&pageSize=50
router.get('/', auth, async (req, res) => {
  try {
    const { keyword, gen, branch, deceased, page = 1, pageSize = 50 } = req.query;
    // 关键词上限：避免超长串触发全表顺序扫描（PGlite 无 trigram）
    if (keyword && String(keyword).length > 100) {
      return res.status(400).json({ error: '搜索关键词不能超过 100 字' });
    }
    if (branch && String(branch).length > 50) {
      return res.status(400).json({ error: '支系名称不能超过 50 字' });
    }
    const conds = ['family_id = $1', "status = 'active'"];
    const params = [currentFamilyId()];
    let idx = params.length + 1;

    if (keyword) {
      // 全名拼接匹配（"王德" 能命中 王德昌），并覆盖曾用名
      conds.push(`((family_name || given_name) ILIKE $${idx}
        OR given_name ILIKE $${idx} OR family_name ILIKE $${idx}
        OR courtesy_name ILIKE $${idx} OR generation_name ILIKE $${idx}
        OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(former_names) fn WHERE fn ILIKE $${idx}))`);
      params.push(`%${keyword}%`);
      idx++;
    }
    if (gen) { conds.push(`generation_no = $${idx++}`); params.push(Number(gen)); }
    if (branch) { conds.push(`branch = $${idx++}`); params.push(branch); }
    if (deceased === 'true') conds.push('is_deceased = true');
    if (deceased === 'false') conds.push('is_deceased = false');

    const where = conds.join(' AND ');
    const { rows: countRows } = await query(`SELECT COUNT(*)::int AS c FROM person WHERE ${where}`, params);
    const total = countRows[0].c;
    const offset = (Number(page) - 1) * Number(pageSize);

    const { rows } = await query(
      `SELECT ${COLUMNS} FROM person WHERE ${where}
       ORDER BY generation_no NULLS LAST, family_name, given_name
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, Number(pageSize), offset]
    );
    res.json({
      total,
      page: Number(page),
      pageSize: Number(pageSize),
      items: rows.map((p) => redactPerson(p, viewerCtx(req, p))),
    });
  } catch (err) {
    logger.error('[persons] list:', err);
    res.status(500).json({ error: '查询失败' });
  }
});

// ---------- 单个成员 ----------
router.get('/:id', auth, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT ${COLUMNS} FROM person WHERE id = $1 AND family_id = $2`,
      [req.params.id, currentFamilyId()]
    );
    if (!rows.length) return res.status(404).json({ error: '成员不存在' });
    res.json(redactPerson(rows[0], viewerCtx(req, rows[0])));
  } catch (err) {
    logger.error('[persons] get:', err);
    res.status(500).json({ error: '查询失败' });
  }
});

// ---------- 新建成员 ----------
router.post('/', auth, editorUp, async (req, res) => {
  try {
    const b = readBody(req, res);
    if (!b) return;
    const invalid = validatePersonInput(b);
    if (invalid) return res.status(400).json({ error: invalid });
    const id = randomUUID();
    const { rows } = await query(
      `INSERT INTO person (id, family_id, family_name, given_name, courtesy_name, former_names,
        generation_name, generation_no, branch, gender,
        birth_date, birth_precision, birth_place,
        death_date, death_precision, death_place, burial_place, is_deceased,
        occupation, education, bio, extra)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
       RETURNING id`,
      [
        id, currentFamilyId(),
        b.family_name || '', b.given_name || '', b.courtesy_name || '',
        JSON.stringify(Array.isArray(b.former_names) ? b.former_names : []),
        b.generation_name || '', b.generation_no ?? null, b.branch || '',
        b.gender || 'unknown',
        parseDate(b.birth_date), b.birth_precision || 'unknown', b.birth_place || '',
        parseDate(b.death_date), b.death_precision || 'unknown', b.death_place || '',
        b.burial_place || '', !!b.is_deceased,
        b.occupation || '', b.education || '', b.bio || '',
        JSON.stringify(b.extra || {}),
      ]
    );
    await audit({
      familyId: currentFamilyId(),
      actorUserId: req.user.id, actorLabel: req.user.username,
      action: 'create', entityType: 'person', entityId: id,
      after: b,
    });
    res.status(201).json({ id: rows[0].id });
  } catch (err) {
    logger.error('[persons] create:', err);
    res.status(500).json({ error: '创建失败' });
  }
});

// ---------- 更新成员 ----------
router.put('/:id', auth, editorUp, async (req, res) => {
  try {
    const b = readBody(req, res);
    if (!b) return;
    const invalid = validatePersonInput(b, { partial: true });
    if (invalid) return res.status(400).json({ error: invalid });
    // 先取改前记录（也用于判断是否本人）
    const { rows: beforeRows } = await query(`SELECT * FROM person WHERE id = $1 AND family_id = $2`,
      [req.params.id, currentFamilyId()]);
    if (!beforeRows.length) return res.status(404).json({ error: '成员不存在' });
    const before = beforeRows[0];
    const isSelf = !!req.user.personId && req.user.personId === before.id;
    const mayEditPrivate = req.user.role === 'admin' || isSelf;

    const fields = buildPersonUpdate(b);
    if (b.contact !== undefined) {
      if (!mayEditPrivate) return res.status(403).json({ error: '无权修改该成员的联系方式' });
      fields.contact = JSON.stringify(encryptJSON(b.contact || {}));
    }
    if (b.privacy_override !== undefined) {
      if (!mayEditPrivate) return res.status(403).json({ error: '无权修改该成员的隐私设置' });
      fields.privacy_override = JSON.stringify(b.privacy_override || {});
    }
    const keys = Object.keys(fields).filter((k) => fields[k] !== undefined);
    if (!keys.length) return res.status(400).json({ error: '没有要更新的字段' });

    // 乐观锁：若客户端带 expectedUpdatedAt，则版本不符时拒绝（避免后台互相覆盖）
    const expected = b.expectedUpdatedAt;
    if (expected !== undefined && expected !== null) {
      const before = beforeRows[0].updated_at;
      const beforeIso = before instanceof Date ? before.toISOString() : new Date(before).toISOString();
      if (new Date(expected).getTime() !== new Date(beforeIso).getTime()) {
        return res.status(409).json({
          error: '该成员已被他人修改，请刷新后重试',
          currentUpdatedAt: beforeIso,
        });
      }
    }

    const setClause = keys.map((k, i) => `${k} = $${i + 3}`).join(', ');
    const values = keys.map((k) => fields[k]);
    await query(
      `UPDATE person SET ${setClause}, updated_at = now() WHERE id = $1 AND family_id = $2`,
      [req.params.id, currentFamilyId(), ...values]
    );

    await audit({
      familyId: currentFamilyId(),
      actorUserId: req.user.id, actorLabel: req.user.username,
      action: 'update', entityType: 'person', entityId: req.params.id,
      before, after: fields,
    });
    res.json({ ok: true });
  } catch (err) {
    logger.error('[persons] update:', err);
    res.status(500).json({ error: '更新失败' });
  }
});

// ---------- 删除（归档，不物理删除） ----------
router.delete('/:id', auth, adminOnly, async (req, res) => {
  try {
    const { rows } = await query(
      `UPDATE person SET status = 'archived', updated_at = now()
       WHERE id = $1 AND family_id = $2 RETURNING id`,
      [req.params.id, currentFamilyId()]
    );
    if (!rows.length) return res.status(404).json({ error: '成员不存在' });
    await audit({
      familyId: currentFamilyId(),
      actorUserId: req.user.id, actorLabel: req.user.username,
      action: 'delete', entityType: 'person', entityId: req.params.id,
    });
    res.json({ ok: true });
  } catch (err) {
    logger.error('[persons] delete:', err);
    res.status(500).json({ error: '删除失败' });
  }
});

export default router;
