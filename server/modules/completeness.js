/**
 * 资料完整度核查（借鉴 Ancestris / webtrees 的"数据质量检查"思路）。
 * 纯函数，便于测试；输出待补清单与完成度。
 */

const yearOf = (v) => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return isNaN(d.getTime()) ? null : d.getUTCFullYear();
};

/** 字段权重：越影响谱牒可信度越高 */
const CHECKS = [
  { key: 'name', label: '姓名', weight: 3, test: (p) => !!(p.family_name || p.given_name) },
  { key: 'gender', label: '性别', weight: 2, test: (p) => p.gender === 'male' || p.gender === 'female' },
  { key: 'birth', label: '出生日期', weight: 3, test: (p) => !!p.birth_date },
  { key: 'birth_place', label: '出生地', weight: 2, test: (p) => !!p.birth_place },
  { key: 'parents', label: '父母', weight: 3, test: (p, ctx) => ctx.hasParent(p.id) },
  { key: 'generation', label: '世代/字辈', weight: 2, test: (p) => p.generation_no !== null || !!p.generation_name },
  { key: 'bio', label: '生平或事件', weight: 1, test: (p, ctx) => !!p.bio || ctx.hasEvent(p.id) },
  { key: 'source', label: '来源考证', weight: 2, test: (p, ctx) => ctx.hasCitation(p.id) },
];

/**
 * @param {Array} persons
 * @param {{hasParent:Function, hasEvent:Function, hasCitation:Function, hasMedia:Function}} ctx
 */
export function auditCompleteness(persons, ctx) {
  const totalWeight = CHECKS.reduce((s, c) => s + c.weight, 0);
  const issues = new Map(); // key -> persons[]
  let scoreSum = 0;

  for (const p of persons) {
    let got = 0;
    for (const c of CHECKS) {
      if (c.test(p, ctx)) {
        got += c.weight;
      } else {
        if (!issues.has(c.key)) issues.set(c.key, []);
        issues.get(c.key).push({
          id: p.id,
          name: `${p.family_name || ''}${p.given_name || ''}`,
          gen: p.generation_no,
        });
      }
    }
    p.completeness = Math.round((got / totalWeight) * 100);
    scoreSum += p.completeness;
  }

  const items = CHECKS.map((c) => ({
    key: c.key,
    label: c.label,
    weight: c.weight,
    missingCount: issues.get(c.key)?.length || 0,
    samples: (issues.get(c.key) || []).slice(0, 8),
  })).sort((a, b) => b.missingCount * b.weight - a.missingCount * a.weight);

  const overall = persons.length ? Math.round(scoreSum / persons.length) : 0;

  // 最需要补录的成员（完整度最低）
  const weakest = persons
    .map((p) => ({ id: p.id, name: `${p.family_name || ''}${p.given_name || ''}`, completeness: p.completeness }))
    .sort((a, b) => a.completeness - b.completeness)
    .slice(0, 10);

  return { overall, totalPersons: persons.length, items, weakest };
}

/** 按筛选条件过滤（名录高级筛选 + 待补页共用） */
export function matchesFilter(p, filter, ctx) {
  if (!filter) return true;
  if (filter.missing) {
    const check = CHECKS.find((c) => c.key === filter.missing);
    if (check && check.test(p, ctx)) return false;
  }
  if (filter.incompleteBelow !== undefined) {
    const threshold = Number(filter.incompleteBelow);
    if (Number.isFinite(threshold) && (p.completeness ?? 100) >= threshold) return false;
  }
  if (filter.noSource && ctx.hasCitation(p.id)) return false;
  if (filter.noParents && ctx.hasParent(p.id)) return false;
  if (filter.alive === 'true' && p.is_deceased) return false;
  if (filter.alive === 'false' && !p.is_deceased) return false;
  if (filter.bornFrom && (yearOf(p.birth_date) ?? 0) < Number(filter.bornFrom)) return false;
  if (filter.bornTo && (yearOf(p.birth_date) ?? 9999) > Number(filter.bornTo)) return false;
  if (filter.gender && p.gender !== filter.gender) return false;
  return true;
}