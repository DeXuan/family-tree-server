import { logger } from '../modules/logger.js';
import express from 'express';
import { query, withTransaction } from '../db/db.js';
import { auth, adminOnly } from '../middleware/auth.js';
import { audit } from './audit.js';
import { config } from '../config/index.js';
import { isUuid } from '../middleware/params.js';

const router = express.Router();
const FAMILY_ID = config.familyId;

const yearOf = (v) => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return isNaN(d.getTime()) ? null : d.getUTCFullYear();
};

// ---------- 重复成员检测（姓名一致 + 出生年接近） ----------
router.get('/duplicates', auth, adminOnly, async (req, res) => {
  const { rows } = await query(
    `SELECT id, family_name, given_name, courtesy_name, birth_date, generation_no, branch, is_deceased
     FROM person WHERE family_id = $1 AND status = 'active'
     ORDER BY family_name, given_name, birth_date NULLS LAST`,
    [FAMILY_ID]
  );

  const groups = new Map();
  for (const p of rows) {
    const key = `${p.family_name}|${p.given_name}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  }

  const pairs = [];
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j];
        const ya = yearOf(a.birth_date), yb = yearOf(b.birth_date);
        let score = 0;
        let reason = '';
        if (ya && yb) {
          const diff = Math.abs(ya - yb);
          if (diff > 2) continue;
          score = diff === 0 ? 100 : 80;
          reason = diff === 0 ? '姓名与出生年完全一致' : `姓名一致，出生年相差 ${diff} 年`;
        } else {
          score = 60;
          reason = '姓名一致，出生年缺失，建议人工核对';
        }
        if (a.courtesy_name && a.courtesy_name === b.courtesy_name) {
          score += 5;
          reason += '；字号一致';
        }
        pairs.push({
          score,
          reason,
          a: { id: a.id, name: `${a.family_name}${a.given_name}`, birthYear: ya, gen: a.generation_no, branch: a.branch },
          b: { id: b.id, name: `${b.family_name}${b.given_name}`, birthYear: yb, gen: b.generation_no, branch: b.branch },
        });
      }
    }
  }

  pairs.sort((x, y) => y.score - x.score);
  res.json(pairs.slice(0, 50));
});

// ---------- 合并成员（把 source 合并进 target） ----------
router.post('/merge', auth, adminOnly, async (req, res) => {
  const { sourceId, targetId, fieldChoices = {} } = req.body || {};
  // fieldChoices: { occupation: 'source', bio: 'target' } —— 逐字段指定取哪边
  const CHOOSABLE = [
    'courtesy_name', 'generation_name', 'generation_no', 'branch', 'gender',
    'birth_date', 'birth_precision', 'birth_place',
    'death_date', 'death_precision', 'death_place', 'burial_place',
    'is_deceased', 'occupation', 'education', 'bio',
  ];
  const choices = {};
  for (const f of CHOOSABLE) {
    const v = fieldChoices[f];
    if (v === 'source' || v === 'target') choices[f] = v;
  }
  if (!isUuid(sourceId) || !isUuid(targetId)) {
    return res.status(400).json({ error: '成员 ID 格式无效' });
  }
  if (sourceId === targetId) return res.status(400).json({ error: '不能与自身合并' });

  try {
    const result = await withTransaction(async (client) => {
      const { rows: pair } = await client.query(
        `SELECT * FROM person
         WHERE id = ANY($1) AND family_id = $2 AND status = 'active' FOR UPDATE`,
        [[sourceId, targetId], FAMILY_ID]
      );
      const source = pair.find((p) => p.id === sourceId);
      const target = pair.find((p) => p.id === targetId);
      if (!source || !target) return { error: '成员不存在或已归档', status: 404 };

      const counts = { parents: 0, children: 0, marriages: 0, events: 0, media: 0, citations: 0, associations: 0, stories: 0 };

      // 1) 亲子关系重挂
      const { rows: edges } = await client.query(
        'SELECT * FROM parent_child WHERE parent_id = $1 OR child_id = $1',
        [sourceId]
      );
      for (const e of edges) {
        const parentId = e.parent_id === sourceId ? targetId : e.parent_id;
        const childId = e.child_id === sourceId ? targetId : e.child_id;
        if (parentId === childId) continue;
        await client.query(
          `INSERT INTO parent_child (parent_id, child_id, relation_type, certainty, note)
           VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (parent_id, child_id, relation_type) DO NOTHING`,
          [parentId, childId, e.relation_type, e.certainty, e.note]
        );
        if (e.parent_id === sourceId) counts.parents++;
        else counts.children++;
      }
      await client.query('DELETE FROM parent_child WHERE parent_id = $1 OR child_id = $1', [sourceId]);

      // 2) 婚姻重挂（目标已与同一人存在有效婚姻时丢弃源记录）
      const { rows: marriages } = await client.query(
        'SELECT * FROM marriage WHERE person_a_id = $1 OR person_b_id = $1',
        [sourceId]
      );
      for (const m of marriages) {
        const partner = m.person_a_id === sourceId ? m.person_b_id : m.person_a_id;
        if (partner === targetId) {
          await client.query('DELETE FROM marriage WHERE id = $1', [m.id]);
          continue;
        }
        const { rows: existing } = await client.query(
          `SELECT id FROM marriage
           WHERE ((person_a_id = $1 AND person_b_id = $2) OR (person_a_id = $2 AND person_b_id = $1))
             AND status <> 'divorced' LIMIT 1`,
          [targetId, partner]
        );
        if (existing.length) {
          await client.query('DELETE FROM marriage WHERE id = $1', [m.id]);
        } else {
          const [a, b] = [targetId, partner].sort();
          await client.query('UPDATE marriage SET person_a_id = $1, person_b_id = $2 WHERE id = $3', [a, b, m.id]);
        }
        counts.marriages++;
      }

      // 3) 事件
      const ev = await client.query('UPDATE event SET person_id = $1 WHERE person_id = $2', [targetId, sourceId]);
      counts.events = ev.rowCount ?? ev.rows.length;

      // 4) 媒体关联
      const { rows: links } = await client.query(
        "SELECT id, media_id FROM media_link WHERE target_type = 'person' AND target_id = $1",
        [sourceId]
      );
      for (const link of links) {
        const { rows: exist } = await client.query(
          "SELECT id FROM media_link WHERE media_id = $1 AND target_type = 'person' AND target_id = $2",
          [link.media_id, targetId]
        );
        if (exist.length) await client.query('DELETE FROM media_link WHERE id = $1', [link.id]);
        else await client.query('UPDATE media_link SET target_id = $1 WHERE id = $2', [targetId, link.id]);
        counts.media++;
      }

      // 4.5) 人物引文转移（事件引文随事件移动）
      const { rows: citations } = await client.query(
        "SELECT id, source_id FROM citation WHERE target_type = 'person' AND target_id = $1",
        [sourceId]
      );
      for (const c of citations) {
        const { rows: exist } = await client.query(
          `SELECT id FROM citation
           WHERE source_id = $1 AND target_type = 'person' AND target_id = $2`,
          [c.source_id, targetId]
        );
        if (exist.length) await client.query('DELETE FROM citation WHERE id = $1', [c.id]);
        else await client.query(
          "UPDATE citation SET target_id = $1 WHERE id = $2", [targetId, c.id]
        );
        counts.citations++;
      }

      // 4.6) 人物关联转移
      const { rows: assocs } = await client.query(
        'SELECT * FROM association WHERE person_a_id = $1 OR person_b_id = $1', [sourceId]
      );
      for (const as of assocs) {
        const aId = as.person_a_id === sourceId ? targetId : as.person_a_id;
        const bId = as.person_b_id === sourceId ? targetId : as.person_b_id;
        await client.query('DELETE FROM association WHERE id = $1', [as.id]);
        if (aId === bId) continue;
        await client.query(
          `INSERT INTO association (family_id, person_a_id, person_b_id, role, note, created_by, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           ON CONFLICT (person_a_id, person_b_id, role) DO NOTHING`,
          [FAMILY_ID, aId, bId, as.role, as.note, as.created_by, as.created_at]
        );
        counts.associations++;
      }

      // 4.7) 故事关联转移
      const { rows: sLinks } = await client.query(
        'SELECT id, story_id, role FROM story_person WHERE person_id = $1', [sourceId]
      );
      for (const l of sLinks) {
        const { rows: exist } = await client.query(
          'SELECT id FROM story_person WHERE story_id = $1 AND person_id = $2 AND role = $3',
          [l.story_id, targetId, l.role]
        );
        if (exist.length) await client.query('DELETE FROM story_person WHERE id = $1', [l.id]);
        else await client.query('UPDATE story_person SET person_id = $1 WHERE id = $2', [targetId, l.id]);
        counts.stories++;
      }

      // 5) 账户绑定：目标未绑定时接管，否则解绑
      const { rows: targetUser } = await client.query('SELECT id FROM users WHERE person_id = $1 LIMIT 1', [targetId]);
      if (!targetUser.length) {
        await client.query('UPDATE users SET person_id = $1 WHERE person_id = $2', [targetId, sourceId]);
      } else {
        await client.query('UPDATE users SET person_id = NULL WHERE person_id = $1', [sourceId]);
      }

      // 6) 空字段补齐（目标优先）
      const former = [...new Set([...(target.former_names || []), ...(source.former_names || [])])];
      const extra = { ...(source.extra || {}), ...(target.extra || {}) };
      const contact = (target.contact && Object.keys(target.contact).length) ? target.contact : source.contact;
      const pick = (field) => {
        // 显式指定取哪边时优先服从
        if (choices[field] === 'source') return source[field] ?? target[field];
        if (choices[field] === 'target') return target[field] ?? source[field];
        // 默认：保留方非空优先
        const tv = target[field];
        if (tv !== null && tv !== undefined && tv !== '') return tv;
        return source[field] ?? tv;
      };
      await client.query(
        `UPDATE person SET
           courtesy_name = $2, generation_name = $3, generation_no = $4, branch = $5,
           gender = $6, birth_date = $7, birth_precision = $8, birth_place = $9,
           death_date = $10, death_precision = $11, death_place = $12, burial_place = $13,
           is_deceased = $14, occupation = $15, education = $16, bio = $17,
           former_names = $18, extra = $19, contact = $20, updated_at = now()
         WHERE id = $1`,
        [
          targetId,
          pick('courtesy_name'), pick('generation_name'), pick('generation_no'), pick('branch'),
          choices.gender === 'source' ? source.gender : (target.gender !== 'unknown' ? target.gender : source.gender),
          pick('birth_date'), pick('birth_precision'), pick('birth_place'),
          pick('death_date'), pick('death_precision'), pick('death_place'), pick('burial_place'),
          choices.is_deceased === 'source' ? source.is_deceased : (choices.is_deceased === 'target' ? target.is_deceased : (target.is_deceased || source.is_deceased)),
          pick('occupation'), pick('education'), pick('bio'),
          JSON.stringify(former),
          JSON.stringify(extra),
          JSON.stringify(contact || {}),
        ]
      );

      // 7) 删除源成员（剩余关联级联清理）
      await client.query('DELETE FROM person WHERE id = $1', [sourceId]);

      return { targetId, sourceName: `${source.family_name}${source.given_name}`, counts, choices };
    });

    if (result.error) return res.status(result.status || 400).json({ error: result.error });

    await audit({
      familyId: FAMILY_ID,
      actorUserId: req.user.id, actorLabel: req.user.username,
      action: 'update', entityType: 'person', entityId: result.targetId,
      after: { mergedFrom: result.sourceName, counts: result.counts, fieldChoices: result.choices },
    });

    res.json({
      ok: true,
      targetId: result.targetId,
      merged: result.sourceName,
      counts: result.counts,
      choices: result.choices || {},
    });
  } catch (err) {
    logger.error('[maintenance] merge:', err);
    res.status(500).json({ error: '合并失败：' + err.message });
  }
});

export default router;
