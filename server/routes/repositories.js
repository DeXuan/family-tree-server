import express from 'express';
import { query } from '../db/db.js';
import { auth, editorUp, adminOnly } from '../middleware/auth.js';
import { audit } from './audit.js';
import { config } from '../config/index.js';
import { uuidParam } from '../middleware/params.js';
import { validateBody } from '../middleware/validateBody.js';

const router = express.Router();
const FAMILY_ID = config.familyId;
router.param('id', uuidParam);

// 收藏地列表（含被来源引用数）
router.get('/', auth, async (req, res) => {
  const { rows } = await query(
    `SELECT r.*,
            (SELECT COUNT(*)::int FROM source s WHERE s.repository_id = r.id) AS source_count
     FROM repository r
     WHERE r.family_id = $1
     ORDER BY r.name`,
    [FAMILY_ID]
  );
  res.json(rows.map((r) => ({ ...r, sourceCount: r.source_count })));
});

router.post('/', auth, editorUp, async (req, res) => {
  const check = validateBody(req, {
    name: { type: 'string', required: true, max: 200, label: '收藏地名称' },
    address: { type: 'string', max: 300, label: '地址' },
    contact: { type: 'string', max: 200, label: '联系方式' },
    note: { type: 'string', max: 2000, label: '备注' },
  });
  if (check.error) return res.status(400).json({ error: check.error });
  const b = { ...req.body, ...check.value };
  const { rows } = await query(
    `INSERT INTO repository (family_id, name, address, contact, note, created_by)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [FAMILY_ID, b.name.trim(), (b.address || '').trim(), (b.contact || '').trim(),
      (b.note || '').trim(), req.user.id]
  );
  await audit({
    familyId: FAMILY_ID,
    actorUserId: req.user.id, actorLabel: req.user.username,
    action: 'create', entityType: 'repository', entityId: rows[0].id,
    after: { name: rows[0].name },
  });
  res.status(201).json(rows[0]);
});

router.put('/:id', auth, editorUp, async (req, res) => {
  const b = req.body || {};
  const MAP = { name: 200, address: 300, contact: 200, note: 2000 };
  const fields = {};
  for (const [k, max] of Object.entries(MAP)) {
    if (b[k] === undefined) continue;
    if (typeof b[k] !== 'string') return res.status(400).json({ error: `${k} 必须是文本` });
    if (b[k].length > max) return res.status(400).json({ error: `${k} 不能超过 ${max} 字` });
    fields[k] = b[k].trim();
  }
  if (fields.name === '') return res.status(400).json({ error: '收藏地名称不能为空' });
  const keys = Object.keys(fields);
  if (!keys.length) return res.status(400).json({ error: '没有要更新的字段' });

  const { rows: beforeRows } = await query(
    'SELECT * FROM repository WHERE id = $1 AND family_id = $2', [req.params.id, FAMILY_ID]
  );
  if (!beforeRows.length) return res.status(404).json({ error: '收藏地不存在' });

  const setClause = keys.map((k, i) => `${k} = $${i + 3}`).join(', ');
  const { rows } = await query(
    `UPDATE repository SET ${setClause}, updated_at = now()
     WHERE id = $1 AND family_id = $2 RETURNING *`,
    [req.params.id, FAMILY_ID, ...keys.map((k) => fields[k])]
  );
  await audit({
    familyId: FAMILY_ID,
    actorUserId: req.user.id, actorLabel: req.user.username,
    action: 'update', entityType: 'repository', entityId: req.params.id,
    before: beforeRows[0], after: fields,
  });
  res.json(rows[0]);
});

// 删除：仅当没有来源引用（或 force=1 时先把引用清空）
router.delete('/:id', auth, adminOnly, async (req, res) => {
  const { rows: used } = await query(
    'SELECT COUNT(*)::int AS c FROM source WHERE repository_id = $1', [req.params.id]
  );
  if (used[0].c > 0 && req.query.force !== '1') {
    return res.status(409).json({
      error: `还有 ${used[0].c} 个来源引用此收藏地，确认要解除关联请带 force=1`,
      sourceCount: used[0].c,
    });
  }
  const { rows } = await query(
    'DELETE FROM repository WHERE id = $1 AND family_id = $2 RETURNING name',
    [req.params.id, FAMILY_ID]
  );
  if (!rows.length) return res.status(404).json({ error: '收藏地不存在' });
  await audit({
    familyId: FAMILY_ID,
    actorUserId: req.user.id, actorLabel: req.user.username,
    action: 'delete', entityType: 'repository', entityId: req.params.id,
    before: { name: rows[0].name, unlinkedSources: used[0].c },
  });
  res.json({ ok: true, unlinkedSources: used[0].c });
});

export default router;