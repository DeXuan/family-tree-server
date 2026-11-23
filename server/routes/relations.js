import { logger } from '../modules/logger.js';
import express from 'express';
import { query, withTransaction } from '../db/db.js';
import { auth, editorUp } from '../middleware/auth.js';
import { audit } from './audit.js';
import { uuidParam } from '../middleware/params.js';
import { config } from '../config/index.js';

const router = express.Router();
router.param('personId', uuidParam);
router.param('parentId', uuidParam);
router.param('unionId', uuidParam);
const FAMILY_ID = config.familyId;

// =====================================================================
// 亲子关系
// =====================================================================

/** 环路检测：若 child 已是 parent 的祖先，则把 parent 设为 child 的父母会形成环 */
async function wouldCreateCycle(client, parentId, childId) {
  const seen = new Set();
  const stack = [parentId];
  while (stack.length) {
    const cur = stack.pop();
    if (cur === childId) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    const { rows } = await client.query('SELECT parent_id FROM parent_child WHERE child_id = $1', [cur]);
    for (const r of rows) stack.push(r.parent_id);
  }
  return false;
}

const fmtDate = (d) => {
  if (!d) return '';
  const dt = d instanceof Date ? d : new Date(d);
  return isNaN(dt.getTime()) ? String(d) : dt.toISOString().slice(0, 10);
};

/** 日期逻辑：子女出生不得早于父母 12 岁 */
async function checkParentAge(client, parentId, childId) {
  const [{ rows: pr }, { rows: cr }] = await Promise.all([
    client.query('SELECT birth_date FROM person WHERE id = $1', [parentId]),
    client.query('SELECT birth_date FROM person WHERE id = $1', [childId]),
  ]);
  const pb = pr[0]?.birth_date, cb = cr[0]?.birth_date;
  if (pb && cb) {
    const ageDiff = new Date(cb) - new Date(pb);
    if (ageDiff < 12 * 365.25 * 24 * 3600 * 1000) {
      return `子女出生日期(${fmtDate(cb)})早于父母(${fmtDate(pb)})满12岁之前，请核实`;
    }
  }
  return null;
}

/** 重复检测：同父母下，姓名+生年是否已有 */
async function checkDuplicate(client, parentId, childId) {
  const { rows } = await client.query(
    `SELECT p.id, p.family_name, p.given_name, p.birth_date
     FROM parent_child pc JOIN person p ON p.id = pc.child_id
     WHERE pc.parent_id = $1 AND p.given_name = (SELECT given_name FROM person WHERE id = $2)
       AND p.birth_date = (SELECT birth_date FROM person WHERE id = $2)
       AND p.id <> $2`,
    [parentId, childId]
  );
  return rows[0] || null;
}

/** 列出某成员的直接亲属（父母/配偶/子女）；旁系关系不入库，树视图运行时推导 */
router.get('/:personId/relations', auth, async (req, res) => {
  try {
    const { personId } = req.params;
    const [{ rows: parents }, { rows: unions }, { rows: children }] = await Promise.all([
      query(`SELECT p.id, p.family_name, p.given_name, pc.relation_type, pc.certainty
             FROM parent_child pc JOIN person p ON p.id = pc.parent_id
             WHERE pc.child_id = $1 AND p.status = 'active'`, [personId]),
      query(`SELECT u.id, u.union_type, u.status,
                    p.id AS partner_id, p.family_name, p.given_name, p.is_deceased
             FROM marriage u JOIN person p ON
               (u.person_a_id = $1 AND p.id = u.person_b_id)
               OR (u.person_b_id = $1 AND p.id = u.person_a_id)
             WHERE p.status = 'active'`, [personId]),
      query(`SELECT p.id, p.family_name, p.given_name, pc.relation_type, pc.certainty
             FROM parent_child pc JOIN person p ON p.id = pc.child_id
             WHERE pc.parent_id = $1 AND p.status = 'active'`, [personId]),
    ]);
    res.json({ parents, unions, children });
  } catch (err) {
    logger.error('[relations] get:', err);
    res.status(500).json({ error: '查询失败' });
  }
});

/** 添加父母 */
router.post('/:personId/parents', auth, editorUp, async (req, res) => {
  const { personId } = req.params;
  const { parentId, relationType = 'biological', certainty = 'confirmed' } = req.body || {};
  if (!parentId) return res.status(400).json({ error: 'parentId 必填' });
  if (parentId === personId) return res.status(400).json({ error: '不能将自己设为自己的父母' });

  try {
    const { rows: parentRows } = await query('SELECT 1 FROM person WHERE id = $1', [parentId]);
    if (!parentRows.length) return res.status(404).json({ error: '父母成员不存在' });

    const result = await withTransaction(async (client) => {
      const cycle = await wouldCreateCycle(client, parentId, personId);
      if (cycle) return { error: '检测到环路：该成员已是其后代，不能设为父母' };
      const ageErr = await checkParentAge(client, parentId, personId);
      if (ageErr) return { error: ageErr };
      const d = await checkDuplicate(client, parentId, personId);
      if (d) return { error: `疑似重复：已存在同名同生年成员（${d.family_name}${d.given_name}）`, dup: d };
      await client.query(
        `INSERT INTO parent_child (parent_id, child_id, relation_type, certainty)
         VALUES ($1,$2,$3,$4) ON CONFLICT (parent_id, child_id, relation_type) DO NOTHING`,
        [parentId, personId, relationType, certainty]
      );
      return { ok: true };
    });
    if (result.error) return res.status(409).json(result);

    await audit({
      familyId: FAMILY_ID,
      actorUserId: req.user.id, actorLabel: req.user.username,
      action: 'create', entityType: 'parent_child',
      entityId: personId,
      after: { parentId, personId, relationType, certainty },
    });
    res.status(201).json({ ok: true });
  } catch (err) {
    logger.error('[relations] add parent:', err);
    res.status(500).json({ error: '添加失败' });
  }
});

/** 删除父母关系 */
router.delete('/:personId/parents/:parentId', auth, editorUp, async (req, res) => {
  try {
    const { personId, parentId } = req.params;
    const { rows } = await query(
      'DELETE FROM parent_child WHERE parent_id = $1 AND child_id = $2 RETURNING id',
      [parentId, personId]
    );
    if (!rows.length) return res.status(404).json({ error: '关系不存在' });
    await audit({
      familyId: FAMILY_ID,
      actorUserId: req.user.id, actorLabel: req.user.username,
      action: 'delete', entityType: 'parent_child',
      entityId: personId, before: { parentId, personId },
    });
    res.json({ ok: true });
  } catch (err) {
    logger.error('[relations] del parent:', err);
    res.status(500).json({ error: '删除失败' });
  }
});

/** 添加配偶 */
router.post('/:personId/spouses', auth, editorUp, async (req, res) => {
  const { personId } = req.params;
  const { spouseId, unionType = 'married', status = 'ongoing', startDate, place } = req.body || {};
  if (!spouseId) return res.status(400).json({ error: 'spouseId 必填' });
  if (spouseId === personId) return res.status(400).json({ error: '不能与自己结婚' });
  try {
    const { rows: exists } = await query('SELECT 1 FROM person WHERE id = $1', [spouseId]);
    if (!exists.length) return res.status(404).json({ error: '配偶成员不存在' });
    const [a, b] = [personId, spouseId].sort();  // 规范化顺序，避免 A-B / B-A 重复
    const { rows: existing } = await query(
      `SELECT id FROM marriage WHERE person_a_id = $1 AND person_b_id = $2 AND status <> 'divorced' LIMIT 1`,
      [a, b]
    );
    if (existing.length) return res.status(409).json({ error: '这两人之间已存在婚姻记录' });
    await query(
      `INSERT INTO marriage (person_a_id, person_b_id, union_type, status, start_date, place)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [a, b, unionType, status, startDate || null, place || '']
    );
    await audit({
      familyId: FAMILY_ID,
      actorUserId: req.user.id, actorLabel: req.user.username,
      action: 'create', entityType: 'union',
      entityId: a, after: { personA: a, personB: b, unionType, status, startDate, place },
    });
    res.status(201).json({ ok: true });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: '这两人之间已存在婚姻记录' });
    logger.error('[relations] add spouse:', err);
    res.status(500).json({ error: '添加失败' });
  }
});

/** 删除婚姻 */
// 修改婚姻状态（带乐观锁）
router.put('/spouses/:unionId', auth, editorUp, async (req, res) => {
  const { status, expectedUpdatedAt } = req.body || {};
  const allowed = ['ongoing', 'divorced', 'widowed', 'annulled', 'separated'];
  if (!allowed.includes(status)) {
    return res.status(400).json({ error: '无效婚姻状态' });
  }

  const { rows } = await query(
    `SELECT m.* FROM marriage m
     JOIN person p ON p.id = m.person_a_id
     WHERE m.id = $1 AND p.family_id = $2`,
    [req.params.unionId, FAMILY_ID]
  );
  if (!rows.length) return res.status(404).json({ error: '婚姻记录不存在' });
  const u = rows[0];

  if (expectedUpdatedAt !== undefined && expectedUpdatedAt !== null) {
    const cur = u.updated_at;
    const curIso = cur instanceof Date ? cur.toISOString() : new Date(cur).toISOString();
    if (new Date(expectedUpdatedAt).getTime() !== new Date(curIso).getTime()) {
      return res.status(409).json({
        error: '该婚姻记录已被他人修改，请刷新后重试',
        currentUpdatedAt: curIso,
      });
    }
  }

  const { rows: updated } = await query(
    `UPDATE marriage SET status = $1, end_date = $2, updated_at = now()
     WHERE id = $3 RETURNING *`,
    [status, status === 'divorced' ? new Date().toISOString().slice(0, 10) : null, u.id]
  );

  await audit({
    familyId: FAMILY_ID,
    actorUserId: req.user.id, actorLabel: req.user.username,
    action: 'update', entityType: 'marriage', entityId: u.id,
    before: u, after: { status },
  });
  res.json({ ok: true, updatedAt: updated[0].updated_at });
});

router.delete('/:personId/spouses/:unionId', auth, editorUp, async (req, res) => {
  try {
    const { rows } = await query(
      `DELETE FROM marriage WHERE id = $1 AND (person_a_id = $2 OR person_b_id = $2) RETURNING id`,
      [req.params.unionId, req.params.personId]
    );
    if (!rows.length) return res.status(404).json({ error: '婚姻记录不存在' });
    await audit({
      familyId: FAMILY_ID,
      actorUserId: req.user.id, actorLabel: req.user.username,
      action: 'delete', entityType: 'union', entityId: req.params.unionId,
    });
    res.json({ ok: true });
  } catch (err) {
    logger.error('[relations] del spouse:', err);
    res.status(500).json({ error: '删除失败' });
  }
});

export default router;
