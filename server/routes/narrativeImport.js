import express from 'express';
import { query, withTransaction } from '../db/db.js';
import { auth, editorUp } from '../middleware/auth.js';
import { audit } from './audit.js';
import { config } from '../config/index.js';
import { parseNarrative, parseTable } from '../modules/narrativeParse.js';
import { validatePersonInput } from '../middleware/validation.js';
import { logger } from '../modules/logger.js';

const router = express.Router();
const FAMILY_ID = config.familyId;

const GENDER_LABEL = { male: '男', female: '女', unknown: '未知' };

async function existingPersons() {
  const { rows } = await query(
    "SELECT id, family_name, given_name FROM person WHERE family_id = $1 AND status = 'active'",
    [FAMILY_ID]
  );
  return rows;
}

/** 把草稿与库内既有成员对齐：标记已存在/新建 */
function annotateDraft(draft, existing) {
  const byName = new Map(existing.map((p) => [`${p.family_name}${p.given_name}`, p]));
  const persons = draft.persons.map((p) => ({
    ...p,
    exists: byName.has(p.name),
    existingId: byName.get(p.name)?.id || null,
    genderLabel: GENDER_LABEL[p.gender] || '未知',
    note: p.isSelf && p.name === '我' ? '请把「我」改成真实姓名' : (p.note || ''),
    invalidReason: p.name === '我' ? '占位姓名，导入前请修改' : '',
  }));

  const nameSet = new Set(persons.map((p) => p.name));
  const relations = draft.relations.map((r) => {
    const missing = [r.from, r.to].filter((n) => !nameSet.has(n));
    return {
      ...r,
      valid: missing.length === 0,
      reason: missing.length ? `缺少成员：${missing.join('、')}` : '',
      existsInDb: false,
    };
  });

  return { persons, relations, warnings: draft.warnings };
}

// 预检：口述 / 表格
router.post('/narrative/preview', auth, editorUp, async (req, res) => {
  const { text, mode = 'narrative' } = req.body || {};
  if (!text || typeof text !== 'string') return res.status(400).json({ error: '请提供要解析的文本' });
  if (text.length > 20000) return res.status(400).json({ error: '文本过长（上限 2 万字）' });

  const draft = mode === 'table' ? parseTable(text) : parseNarrative(text);
  const existing = await existingPersons();
  const annotated = annotateDraft(draft, existing);

  res.json({
    mode,
    ...annotated,
    stats: {
      persons: annotated.persons.length,
      newPersons: annotated.persons.filter((p) => !p.exists && !p.invalidReason).length,
      existing: annotated.persons.filter((p) => p.exists).length,
      relations: annotated.relations.length,
      validRelations: annotated.relations.filter((r) => r.valid).length,
    },
  });
});

// 提交：只接受前端校对后的草稿
router.post('/narrative/commit', auth, editorUp, async (req, res) => {
  const { persons = [], relations = [] } = req.body || {};
  if (!Array.isArray(persons) || !persons.length) {
    return res.status(400).json({ error: '没有可导入的成员' });
  }
  if (persons.length > 500) return res.status(400).json({ error: '单次最多导入 500 位成员' });

  for (const p of persons) {
    if (!p.name || !/^[\u4e00-\u9fa5]{2,4}$/.test(p.name)) {
      return res.status(400).json({ error: `姓名「${p.name || ''}」无效，请先修改` });
    }
    const err = validatePersonInput({
      family_name: p.name.slice(0, 1),
      given_name: p.name.slice(1),
      birth_date: p.birthYear ? `${p.birthYear}-01-01` : null,
      birth_precision: p.birthYear ? 'year' : 'unknown',
      birth_place: p.birthPlace || '',
      occupation: '',
      bio: '',
    });
    if (err) return res.status(400).json({ error: `${p.name}：${err}` });
  }

  try {
    const report = await withTransaction(async (client) => {
      const { rows: existingRows } = await client.query(
        "SELECT id, family_name, given_name FROM person WHERE family_id = $1 AND status = 'active'",
        [FAMILY_ID]
      );
      const byName = new Map(existingRows.map((p) => [`${p.family_name}${p.given_name}`, p.id]));

      let created = 0, reused = 0;
      const idByName = new Map();

      for (const p of persons) {
        const name = p.name;
        if (byName.has(name)) {
          idByName.set(name, byName.get(name));
          reused++;
          continue;
        }
        const { rows } = await client.query(
          `INSERT INTO person (family_id, family_name, given_name, gender,
             birth_date, birth_precision, birth_place, generation_name, is_deceased, status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,false,'active')
           RETURNING id`,
          [
            FAMILY_ID,
            name.slice(0, 1),
            name.slice(1),
            ['male', 'female'].includes(p.gender) ? p.gender : 'unknown',
            p.birthYear ? `${p.birthYear}-01-01` : null,
            p.birthYear ? 'year' : 'unknown',
            p.birthPlace || '',
            (p.generationName || '').slice(0, 2),
          ]
        );
        idByName.set(name, rows[0].id);
        byName.set(name, rows[0].id);
        created++;
      }

      let parentEdges = 0, spouseEdges = 0, skipped = 0;
      for (const rel of relations) {
        if (!rel || rel.valid === false) { skipped++; continue; }
        const fromId = idByName.get(rel.from);
        const toId = idByName.get(rel.to);
        if (!fromId || !toId || fromId === toId) { skipped++; continue; }

        if (rel.kind === 'parent') {
          // 写库前再查一次环路
          const { rows: ancestors } = await client.query(
            `WITH RECURSIVE up AS (
               SELECT parent_id FROM parent_child WHERE child_id = $1
               UNION
               SELECT pc.parent_id FROM parent_child pc JOIN up ON pc.child_id = up.parent_id
             ) SELECT parent_id FROM up`,
            [fromId]
          );
          if (ancestors.some((a) => a.parent_id === toId)) { skipped++; continue; }

          await client.query(
            `INSERT INTO parent_child (parent_id, child_id, relation_type, certainty)
             VALUES ($1,$2,'biological','probable')
             ON CONFLICT (parent_id, child_id, relation_type) DO NOTHING`,
            [fromId, toId]
          );
          parentEdges++;
        } else if (rel.kind === 'spouse') {
          const [a, b] = [fromId, toId].sort();
          const { rows: exists } = await client.query(
            `SELECT id FROM marriage WHERE person_a_id = $1 AND person_b_id = $2 AND status <> 'divorced' LIMIT 1`,
            [a, b]
          );
          if (!exists.length) {
            await client.query(
              `INSERT INTO marriage (person_a_id, person_b_id, union_type, status) VALUES ($1,$2,'married','ongoing')`,
              [a, b]
            );
            spouseEdges++;
          }
        } else {
          skipped++;
        }
      }

      return { created, reused, parentEdges, spouseEdges, skipped };
    });

    await audit({
      familyId: FAMILY_ID,
      actorUserId: req.user.id, actorLabel: req.user.username,
      action: 'import', entityType: 'person', entityId: null,
      after: { ...report, mode: 'narrative' },
    });

    res.json({ ok: true, ...report });
  } catch (err) {
    logger.error('[narrative] commit:', err);
    res.status(500).json({ error: '导入失败：' + err.message });
  }
});

export default router;