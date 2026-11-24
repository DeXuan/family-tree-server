import express from 'express';
import { query, withTransaction } from '../db/db.js';
import { auth, adminOnly } from '../middleware/auth.js';
import { audit } from './audit.js';
import { currentFamilyId } from '../middleware/tenant.js';
import { uuidParam } from '../middleware/params.js';
import { validatePersonInput } from '../middleware/validation.js';
import { buildPersonUpdate, pickEditablePayload } from '../modules/personFields.js';
import { logger } from '../modules/logger.js';

const router = express.Router();
router.param('id', uuidParam);

async function getPerson(personId) {
  const { rows } = await query(
    "SELECT id, family_name, given_name, status FROM person WHERE id = $1 AND family_id = $2",
    [personId, currentFamilyId()]
  );
  return rows[0] || null;
}

// 提交修改建议（族人/编辑；访客除外）
router.post('/', auth, async (req, res) => {
  if (req.user.role === 'guest') return res.status(403).json({ error: '访客不能提交修改建议' });

  const { personId, payload, note = '' } = req.body || {};
  const person = await getPerson(personId);
  if (!person || person.status !== 'active') {
    return res.status(404).json({ error: '成员不存在或已归档' });
  }

  const picked = pickEditablePayload(payload || {});
  if (!Object.keys(picked).length) {
    return res.status(400).json({ error: '没有可提交的修改内容' });
  }
  const invalid = validatePersonInput(picked, { partial: true });
  if (invalid) return res.status(400).json({ error: invalid });
  if (String(note).length > 500) return res.status(400).json({ error: '说明不能超过 500 字' });

  const { rows: pending } = await query(
    `SELECT id FROM change_request
     WHERE person_id = $1 AND requester_user_id = $2 AND status = 'pending' LIMIT 1`,
    [person.id, req.user.id]
  );
  if (pending.length) {
    return res.status(409).json({ error: '你对这位成员已有一条待审核建议，请等待处理' });
  }

  const { rows } = await query(
    `INSERT INTO change_request (family_id, person_id, requester_user_id, payload, note)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [currentFamilyId(), person.id, req.user.id, JSON.stringify(picked), String(note).slice(0, 500)]
  );

  await audit({
    familyId: currentFamilyId(),
    actorUserId: req.user.id, actorLabel: req.user.username,
    action: 'create', entityType: 'change_request', entityId: rows[0].id,
    after: { personId: person.id, fields: Object.keys(picked) },
  });

  res.status(201).json({
    id: rows[0].id,
    personId: person.id,
    status: 'pending',
    fields: Object.keys(picked),
    createdAt: rows[0].created_at,
  });
});

// 我提交的建议
router.get('/mine', auth, async (req, res) => {
  const { rows } = await query(
    `SELECT c.id, c.person_id, c.status, c.note, c.review_note, c.created_at, c.reviewed_at,
            p.family_name, p.given_name
     FROM change_request c JOIN person p ON p.id = c.person_id
     WHERE c.requester_user_id = $1
     ORDER BY c.created_at DESC LIMIT 50`,
    [req.user.id]
  );
  res.json(rows.map((r) => ({
    ...r,
    personName: `${r.family_name || ''}${r.given_name || ''}`,
  })));
});

// 管理员：待审核列表
router.get('/', auth, adminOnly, async (req, res) => {
  const status = ['pending', 'approved', 'rejected'].includes(req.query.status)
    ? req.query.status : 'pending';
  const { rows } = await query(
    `SELECT c.id, c.person_id, c.payload, c.note, c.status, c.created_at,
            p.family_name, p.given_name,
            u.username AS requester
     FROM change_request c
     JOIN person p ON p.id = c.person_id
     LEFT JOIN users u ON u.id = c.requester_user_id
     WHERE c.family_id = $1 AND c.status = $2
     ORDER BY c.created_at DESC LIMIT 100`,
    [currentFamilyId(), status]
  );
  res.json(rows.map((r) => ({
    ...r,
    personName: `${r.family_name || ''}${r.given_name || ''}`,
    payload: r.payload || {},
  })));
});

// 管理员：通过并应用
router.post('/:id/approve', auth, adminOnly, async (req, res) => {
  try {
    const result = await withTransaction(async (client) => {
      const { rows: reqRows } = await client.query(
        'SELECT * FROM change_request WHERE id = $1 AND family_id = $2 FOR UPDATE',
        [req.params.id, currentFamilyId()]
      );
      const change = reqRows[0];
      if (!change) return { error: '建议不存在', status: 404 };
      if (change.status !== 'pending') return { error: '该建议已处理', status: 409 };

      const { rows: personRows } = await client.query(
        "SELECT * FROM person WHERE id = $1 AND family_id = $2 AND status = 'active'",
        [change.person_id, currentFamilyId()]
      );
      const person = personRows[0];
      if (!person) return { error: '成员不存在或已归档', status: 410 };

      const picked = pickEditablePayload(change.payload || {});
      const invalid = validatePersonInput(picked, { partial: true });
      if (invalid) return { error: invalid, status: 400 };

      const fields = buildPersonUpdate(picked);
      const keys = Object.keys(fields).filter((k) => fields[k] !== undefined);
      if (!keys.length) return { error: '建议内容为空', status: 400 };

      const setClause = keys.map((k, i) => `${k} = $${i + 3}`).join(', ');
      const { rows: updated } = await client.query(
        `UPDATE person SET ${setClause}, updated_at = now()
         WHERE id = $1 AND family_id = $2 RETURNING id`,
        [change.person_id, currentFamilyId(), ...keys.map((k) => fields[k])]
      );

      await client.query(
        `UPDATE change_request
         SET status = 'approved', reviewer_user_id = $1, reviewed_at = now()
         WHERE id = $2`,
        [req.user.id, change.id]
      );

      return {
        personId: change.person_id,
        before: person,
        after: fields,
        updatedId: updated[0]?.id,
      };
    });

    if (result.error) return res.status(result.status || 400).json({ error: result.error });

    await audit({
      familyId: currentFamilyId(),
      actorUserId: req.user.id, actorLabel: req.user.username,
      action: 'update', entityType: 'person', entityId: result.personId,
      before: result.before, after: { ...result.after, via: 'change_request' },
    });
    res.json({ ok: true, personId: result.personId });
  } catch (err) {
    logger.error('[change-requests] approve:', err);
    res.status(500).json({ error: '审核失败' });
  }
});

// 管理员：驳回
router.post('/:id/reject', auth, adminOnly, async (req, res) => {
  const reviewNote = String(req.body?.note || '').slice(0, 500);
  const { rows } = await query(
    `UPDATE change_request
     SET status = 'rejected', reviewer_user_id = $1, review_note = $2, reviewed_at = now()
     WHERE id = $3 AND family_id = $4 AND status = 'pending'
     RETURNING id, person_id`,
    [req.user.id, reviewNote, req.params.id, currentFamilyId()]
  );
  if (!rows.length) return res.status(404).json({ error: '建议不存在或已处理' });

  await audit({
    familyId: currentFamilyId(),
    actorUserId: req.user.id, actorLabel: req.user.username,
    action: 'update', entityType: 'change_request', entityId: req.params.id,
    after: { status: 'rejected', note: reviewNote },
  });
  res.json({ ok: true });
});

export default router;
