import { validateOverride, applyOverride, removeOverride, normalizeOverrides } from '../modules/kinshipDialect.js';
import { logger } from '../modules/logger.js';
import express from 'express';
import { randomBytes } from 'crypto';
import { query, withTransaction } from '../db/db.js';
import { auth, adminOnly } from '../middleware/auth.js';
import { hashPassword } from '../middleware/password.js';
import { audit } from './audit.js';
import { invitationState } from './invitations.js';
import { createBackup, listBackups, backupPath, pruneBackups } from '../modules/backup.js';
import fs from 'fs';
import path from 'path';
import { uuidParam } from '../middleware/params.js';
import { validateBody } from '../middleware/validateBody.js';
import { config } from '../config/index.js';
import { currentFamilyId } from '../middleware/tenant.js';


const router = express.Router();
router.param('id', uuidParam);

// 用户列表（管理员）
router.get('/users', auth, adminOnly, async (req, res) => {
  const { rows } = await query(
    `SELECT u.id, u.username, u.role, u.status, u.person_id, u.created_at,
            p.family_name, p.given_name
     FROM users u LEFT JOIN person p ON p.id = u.person_id
     ORDER BY u.created_at`
  );
  res.json(rows);
});

// 创建用户（管理员代建）
router.post('/users', auth, adminOnly, async (req, res) => {
  const { username, password, role = 'member' } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: '用户名和密码必填' });
  if (String(password).length < 8) return res.status(400).json({ error: '密码至少 8 位' });
  if (!['admin', 'editor', 'member', 'guest'].includes(role)) return res.status(400).json({ error: '无效角色' });
  try {
    const hash = await hashPassword(password);
    const { rows } = await query(
      `INSERT INTO users (username, password_hash, role, status)
       VALUES ($1,$2,$3,'active') RETURNING id, username, role`,
      [username, hash, role]
    );
    await audit({
      actorUserId: req.user.id, actorLabel: req.user.username,
      action: 'create', entityType: 'user', entityId: rows[0].id,
      after: { username, role },
    });
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: '用户名已存在' });
    logger.error('[admin] create user:', err);
    res.status(500).json({ error: '创建用户失败' });
  }
});

// 用户角色变更
router.put('/users/:id/role', auth, adminOnly, async (req, res) => {
  const { role } = req.body || {};
  if (!['admin', 'editor', 'member', 'guest'].includes(role)) return res.status(400).json({ error: '无效角色' });
  await query('UPDATE users SET role = $1, updated_at = now() WHERE id = $2', [role, req.params.id]);
  await audit({
    actorUserId: req.user.id, actorLabel: req.user.username,
    action: 'update', entityType: 'user_role', entityId: req.params.id,
    after: { role },
  });
  res.json({ ok: true });
});

// 启用/停用用户
router.put('/users/:id/status', auth, adminOnly, async (req, res) => {
  const { status } = req.body || {};
  if (!['active', 'disabled'].includes(status)) return res.status(400).json({ error: '无效状态' });
  await query('UPDATE users SET status = $1, updated_at = now() WHERE id = $2', [status, req.params.id]);
  res.json({ ok: true });
});

// 删除账户（不可删除自己；不可删除最后一个管理员）
router.delete('/users/:id', auth, adminOnly, async (req, res) => {
  if (req.params.id === req.user.id) {
    return res.status(400).json({ error: '不能删除当前登录账户' });
  }
  const { rows } = await query('SELECT id, username, role FROM users WHERE id = $1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: '账户不存在' });
  if (rows[0].role === 'admin') {
    const { rows: admins } = await query("SELECT COUNT(*)::int AS c FROM users WHERE role = 'admin' AND status = 'active'");
    if (admins[0].c <= 1) return res.status(400).json({ error: '不能删除最后一个管理员' });
  }
  await query('DELETE FROM users WHERE id = $1', [req.params.id]);
  await audit({
    actorUserId: req.user.id, actorLabel: req.user.username,
    action: 'delete', entityType: 'user', entityId: req.params.id,
    before: { username: rows[0].username, role: rows[0].role },
  });
  res.json({ ok: true });
});

// 绑定 / 解绑用户与成员节点（本人绑定）
router.put('/users/:id/person', auth, adminOnly, async (req, res) => {
  const { personId = null } = req.body || {};
  const { rows: users } = await query('SELECT id, username, person_id FROM users WHERE id = $1', [req.params.id]);
  if (!users.length) return res.status(404).json({ error: '账户不存在' });

  if (personId) {
    const { rows: persons } = await query(
      "SELECT id, family_name, given_name FROM person WHERE id = $1 AND status = 'active'",
      [personId]
    );
    if (!persons.length) return res.status(404).json({ error: '成员不存在' });
    // 一个成员节点只能被一个账户绑定
    const { rows: taken } = await query(
      'SELECT id, username FROM users WHERE person_id = $1 AND id <> $2',
      [personId, req.params.id]
    );
    if (taken.length) {
      return res.status(409).json({ error: `该成员已绑定账户 ${taken[0].username}` });
    }
  }

  await query('UPDATE users SET person_id = $1, updated_at = now() WHERE id = $2', [personId, req.params.id]);
  await audit({
    actorUserId: req.user.id, actorLabel: req.user.username,
    action: 'update', entityType: 'user_person', entityId: req.params.id,
    before: { personId: users[0].person_id }, after: { personId },
  });
  res.json({ ok: true });
});

// ---------- 邀请管理 ----------
router.get('/invitations', auth, adminOnly, async (req, res) => {
  const { rows } = await query(
    `SELECT i.id, i.token, i.role, i.target_person_id, i.max_uses, i.used_count,
            i.expires_at, i.status, i.created_at,
            p.family_name, p.given_name
     FROM invitation i LEFT JOIN person p ON p.id = i.target_person_id
     WHERE i.family_id = $1
     ORDER BY i.created_at DESC LIMIT 100`,
    [currentFamilyId()]
  );
  res.json(rows.map((r) => ({
    ...r,
    state: invitationState(r),
    target_name: r.family_name ? `${r.family_name}${r.given_name}` : null,
  })));
});

router.post('/invitations', auth, adminOnly, async (req, res) => {
  const {
    role = 'member', targetPersonId = null,
    expiresDays = 7, maxUses = 1,
  } = req.body || {};

  if (!['admin', 'editor', 'member', 'guest'].includes(role)) {
    return res.status(400).json({ error: '无效角色' });
  }
  const days = Number(expiresDays);
  const uses = Number(maxUses);
  if (!Number.isInteger(days) || days < 1 || days > 90) {
    return res.status(400).json({ error: '有效期需为 1–90 天' });
  }
  if (!Number.isInteger(uses) || uses < 1 || uses > 50) {
    return res.status(400).json({ error: '使用次数需为 1–50' });
  }
  if (targetPersonId) {
    const { rows } = await query(
      "SELECT id FROM person WHERE id = $1 AND status = 'active'", [targetPersonId]
    );
    if (!rows.length) return res.status(404).json({ error: '绑定的成员不存在或已归档' });
    const { rows: taken } = await query('SELECT id FROM users WHERE person_id = $1', [targetPersonId]);
    if (taken.length) return res.status(409).json({ error: '该成员已绑定其他账户' });
  }

  const token = randomBytes(24).toString('base64url');
  const expiresAt = new Date(Date.now() + days * 24 * 3600 * 1000);
  const { rows } = await query(
    `INSERT INTO invitation (family_id, token, role, target_person_id, max_uses, expires_at, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING id, token, role, max_uses, expires_at, status, created_at`,
    [currentFamilyId(), token, role, targetPersonId, uses, expiresAt, req.user.id]
  );
  await audit({
    familyId: currentFamilyId(),
    actorUserId: req.user.id, actorLabel: req.user.username,
    action: 'create', entityType: 'invitation', entityId: rows[0].id,
    after: { role, targetPersonId, maxUses: uses, expiresDays: days },
  });
  res.status(201).json(rows[0]);
});

router.post('/invitations/:id/revoke', auth, adminOnly, async (req, res) => {
  const { rows } = await query(
    `UPDATE invitation SET status = 'revoked'
     WHERE id = $1 AND family_id = $2 RETURNING id, token`,
    [req.params.id, currentFamilyId()]
  );
  if (!rows.length) return res.status(404).json({ error: '邀请不存在' });
  await audit({
    familyId: currentFamilyId(),
    actorUserId: req.user.id, actorLabel: req.user.username,
    action: 'update', entityType: 'invitation', entityId: req.params.id,
    after: { status: 'revoked' },
  });
  res.json({ ok: true });
});

// 删除邀请记录（仅清理用途；撤销请用 /revoke）
router.delete('/invitations/:id', auth, adminOnly, async (req, res) => {
  const { rows } = await query(
    `DELETE FROM invitation WHERE id = $1 AND family_id = $2
     RETURNING token, role, target_person_id, used_count`,
    [req.params.id, currentFamilyId()]
  );
  if (!rows.length) return res.status(404).json({ error: '邀请不存在' });
  await audit({
    familyId: currentFamilyId(),
    actorUserId: req.user.id, actorLabel: req.user.username,
    action: 'delete', entityType: 'invitation', entityId: req.params.id,
    before: rows[0],
  });
  res.json({ ok: true });
});

// 手动清理旧备份，只保留最近 keep 份
router.post('/backups/prune', auth, adminOnly, async (req, res) => {
  const keep = Number(req.body?.keep ?? config.backupKeep);
  if (!Number.isInteger(keep) || keep < 1 || keep > 365) {
    return res.status(400).json({ error: '保留份数需为 1–365 的整数' });
  }
  const result = pruneBackups(keep);
  await audit({
    familyId: currentFamilyId(),
    actorUserId: req.user.id, actorLabel: req.user.username,
    action: 'delete', entityType: 'backup', entityId: null,
    after: { prune: true, keep, deleted: result.deleted },
  });
  res.json(result);
});

// ---------- 备份 ----------
router.post('/backup', auth, adminOnly, async (req, res) => {
  try {
    const result = await createBackup();
    const pruned = pruneBackups(config.backupKeep);
    await audit({
      familyId: currentFamilyId(),
      actorUserId: req.user.id, actorLabel: req.user.username,
      action: 'export', entityType: 'backup', entityId: null,
      after: { file: result.file, counts: result.counts, pruned: pruned.deleted },
    });
    res.status(201).json({ ...result, pruned: pruned.deleted, keep: config.backupKeep });
  } catch (err) {
    logger.error('[backup] create:', err);
    res.status(500).json({ error: '备份失败：' + err.message });
  }
});

router.get('/backups', auth, adminOnly, async (req, res) => {
  try {
    res.json(listBackups());
  } catch (err) {
    res.status(500).json({ error: '读取备份列表失败' });
  }
});

router.get('/backups/:file', auth, adminOnly, async (req, res) => {
  try {
    const full = backupPath(req.params.file);
    if (!fs.existsSync(full)) return res.status(404).json({ error: '备份文件不存在' });
    await audit({
      familyId: currentFamilyId(),
      actorUserId: req.user.id, actorLabel: req.user.username,
      action: 'export', entityType: 'backup', entityId: null,
      after: { file: req.params.file, download: true },
    });
    res.download(full, req.params.file);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/backups/:file', auth, adminOnly, async (req, res) => {
  try {
    const full = backupPath(req.params.file);
    if (!fs.existsSync(full)) return res.status(404).json({ error: '备份文件不存在' });
    fs.unlinkSync(full);
    await audit({
      familyId: currentFamilyId(),
      actorUserId: req.user.id, actorLabel: req.user.username,
      action: 'delete', entityType: 'backup', entityId: null,
      before: { file: req.params.file },
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 永久清理归档成员（含其关系、事件、媒体文件），不可恢复
router.post('/purge-archived', auth, adminOnly, async (req, res) => {
  const { rows: archived } = await query(
    "SELECT id FROM person WHERE family_id = $1 AND status = 'archived'", [currentFamilyId()]
  );
  if (!archived.length) {
    return res.json({ deletedPersons: 0, deletedMedia: 0 });
  }
  const ids = archived.map((r) => r.id);

  const { rows: mediaRows } = await query(
    `SELECT DISTINCT m.id FROM media m
     JOIN media_link ml ON ml.media_id = m.id
     WHERE ml.target_type = 'person' AND ml.target_id = ANY($1)`,
    [ids]
  );
  const mediaIds = mediaRows.map((r) => r.id);

  const result = await withTransaction(async (client) => {
    // 先解除账户绑定（外键无级联）
    await client.query('UPDATE users SET person_id = NULL WHERE person_id = ANY($1)', [ids]);
    await client.query(
      "DELETE FROM media_link WHERE target_type = 'person' AND target_id = ANY($1)", [ids]
    );
    await client.query(
      'DELETE FROM association WHERE person_a_id = ANY($1) OR person_b_id = ANY($1)', [ids]
    );
    // 引文无外键：先删人物引文，再删其事件的引文
    await client.query(
      "DELETE FROM citation WHERE target_type = 'person' AND target_id = ANY($1)", [ids]
    );
    const { rows: purgeEvents } = await client.query(
      'SELECT id FROM event WHERE person_id = ANY($1)', [ids]
    );
    if (purgeEvents.length) {
      await client.query(
        "DELETE FROM citation WHERE target_type = 'event' AND target_id = ANY($1)",
        [purgeEvents.map((e) => e.id)]
      );
    }
    const deletedPersons = await client.query(
      "DELETE FROM person WHERE family_id = $1 AND status = 'archived' RETURNING id", [currentFamilyId()]
    );
    let files = [];
    if (mediaIds.length) {
      const deletedMedia = await client.query(
        `DELETE FROM media
         WHERE id = ANY($1)
           AND NOT EXISTS (SELECT 1 FROM media_link ml WHERE ml.media_id = media.id)
         RETURNING file_key`,
        [mediaIds]
      );
      files = deletedMedia.rows.map((r) => r.file_key);
    }
    return { deletedPersons: deletedPersons.rows.length, files };
  });

  for (const key of result.files) {
    fs.rmSync(path.resolve(config.uploadDir, key), { force: true });
  }

  await audit({
    familyId: currentFamilyId(),
    actorUserId: req.user.id, actorLabel: req.user.username,
    action: 'delete', entityType: 'person', entityId: null,
    after: { purgeArchived: true, persons: result.deletedPersons, media: result.files.length },
  });

  res.json({ deletedPersons: result.deletedPersons, deletedMedia: result.files.length });
});

// 家族设置（派语等）
router.get('/family-settings', auth, async (req, res) => {
  const { rows } = await query('SELECT name, surname, settings, privacy_policy FROM family WHERE id = $1', [currentFamilyId()]);
  if (!rows.length) return res.status(404).json({ error: '家族不存在' });
  res.json(rows[0]);
});

router.put('/family-settings', auth, adminOnly, async (req, res) => {
  const check = validateBody(req, {
    name: { type: 'string', max: 60, label: '家族名称' },
    surname: { type: 'string', max: 10, label: '姓氏' },
    generationPoem: { type: 'array', max: 60, label: '字辈派语' },
    dialect: { type: 'enum', values: ['standard', 'wu', 'yue', 'minnan', 'hakka', 'southwest', 'jiaoliao'], label: '方言称谓' },
  });
  if (check.error) return res.status(400).json({ error: check.error });

  const { rows: before } = await query('SELECT settings FROM family WHERE id = $1', [currentFamilyId()]);
  if (!before.length) return res.status(404).json({ error: '家族不存在' });

  const settings = { ...(before[0].settings || {}) };
  if (req.body.generationPoem !== undefined) {
    settings.generationPoem = (req.body.generationPoem || [])
      .map((x) => String(x).trim()).filter(Boolean).slice(0, 60);
  }
  if (check.value.dialect !== undefined) settings.dialect = check.value.dialect;
  const fields = {};
  if (check.value.name) fields.name = check.value.name;
  if (check.value.surname) fields.surname = check.value.surname;

  const keys = Object.keys(fields);
  const setClause = keys.length
    ? keys.map((k, i) => `${k} = ${i + 3}`).join(', ') + ', '
    : '';
  await query(
    `UPDATE family SET ${setClause}settings = $1, updated_at = now() WHERE id = $2`,
    [JSON.stringify(settings), currentFamilyId(), ...keys.map((k) => fields[k])]
  );

  await audit({
    familyId: currentFamilyId(),
    actorUserId: req.user.id, actorLabel: req.user.username,
    action: 'update', entityType: 'family', entityId: currentFamilyId(),
    before: { settings: before[0].settings }, after: { settings },
  });
  res.json({ ok: true, settings });

// ---------------------------------------------------------------------------
// 方言自定义词条（家族级覆盖）
// ---------------------------------------------------------------------------

/** GET /api/admin/dialect-overrides —— 当前自定义词条 */
router.get('/dialect-overrides', auth, async (req, res) => {
  const { rows } = await query('SELECT settings FROM family WHERE id = $1', [currentFamilyId()]);
  if (!rows.length) return res.status(404).json({ error: '家族不存在' });
  const overrides = normalizeOverrides(rows[0].settings?.dialectOverrides || {});
  res.json({ overrides, max: 60, maxTermLen: 10 });
});

/** PUT /api/admin/dialect-overrides —— 新增/覆盖一条词条 */
router.put('/dialect-overrides', auth, adminOnly, async (req, res) => {
  const check = validateOverride(req.body || {});
  if (!check.ok) return res.status(400).json({ error: check.error });

  const { rows: before } = await query('SELECT settings FROM family WHERE id = $1', [currentFamilyId()]);
  if (!before.length) return res.status(404).json({ error: '家族不存在' });
  const current = normalizeOverrides(before[0].settings?.dialectOverrides || {});
  const applied = applyOverride(current, check.override);
  if (!applied.ok) return res.status(400).json({ error: applied.error });

  await query(
    `UPDATE family SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb),
       '{dialectOverrides}', $1::jsonb, true), updated_at = now() WHERE id = $2`,
    [JSON.stringify(applied.overrides), currentFamilyId()]
  );
  await audit({
    familyId: currentFamilyId(),
    actorUserId: req.user.id, actorLabel: req.user.username,
    action: 'update', entityType: 'family', entityId: currentFamilyId(),
    before: { dialectOverrides: current }, after: { dialectOverrides: applied.overrides },
  });
  res.json({ ok: true, overrides: applied.overrides });
});

/** DELETE /api/admin/dialect-overrides —— 删除一条词条（query: dialect & standard） */
router.delete('/dialect-overrides', auth, adminOnly, async (req, res) => {
  const dialect = String(req.query.dialect || '');
  const standard = String(req.query.standard || '');
  const { rows: before } = await query('SELECT settings FROM family WHERE id = $1', [currentFamilyId()]);
  if (!before.length) return res.status(404).json({ error: '家族不存在' });
  const current = normalizeOverrides(before[0].settings?.dialectOverrides || {});
  const removed = removeOverride(current, { dialect, standard });
  if (!removed.ok) return res.status(404).json({ error: removed.error });

  await query(
    `UPDATE family SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb),
       '{dialectOverrides}', $1::jsonb, true), updated_at = now() WHERE id = $2`,
    [JSON.stringify(removed.overrides), currentFamilyId()]
  );
  await audit({
    familyId: currentFamilyId(),
    actorUserId: req.user.id, actorLabel: req.user.username,
    action: 'delete', entityType: 'family', entityId: currentFamilyId(),
    before: { removed: { dialect, standard } }, after: { dialectOverrides: removed.overrides },
  });
  res.json({ ok: true, overrides: removed.overrides });
});

});

// 审计日志查询
router.get('/audit', auth, adminOnly, async (req, res) => {
  const { page = 1, pageSize = 50, action } = req.query;
  const params = [];
  let where = '';
  if (action) { params.push(action); where = `WHERE action = $${params.length}`; }
  const offset = (Number(page) - 1) * Number(pageSize);
  const { rows } = await query(
    `SELECT id, actor_label, action, entity_type, entity_id, before, after, created_at
     FROM audit_log ${where} ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, Number(pageSize), offset]
  );
  res.json(rows);
});

export default router;
