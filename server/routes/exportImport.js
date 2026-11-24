import { logger } from '../modules/logger.js';
import express from 'express';
import multer from 'multer';
import { randomUUID } from 'crypto';
import { query, withTransaction } from '../db/db.js';
import { auth, adminOnly } from '../middleware/auth.js';
import { audit } from './audit.js';
import { personsToExcel, excelToPersons } from '../modules/excel.js';
import { exportGedcom, parseGedcom } from '../modules/gedcom.js';
import { tryDecryptJSON } from '../modules/crypto.js';
import { currentFamilyId } from '../middleware/tenant.js';

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /\.(xlsx|ged|gedcom|txt)$/i.test(file.originalname);
    cb(ok ? null : new Error('仅支持 .xlsx / .ged / .gedcom 文件'), ok);
  },
});

async function loadAll() {
  const [{ rows: persons }, { rows: parentChild }, { rows: unions }, { rows: fam }] = await Promise.all([
    query(`SELECT * FROM person WHERE family_id = $1 AND status = 'active'
           ORDER BY generation_no NULLS LAST, family_name, given_name`, [currentFamilyId()]),
    query(`SELECT pc.* FROM parent_child pc JOIN person p ON p.id = pc.child_id
           WHERE p.family_id = $1`, [currentFamilyId()]),
    query(`SELECT u.* FROM marriage u JOIN person p ON p.id = u.person_a_id
           WHERE p.family_id = $1`, [currentFamilyId()]),
    query('SELECT name FROM family WHERE id = $1', [currentFamilyId()]),
  ]);
  // 导出给管理员：联系方式解密后输出，便于带离与迁移
  const plainPersons = persons.map((p) => ({ ...p, contact: tryDecryptJSON(p.contact) }));
  return { persons: plainPersons, parentChild, unions, familyName: fam[0]?.name || '家族谱' };
}

// ---------- 导出 ----------
router.get('/json', auth, adminOnly, async (req, res) => {
  const data = await loadAll();
  await audit({
    familyId: currentFamilyId(), actorUserId: req.user.id, actorLabel: req.user.username,
    action: 'export', entityType: 'family', entityId: currentFamilyId(), after: { format: 'json' },
  });
  res.setHeader('Content-Disposition', 'attachment; filename="family-tree-export.json"');
  res.json({ exportedAt: new Date().toISOString(), ...data });
});

router.get('/excel', auth, adminOnly, async (req, res) => {
  const { persons } = await loadAll();
  const buf = await personsToExcel(persons);
  await audit({
    familyId: currentFamilyId(), actorUserId: req.user.id, actorLabel: req.user.username,
    action: 'export', entityType: 'family', entityId: currentFamilyId(), after: { format: 'excel' },
  });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="family-tree.xlsx"');
  res.send(Buffer.from(buf));
});

router.get('/gedcom', auth, adminOnly, async (req, res) => {
  const { persons, parentChild, unions, familyName } = await loadAll();
  const text = exportGedcom(persons, parentChild, unions, familyName);
  await audit({
    familyId: currentFamilyId(), actorUserId: req.user.id, actorLabel: req.user.username,
    action: 'export', entityType: 'family', entityId: currentFamilyId(), after: { format: 'gedcom' },
  });
  res.setHeader('Content-Type', 'application/x-gedcom; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="family-tree.ged"');
  res.send(text);
});

// 导入预览缓存：previewId → { persons, families, userId, createdAt }
// 避免把万行解析结果先回传前端再传回来；15 分钟过期
const previewCache = new Map();
const PREVIEW_TTL = 15 * 60 * 1000;

function prunePreviewCache() {
  const now = Date.now();
  for (const [k, v] of previewCache) {
    if (now - v.createdAt > PREVIEW_TTL) previewCache.delete(k);
  }
}

// ---------- 导入：第一步 预览（不落库） ----------
router.post('/preview', auth, adminOnly, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: '请上传文件' });
    const name = req.file.originalname.toLowerCase();
    let parsed;

    if (name.endsWith('.xlsx')) {
      const rows = await excelToPersons(req.file.buffer);
      parsed = { format: 'excel', persons: rows, families: [], warnings: [] };
    } else {
      const text = req.file.buffer.toString('utf8');
      const g = parseGedcom(text);
      parsed = { format: 'gedcom', ...g };
    }

    // 冲突检测：库内同姓+名+生日
    const conflicts = [];
    for (const p of parsed.persons) {
      const { rows } = await query(
        `SELECT id, family_name, given_name, birth_date FROM person
         WHERE family_id = $1 AND family_name = $2 AND given_name = $3
           AND ($4::date IS NULL OR birth_date = $4::date) AND status = 'active' LIMIT 1`,
        [currentFamilyId(), p.family_name || '', p.given_name || '', p.birth_date || null]
      );
      if (rows.length) {
        conflicts.push({ incoming: `${p.family_name}${p.given_name}`, existingId: rows[0].id, reason: '姓名+出生日期完全一致' });
      }
    }

    prunePreviewCache();
    const previewId = randomUUID();
    previewCache.set(previewId, {
      persons: parsed.persons,
      families: parsed.families || [],
      userId: req.user.id,
      createdAt: Date.now(),
    });

    res.json({
      previewId,
      format: parsed.format,
      counts: { persons: parsed.persons.length, families: parsed.families?.length || 0 },
      warnings: parsed.warnings || [],
      conflicts,
      sample: parsed.persons.slice(0, 10),
    });
  } catch (err) {
    logger.error('[import] preview:', err);
    res.status(400).json({ error: err.message || '解析失败' });
  }
});

// ---------- 导入：第二步 确认落库 ----------
router.post('/commit', auth, adminOnly, async (req, res) => {
  const { previewId, persons: inlinePersons, families: inlineFamilies, skipConflicts = true } = req.body || {};
  let persons = inlinePersons, families = inlineFamilies;

  if (previewId) {
    const cached = previewCache.get(previewId);
    if (!cached) return res.status(410).json({ error: '预览已过期，请重新上传' });
    if (cached.userId !== req.user.id) return res.status(403).json({ error: '预览不属于当前用户' });
    persons = cached.persons;
    families = cached.families;
    previewCache.delete(previewId);
  }

  if (!Array.isArray(persons) || !persons.length) {
    return res.status(400).json({ error: '没有可导入的数据' });
  }

  try {
    const report = await withTransaction(async (client) => {
      const xrefToId = new Map();
      let inserted = 0, skipped = 0;

      for (const p of persons) {
        if (!p.given_name && !p.family_name) { skipped++; continue; }
        const dup = await client.query(
          `SELECT id FROM person WHERE family_id = $1 AND family_name = $2 AND given_name = $3
             AND ($4::date IS NULL OR birth_date = $4::date) AND status = 'active' LIMIT 1`,
          [currentFamilyId(), p.family_name || '', p.given_name || '', p.birth_date || null]
        );
        if (dup.rows.length && skipConflicts) { skipped++; continue; }

        const id = randomUUID();
        await client.query(
          `INSERT INTO person (id, family_id, family_name, given_name, courtesy_name,
             generation_name, generation_no, branch, gender,
             birth_date, birth_precision, birth_date_end, birth_place,
             death_date, death_precision, death_date_end, death_place, burial_place,
             is_deceased, occupation, bio)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
          [id, currentFamilyId(), p.family_name || '', p.given_name || '', p.courtesy_name || '',
           p.generation_name || '', p.generation_no ?? null, p.branch || '', p.gender || 'unknown',
           p.birth_date || null, p.birth_precision || 'unknown', p.birth_date_end || null, p.birth_place || '',
           p.death_date || null, p.death_precision || 'unknown', p.death_date_end || null,
           p.death_place || '', p.burial_place || '',
           !!p.is_deceased, p.occupation || '', p.bio || '']
        );
        if (p.xref) xrefToId.set(p.xref, id);
        inserted++;
      }

      let unionsCreated = 0, edgesCreated = 0;
      for (const f of families) {
        const husband = f.husbandXref ? xrefToId.get(f.husbandXref) : null;
        const wife = f.wifeXref ? xrefToId.get(f.wifeXref) : null;
        if (husband && wife) {
          const [a, b] = [husband, wife].sort();
          const { rows: ex } = await client.query(
            `SELECT id FROM marriage WHERE person_a_id = $1 AND person_b_id = $2 LIMIT 1`, [a, b]
          );
          if (!ex.length) {
            await client.query(
              `INSERT INTO marriage (person_a_id, person_b_id, union_type, status, start_date, start_precision, place)
               VALUES ($1,$2,'married',$3,$4,$5,$6)`,
              [a, b, f.status || 'ongoing', f.start_date || null, f.start_precision || 'unknown', f.place || '']
            );
            unionsCreated++;
          }
        }
        for (const cx of f.childXrefs || []) {
          const childId = xrefToId.get(cx);
          for (const parentId of [husband, wife].filter(Boolean)) {
            if (parentId === childId) continue;
            const { rows: ex } = await client.query(
              `SELECT 1 FROM parent_child WHERE parent_id = $1 AND child_id = $2`, [parentId, childId]
            );
            if (!ex.length) {
              await client.query(
                `INSERT INTO parent_child (parent_id, child_id, relation_type, certainty)
                 VALUES ($1,$2,'biological','confirmed')`, [parentId, childId]
              );
              edgesCreated++;
            }
          }
        }
      }

      return { inserted, skipped, unionsCreated, edgesCreated };
    });

    await audit({
      familyId: currentFamilyId(), actorUserId: req.user.id, actorLabel: req.user.username,
      action: 'import', entityType: 'family', entityId: currentFamilyId(), after: report,
    });
    res.json({ ok: true, ...report });
  } catch (err) {
    logger.error('[import] commit:', err);
    res.status(500).json({ error: '导入失败：' + err.message });
  }
});

export default router;
