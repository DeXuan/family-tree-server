import express from 'express';
import { query, withTransaction } from '../db/db.js';
import { auth, editorUp, adminOnly } from '../middleware/auth.js';
import { audit } from './audit.js';
import { config } from '../config/index.js';
import { uuidParam } from '../middleware/params.js';
import { renderStoryMarkdown, storyExcerpt } from '../modules/storyMarkdown.js';
import { logger } from '../modules/logger.js';
import { validateBody } from '../middleware/validateBody.js';
import { snapshotStory } from './storyVersions.js';

const router = express.Router();
const FAMILY_ID = config.familyId;
router.param('id', uuidParam);

const RANK = { L0: 0, L1: 1, L2: 2 };
const VISIBILITY = ['L0', 'L1', 'L2'];
const PRECISIONS = ['exact', 'year', 'about', 'range', 'unknown'];

function viewerRank(req) {
  if (req.user.role === 'admin') return 2;
  return req.user.role === 'guest' ? 0 : 1;
}

function parseDate(v) {
  if (v === undefined) return undefined;
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

async function loadLinked(storyIds) {
  if (!storyIds.length) return new Map();
  const { rows } = await query(
    `SELECT sp.story_id, sp.role, p.id, p.family_name, p.given_name
     FROM story_person sp JOIN person p ON p.id = sp.person_id
     WHERE sp.story_id = ANY($1) AND p.status = 'active'
     ORDER BY sp.role, p.given_name`,
    [storyIds]
  );
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.story_id)) map.set(r.story_id, []);
    map.get(r.story_id).push({
      id: r.id, name: `${r.family_name || ''}${r.given_name || ''}`, role: r.role,
    });
  }
  return map;
}

// 列表
router.get('/', auth, async (req, res) => {
  const keyword = String(req.query.keyword || '').trim();
  const params = [FAMILY_ID];
  let where = 'family_id = $1';
  if (keyword) {
    params.push(`%${keyword}%`);
    where += ` AND (title ILIKE $${params.length} OR body ILIKE $${params.length} OR author_name ILIKE $${params.length})`;
  }
  const { rows } = await query(
    `SELECT id, title, body, author_name, story_date, date_precision, visibility, created_at, updated_at
     FROM story WHERE ${where} ORDER BY COALESCE(story_date, created_at::date) DESC, created_at DESC LIMIT 200`,
    params
  );

  const maxRank = viewerRank(req);
  const visible = rows.filter((r) => RANK[r.visibility] <= maxRank);
  const linked = await loadLinked(visible.map((r) => r.id));

  res.json(visible.map((r) => ({
    id: r.id,
    title: r.title,
    excerpt: storyExcerpt(r.body),
    authorName: r.author_name,
    date: r.story_date,
    precision: r.date_precision,
    visibility: r.visibility,
    persons: linked.get(r.id) || [],
    updatedAt: r.updated_at,
  })));
});

// 某成员参与的故事
router.get('/person/:personId', auth, async (req, res) => {
  if (!/^[0-9a-f-]{36}$/i.test(req.params.personId)) {
    return res.status(400).json({ error: 'ID 无效' });
  }
  const { rows } = await query(
    `SELECT s.id, s.title, s.body, s.author_name, s.story_date, s.date_precision,
            s.visibility, sp.role
     FROM story s JOIN story_person sp ON sp.story_id = s.id
     WHERE s.family_id = $1 AND sp.person_id = $2
     ORDER BY COALESCE(s.story_date, s.created_at::date) DESC`,
    [FAMILY_ID, req.params.personId]
  );
  const maxRank = viewerRank(req);
  res.json(rows
    .filter((r) => RANK[r.visibility] <= maxRank)
    .map((r) => ({
      id: r.id,
      title: r.title,
      excerpt: storyExcerpt(r.body),
      authorName: r.author_name,
      date: r.story_date,
      role: r.role,
      visibility: r.visibility,
    })));
});

// 详情（含渲染后的 HTML）
router.get('/:id', auth, async (req, res) => {
  const { rows } = await query(
    'SELECT * FROM story WHERE id = $1 AND family_id = $2', [req.params.id, FAMILY_ID]
  );
  if (!rows.length) return res.status(404).json({ error: '故事不存在' });
  const story = rows[0];
  if (RANK[story.visibility] > viewerRank(req)) {
    return res.status(403).json({ error: '无权查看该故事' });
  }
  const linked = await loadLinked([story.id]);

  // 内嵌媒体按可见级别过滤：无权查看的图片显示为占位
  const mediaIds = [...story.body.matchAll(/media:([0-9a-f-]{36})/gi)].map((m) => m[1]);
  let allowedMedia = null;
  if (mediaIds.length) {
    const { rows: mediaRows } = await query(
      `SELECT id, visibility FROM media WHERE id = ANY($1) AND family_id = $2`,
      [mediaIds, FAMILY_ID]
    );
    const rank = viewerRank(req);
    allowedMedia = new Set(
      mediaRows.filter((m) => ({ L0: 0, L1: 1, L2: 2 }[m.visibility] ?? 1) <= rank).map((m) => m.id)
    );
  }

  res.json({
    id: story.id,
    title: story.title,
    body: story.body,
    html: renderStoryMarkdown(story.body, { allowedMedia }),
    authorName: story.author_name,
    date: story.story_date,
    precision: story.date_precision,
    visibility: story.visibility,
    persons: linked.get(story.id) || [],
    updatedAt: story.updated_at,
  });
});

function validate(body, { partial = false } = {}) {
  const b = body || {};
  if (!partial) {
    if (!b.title || !String(b.title).trim()) return { error: '标题必填' };
  }
  if (b.title !== undefined && String(b.title).length > 200) return { error: '标题不能超过 200 字' };
  if (b.body !== undefined && String(b.body).length > 50000) return { error: '正文不能超过 5 万字' };
  if (b.authorName !== undefined && String(b.authorName).length > 100) return { error: '署名不能超过 100 字' };
  if (b.visibility !== undefined && !VISIBILITY.includes(b.visibility)) return { error: '可见级别无效' };
  if (b.precision !== undefined && !PRECISIONS.includes(b.precision)) return { error: '日期精度无效' };
  if (b.personIds !== undefined) {
    if (!Array.isArray(b.personIds)) return { error: '关联人物必须是数组' };
    if (b.personIds.length > 50) return { error: '最多关联 50 位人物' };
  }
  return { ok: true };
}

async function syncPersons(client, storyId, personIds = [], role = 'subject') {
  await client.query('DELETE FROM story_person WHERE story_id = $1', [storyId]);
  const uniq = [...new Set(personIds)].slice(0, 50);
  for (const pid of uniq) {
    const { rows } = await client.query(
      "SELECT id FROM person WHERE id = $1 AND family_id = $2 AND status = 'active'",
      [pid, FAMILY_ID]
    );
    if (!rows.length) continue;
    await client.query(
      `INSERT INTO story_person (story_id, person_id, role) VALUES ($1,$2,$3)
       ON CONFLICT (story_id, person_id, role) DO NOTHING`,
      [storyId, pid, role]
    );
  }
  return uniq.length;
}

// 新建
router.post('/', auth, editorUp, async (req, res) => {
  const b = req.body || {};
  const v = validate(b);
  if (v.error) return res.status(400).json({ error: v.error });
  const visibility = b.visibility || 'L1';
  if (visibility === 'L2' && req.user.role !== 'admin') {
    return res.status(403).json({ error: '仅管理员可将故事设为私密' });
  }

  try {
    const created = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO story (family_id, title, body, author_name, story_date, date_precision, visibility, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [FAMILY_ID, String(b.title).trim(), String(b.body || ''), String(b.authorName || ''),
          parseDate(b.date) ?? null, b.precision || 'unknown', visibility, req.user.id]
      );
      const id = rows[0].id;
      await syncPersons(client, id, b.personIds || []);
      return id;
    });

    await audit({
      familyId: FAMILY_ID,
      actorUserId: req.user.id, actorLabel: req.user.username,
      action: 'create', entityType: 'story', entityId: created,
      after: { title: b.title, visibility, persons: (b.personIds || []).length },
    });
    res.status(201).json({ id: created });
  } catch (err) {
    logger.error('[stories] create:', err);
    res.status(500).json({ error: '故事创建失败' });
  }
});

// 修改
router.put('/:id', auth, editorUp, async (req, res) => {
  const b = req.body || {};
  const v = validate(b, { partial: true });
  if (v.error) return res.status(400).json({ error: v.error });

  const { rows: beforeRows } = await query(
    'SELECT * FROM story WHERE id = $1 AND family_id = $2', [req.params.id, FAMILY_ID]
  );
  if (!beforeRows.length) return res.status(404).json({ error: '故事不存在' });
  const before = beforeRows[0];

  if (b.visibility === 'L2' && req.user.role !== 'admin') {
    return res.status(403).json({ error: '仅管理员可将故事设为私密' });
  }

  const fields = {
    title: b.title !== undefined ? String(b.title).trim() : undefined,
    body: b.body !== undefined ? String(b.body) : undefined,
    author_name: b.authorName !== undefined ? String(b.authorName) : undefined,
    story_date: parseDate(b.date),
    date_precision: b.precision,
    visibility: b.visibility,
  };
  const keys = Object.keys(fields).filter((k) => fields[k] !== undefined);
  if (!keys.length && b.personIds === undefined) {
    return res.status(400).json({ error: '没有要更新的字段' });
  }

  try {
    await withTransaction(async (client) => {
      // 更新前保存快照
      await snapshotStory(client, before, req.user.id, req.user.username, b.versionNote || '');
      if (keys.length) {
        const setClause = keys.map((k, i) => `${k} = $${i + 3}`).join(', ');
        await client.query(
          `UPDATE story SET ${setClause}, updated_at = now() WHERE id = $1 AND family_id = $2`,
          [req.params.id, FAMILY_ID, ...keys.map((k) => fields[k])]
        );
      } else {
        await client.query('UPDATE story SET updated_at = now() WHERE id = $1', [req.params.id]);
      }
      if (b.personIds !== undefined) {
        await syncPersons(client, req.params.id, b.personIds);
      }
    });

    await audit({
      familyId: FAMILY_ID,
      actorUserId: req.user.id, actorLabel: req.user.username,
      action: 'update', entityType: 'story', entityId: req.params.id,
      before, after: { ...fields, personIds: b.personIds },
    });
    res.json({ ok: true });
  } catch (err) {
    logger.error('[stories] update:', err);
    res.status(500).json({ error: '故事保存失败' });
  }
});

// 删除
router.delete('/:id', auth, adminOnly, async (req, res) => {
  const { rows } = await query(
    'DELETE FROM story WHERE id = $1 AND family_id = $2 RETURNING title', [req.params.id, FAMILY_ID]
  );
  if (!rows.length) return res.status(404).json({ error: '故事不存在' });
  await audit({
    familyId: FAMILY_ID,
    actorUserId: req.user.id, actorLabel: req.user.username,
    action: 'delete', entityType: 'story', entityId: req.params.id,
    before: { title: rows[0].title },
  });
  res.json({ ok: true });
});

export default router;