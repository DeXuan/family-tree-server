import express from 'express';
import { query } from '../db/db.js';
import { auth, editorUp, adminOnly } from '../middleware/auth.js';
import { audit } from './audit.js';
import { config } from '../config/index.js';
import { uuidParam, isUuid } from '../middleware/params.js';
import { validateBody } from '../middleware/validateBody.js';

const router = express.Router();
const FAMILY_ID = config.familyId;
router.param('id', uuidParam);

const LIMITS = { title: 200, author: 200, publication: 200, repository: 200, note: 2000 };

function validate(body, { partial = false } = {}) {
  const out = {};
  for (const [field, max] of Object.entries(LIMITS)) {
    const v = body[field];
    if (v === undefined) continue;
    if (typeof v !== 'string') return { error: `${field} 必须是文本` };
    if (v.length > max) return { error: `${field} 不能超过 ${max} 字` };
    out[field] = v.trim();
  }
  if (!partial && !out.title) return { error: '来源标题必填' };
  return { fields: out };
}

// 来源列表（含引用次数、收藏地实体名）
router.get('/', auth, async (req, res) => {
  const { rows } = await query(
    `SELECT s.*, r.name AS repository_name,
            (SELECT COUNT(*)::int FROM citation c WHERE c.source_id = s.id) AS citation_count
     FROM source s
     LEFT JOIN repository r ON r.id = s.repository_id
     WHERE s.family_id = $1
     ORDER BY s.title`,
    [FAMILY_ID]
  );
  res.json(rows.map((r) => ({ ...r, citationCount: r.citation_count })));
});

// 新建来源
router.post('/', auth, editorUp, async (req, res) => {
  const check = validateBody(req, {
    title: { type: 'string', required: true, max: 200, label: '来源标题' },
    author: { type: 'string', max: 200, label: '作者' },
    publication: { type: 'string', max: 200, label: '出版信息' },
    repository: { type: 'string', max: 200, label: '收藏地' },
    note: { type: 'string', max: 2000, label: '备注' },
  });
  if (check.error) return res.status(400).json({ error: check.error });
  const { fields, error } = validate({ ...req.body, ...check.value });
  if (error) return res.status(400).json({ error });
  const b = fields;
  // repositoryId 可选：关联到收藏地实体（同时把名称快照写入 repository 文本字段）
  const repositoryId = req.body?.repositoryId || null;
  if (repositoryId && !isUuid(repositoryId)) {
    return res.status(400).json({ error: '收藏地 ID 格式无效' });
  }
  let repoName = b.repository || '';
  if (repositoryId) {
    const { rows: rr } = await query(
      'SELECT name FROM repository WHERE id = $1 AND family_id = $2', [repositoryId, FAMILY_ID]
    );
    if (!rr.length) return res.status(400).json({ error: '收藏地不存在' });
    repoName = rr[0].name;
  }
  const { rows } = await query(
    `INSERT INTO source (family_id, title, author, publication, repository, note, created_by, repository_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [FAMILY_ID, fields.title, fields.author || '', fields.publication || '',
      repoName, fields.note || '', req.user.id, repositoryId]
  );
  await audit({
    familyId: FAMILY_ID,
    actorUserId: req.user.id, actorLabel: req.user.username,
    action: 'create', entityType: 'source', entityId: rows[0].id,
    after: { title: fields.title },
  });
  res.status(201).json(rows[0]);
});

// 修改来源
router.put('/:id', auth, editorUp, async (req, res) => {
  const { fields, error } = validate(req.body || {}, { partial: true });
  if (error) return res.status(400).json({ error });

  // repositoryId: 传 null 表示解除关联；传 UUID 表示关联到实体（并同步文本快照）
  if (req.body && Object.prototype.hasOwnProperty.call(req.body, 'repositoryId')) {
    const rid = req.body.repositoryId;
    if (rid === null || rid === '') {
      fields.repository_id = null;
    } else {
      if (!isUuid(rid)) return res.status(400).json({ error: '收藏地 ID 格式无效' });
      const { rows: rr } = await query(
        'SELECT name FROM repository WHERE id = $1 AND family_id = $2', [rid, FAMILY_ID]
      );
      if (!rr.length) return res.status(400).json({ error: '收藏地不存在' });
      fields.repository_id = rid;
      fields.repository = rr[0].name;
    }
  }

  const keys = Object.keys(fields);
  if (!keys.length) return res.status(400).json({ error: '没有要更新的字段' });

  const { rows: beforeRows } = await query(
    'SELECT * FROM source WHERE id = $1 AND family_id = $2', [req.params.id, FAMILY_ID]
  );
  if (!beforeRows.length) return res.status(404).json({ error: '来源不存在' });

  const setClause = keys.map((k, i) => `${k} = $${i + 3}`).join(', ');
  await query(
    `UPDATE source SET ${setClause}, updated_at = now()
     WHERE id = $1 AND family_id = $2`,
    [req.params.id, FAMILY_ID, ...keys.map((k) => fields[k])]
  );
  await audit({
    familyId: FAMILY_ID,
    actorUserId: req.user.id, actorLabel: req.user.username,
    action: 'update', entityType: 'source', entityId: req.params.id,
    before: beforeRows[0], after: fields,
  });
  res.json({ ok: true });
});

// 删除来源（级联删除其引文）
router.delete('/:id', auth, adminOnly, async (req, res) => {
  const { rows } = await query(
    'DELETE FROM source WHERE id = $1 AND family_id = $2 RETURNING title',
    [req.params.id, FAMILY_ID]
  );
  if (!rows.length) return res.status(404).json({ error: '来源不存在' });
  await audit({
    familyId: FAMILY_ID,
    actorUserId: req.user.id, actorLabel: req.user.username,
    action: 'delete', entityType: 'source', entityId: req.params.id,
    before: { title: rows[0].title },
  });
  res.json({ ok: true });
});

export default router;
