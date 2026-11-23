/**
 * GEDCOM 5.5.1 导入/导出（MVP 子集：INDI / FAM / BIRT / DEAT / NAME / SEX / PLAC）
 * 设计原则：只做能往返无损的字段，其余字段导出时忽略并记入报告。
 */

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
  'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

function fmtGedDate(dateStr, precision, dateEnd) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d)) return null;
  const y = d.getUTCFullYear();
  const m = MONTHS[d.getUTCMonth()];
  const day = d.getUTCDate();
  switch (precision) {
    case 'exact': return `${day} ${m} ${y}`;
    case 'year': return String(y);
    case 'about': return `ABT ${y}`;
    case 'range': {
      const end = dateEnd ? new Date(dateEnd).getUTCFullYear() : y;
      return `BET ${y} AND ${end}`;
    }
    default: return String(y);
  }
}

function parseGedDate(raw) {
  if (!raw) return { date: null, precision: 'unknown', dateEnd: null };
  const s = raw.trim().toUpperCase();
  let m;
  if ((m = s.match(/^BET\.?\s+(\d{4})\s+AND\s+(\d{4})$/))) {
    return { date: `${m[1]}-01-01`, precision: 'range', dateEnd: `${m[2]}-12-31` };
  }
  if ((m = s.match(/^(ABT|EST|CAL)\.?\s+(\d{4})$/))) {
    return { date: `${m[2]}-01-01`, precision: 'about', dateEnd: null };
  }
  if ((m = s.match(/^(\d{4})$/))) {
    return { date: `${m[1]}-01-01`, precision: 'year', dateEnd: null };
  }
  if ((m = s.match(/^(?:(\d{1,2})\s+)?([A-Z]{3})\s+(\d{4})$/))) {
    const mon = MONTHS.indexOf(m[2]) + 1;
    const day = m[1] ? m[1].padStart(2, '0') : '01';
    const date = `${m[3]}-${String(mon).padStart(2, '0')}-${day}`;
    return { date, precision: m[1] ? 'exact' : 'year', dateEnd: null };
  }
  return { date: null, precision: 'unknown', dateEnd: null };
}

/**
 * @param {Array} persons  person 行（含 id、姓名、性别、出生与去世字段）
 * @param {Array} parentChild  亲子关系
 * @param {Array} unions  婚姻
 * @param {string} familyName 家族名（HEAD 用）
 * @returns {string} GEDCOM 文本
 */
export function exportGedcom(persons, parentChild, unions, familyName = '家族谱') {
  const lines = [];
  const L = (level, tag, value = '') => lines.push(`${level} ${tag}${value ? ' ' + value : ''}`);

  const indiId = new Map();
  persons.forEach((p, i) => indiId.set(p.id, `@I${i + 1}@`));
  const famId = new Map();
  unions.forEach((u, i) => famId.set(u.id, `@F${i + 1}@`));

  L(0, 'HEAD');
  L(1, 'SOUR', 'FAMILY_TREE');
  L(2, 'NAME', familyName);
  L(1, 'GEDC');
  L(2, 'VERS', '5.5.1');
  L(2, 'FORM', 'LINEAGE-LINKED');
  L(1, 'CHAR', 'UTF-8');
  L(1, 'DATE', new Date().toISOString().slice(0, 10).replace(/-/g, ' '));

  // INDI
  for (const p of persons) {
    const id = indiId.get(p.id);
    L(0, `${id} INDI`);
    L(1, 'NAME', `${p.given_name || ''} /${p.family_name || ''}/`.trim());
    if (p.courtesy_name) L(1, 'NICK', p.courtesy_name);
    L(1, 'SEX', p.gender === 'male' ? 'M' : p.gender === 'female' ? 'F' : 'U');

    const bd = fmtGedDate(p.birth_date, p.birth_precision, p.birth_date_end);
    if (bd) { L(1, 'BIRT'); L(2, 'DATE', bd); if (p.birth_place) L(2, 'PLAC', p.birth_place); }
    const dd = fmtGedDate(p.death_date, p.death_precision, p.death_date_end);
    if (dd) { L(1, 'DEAT'); L(2, 'DATE', dd); if (p.death_place) L(2, 'PLAC', p.death_place); }
    if (p.occupation) L(1, 'OCCU', p.occupation);
    if (p.bio) L(1, 'NOTE', String(p.bio).replace(/\r?\n/g, ' '));
    if (p.generation_no) L(1, '_GEN', String(p.generation_no));
    if (p.generation_name) L(1, '_ZIBEI', p.generation_name);
    if (p.branch) L(1, '_BRANCH', p.branch);
  }

  // FAM（HUSB/WIFE 按性别排，避免规范化排序导致角色颠倒）
  const byId = new Map(persons.map((p) => [p.id, p]));
  for (const u of unions) {
    const fid = famId.get(u.id);
    const a = byId.get(u.person_a_id);
    const b = byId.get(u.person_b_id);
    const swap = a?.gender === 'female' && b?.gender === 'male';
    const husbandId = swap ? u.person_b_id : u.person_a_id;
    const wifeId = swap ? u.person_a_id : u.person_b_id;
    L(0, `${fid} FAM`);
    L(1, 'HUSB', indiId.get(husbandId) || '');
    L(1, 'WIFE', indiId.get(wifeId) || '');
    const sd = fmtGedDate(u.start_date, u.start_precision);
    if (sd) { L(1, 'MARR'); L(2, 'DATE', sd); if (u.place) L(2, 'PLAC', u.place); }
    if (u.status === 'divorced') { L(1, 'DIV'); if (u.end_date) L(2, 'DATE', fmtGedDate(u.end_date, 'year')); }
    // 该家庭的子女：取父或母为本家庭任一方的亲子关系
    const kids = parentChild.filter((pc) => pc.parent_id === u.person_a_id || pc.parent_id === u.person_b_id);
    const seen = new Set();
    for (const k of kids) {
      if (seen.has(k.child_id)) continue;
      seen.add(k.child_id);
      L(1, 'CHIL', indiId.get(k.child_id) || '');
    }
  }

  L(0, 'TRLR');
  return lines.join('\n');
}

/**
 * 解析 GEDCOM 文本 → { persons, families, warnings }
 * 返回的 person 不带数据库 id，使用 xref 作为临时键。
 */
export function parseGedcom(text) {
  const lines = text.split(/\r?\n/);
  const records = [];
  let current = null;
  let lastTag = null;

  for (const line of lines) {
    const m = line.match(/^(\d+)\s+(?:(@[^@]+@)\s+)?(\S+)(?:\s+(.*))?$/);
    if (!m) continue;
    const level = Number(m[1]);
    const xref = m[2] || null;
    const tag = m[3];
    const value = (m[4] || '').trim();

    if (level === 0) {
      current = { xref, tag, value, children: [] };
      records.push(current);
      lastTag = null;
      continue;
    }
    if (!current) continue;
    if (level === 1) {
      const node = { tag, value, children: [] };
      current.children.push(node);
      lastTag = node;
    } else if (lastTag) {
      // 只支持两层嵌套（BIRT/DATE、BIRT/PLAC 足够）
      lastTag.children.push({ tag, value, children: [] });
    }
  }

  const warnings = [];
  const persons = [];
  const families = [];
  const byXref = new Map();
  const indiRecords = records.filter((r) => r.tag === 'INDI' && r.xref);

  for (const rec of indiRecords) {
    const get1 = (tag) => rec.children.find((c) => c.tag === tag);
    const nameNode = get1('NAME');
    let given = '', family = '';
    if (nameNode) {
      const raw = nameNode.value.replace(/\//g, '').trim();
      const slash = nameNode.value.match(/^(.*?)\/(.*?)\//);
      if (slash) { given = slash[1].trim(); family = slash[2].trim(); }
      else { family = raw.slice(0, 1); given = raw.slice(1); }
    }
    const sexNode = get1('SEX');
    const gender = sexNode?.value === 'M' ? 'male' : sexNode?.value === 'F' ? 'female' : 'unknown';
    const birt = get1('BIRT');
    const deat = get1('DEAT');
    const birth = parseGedDate(birt?.children.find((c) => c.tag === 'DATE')?.value);
    const death = parseGedDate(deat?.children.find((c) => c.tag === 'DATE')?.value);
    const p = {
      xref: rec.xref,
      family_name: family,
      given_name: given,
      courtesy_name: get1('NICK')?.value || '',
      gender,
      birth_date: birth.date,
      birth_precision: birth.precision,
      birth_date_end: birth.dateEnd,
      birth_place: birt?.children.find((c) => c.tag === 'PLAC')?.value || '',
      death_date: death.date,
      death_precision: death.precision,
      death_date_end: death.dateEnd,
      death_place: deat?.children.find((c) => c.tag === 'PLAC')?.value || '',
      is_deceased: !!deat,
      occupation: get1('OCCU')?.value || '',
      bio: get1('NOTE')?.value || '',
      generation_no: get1('_GEN') ? Number(get1('_GEN').value) : null,
      generation_name: get1('_ZIBEI')?.value || '',
      branch: get1('_BRANCH')?.value || '',
    };
    if (!p.given_name && !p.family_name) warnings.push(`${rec.xref} 缺少姓名，已跳过`);
    else { persons.push(p); byXref.set(rec.xref, p); }
  }

  for (const rec of records.filter((r) => r.tag === 'FAM' && r.xref)) {
    const husb = rec.children.find((c) => c.tag === 'HUSB')?.value || null;
    const wife = rec.children.find((c) => c.tag === 'WIFE')?.value || null;
    const chil = rec.children.filter((c) => c.tag === 'CHIL').map((c) => c.value);
    const marr = rec.children.find((c) => c.tag === 'MARR');
    const marrDate = parseGedDate(marr?.children.find((c) => c.tag === 'DATE')?.value);
    families.push({
      xref: rec.xref,
      husbandXref: husb,
      wifeXref: wife,
      childXrefs: chil,
      start_date: marrDate.date,
      start_precision: marrDate.precision,
      place: marr?.children.find((c) => c.tag === 'PLAC')?.value || '',
      status: rec.children.some((c) => c.tag === 'DIV') ? 'divorced' : 'ongoing',
    });
    if (!husb && !wife) warnings.push(`${rec.xref} FAM 无父母，已跳过`);
  }

  return { persons, families, warnings };
}
