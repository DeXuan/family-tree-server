import { logger } from '../modules/logger.js';
import { validateBody } from '../middleware/validateBody.js';
import express from 'express';
import { query } from '../db/db.js';
import { auth, editorUp } from '../middleware/auth.js';
import { audit } from './audit.js';
import { currentFamilyId } from '../middleware/tenant.js';
import { resolveRoles, isKnownRole, roleLabel as labelOf, validateNewRole, removeRole } from '../modules/associationRoles.js';
import { isUuid, uuidParam } from '../middleware/params.js';

const router = express.Router();
router.param('id', uuidParam);

export const ROLES = ['godparent', 'godchild', 'witness', 'employer', 'employee',
  'neighbor', 'friend', 'teacher', 'student', 'successor', 'other'];

const ROLE_LABEL = {
  godparent: '义父/义母', godchild: '义子/义女', witness: '见证人',
  employer: '雇主', employee: '雇员', neighbor: '邻里', friend: '好友',
  teacher: '师长', student: '门生', successor: '继承人', other: '其他',
};

/** 读取本家族的自定义角色 */
async function loadCustomRoles() {
  const { rows } = await query('SELECT settings FROM family WHERE id = $1', [currentFamilyId()]);
  return rows[0]?.settings?.customRoles || [];
}

async function personOk(id) {
  const { rows } = await query(
    "SELECT id FROM person WHERE id = $1 AND family_id = $2 AND status = 'active'",
    [id, currentFamilyId()]
  );
  return rows.length > 0;
}

// 某成员的关联（双向）
router.get('/person/:personId', auth, async (req, res) => {
  if (!isUuid(req.params.personId)) return res.status(400).json({ error: 'ID 无效' });
  const { rows } = await query(
    `SELECT a.*,
            pa.family_name AS a_family, pa.given_name AS a_given,
            pb.family_name AS b_family, pb.given_name AS b_given
     FROM association a
     JOIN person pa ON pa.id = a.person_a_id
     JOIN person pb ON pb.id = a.person_b_id
     WHERE a.family_id = $1 AND (a.person_a_id = $2 OR a.person_b_id = $2)
     ORDER BY a.created_at`,
    [currentFamilyId(), req.params.personId]
  );

  const customRoles = await loadCustomRoles();
  const { labels: roleLabels } = resolveRoles(customRoles);
  res.json(rows.map((r) => {
    const isA = r.person_a_id === req.params.personId;
    return {
      id: r.id,
      role: r.role,
      roleLabel: roleLabels[r.role] || r.role,
      note: r.note,
      other: {
        id: isA ? r.person_b_id : r.person_a_id,
        name: isA ? `${r.b_family}${r.b_given}` : `${r.a_family}${r.a_given}`,
      },
      direction: isA ? 'forward' : 'reverse',
      createdAt: r.created_at,
    };
  }));
});

// 新建关联
router.post('/', auth, editorUp, async (req, res) => {
  const { personAId, personBId, role = 'other', note = '' } = req.body || {};
  if (!isUuid(personAId) || !isUuid(personBId)) return res.status(400).json({ error: '成员 ID 无效' });
  if (personAId === personBId) return res.status(400).json({ error: '不能与自己建立关联' });
  const customRoles = await loadCustomRoles();
  if (!isKnownRole(role, customRoles)) return res.status(400).json({ error: '关联角色无效' });
  if (String(note).length > 500) return res.status(400).json({ error: '备注不能超过 500 字' });

  const [aOk, bOk] = await Promise.all([personOk(personAId), personOk(personBId)]);
  if (!aOk || !bOk) return res.status(404).json({ error: '成员不存在或已归档' });

  try {
    const { rows } = await query(
      `INSERT INTO association (family_id, person_a_id, person_b_id, role, note, created_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [currentFamilyId(), personAId, personBId, role, String(note).slice(0, 500), req.user.id]
    );
    await audit({
      familyId: currentFamilyId(),
      actorUserId: req.user.id, actorLabel: req.user.username,
      action: 'create', entityType: 'association', entityId: rows[0].id,
      after: { personAId, personBId, role },
    });
  res.status(201).json({ ...rows[0], roleLabel: labelOf(role, customRoles) });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: '这两人之间已存在同角色关联' });
    logger.error('[associations] create:', err);
    res.status(500).json({ error: '关联创建失败' });
  }
});

// 删除关联
router.delete('/:id', auth, editorUp, async (req, res) => {
  const { rows } = await query(
    'SELECT * FROM association WHERE id = $1 AND family_id = $2',
    [req.params.id, currentFamilyId()]
  );
  if (!rows.length) return res.status(404).json({ error: '关联不存在' });
  await query('DELETE FROM association WHERE id = $1', [req.params.id]);
  await audit({
    familyId: currentFamilyId(),
    actorUserId: req.user.id, actorLabel: req.user.username,
    action: 'delete', entityType: 'association', entityId: req.params.id,
    before: rows[0],
  });
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// 自定义关联角色管理
// ---------------------------------------------------------------------------

/** GET /api/associations/roles —— 可用角色清单（内置 + 自定义） */
router.get('/roles', auth, async (req, res) => {
  const customRoles = await loadCustomRoles();
  const { all, labels, custom } = resolveRoles(customRoles);
  res.json({
    roles: all.map((key) => ({ key, label: labels[key], builtin: !key.startsWith('custom_') })),
    custom,
    limits: { max: 30, maxLabelLen: 12 },
  });
});

/** POST /api/associations/roles —— 新增自定义角色（editor+） */
router.post('/roles', auth, editorUp, async (req, res) => {
  const customRoles = await loadCustomRoles();
  const check = validateNewRole(req.body, customRoles);
  if (!check.ok) return res.status(400).json({ error: check.error });

  const next = [...customRoles, check.role];
  await query(
    `UPDATE family SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb),
       '{customRoles}', $1::jsonb, true), updated_at = now() WHERE id = $2`,
    [JSON.stringify(next), currentFamilyId()]
  );
  await audit({
    familyId: currentFamilyId(),
    actorUserId: req.user.id, actorLabel: req.user.username,
    action: 'create', entityType: 'family', entityId: currentFamilyId(),
    after: { customRole: check.role },
  });
  res.status(201).json({ ok: true, role: check.role, custom: next });
});

/** DELETE /api/associations/roles/:key —— 删除自定义角色（adminOnly 语义由 editorUp 放宽，仅自定义可删） */
router.delete('/roles/:key', auth, editorUp, async (req, res) => {
  const customRoles = await loadCustomRoles();
  const result = removeRole(customRoles, req.params.key);
  if (!result.ok) return res.status(400).json({ error: result.error });

  await query(
    `UPDATE family SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb),
       '{customRoles}', $1::jsonb, true), updated_at = now() WHERE id = $2`,
    [JSON.stringify(result.roles), currentFamilyId()]
  );
  await audit({
    familyId: currentFamilyId(),
    actorUserId: req.user.id, actorLabel: req.user.username,
    action: 'delete', entityType: 'family', entityId: currentFamilyId(),
    before: { removedRole: req.params.key },
  });
  res.json({ ok: true, custom: result.roles });
});

export { ROLE_LABEL };
export default router;