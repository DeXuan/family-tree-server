import express from 'express';
import { query } from '../db/db.js';
import { auth } from '../middleware/auth.js';
import { audit } from './audit.js';
import {
  redactPerson, levelMap, SELF_ADJUSTABLE_FIELDS, LEVEL,
} from '../modules/privacy.js';
import { encryptJSON, tryDecryptJSON } from '../modules/crypto.js';

const router = express.Router();

async function boundPerson(userId) {
  const { rows } = await query(
    `SELECT p.* FROM users u JOIN person p ON p.id = u.person_id
     WHERE u.id = $1 AND p.status = 'active'`,
    [userId]
  );
  return rows[0] || null;
}

// 当前账户 + 绑定成员 + 生效隐私级别
router.get('/', auth, async (req, res) => {
  const person = await boundPerson(req.user.id);
  if (!person) {
    return res.json({ user: req.user, person: null, levels: {}, adjustable: [] });
  }
  const ctx = { role: req.user.role, isAdmin: req.user.role === 'admin', isSelf: true };
  res.json({
    user: req.user,
    person: redactPerson(person, ctx),
    levels: levelMap(person),
    adjustable: SELF_ADJUSTABLE_FIELDS,
  });
});

// 更新本人联系方式（L2 字段）
router.put('/profile', auth, async (req, res) => {
  const person = await boundPerson(req.user.id);
  if (!person) return res.status(400).json({ error: '账户尚未绑定成员节点，请联系管理员' });

  const b = req.body || {};
  const current = tryDecryptJSON(person.contact) || {};
  const contact = {
    phone: String(b.phone ?? current.phone ?? '').slice(0, 40),
    email: String(b.email ?? current.email ?? '').slice(0, 120),
    address: String(b.address ?? current.address ?? '').slice(0, 200),
  };

  await query(
    `UPDATE person SET contact = $1, updated_at = now() WHERE id = $2`,
    [JSON.stringify(encryptJSON(contact)), person.id]
  );
  await audit({
    familyId: person.family_id,
    actorUserId: req.user.id, actorLabel: req.user.username,
    action: 'update', entityType: 'person', entityId: person.id,
    before: { contact: current }, after: { contact },
  });
  res.json({ ok: true, contact });
});

// 本人隐私设置：L1/L2 可选，不允许把族内字段公开为 L0
router.put('/privacy', auth, async (req, res) => {
  const person = await boundPerson(req.user.id);
  if (!person) return res.status(400).json({ error: '账户尚未绑定成员节点，请联系管理员' });

  const input = req.body?.overrides;
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return res.status(400).json({ error: '参数格式错误' });
  }

  const next = { ...(person.privacy_override || {}) };
  for (const [field, level] of Object.entries(input)) {
    if (!SELF_ADJUSTABLE_FIELDS.includes(field)) {
      return res.status(400).json({ error: `字段 ${field} 不支持自助设置` });
    }
    if (level === '' || level === null) { delete next[field]; continue; }
    if (![LEVEL.L1, LEVEL.L2].includes(level)) {
      return res.status(400).json({ error: '可将字段设为“族内可见(L1)”或“仅本人与管理员(L2)”' });
    }
    next[field] = level;
  }

  await query(
    `UPDATE person SET privacy_override = $1, updated_at = now() WHERE id = $2`,
    [JSON.stringify(next), person.id]
  );
  await audit({
    familyId: person.family_id,
    actorUserId: req.user.id, actorLabel: req.user.username,
    action: 'privacy_change', entityType: 'person', entityId: person.id,
    before: person.privacy_override, after: next,
  });
  res.json({ ok: true, levels: levelMap({ ...person, privacy_override: next }) });
});

export default router;
