/**

 * 家族洞察（借鉴 yimai 的六类洞察：人丁结构 / 出生年代 / 代际寿数 / 字辈图谱 / 地域 / 年表）。
 * 纯函数：输入成员与关系，输出结构化数据，便于前端渲染与单元测试。
 */
import { auditGenerationNames } from './generationPoem.js';


const yearOf = (v) => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return isNaN(d.getTime()) ? null : d.getUTCFullYear();
};

const CN_NUM = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
export function cnNum(n) {
  if (!Number.isFinite(n)) return '—';
  if (n <= 10) return CN_NUM[n] ?? String(n);
  if (n < 20) return `十${CN_NUM[n - 10]}`;
  return String(n);
}

export function buildInsights({ persons, edges = [], marriages = [] }, { now = new Date(), generationPoem = null, surname = null } = {}) {
  const byId = new Map(persons.map((p) => [p.id, p]));
  const alive = persons.filter((p) => !p.is_deceased);

  // ---- 世代与字辈 ----
  const gens = new Map();
  // 优先用显式 generation_no；缺失时沿父系推断（父辈代数 + 1）
  const genOf = (id, seen = new Set()) => {
    if (gens.has(id)) return gens.get(id);
    const p = byId.get(id);
    if (!p) return null;
    const explicit = p.generation_no === null || p.generation_no === undefined
      ? null : Number(p.generation_no);
    if (explicit !== null && Number.isFinite(explicit)) {
      gens.set(id, explicit);
      return explicit;
    }
    if (seen.has(id)) return null;
    seen.add(id);
    const parentEdge = edges.find((e) => e.child_id === id);
    const parentGen = parentEdge ? genOf(parentEdge.parent_id, seen) : null;
    const g = parentGen === null ? null : parentGen + 1;
    gens.set(id, g);
    return g;
  };
  for (const p of persons) genOf(p.id);

  const byGen = new Map();
  for (const p of persons) {
    const g = gens.get(p.id);
    if (g === null || g === undefined) continue;
    if (!byGen.has(g)) byGen.set(g, { male: 0, female: 0, unknown: 0, list: [] });
    const bucket = byGen.get(g);
    const sex = p.gender === 'female' ? 'female' : p.gender === 'male' ? 'male' : 'unknown';
    bucket[sex]++;
    bucket.list.push(p);
  }
  const genKeys = [...byGen.keys()].sort((a, b) => a - b);

  const generationStructure = genKeys.map((g, i) => {
    const b = byGen.get(g);
    const names = b.list.map((p) => `${p.family_name || ''}${p.given_name || ''}`);
    const zbCount = new Map();
    for (const p of b.list) {
      const zb = (p.generation_name || '').trim();
      if (zb) zbCount.set(zb, (zbCount.get(zb) || 0) + 1);
    }
    const mainZb = [...zbCount.entries()].sort((x, y) => y[1] - x[1])[0];
    return {
      generation: g,
      order: i + 1,
      orderLabel: `第${cnNum(i + 1)}世`,
      male: b.male,
      female: b.female,
      unknown: b.unknown,
      total: b.list.length,
      mainGenerationName: mainZb ? mainZb[0] : '',
      members: names,
    };
  });

  // ---- 字辈图谱与断裂 ----
  const zibeiSeries = generationStructure.map((g) => ({
    orderLabel: g.orderLabel,
    generationName: g.mainGenerationName,
    count: g.total,
  }));
  const kept = zibeiSeries.filter((z) => z.generationName).length;
  let zibeiBreak = { kept, broken: false, message: '' };
  if (kept >= 2) {
    const seq = zibeiSeries.map((z) => z.generationName).filter(Boolean);
    const lastIdx = zibeiSeries.map((z) => !!z.generationName).lastIndexOf(true);
    const broken = lastIdx < zibeiSeries.length - 1;
    zibeiBreak = {
      kept,
      broken,
      sequence: seq,
      brokenAtOrder: broken ? lastIdx + 2 : null,
      message: broken
        ? `字辈「${seq.join('')}」延续了 ${cnNum(kept)} 世，此后未再按字辈取名——这在城市化后较常见。`
        : `字辈「${seq.join('')}」连续 ${cnNum(kept)} 世未中断。`,
    };
  } else if (kept === 1) {
    zibeiBreak = { kept, broken: false, sequence: zibeiSeries.map((z) => z.generationName).filter(Boolean), message: '仅一世记录字辈，暂看不出规律，可继续补录。' };
  } else {
    zibeiBreak = { kept: 0, broken: false, sequence: [], message: '尚未录入字辈，补录后可看出取名规律。' };
  }

  // ---- 出生年代 ----
  const births = persons.map((p) => yearOf(p.birth_date)).filter((y) => y !== null);
  const deaths = persons.map((p) => yearOf(p.death_date)).filter((y) => y !== null);
  const lo = births.length ? Math.min(...births) : null;
  const hi = births.length ? Math.max(...births) : null;
  const birthSpan = lo !== null && hi !== null ? hi - lo : 0;

  // ---- 寿数 ----
  const deceased = persons
    .map((p) => {
      const b = yearOf(p.birth_date);
      const d = yearOf(p.death_date);
      if (b === null || d === null || d < b) return null;
      return {
        id: p.id,
        name: `${p.family_name || ''}${p.given_name || ''}`,
        birthYear: b,
        deathYear: d,
        age: d - b,
        gen: gens.get(p.id) ?? null,
      };
    })
    .filter(Boolean);
  const avgAge = deceased.length
    ? Math.round(deceased.reduce((a, x) => a + x.age, 0) / deceased.length)
    : null;
  const oldest = deceased.slice().sort((a, b) => b.age - a.age)[0] || null;
  const living = alive
    .map((p) => {
      const b = yearOf(p.birth_date);
      return b === null ? null : { id: p.id, name: `${p.family_name || ''}${p.given_name || ''}`, birthYear: b, age: now.getUTCFullYear() - b };
    })
    .filter(Boolean);
  const oldestLiving = living.slice().sort((a, b) => a.birthYear - b.birthYear)[0] || null;

  // ---- 地域 ----
  const regionCount = new Map();
  for (const p of persons) {
    const place = (p.birth_place || '').trim();
    if (!place) continue;
    regionCount.set(place, (regionCount.get(place) || 0) + 1);
  }
  const regions = [...regionCount.entries()]
    .map(([place, count]) => ({ place, count }))
    .sort((a, b) => b.count - a.count);

  // ---- 年表 ----
  const timeline = [];
  for (const p of persons) {
    const name = `${p.family_name || ''}${p.given_name || ''}`;
    const b = yearOf(p.birth_date);
    const d = yearOf(p.death_date);
    if (b !== null) timeline.push({ year: b, kind: 'birth', text: `${name} 出生`, place: p.birth_place || '', personId: p.id });
    if (d !== null) timeline.push({ year: d, kind: 'death', text: `${name} 卒，享年 ${d - b} 岁`, place: p.death_place || '', personId: p.id });
  }
  timeline.sort((a, b) => a.year - b.year);

  const livingGenerations = generationStructure.filter((g) =>
    persons.some((p) => !p.is_deceased && gens.get(p.id) === g.generation)).length;

  return {
    total: persons.length,
    alive: alive.length,
    deceased: persons.length - alive.length,
    generations: genKeys.length,
    livingGenerations,
    gender: {
      male: persons.filter((p) => p.gender === 'male').length,
      female: persons.filter((p) => p.gender === 'female').length,
      unknown: persons.filter((p) => !['male', 'female'].includes(p.gender)).length,
    },
    generationStructure,
    zibei: { series: zibeiSeries, ...zibeiBreak },
    generationAudit: auditGenerationNames(persons, generationPoem || [], { surname }),
    birth: { from: lo, to: hi, span: birthSpan, count: births.length },
    longevity: {
      deceasedCount: deceased.length,
      averageAge: avgAge,
      oldest,
      oldestLiving,
      records: deceased.sort((a, b) => a.birthYear - b.birthYear),
    },
    regions,
    timeline: timeline.slice(-200),
  };
}