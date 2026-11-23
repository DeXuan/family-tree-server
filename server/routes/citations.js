import express from 'express';
import { query } from '../db/db.js';
import { auth, editorUp } from '../middleware/auth.js';
import { audit } from './audit.js';
import { config } from '../config/index.js';
import { isUuid, uuidParam } from '../middleware/params.js';
import { validateBody } from '../middleware/validateBody.js';
import { logger } from '../modules/logger.js';

const router = express.Router();
const FAMILY_ID = config.familyId;
router.param('id', uuidParam);

const TARGETS = ['person', 'event'];
const CONFIDENCE = ['high', 'medium', 'low'];

async function targetExists(type, id) {
  if (type === 'person') {
    const { rows } = await query(
      "SELECT id FROM person WHERE id = $1 AND family_id = $2 AND status = 'active'",
      [id, FAMILY_ID]
    );
    return rows.length > 0;
  }
  const { rows } = await query(
    `SELECT e.id FROM event e JOIN person p ON p.id = e.person_id
     WHERE e.id = $1 AND p.family_id = $2 AND p.status = 'active'`,
    [id, FAMILY_ID]
  );
  return rows.length > 0;
}

// 某对象上的引文
router.get('/', auth, async (req, res) => {
  const { targetType, targetId } = req.query;
  if (!TARGETS.includes(targetType) || !isUuid(targetId)) {
    return res.status(400).json({ error: '参数 targetType/targetId 无效' });
  }
  const { rows } = await query(
    `SELECT c.*, s.title, s.author, s.publication, s.repository
     FROM citation c JOIN source s ON s.id = c.source_id
     WHERE c.family_id = $1 AND c.target_type = $2 AND c.target_id = $3
     ORDER BY c.created_at`,
    [FAMILY_ID, targetType, targetId]
  );
  res.json(rows);
});

// 添加引文
router.post('/', auth, editorUp, async (req, res) => {
  const check = validateBody(req, {
    sourceId: { type: 'string', required: true, label: '来源' },
    targetType: { type: 'enum', values: TARGETS, label: '引文对象类型' },
    targetId: { type: 'string', required: true, label: '引文对象' },
    page: { type: 'string', max: 100, label: '卷页' },
    confidence: { type: 'enum', values: CONFIDENCE, label: '可信度' },
    note: { type: 'string', max: 1000, label: '备注' },
  });
  if (check.error) return res.status(400).json({ error: check.error });
  const {
    sourceId, targetType, targetId, page = '', confidence = 'medium', note = '',
  } = check.value;

  if (!isUuid(sourceId) || !isUuid(targetId) || !TARGETS.includes(targetType)) {
    return res.status(400).json({ error: '参数无效' });
  }
  if (!CONFIDENCE.includes(confidence)) return res.status(400).json({ error: '可信度取值无效' });
  if (String(page).length > 100) return res.status(400).json({ error: '卷页不能超过 100 字' });
  if (String(note).length > 1000) return res.status(400).json({ error: '备注不能超过 1000 字' });

  const { rows: sources } = await query(
    'SELECT id, title FROM source WHERE id = $1 AND family_id = $2', [sourceId, FAMILY_ID]
  );
  if (!sources.length) return res.status(404).json({ error: '来源不存在' });
  if (!(await targetExists(targetType, targetId))) {
    return res.status(404).json({ error: '引文对象不存在或已归档' });
  }

  try {
    const { rows } = await query(
      `INSERT INTO citation (family_id, source_id, target_type, target_id, page, confidence, note, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [FAMILY_ID, sourceId, targetType, targetId, String(page).slice(0, 100),
        confidence, String(note).slice(0, 1000), req.user.id]
    );
    await audit({
      familyId: FAMILY_ID,
      actorUserId: req.user.id, actorLabel: req.user.username,
      action: 'create', entityType: 'citation', entityId: rows[0].id,
      after: { source: sources[0].title, targetType, targetId },
    });
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: '该来源已关联到此对象' });
    logger.error('[citations] create:', err);
    res.status(500).json({ error: '引文添加失败' });
  }
});

// 删除引文
router.delete('/:id', auth, editorUp, async (req, res) => {
  const { rows } = await query(
    `SELECT * FROM citation WHERE id = $1 AND family_id = $2`,
    [req.params.id, FAMILY_ID]
  );
  if (!rows.length) return res.status(404).json({ error: '引文不存在' });
  await query('DELETE FROM citation WHERE id = $1', [req.params.id]);
  await audit({
    familyId: FAMILY_ID,
    actorUserId: req.user.id, actorLabel: req.user.username,
    action: 'delete', entityType: 'citation', entityId: req.params.id,
    before: rows[0],
  });
  res.json({ ok: true });
});

export default router;
