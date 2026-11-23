import express from 'express';
import { query, withTransaction } from '../db/db.js';
import { auth, editorUp } from '../middleware/auth.js';
import { audit } from './audit.js';
import { config } from '../config/index.js';
import { auditCompleteness, matchesFilter } from '../modules/completeness.js';
import { validatePersonInput } from '../middleware/validation.js';
import { logger } from '../modules/logger.js';

const router = express.Router();
const FAMILY_ID = config.familyId;

/** 一次性把上下文需要的集合查出来（避免 N+1） */
async function loadContext() {
  const [{ rows: persons }, { rows: pc }, { rows: events }, { rows: cites }, { rows: media }] = await Promise.all([
    query(
      `SELECT id, family_name, given_name, gender, birth_date, birth_place, generation_no,
              generation_name, bio, is_deceased, branch, status
       FROM person WHERE family_id = $1 AND status = 'active'`,
      [FAMILY_ID]
    ),
    query(
      `SELECT pc.parent_id, pc.child_id FROM parent_child pc
       JOIN person p ON p.id = pc.child_id WHERE p.family_id = $1 AND p.status = 'active'`,
      [FAMILY_ID]
    ),
    query(
      `SELECT e.person_id FROM event e JOIN person p ON p.id = e.person_id
       WHERE p.family_id = $1 AND p.status = 'active'`,
      [FAMILY_ID]
    ),
    query(
      `SELECT c.target_id FROM citation c JOIN person p ON p.id = c.target_id
       WHERE p.family_id = $1 AND p.status = 'active' AND c.target_type = 'person'`,
      [FAMILY_ID]
    ),
    query(
      `SELECT ml.target_id FROM media_link ml JOIN person p ON p.id = ml.target_id
       WHERE p.family_id = $1 AND p.status = 'active' AND ml.target_type = 'person'`,
      [FAMILY_ID]
    ),
  ]);

  const parentSet = new Set(pc.map((e) => e.child_id));
  const childSet = new Set(pc.map((e) => e.parent_id));
  const eventSet = new Set(events.map((e) => e.person_id));
  const citeSet = new Set(cites.map((c) => c.target_id));
  const mediaSet = new Set(media.map((m) => m.target_id));

  return {
    persons,
    parentSet,
    childSet,
    eventSet,
    citeSet,
    mediaSet,
    ctx: {
      hasParent: (id) => parentSet.has(id),
      hasChild: (id) => childSet.has(id),
      hasEvent: (id) => eventSet.has(id),
      hasCitation: (id) => citeSet.has(id),
      hasMedia: (id) => mediaSet.has(id),
    },
  };
}

// 资料完整度总览
router.get('/completeness', auth, async (req, res) => {
  try {
    const { persons, ctx } = await loadContext();
    res.json(auditCompleteness(persons, ctx));
  } catch (err) {
    logger.error('[quality] completeness:', err);
    res.status(500).json({ error: '完整度分析失败' });
  }
});

// 待补清单（支持筛选：missing=key / noSource / noParents / incompleteBelow）
router.get('/incomplete', auth, async (req, res) => {
  try {
    const { persons, ctx } = await loadContext();
    const audited = auditCompleteness(persons, ctx);
    const filter = {
      missing: req.query.missing || undefined,
      noSource: req.query.noSource === 'true',
      noParents: req.query.noParents === 'true',
      incompleteBelow: req.query.incompleteBelow || undefined,
      alive: req.query.alive,
      gender: req.query.gender || undefined,
      bornFrom: req.query.bornFrom,
      bornTo: req.query.bornTo,
    };
    const list = persons
      .filter((p) => matchesFilter(p, filter, ctx))
      .map((p) => ({
        id: p.id,
        name: `${p.family_name || ''}${p.given_name || ''}`,
        gen: p.generation_no,
        branch: p.branch,
        is_deceased: p.is_deceased,
        completeness: p.completeness,
      }))
      .sort((a, b) => a.completeness - b.completeness);

    res.json({
      total: list.length,
      items: list.slice(0, 100),
      overall: audited.overall,
      filter,
    });
  } catch (err) {
    logger.error('[quality] incomplete:', err);
    res.status(500).json({ error: '待补清单查询失败' });
  }
});

// 批量编辑（支系/世代/字辈）——Ancestris 类工具的批量维护思路
router.post('/bulk-update', auth, editorUp, async (req, res) => {
  const { personIds, set } = req.body || {};
  if (!Array.isArray(personIds) || !personIds.length) {
    return res.status(400).json({ error: '请选择要修改的成员' });
  }
  if (personIds.length > 200) return res.status(400).json({ error: '单次最多 200 人' });
  if (!set || typeof set !== 'object' || Array.isArray(set)) {
    return res.status(400).json({ error: '缺少要设置的字段' });
  }

  const allowed = ['branch', 'generation_no', 'generation_name'];
  const fields = {};
  for (const key of allowed) {
    if (set[key] !== undefined) fields[key] = set[key];
  }
  if (!Object.keys(fields).length) return res.status(400).json({ error: '仅支持批量修改支系/世代/字辈' });

  const err = validatePersonInput(fields, { partial: true });
  if (err) return res.status(400).json({ error: err });

  try {
    const result = await withTransaction(async (client) => {
      const { rows: before } = await client.query(
        `SELECT id, family_name, given_name, branch, generation_no, generation_name
         FROM person WHERE id = ANY($1) AND family_id = $2 AND status = 'active'`,
        [personIds, FAMILY_ID]
      );
      if (!before.length) return { updated: 0, before: [] };

      const keys = Object.keys(fields);
      const setClause = keys.map((k, i) => `${k} = $${i + 3}`).join(', ');
      await client.query(
        `UPDATE person SET ${setClause}, updated_at = now()
         WHERE id = ANY($1) AND family_id = $2 AND status = 'active'`,
        [personIds, FAMILY_ID, ...keys.map((k) => fields[k])]
      );
      return { updated: before.length, before };
    });

    await audit({
      familyId: FAMILY_ID,
      actorUserId: req.user.id, actorLabel: req.user.username,
      action: 'update', entityType: 'person', entityId: null,
      before: result.before, after: { bulk: true, set: fields, count: result.updated },
    });

    res.json({ ok: true, updated: result.updated, set: fields });
  } catch (err2) {
    logger.error('[quality] bulk-update:', err2);
    res.status(500).json({ error: '批量修改失败' });
  }
});

// 名录高级筛选（在现有 /api/persons 之外补充质量维度）
router.get('/search', auth, async (req, res) => {
  try {
    const { persons, ctx } = await loadContext();
    auditCompleteness(persons, ctx);
    const filter = {
      missing: req.query.missing || undefined,
      noSource: req.query.noSource === 'true',
      noParents: req.query.noParents === 'true',
      incompleteBelow: req.query.incompleteBelow || undefined,
      alive: req.query.alive,
      gender: req.query.gender || undefined,
      bornFrom: req.query.bornFrom,
      bornTo: req.query.bornTo,
    };
    const keyword = String(req.query.keyword || '').trim();
    const list = persons
      .filter((p) => {
        if (keyword) {
          const name = `${p.family_name || ''}${p.given_name || ''}`;
          if (!name.includes(keyword)) return false;
        }
        return matchesFilter(p, filter, ctx);
      })
      .map((p) => ({
        id: p.id,
        name: `${p.family_name || ''}${p.given_name || ''}`,
        gender: p.gender,
        gen: p.generation_no,
        branch: p.branch,
        is_deceased: p.is_deceased,
        birth_year: p.birth_date ? new Date(p.birth_date).getUTCFullYear() : null,
        completeness: p.completeness,
        hasSource: ctx.hasCitation(p.id),
        hasParents: ctx.hasParent(p.id),
      }));

    res.json({ total: list.length, items: list.slice(0, 200), filter: { ...filter, keyword } });
  } catch (err) {
    logger.error('[quality] search:', err);
    res.status(500).json({ error: '筛选失败' });
  }
});

export default router;