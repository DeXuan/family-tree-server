import express from 'express';
import { query, withTransaction } from '../db/db.js';
import { auth, adminOnly } from '../middleware/auth.js';
import { audit } from './audit.js';
import { currentFamilyId } from '../middleware/tenant.js';
import { uuidParam } from '../middleware/params.js';
import { logger } from '../modules/logger.js';

const router = express.Router();
router.param('id', uuidParam);

/** 保存一个版本快照（在更新前调用；事务内） */
export async function snapshotStory(client, story, userId, label, note = '') {
  const { rows: maxRows } = await client.query(
    'SELECT COALESCE(MAX(version_no), 0) AS n FROM story_version WHERE story_id = $1',
    [story.id]
  );
  const versionNo = maxRows[0].n + 1;
  const { rows: links } = await client.query(
    "SELECT person_id FROM story_person WHERE story_id = $1 AND role = 'subject'",
    [story.id]
  );
  await client.query(
    `INSERT INTO story_version (story_id, version_no, title, body, author_name, story_date,
       date_precision, visibility, person_ids, saved_by, saved_label, note)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [story.id, versionNo, story.title, story.body, story.author_name,
      story.story_date, story.date_precision, story.visibility,
      JSON.stringify(links.map((l) => l.person_id)), userId, label, String(note).slice(0, 300)]
  );
  return versionNo;
}

/** 版本列表 */
router.get('/:id/versions', auth, async (req, res) => {
  const { rows } = await query(
    `SELECT id, version_no, title, author_name, story_date, visibility, saved_label, note, created_at,
            length(body) AS body_length
     FROM story_version WHERE story_id = $1
     ORDER BY version_no DESC`,
    [req.params.id]
  );
  res.json(rows);
});

/** 某版本详情（含 diff 所需的正文） */
router.get('/:id/versions/:version', auth, async (req, res) => {
  const version = Number(req.params.version);
  if (!Number.isInteger(version) || version < 1) {
    return res.status(400).json({ error: '版本号无效' });
  }
  const { rows } = await query(
    'SELECT * FROM story_version WHERE story_id = $1 AND version_no = $2',
    [req.params.id, version]
  );
  if (!rows.length) return res.status(404).json({ error: '版本不存在' });
  const v = rows[0];
  let personNames = [];
  const ids = Array.isArray(v.person_ids) ? v.person_ids : [];
  if (ids.length) {
    const { rows: ps } = await query(
      'SELECT id, family_name, given_name FROM person WHERE id = ANY($1)',
      [ids]
    );
    personNames = ps.map((p) => ({ id: p.id, name: `${p.family_name || ''}${p.given_name || ''}` }));
  }
  res.json({ ...v, persons: personNames });
});

/** 回滚到指定版本（admin） */
router.post('/:id/versions/:version/restore', auth, adminOnly, async (req, res) => {
  const version = Number(req.params.version);
  if (!Number.isInteger(version) || version < 1) {
    return res.status(400).json({ error: '版本号无效' });
  }

  try {
    const result = await withTransaction(async (client) => {
      const { rows: storyRows } = await client.query(
        'SELECT * FROM story WHERE id = $1 AND family_id = $2 FOR UPDATE',
        [req.params.id, currentFamilyId()]
      );
      const story = storyRows[0];
      if (!story) return { error: '故事不存在', status: 404 };

      const { rows: versionRows } = await client.query(
        'SELECT * FROM story_version WHERE story_id = $1 AND version_no = $2',
        [story.id, version]
      );
      const v = versionRows[0];
      if (!v) return { error: '版本不存在', status: 404 };

      // 先把当前状态存为新版本（保留回滚前现场）
      await snapshotStory(client, story, req.user.id, req.user.username, `回滚前的状态（回滚至 v${version}）`);

      await client.query(
        `UPDATE story SET title = $1, body = $2, author_name = $3, story_date = $4,
           date_precision = $5, visibility = $6, updated_at = now()
         WHERE id = $7`,
        [v.title, v.body, v.author_name, v.story_date, v.date_precision, v.visibility, story.id]
      );

      await client.query('DELETE FROM story_person WHERE story_id = $1', [story.id]);
      for (const pid of (Array.isArray(v.person_ids) ? v.person_ids : [])) {
        const { rows: exists } = await client.query(
          "SELECT id FROM person WHERE id = $1 AND family_id = $2 AND status = 'active'",
          [pid, currentFamilyId()]
        );
        if (exists.length) {
          await client.query(
            "INSERT INTO story_person (story_id, person_id, role) VALUES ($1,$2,'subject')",
            [story.id, pid]
          );
        }
      }
      return { version };
    });

    if (result.error) return res.status(result.status || 400).json({ error: result.error });

    await audit({
      familyId: currentFamilyId(),
      actorUserId: req.user.id, actorLabel: req.user.username,
      action: 'update', entityType: 'story', entityId: req.params.id,
      after: { rollbackToVersion: result.version },
    });
    res.json({ ok: true, restoredVersion: result.version });
  } catch (err) {
    logger.error('[story-versions] restore:', err);
    res.status(500).json({ error: '回滚失败' });
  }
});

export default router;
