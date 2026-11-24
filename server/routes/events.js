import { logger } from '../modules/logger.js';
import express from 'express';
import { query } from '../db/db.js';
import { auth, editorUp } from '../middleware/auth.js';
import { audit } from './audit.js';
import { validateEventInput } from '../middleware/validation.js';
import { uuidParam } from '../middleware/params.js';
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
router.param('personId', uuidParam);
router.param('eventId', uuidParam);

const EVENT_TYPES = ['birth', 'adoption', 'marriage', 'divorce', 'education', 'career',
  'migration', 'military', 'award', 'residence', 'death', 'burial', 'custom'];
const PRECISIONS = ['exact', 'year', 'about', 'range', 'unknown'];
const VISIBILITY = ['L0', 'L1', 'L2'];
const RANK = { L0: 0, L1: 1, L2: 2 };

function parseDate(v) {
  if (v === undefined) return undefined;
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function viewRank(req, person) {
  const isSelf = !!req.user.personId && req.user.personId === person.id;
  if (req.user.role === 'admin' || isSelf) return 2;
  return req.user.role === 'guest' ? 0 : 1;
}

async function getPerson(personId) {
  const { rows } = await query(
    "SELECT id, family_id, family_name, given_name FROM person WHERE id = $1 AND family_id = $2 AND status = 'active'",
    [personId, currentFamilyId()]
  );
  return rows[0] || null;
}

// 某成员的生平事件（按可见级别过滤）
router.get('/:personId', auth, async (req, res) => {
  try {
    const person = await getPerson(req.params.personId);
    if (!person) return res.status(404).json({ error: '成员不存在' });

    const { rows } = await query(
      `SELECT e.id, e.person_id, e.event_type, e.title, e.description, e.event_date,
              e.event_precision, e.event_date_end, e.place, e.visibility,
              e.created_at, e.updated_at,
              (SELECT COUNT(*)::int FROM citation c
               WHERE c.target_type = 'event' AND c.target_id = e.id) AS citation_count
       FROM event e WHERE e.person_id = $1
       ORDER BY e.event_date DESC NULLS LAST, e.created_at DESC`,
      [person.id]
    );

    const maxRank = viewRank(req, person);
    res.json(rows.filter((e) => RANK[e.visibility] <= maxRank));
  } catch (err) {
    logger.error('[events] list:', err);
    res.status(500).json({ error: '事件查询失败' });
  }
});

// 新增事件
router.post('/:personId', auth, editorUp, async (req, res) => {
  try {
    const person = await getPerson(req.params.personId);
    if (!person) return res.status(404).json({ error: '成员不存在' });

    const b = readBody(req, res);
    if (!b) return;
    const invalid = validateEventInput(b);
    if (invalid) return res.status(400).json({ error: invalid });

    const type = b.eventType || 'custom';
    const precision = b.eventPrecision || 'unknown';
    const visibility = b.visibility || 'L1';
    if (visibility === 'L2' && req.user.role !== 'admin') {
      return res.status(403).json({ error: '仅管理员可将事件设为私密' });
    }

    const { rows } = await query(
      `INSERT INTO event (person_id, event_type, title, description, event_date, event_precision,
         event_date_end, place, visibility)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [person.id, type, String(b.title).trim(), b.description || '',
       parseDate(b.eventDate), precision, parseDate(b.eventDateEnd), b.place || '', visibility]
    );

    await audit({
      familyId: currentFamilyId(),
      actorUserId: req.user.id, actorLabel: req.user.username,
      action: 'create', entityType: 'event', entityId: rows[0].id,
      after: { personId: person.id, title: rows[0].title, type, visibility },
    });
    res.status(201).json(rows[0]);
  } catch (err) {
    logger.error('[events] create:', err);
    res.status(500).json({ error: '事件创建失败' });
  }
});

// 修改事件
router.put('/:eventId', auth, editorUp, async (req, res) => {
  try {
    const { rows: beforeRows } = await query(
      'SELECT * FROM event WHERE id = $1', [req.params.eventId]
    );
    if (!beforeRows.length) return res.status(404).json({ error: '事件不存在' });
    const before = beforeRows[0];
    const person = await getPerson(before.person_id);
    if (!person) return res.status(404).json({ error: '成员不存在' });

    const b = readBody(req, res);
    if (!b) return;
    // 乐观锁：版本不符时拒绝（多人同时编辑事件）
    if (b.expectedUpdatedAt !== undefined && b.expectedUpdatedAt !== null) {
      const cur = before.updated_at;
      const curIso = cur instanceof Date ? cur.toISOString() : new Date(cur).toISOString();
      if (new Date(b.expectedUpdatedAt).getTime() !== new Date(curIso).getTime()) {
        return res.status(409).json({
          error: '该事件已被他人修改，请刷新后重试',
          currentUpdatedAt: curIso,
        });
      }
    }
    const invalid = validateEventInput(b, { partial: true });
    if (invalid) return res.status(400).json({ error: invalid });
    const fields = {
      event_type: b.eventType,
      title: b.title !== undefined ? String(b.title).trim() : undefined,
      description: b.description,
      event_date: parseDate(b.eventDate),
      event_precision: b.eventPrecision,
      event_date_end: parseDate(b.eventDateEnd),
      place: b.place,
      visibility: b.visibility,
    };
    if (fields.event_type !== undefined && !EVENT_TYPES.includes(fields.event_type)) {
      return res.status(400).json({ error: '无效事件类型' });
    }
    if (fields.event_precision !== undefined && !PRECISIONS.includes(fields.event_precision)) {
      return res.status(400).json({ error: '无效日期精度' });
    }
    if (fields.visibility !== undefined) {
      if (!VISIBILITY.includes(fields.visibility)) return res.status(400).json({ error: '无效可见级别' });
      if (fields.visibility === 'L2' && req.user.role !== 'admin') {
        return res.status(403).json({ error: '仅管理员可将事件设为私密' });
      }
    }
    if (fields.title === '') return res.status(400).json({ error: '事件标题不能为空' });

    const keys = Object.keys(fields).filter((k) => fields[k] !== undefined);
    if (!keys.length) return res.status(400).json({ error: '没有要更新的字段' });
    const setClause = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
    const { rows } = await query(
      `UPDATE event SET ${setClause}, updated_at = now() WHERE id = $1 RETURNING *`,
      [req.params.eventId, ...keys.map((k) => fields[k])]
    );

    await audit({
      familyId: currentFamilyId(),
      actorUserId: req.user.id, actorLabel: req.user.username,
      action: 'update', entityType: 'event', entityId: req.params.eventId,
      before, after: rows[0],
    });
    res.json(rows[0]);
  } catch (err) {
    logger.error('[events] update:', err);
    res.status(500).json({ error: '事件更新失败' });
  }
});

// 删除事件
router.delete('/:eventId', auth, editorUp, async (req, res) => {
  try {
    await query("DELETE FROM citation WHERE target_type = 'event' AND target_id = $1", [req.params.eventId]);
  const { rows } = await query('DELETE FROM event WHERE id = $1 RETURNING *', [req.params.eventId]);
    if (!rows.length) return res.status(404).json({ error: '事件不存在' });
    await audit({
      familyId: currentFamilyId(),
      actorUserId: req.user.id, actorLabel: req.user.username,
      action: 'delete', entityType: 'event', entityId: req.params.eventId,
      before: rows[0],
    });
    res.json({ ok: true });
  } catch (err) {
    logger.error('[events] delete:', err);
    res.status(500).json({ error: '事件删除失败' });
  }
});

export default router;
