/**
 * 字辈派语校验（纯函数）。
 *
 * 传统族谱按"派语"（字辈诗）逐代取字命名，例如：
 *   守德建明一 → 第一世用"守"，第二世用"德"…
 * 校验目标：
 *  1. 给定世代，判断姓名是否含应派之字
 *  2. 汇总全族偏离情况，供资料完整度/洞察使用
 *
 * 派语来源：family.settings.generationPoem（array 或 string）
 */

/** 把派语解析为数组：支持 "守德建明一" 或 ["守","德",…] 或 "守、德、建" */
export function parseGenerationPoem(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map((x) => String(x).trim()).filter(Boolean);
  return String(raw)
    .replace(/[、，,\s/|-]/g, '')
    .split('')
    .filter(Boolean);
}

/**
 * 取某世代应派的字。
 * @param {string[]} poem 派语数组（下标 0 = 第一世）
 * @param {number} generationNo 世代号（1 起）
 */
export function generationCharAt(poem, generationNo) {
  if (!Array.isArray(poem) || !poem.length) return null;
  const idx = Number(generationNo) - 1;
  if (!Number.isInteger(idx) || idx < 0 || idx >= poem.length) return null;
  return poem[idx];
}

/**
 * 校验单个成员是否按字辈取名。
 * 中文姓名中，派字通常出现在"名"里（如 王守仁 → 名"守仁"含"守"），
 * 也可能出现在姓与名之间；这里只检查"除姓以外的所有字"。
 *
 * @returns {{status:'ok'|'mismatch'|'no-poem'|'no-data', expected:string|null, actual:string|null}}
 */
export function checkGenerationName(person, poem, { surname = null } = {}) {
  if (!Array.isArray(poem) || !poem.length) return { status: 'no-poem', expected: null, actual: null };

  // 姻亲（嫁入/娶入者）不随本族派语取名，应排除
  const family = String(person?.family_name || '').trim();
  if (surname && family && family !== surname) {
    return { status: 'excluded', expected: null, actual: null };
  }
  const gen = person?.generation_no;
  const expected = generationCharAt(poem, gen);
  if (!expected) return { status: 'no-poem', expected: null, actual: null };

  const given = String(person.given_name || '').trim();
  const recorded = String(person.generation_name || '').trim();

  // 优先用显式记录的字辈字段
  if (recorded) {
    const hit = recorded.includes(expected) || expected.includes(recorded[0]);
    return { status: hit ? 'ok' : 'mismatch', expected, actual: recorded };
  }

  if (!given) return { status: 'no-data', expected, actual: null };

  // 从名中找派字
  const actual = given.includes(expected) ? expected : given[0];
  return { status: given.includes(expected) ? 'ok' : 'mismatch', expected, actual };
}

/**
 * 全族字辈符合度统计。
 * @param {Array} persons
 * @param {string[]} poem
 */
export function auditGenerationNames(persons, poem, { surname = null } = {}) {
  const parsed = parseGenerationPoem(poem);
  if (!parsed.length) {
    return { hasPoem: false, poem: [], total: 0, checked: 0, ok: 0, mismatch: 0, noData: 0, excluded: 0, rate: null, mismatches: [] };
  }

  let checked = 0, ok = 0, mismatch = 0, noData = 0, excluded = 0;
  const mismatches = [];

  for (const p of persons) {
    const r = checkGenerationName(p, parsed, { surname });
    if (r.status === 'ok') { ok++; checked++; }
    else if (r.status === 'mismatch') {
      mismatch++;
      checked++;
      mismatches.push({
        id: p.id,
        name: `${p.family_name || ''}${p.given_name || ''}`,
        gen: p.generation_no,
        expected: r.expected,
        actual: r.actual,
      });
    } else if (r.status === 'no-data') noData++;
    else if (r.status === 'excluded') excluded++;
  }

  return {
    hasPoem: true,
    poem: parsed,
    total: persons.length,
    checked,
    ok,
    mismatch,
    noData,
    excluded,
    rate: checked ? Math.round((ok / checked) * 100) : null,
    mismatches: mismatches.slice(0, 30),
  };
}