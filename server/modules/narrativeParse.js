/**
 * 口述 / 粘贴表格建谱解析（借鉴 yimai 的 impParseNarrative / impParseTable）。
 *
 * 设计取舍：
 * - 只产出"可校对草稿"，绝不直接入库；前端必须预览并人工确认
 * - 不确定的关系给 warning，不猜测后静默写库
 * - 纯函数，便于单元测试
 */

const NAME_CORE = '[\\u4e00-\\u9fa5]{2,4}';
const SELF_CORE = '我|本人';

/** 关系词 → 语义 */
const KIN = {
  父亲: { type: 'parent', side: 'father', otherGender: 'male' },
  爸爸: { type: 'parent', side: 'father', otherGender: 'male' },
  母亲: { type: 'parent', side: 'mother', otherGender: 'female' },
  妈妈: { type: 'parent', side: 'mother', otherGender: 'female' },
  儿子: { type: 'child', otherGender: 'male' },
  女儿: { type: 'child', otherGender: 'female' },
  丈夫: { type: 'spouse', otherGender: 'male' },
  老公: { type: 'spouse', otherGender: 'male' },
  妻子: { type: 'spouse', otherGender: 'female' },
  老婆: { type: 'spouse', otherGender: 'female' },
  爷爷: { type: 'grandparent', side: 'paternal', otherGender: 'male' },
  奶奶: { type: 'grandparent', side: 'paternal', otherGender: 'female' },
  外公: { type: 'grandparent', side: 'maternal', otherGender: 'male' },
  外婆: { type: 'grandparent', side: 'maternal', otherGender: 'female' },
  哥哥: { type: 'sibling', otherGender: 'male' },
  弟弟: { type: 'sibling', otherGender: 'male' },
  姐姐: { type: 'sibling', otherGender: 'female' },
  妹妹: { type: 'sibling', otherGender: 'female' },
};

const KIN_WORDS = Object.keys(KIN).join('|');
const BAD_NAME_CHARS = /[我你他她它的了是在叫和与跟年生出住籍贯父亲母亲儿子女儿丈夫妻子爷爷奶奶外公外婆哥哥弟弟姐姐妹妹]/;

/** 姓名合理性：避免把"我父亲是""今天天气"等片段当人名 */
function isPlausibleName(name) {
  return typeof name === 'string'
    && /^[\u4e00-\u9fa5]{2,4}$/.test(name)
    && !BAD_NAME_CHARS.test(name);
}

function emptyDraft() {
  return { persons: [], relations: [], warnings: [] };
}

function getPerson(draft, name) {
  let p = draft.persons.find((x) => x.name === name);
  if (!p) {
    p = {
      name, gender: null, birthYear: null, deathYear: null,
      birthPlace: '', generationName: '', isSelf: false, note: '',
    };
    draft.persons.push(p);
  }
  return p;
}

function setGender(person, gender) {
  if (!person || !gender) return;
  if (person.gender && person.gender !== gender) {
    person.note = `性别有冲突：先记 ${person.gender}，又出现 ${gender}`;
    return;
  }
  person.gender = gender;
}

function addRelation(draft, rel) {
  const key = `${rel.kind}:${rel.from}:${rel.to}:${rel.role || ''}`;
  if (draft.relations.some((r) => `${r.kind}:${r.from}:${r.to}:${r.role || ''}` === key)) return;
  draft.relations.push({ ...rel, source: 'narrative' });
}

function extractFacts(sentence) {
  const facts = {};
  const birth = sentence.match(/((?:19|20)\d{2})\s*年?\s*(?:出生|生)/)
    || sentence.match(/生于\s*((?:19|20)\d{2})/);
  if (birth) facts.birthYear = Number(birth[1]);

  const death = sentence.match(/((?:19|20)\d{2})\s*年?\s*(?:去世|卒|逝世|病故)/);
  if (death) facts.deathYear = Number(death[1]);

  const place = sentence.match(/(?:出生(?:在|于)|籍贯(?:是|在)?|老家(?:是|在)?)\s*([\u4e00-\u9fa5]{2,12}?)(?:[，,。；;]|$)/);
  if (place) facts.birthPlace = place[1];

  const zb = sentence.match(/字辈(?:是|为)?\s*([\u4e00-\u9fa5])/);
  if (zb) facts.generationName = zb[1];
  return facts;
}

function applyFacts(person, facts) {
  if (!person) return;
  if (facts.birthYear && !person.birthYear) person.birthYear = facts.birthYear;
  if (facts.deathYear && !person.deathYear) person.deathYear = facts.deathYear;
  if (facts.birthPlace && !person.birthPlace) person.birthPlace = facts.birthPlace;
  if (facts.generationName && !person.generationName) person.generationName = facts.generationName;
}

function resolveSubject(raw, draft, lastPerson) {
  if (raw === '我' || raw === '本人') {
    const self = draft.persons.find((p) => p.isSelf);
    if (self) return self.name;
    const placeholder = getPerson(draft, '我');
    placeholder.isSelf = true;
    placeholder.note = '文本中使用了「我」，请补填真实姓名';
    return '我';
  }
  if (raw === '他' || raw === '她' || raw === '其') return lastPerson ? lastPerson.name : '';
  return raw;
}

/**
 * 解析一段口述文本。
 */
export function parseNarrative(text) {
  const draft = emptyDraft();
  if (!text || typeof text !== 'string') {
    draft.warnings.push('没有可解析的文本');
    return draft;
  }

  const sentences = text
    .replace(/[；;]/g, '。')
    .split(/[。\n！!？?]/)
    .map((s) => s.trim())
    .filter(Boolean);

  let lastPerson = null;

  for (const raw of sentences) {
    const facts = extractFacts(raw);

    // 1) 自报姓名：我叫王小明 / 我是王小明 / 本人名叫王小明
    const selfMatch = raw.match(new RegExp(`(?:${SELF_CORE})(?:叫|名叫|是)\\s*(?<name>${NAME_CORE})`));
    if (selfMatch && isPlausibleName(selfMatch.groups.name)) {
      const me = getPerson(draft, selfMatch.groups.name);
      me.isSelf = true;
      applyFacts(me, facts);
      lastPerson = me;
      continue;
    }

    if (/^我/.test(raw)) {
      const self = draft.persons.find((p) => p.isSelf);
      if (self) lastPerson = self;
    }

    // 2) A(的)K 是 B  —— 例：我父亲是王德明 / 王小明的妻子是周静
    const m1 = raw.match(new RegExp(
      `(?<subject>${SELF_CORE}|${NAME_CORE})的?(?<kin>${KIN_WORDS})(?:是|叫|名叫)?\\s*(?<other>${NAME_CORE})`
    ));
    if (m1 && isPlausibleName(m1.groups.other)) {
      const subjectName = resolveSubject(m1.groups.subject, draft, lastPerson);
      const kin = KIN[m1.groups.kin];
      const other = getPerson(draft, m1.groups.other);
      setGender(other, kin.otherGender);

      if (kin.type === 'parent') {
        if (subjectName) addRelation(draft, { kind: 'parent', from: other.name, to: subjectName, role: kin.side });
      } else if (kin.type === 'child') {
        if (subjectName) addRelation(draft, { kind: 'parent', from: subjectName, to: other.name, role: 'unknown' });
      } else if (kin.type === 'spouse') {
        if (subjectName) addRelation(draft, { kind: 'spouse', from: subjectName, to: other.name });
      } else {
        draft.warnings.push(`「${raw}」：${m1.groups.kin}需要先有中间一代（父/母），已建人物，请手动补关系`);
      }
      applyFacts(other, facts);
      lastPerson = other;
      continue;
    }

    // 3) A 是 B 的 K —— 例：王小明是王德明的儿子
    const m2 = raw.match(new RegExp(
      `(?<subject>${NAME_CORE})是(?<anchor>${SELF_CORE}|${NAME_CORE})的(?<kin>${KIN_WORDS})`
    ));
    if (m2 && isPlausibleName(m2.groups.subject)) {
      const subject = getPerson(draft, m2.groups.subject);
      const anchorName = resolveSubject(m2.groups.anchor, draft, lastPerson);
      const kin = KIN[m2.groups.kin];
      if (kin.type === 'parent') {
        setGender(subject, kin.side === 'father' ? 'male' : 'female');
        if (anchorName) addRelation(draft, { kind: 'parent', from: subject.name, to: anchorName, role: kin.side });
      } else if (kin.type === 'child') {
        setGender(subject, kin.otherGender);
        if (anchorName) addRelation(draft, { kind: 'parent', from: anchorName, to: subject.name, role: 'unknown' });
      } else if (kin.type === 'spouse') {
        if (anchorName) addRelation(draft, { kind: 'spouse', from: anchorName, to: subject.name });
      } else {
        draft.warnings.push(`「${raw}」：${m2.groups.kin}需要先有中间一代，已建人物，请手动补关系`);
      }
      applyFacts(subject, facts);
      lastPerson = subject;
      continue;
    }

    // 4) A 和 B 结婚 / 是夫妻
    const m3 = raw.match(new RegExp(
      `(?<a>${SELF_CORE}|${NAME_CORE})(?:和|与|跟)(?<b>${SELF_CORE}|${NAME_CORE})(?:结婚|成婚|结为夫妻|是夫妻)`
    ));
    if (m3) {
      const aName = resolveSubject(m3.groups.a, draft, lastPerson);
      const bName = resolveSubject(m3.groups.b, draft, lastPerson);
      if (aName && bName && aName !== bName) {
        addRelation(draft, { kind: 'spouse', from: aName, to: bName });
        lastPerson = getPerson(draft, bName);
      }
      continue;
    }

    // 5) 整句就是一个姓名（可带出生信息）
    if (isPlausibleName(raw.split(/[，,]/)[0].trim())) {
      const p = getPerson(draft, raw.split(/[，,]/)[0].trim());
      applyFacts(p, facts);
      lastPerson = p;
      continue;
    }

    // 6) 兜底：只有"句子里出现姓名 + 有事实信息"时才建人，避免把普通句子当姓名
    const hasFacts = Object.keys(facts).length > 0;
    const anyName = raw.match(new RegExp(NAME_CORE));
    if (anyName && isPlausibleName(anyName[0]) && hasFacts) {
      const p = getPerson(draft, anyName[0]);
      applyFacts(p, facts);
      lastPerson = p;
    } else if (hasFacts) {
      const target = draft.persons.find((p) => p.isSelf) || lastPerson;
      if (target) applyFacts(target, facts);
      else draft.warnings.push(`「${raw}」：无法判断说的是谁，已忽略`);
    }
  }

  // 父母性别补齐
  for (const rel of draft.relations) {
    if (rel.kind !== 'parent') continue;
    const parent = draft.persons.find((p) => p.name === rel.from);
    if (parent && !parent.gender) {
      if (rel.role === 'father') parent.gender = 'male';
      if (rel.role === 'mother') parent.gender = 'female';
    }
  }

  if (!draft.persons.length) draft.warnings.push('没有识别到任何人物，请检查是否包含「姓名 + 称呼」');
  return draft;
}

/** 解析粘贴表格（制表符/逗号/中文逗号） */
export function parseTable(text) {
  const draft = emptyDraft();
  if (!text || typeof text !== 'string') {
    draft.warnings.push('没有可解析的表格');
    return draft;
  }

  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) {
    draft.warnings.push('表格为空');
    return draft;
  }

  const split = (line) => {
    if (line.includes('\t')) return line.split('\t').map((x) => x.trim());
    if (line.includes('，')) return line.split('，').map((x) => x.trim());
    return line.split(',').map((x) => x.trim());
  };

  let header = split(lines[0]);
  const hasHeader = header.some((h) => ['姓名', '名字', 'name'].includes(h));
  if (!hasHeader) header = ['姓名', '性别', '出生年', '父亲', '母亲', '配偶', '字辈', '籍贯'];

  const col = (name) => header.findIndex((h) => h === name);
  const idx = {
    name: col('姓名') >= 0 ? col('姓名') : col('名字'),
    gender: col('性别'),
    birth: col('出生年') >= 0 ? col('出生年') : col('出生'),
    father: col('父亲'),
    mother: col('母亲'),
    spouse: col('配偶'),
    zb: col('字辈'),
    place: col('籍贯') >= 0 ? col('籍贯') : col('出生地'),
  };

  const rows = hasHeader ? lines.slice(1) : lines;
  for (const line of rows) {
    const cells = split(line);
    const name = (cells[idx.name] || '').trim();
    if (!isPlausibleName(name)) {
      if (name) draft.warnings.push(`「${name}」不是有效姓名，已跳过`);
      continue;
    }
    const p = getPerson(draft, name);
    const g = (cells[idx.gender] || '').trim();
    setGender(p, ['男', 'M', 'm'].includes(g) ? 'male' : ['女', 'F', 'f'].includes(g) ? 'female' : null);

    const by = parseInt((cells[idx.birth] || '').replace(/[^\d]/g, ''), 10);
    if (Number.isInteger(by) && by > 1000) p.birthYear = by;
    if (idx.zb >= 0) p.generationName = (cells[idx.zb] || '').trim().slice(0, 2);
    if (idx.place >= 0) p.birthPlace = (cells[idx.place] || '').trim();

    const father = (cells[idx.father] || '').trim();
    const mother = (cells[idx.mother] || '').trim();
    if (isPlausibleName(father)) {
      const fp = getPerson(draft, father);
      setGender(fp, 'male');
      addRelation(draft, { kind: 'parent', from: father, to: name, role: 'father' });
    }
    if (isPlausibleName(mother)) {
      const mp = getPerson(draft, mother);
      setGender(mp, 'female');
      addRelation(draft, { kind: 'parent', from: mother, to: name, role: 'mother' });
    }
    if (idx.spouse >= 0) {
      for (const sp of (cells[idx.spouse] || '').split(/[、/,，;；]/).map((x) => x.trim()).filter(Boolean)) {
        if (!isPlausibleName(sp)) continue;
        getPerson(draft, sp);
        addRelation(draft, { kind: 'spouse', from: name, to: sp });
      }
    }
  }

  if (!draft.persons.length) draft.warnings.push('没有识别到任何成员，请检查表头与姓名列');
  return draft;
}