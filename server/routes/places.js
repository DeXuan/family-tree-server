import { logger } from '../modules/logger.js';
import express from 'express';
import { query } from '../db/db.js';
import { auth, adminOnly } from '../middleware/auth.js';
import { audit } from './audit.js';
import { config } from '../config/index.js';
import { currentFamilyId } from '../middleware/tenant.js';
import { uuidParam } from '../middleware/params.js';
import { validateBody } from '../middleware/validateBody.js';

const router = express.Router();
router.param('id', uuidParam);

const bad = (res, msg) => res.status(400).json({ error: msg });

function normalize(s) {
  return String(s || '').trim().replace(/\s+/g, '');
}

/** 判断某条地点文本是否命中地点库条目（名称或别名，允许前缀包含） */
function matchPlace(place, text) {
  const t = normalize(text);
  if (!t) return false;
  const candidates = [place.name, ...(place.aliases || [])].map(normalize).filter(Boolean);
  return candidates.some((c) => t === c || t.startsWith(c) || c.startsWith(t));
}

async function loadPeoplePlaces() {
  const { rows } = await query(
    `SELECT id, family_name, given_name, birth_place, death_place, burial_place
     FROM person WHERE family_id = $1 AND status = 'active'`,
    [currentFamilyId()]
  );
  return rows;
}

async function loadPlaces() {
  const { rows } = await query(
    `SELECT * FROM place WHERE family_id = $1 ORDER BY province, city, name`,
    [currentFamilyId()]
  );
  return rows;
}

// 地点列表 + 每个地点的成员数、未归类地点
router.get('/', auth, async (req, res) => {
  const [places, persons] = await Promise.all([loadPlaces(), loadPeoplePlaces()]);

  const covered = new Set();
  const enriched = places.map((p) => {
    let birthCount = 0, deathCount = 0;
    const memberIds = new Set();
    for (const person of persons) {
      const hitBirth = matchPlace(p, person.birth_place);
      const hitDeath = matchPlace(p, person.death_place);
      const hitBurial = matchPlace(p, person.burial_place);
      if (hitBirth || hitDeath || hitBurial) {
        if (hitBirth) birthCount++;
        if (hitDeath) deathCount++;
        memberIds.add(person.id);
        if (person.birth_place) covered.add(normalize(person.birth_place));
        if (person.death_place) covered.add(normalize(person.death_place));
      }
    }
    return {
      ...p,
      birthCount,
      deathCount,
      memberCount: memberIds.size,
    };
  });

  // 未归类地点（有成员填写但地点库未收录）
  const unmatchedMap = new Map();
  for (const person of persons) {
    for (const field of [person.birth_place, person.death_place]) {
      const t = normalize(field);
      if (!t) continue;
      if (!covered.has(t)) unmatchedMap.set(t, (unmatchedMap.get(t) || 0) + 1);
    }
  }
  const unmatched = [...unmatchedMap.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  // 层级：parent_id 组织成树（未设置父级的为省级/顶层）
  const byId = new Map(enriched.map((p) => [p.id, { ...p, children: [] }]));
  const roots = [];
  for (const node of byId.values()) {
    if (node.parent_id && byId.has(node.parent_id)) byId.get(node.parent_id).children.push(node);
    else roots.push(node);
  }

  res.json({ places: enriched, tree: roots, unmatched });
});

// 地图数据：有坐标的地点 + 迁徙路径（零外部瓦片，前端自绘 SVG）
router.get('/map', auth, async (req, res) => {
  const [places, { rows: migRows }] = await Promise.all([
    loadPlaces(),
    query(
      `SELECT e.id, e.event_date, e.place, p.id AS person_id,
              p.family_name, p.given_name, p.birth_place
       FROM event e JOIN person p ON p.id = e.person_id
       WHERE p.family_id = $1 AND p.status = 'active' AND e.event_type = 'migration'`,
      [currentFamilyId()]
    ),
  ]);

  const withCoords = places.filter((p) =>
    Number.isFinite(p.lat) && Number.isFinite(p.lng));
  const index = new Map();
  for (const pl of withCoords) {
    for (const k of [pl.name, ...(pl.aliases || [])].map((x) => String(x).trim()).filter(Boolean)) {
      index.set(k, pl);
    }
  }
  const findPlace = (text) => {
    const t = String(text || '').trim();
    if (!t) return null;
    if (index.has(t)) return index.get(t);
    for (const [k, v] of index) if (t.includes(k) || k.includes(t)) return v;
    return null;
  };

  const lats = withCoords.map((p) => p.lat);
  const lngs = withCoords.map((p) => p.lng);
  res.json({
    // 可选底图：留空表示纯离线自绘；有值时前端叠加 XYZ 瓦片
    tiles: config.mapTileUrl ? {
      urlTemplate: config.mapTileUrl,
      attribution: config.mapTileAttribution,
      maxZoom: config.mapTileMaxZoom,
    } : null,
    bounds: withCoords.length ? {
      minLat: Math.min(...lats), maxLat: Math.max(...lats),
      minLng: Math.min(...lngs), maxLng: Math.max(...lngs),
    } : null,
    places: withCoords.map((p) => ({
      id: p.id, name: p.name, province: p.province, city: p.city, lat: p.lat, lng: p.lng,
    })),
    migrations: migRows.map((m) => {
      const from = findPlace(m.birth_place);
      const to = findPlace(m.place);
      return {
        id: m.id,
        personId: m.person_id,
        personName: `${m.family_name || ''}${m.given_name || ''}`,
        from: from ? { id: from.id, name: from.name, lat: from.lat, lng: from.lng } : null,
        to: to ? { id: to.id, name: to.name, lat: to.lat, lng: to.lng } : null,
        year: m.event_date ? new Date(m.event_date).getUTCFullYear() : null,
      };
    }).filter((m) => m.from || m.to),
  });
});

// 省份聚合
router.get('/stats', auth, async (req, res) => {
  const [places, persons] = await Promise.all([loadPlaces(), loadPeoplePlaces()]);
  const provinceMap = new Map();
  let coveredPersons = 0;
  const coveredIds = new Set();

  for (const person of persons) {
    let hit = false;
    for (const place of places) {
      if (matchPlace(place, person.birth_place) || matchPlace(place, person.death_place)) {
        const key = place.province || '未标注省份';
        provinceMap.set(key, (provinceMap.get(key) || 0) + 1);
        hit = true;
        coveredIds.add(person.id);
        break;
      }
    }
    if (hit) coveredPersons++;
  }

  const provinces = [...provinceMap.entries()]
    .map(([province, count]) => ({ province, count }))
    .sort((a, b) => b.count - a.count);

  res.json({
    totalPlaces: places.length,
    totalPersons: persons.length,
    coveredPersons,
    uncoveredPersons: persons.length - coveredPersons,
    provinces,
  });
});

// 迁徙记录：migration 事件 + 出生地
router.get('/migrations', auth, async (req, res) => {
  const { rows } = await query(
    `SELECT e.id, e.title, e.event_date, e.place, e.description,
            p.id AS person_id, p.family_name, p.given_name, p.birth_place
     FROM event e JOIN person p ON p.id = e.person_id
     WHERE p.family_id = $1 AND p.status = 'active' AND e.event_type = 'migration'
     ORDER BY e.event_date DESC NULLS LAST LIMIT 200`,
    [currentFamilyId()]
  );
  res.json(rows.map((r) => ({
    id: r.id,
    personId: r.person_id,
    personName: `${r.family_name || ''}${r.given_name || ''}`,
    title: r.title,
    from: r.birth_place || '',
    to: r.place || '',
    year: r.event_date ? new Date(r.event_date).getUTCFullYear() : null,
    description: r.description || '',
  })));
});

// 新建地点
router.post('/', auth, adminOnly, async (req, res) => {
  const check = validateBody(req, {
    name: { type: 'string', required: true, max: 60, label: '地名' },
    province: { type: 'string', max: 30, label: '省份' },
    city: { type: 'string', max: 30, label: '城市' },
    aliases: { type: 'array', max: 20, label: '别名' },
    note: { type: 'string', max: 500, label: '备注' },
    parentId: { type: 'string', label: '上级地点' },
  });
  if (check.error) return bad(res, check.error);
  const b = { ...req.body, ...check.value };
  const name = normalize(b.name);
  if (!name) return bad(res, '地名必填');
  if (name.length > 60) return bad(res, '地名不能超过 60 字');
  const province = String(b.province || '').trim().slice(0, 30);
  const city = String(b.city || '').trim().slice(0, 30);
  const aliases = Array.isArray(b.aliases)
    ? b.aliases.map((x) => String(x).trim()).filter(Boolean).slice(0, 20)
    : [];
  let parentId = null;
  if (b.parentId !== undefined && b.parentId !== null && b.parentId !== '') {
    if (!/^[0-9a-f-]{36}$/i.test(String(b.parentId))) return bad(res, '上级地点 ID 无效');
    const { rows: parentRows } = await query(
      'SELECT id FROM place WHERE id = $1 AND family_id = $2', [b.parentId, currentFamilyId()]
    );
    if (!parentRows.length) return bad(res, '上级地点不存在');
    parentId = b.parentId;
  }
  const lat = b.lat === undefined || b.lat === null || b.lat === '' ? null : Number(b.lat);
  const lng = b.lng === undefined || b.lng === null || b.lng === '' ? null : Number(b.lng);
  if (lat !== null && (!Number.isFinite(lat) || lat < -90 || lat > 90)) return bad(res, '纬度需在 -90~90');
  if (lng !== null && (!Number.isFinite(lng) || lng < -180 || lng > 180)) return bad(res, '经度需在 -180~180');

  try {
    const { rows } = await query(
      `INSERT INTO place (family_id, name, province, city, lat, lng, aliases, note, parent_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [currentFamilyId(), name, province, city, lat, lng, JSON.stringify(aliases),
        String(b.note || '').slice(0, 500), parentId]
    );
    await audit({
      familyId: currentFamilyId(),
      actorUserId: req.user.id, actorLabel: req.user.username,
      action: 'create', entityType: 'place', entityId: rows[0].id,
      after: { name, province, city, aliases },
    });
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: '该地名已存在' });
    logger.error('[places] create:', err);
    res.status(500).json({ error: '地点创建失败' });
  }
});

// 修改地点
router.put('/:id', auth, adminOnly, async (req, res) => {
  const check = validateBody(req, {
    name: { type: 'string', max: 60, label: '地名' },
    province: { type: 'string', max: 30, label: '省份' },
    city: { type: 'string', max: 30, label: '城市' },
    note: { type: 'string', max: 500, label: '备注' },
    aliases: { type: 'array', max: 20, label: '别名' },
    parentId: { type: 'string', label: '上级地点' },
  });
  if (check.error) return bad(res, check.error);
  const b = { ...req.body, ...check.value };
  const fields = {
    name: b.name !== undefined ? normalize(b.name) : undefined,
    province: b.province !== undefined ? String(b.province).trim().slice(0, 30) : undefined,
    city: b.city !== undefined ? String(b.city).trim().slice(0, 30) : undefined,
    note: b.note !== undefined ? String(b.note).slice(0, 500) : undefined,
  };
  if (fields.name === '') return bad(res, '地名不能为空');
  if (b.aliases !== undefined) {
    if (!Array.isArray(b.aliases)) return bad(res, '别名必须是数组');
    fields.aliases = JSON.stringify(b.aliases.map((x) => String(x).trim()).filter(Boolean).slice(0, 20));
  }
  if (b.parentId !== undefined) {
    if (b.parentId === null || b.parentId === '') {
      fields.parent_id = null;
    } else {
      if (!/^[0-9a-f-]{36}$/i.test(String(b.parentId))) return bad(res, '上级地点 ID 无效');
      if (b.parentId === req.params.id) return bad(res, '地点不能以上级自身的父级');
      // 环路检测：沿 parent 链向上，若遇到自己则拒绝
      let cur = b.parentId;
      const seen = new Set();
      while (cur && !seen.has(cur)) {
        if (cur === req.params.id) return bad(res, '不能形成地点层级环路');
        seen.add(cur);
        const { rows } = await query('SELECT parent_id FROM place WHERE id = $1 AND family_id = $2', [cur, currentFamilyId()]);
        cur = rows[0]?.parent_id || null;
      }
      fields.parent_id = b.parentId;
    }
  }
  if (b.lat !== undefined) fields.lat = b.lat === null || b.lat === '' ? null : Number(b.lat);
  if (b.lng !== undefined) fields.lng = b.lng === null || b.lng === '' ? null : Number(b.lng);

  const keys = Object.keys(fields).filter((k) => fields[k] !== undefined);
  if (!keys.length) return bad(res, '没有要更新的字段');

  const { rows: before } = await query(
    'SELECT * FROM place WHERE id = $1 AND family_id = $2', [req.params.id, currentFamilyId()]
  );
  if (!before.length) return res.status(404).json({ error: '地点不存在' });

  const setClause = keys.map((k, i) => `${k} = $${i + 3}`).join(', ');
  await query(
    `UPDATE place SET ${setClause}, updated_at = now() WHERE id = $1 AND family_id = $2`,
    [req.params.id, currentFamilyId(), ...keys.map((k) => fields[k])]
  );
  await audit({
    familyId: currentFamilyId(),
    actorUserId: req.user.id, actorLabel: req.user.username,
    action: 'update', entityType: 'place', entityId: req.params.id,
    before: before[0], after: fields,
  });
  res.json({ ok: true });
});

// 合并地点：把 source 的成员引用与子级挂到 target，再删除 source
router.post('/merge', auth, adminOnly, async (req, res) => {
  const check = validateBody(req, {
    sourceId: { type: 'string', required: true, label: '源地点' },
    targetId: { type: 'string', required: true, label: '目标地点' },
  });
  if (check.error) return bad(res, check.error);
  const { sourceId, targetId } = check.value;
  if (!/^[0-9a-f-]{36}$/i.test(String(sourceId)) || !/^[0-9a-f-]{36}$/i.test(String(targetId))) {
    return bad(res, '地点 ID 无效');
  }
  if (sourceId === targetId) return bad(res, '不能与自身合并');

  const { rows: pair } = await query(
    'SELECT * FROM place WHERE id = ANY($1) AND family_id = $2', [[sourceId, targetId], currentFamilyId()]
  );
  const source = pair.find((p) => p.id === sourceId);
  const target = pair.find((p) => p.id === targetId);
  if (!source || !target) return res.status(404).json({ error: '地点不存在' });

  await query('UPDATE place SET parent_id = $1 WHERE parent_id = $2 AND family_id = $3',
    [targetId, sourceId, currentFamilyId()]);
  // 别名合并去重
  const mergedAliases = [...new Set([...(target.aliases || []), source.name, ...(source.aliases || [])])]
    .filter((a) => a && a !== target.name);
  await query('UPDATE place SET aliases = $1, updated_at = now() WHERE id = $2',
    [JSON.stringify(mergedAliases), targetId]);
  await query('DELETE FROM place WHERE id = $1', [sourceId]);

  await audit({
    familyId: currentFamilyId(),
    actorUserId: req.user.id, actorLabel: req.user.username,
    action: 'update', entityType: 'place', entityId: targetId,
    after: { mergedFrom: source.name, aliases: mergedAliases },
  });
  res.json({ ok: true, mergedFrom: source.name, into: target.name, aliases: mergedAliases });
});

// 删除地点
router.delete('/:id', auth, adminOnly, async (req, res) => {
  const { rows } = await query(
    'DELETE FROM place WHERE id = $1 AND family_id = $2 RETURNING name',
    [req.params.id, currentFamilyId()]
  );
  if (!rows.length) return res.status(404).json({ error: '地点不存在' });
  await audit({
    familyId: currentFamilyId(),
    actorUserId: req.user.id, actorLabel: req.user.username,
    action: 'delete', entityType: 'place', entityId: req.params.id,
    before: { name: rows[0].name },
  });
  res.json({ ok: true });
});

export default router;