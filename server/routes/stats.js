import { logger } from '../modules/logger.js';
import express from 'express';
import { query } from '../db/db.js';
import { auth } from '../middleware/auth.js';
import { currentFamilyId } from '../middleware/tenant.js';

const router = express.Router();

router.get('/', auth, async (req, res) => {
  try {
    const [{ rows: agg }, { rows: branches }, { rows: recent }, { rows: fam }, { rows: arch }] = await Promise.all([
      query(`SELECT COUNT(*)::int AS total,
                    COUNT(*) FILTER (WHERE NOT is_deceased)::int AS alive,
                    COUNT(*) FILTER (WHERE is_deceased)::int AS deceased,
                    MAX(generation_no)::int AS max_gen,
                    COUNT(DISTINCT generation_no) FILTER (WHERE NOT is_deceased AND generation_no IS NOT NULL)::int AS alive_generations
             FROM person WHERE family_id = $1 AND status = 'active'`, [currentFamilyId()]),
      query(`SELECT branch, COUNT(*)::int AS c FROM person
             WHERE family_id = $1 AND status = 'active' AND branch <> ''
             GROUP BY branch ORDER BY branch`, [currentFamilyId()]),
      query(`SELECT actor_label, action, entity_type, entity_id, before, after, created_at FROM audit_log
             WHERE family_id = $1 ORDER BY created_at DESC LIMIT 5`, [currentFamilyId()]),
      query('SELECT name, surname FROM family WHERE id = $1', [currentFamilyId()]),
      query("SELECT COUNT(*)::int AS c FROM person WHERE family_id = $1 AND status = 'archived'", [currentFamilyId()]),
    ]);
    res.json({
      familyName: fam[0]?.name || '家族族谱',
      surname: fam[0]?.surname || '',
      total: agg[0].total,
      alive: agg[0].alive,
      deceased: agg[0].deceased,
      archived: arch[0].c,
      maxGeneration: agg[0].max_gen || 0,
      aliveGenerations: agg[0].alive_generations || 0,
      branches,
      recent,
    });
  } catch (err) {
    logger.error('[stats]', err);
    res.status(500).json({ error: '统计查询失败' });
  }
});

export default router;
