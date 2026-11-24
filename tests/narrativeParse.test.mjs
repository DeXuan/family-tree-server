import test from 'node:test';
import assert from 'node:assert/strict';
import { parseNarrative, parseTable } from '../server/modules/narrativeParse.js';

const names = (draft) => draft.persons.map((p) => p.name).sort();

test('自我介绍 + 父母 + 生年', () => {
  const d = parseNarrative('我叫王小明，1997年出生。我父亲是王德明，1952年生。我母亲叫陈玉兰。');
  assert.deepEqual(names(d), ['王小明', '王德明', '陈玉兰'].sort());
  const me = d.persons.find((p) => p.name === '王小明');
  assert.equal(me.isSelf, true);
  assert.equal(me.birthYear, 1997);
  const dad = d.persons.find((p) => p.name === '王德明');
  assert.equal(dad.gender, 'male');
  assert.equal(dad.birthYear, 1952);

  const rels = d.relations.map((r) => `${r.kind}:${r.from}->${r.to}:${r.role}`);
  assert.ok(rels.includes('parent:王德明->王小明:father'));
  assert.ok(rels.includes('parent:陈玉兰->王小明:mother'));
});

test('子女与配偶', () => {
  const d = parseNarrative('我叫王小明。我妻子是周静。我儿子叫王一诺，2021年出生。');
  const rels = d.relations.map((r) => `${r.kind}:${r.from}->${r.to}`);
  assert.ok(rels.includes('spouse:王小明->周静'));
  assert.ok(rels.includes('parent:王小明->王一诺'));
  assert.equal(d.persons.find((p) => p.name === '周静').gender, 'female');
  assert.equal(d.persons.find((p) => p.name === '王一诺').gender, 'male');
});

test('反向句式：A 是 B 的儿子', () => {
  const d = parseNarrative('王小明是王德明的儿子。');
  const rel = d.relations[0];
  assert.equal(rel.kind, 'parent');
  assert.equal(rel.from, '王德明');
  assert.equal(rel.to, '王小明');
  assert.equal(d.persons.find((p) => p.name === '王小明').gender, 'male');
});

test('婚姻句式：A 和 B 结婚', () => {
  const d = parseNarrative('王小明和周静结婚。');
  const rel = d.relations[0];
  assert.equal(rel.kind, 'spouse');
  assert.deepEqual([rel.from, rel.to].sort(), ['周静', '王小明'].sort());
});

test('祖辈关系自动补中间一代并给出 warning', () => {
  const d = parseNarrative('王小明是王德明的爷爷。');
  assert.ok(d.persons.some((p) => p.name === '王小明'));
  // 自动补一个占位父/母，串起跨代关系
  assert.ok(d.persons.some((p) => p.isPlaceholder), '应有占位中间代');
  assert.ok(d.warnings.some((w) => w.includes('中间一代')));
  assert.ok(d.relations.length >= 2, '应至少有两条亲子关系');
});

test('兄弟姐妹自动补共同父母', () => {
  const d = parseNarrative('王小刚是王德明的弟弟。');
  assert.ok(d.persons.some((p) => p.name === '王小刚'));
  assert.ok(d.warnings.some((w) => w.includes('共同父母')));
});

test('出生地抽取', () => {
  const d = parseNarrative('我叫王小明，出生在北京。');
  assert.equal(d.persons.find((p) => p.name === '王小明').birthPlace, '北京');
});

test('空文本给出明确提示', () => {
  const d = parseNarrative('');
  assert.equal(d.persons.length, 0);
  assert.ok(d.warnings.length > 0);
});

test('乱文不产生脏数据', () => {
  const d = parseNarrative('今天天气不错，出去走走。');
  assert.equal(d.persons.length, 0);
  assert.ok(d.warnings.some((w) => w.includes('没有识别')));
});

test('表格解析：带表头 + 父母 + 配偶', () => {
  const text = [
    '姓名,性别,出生年,父亲,母亲,配偶,字辈,籍贯',
    '王小明,男,1997,王德明,陈玉兰,周静,明,北京',
    '王一诺,男,2021,王小明,,,一,北京',
  ].join('\n');
  const d = parseTable(text);
  assert.equal(d.persons.length, 5); // 王小明 王德明 陈玉兰 周静 王一诺
  const rels = d.relations.map((r) => `${r.kind}:${r.from}->${r.to}:${r.role || ''}`);
  assert.ok(rels.includes('parent:王德明->王小明:father'));
  assert.ok(rels.includes('parent:陈玉兰->王小明:mother'));
  assert.ok(rels.includes('spouse:王小明->周静:'));
  assert.ok(rels.includes('parent:王小明->王一诺:father'));
});

test('表格解析：无表头按默认列顺序', () => {
  const d = parseTable('王小明,男,1997,王德明,陈玉兰');
  assert.equal(d.persons.length, 3);
});

test('表格解析：非法姓名被跳过并 warning', () => {
  const d = parseTable('姓名,性别\n王,男\n王小明,男');
  assert.ok(!d.persons.some((p) => p.name === '王'));
  assert.ok(d.warnings.some((w) => w.includes('不是有效姓名')));
});