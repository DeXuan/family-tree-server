import test from 'node:test';
import assert from 'node:assert/strict';
import { exportGedcom, parseGedcom } from '../server/modules/gedcom.js';

const persons = [
  {
    id: 'p1', family_name: '王', given_name: '守仁', courtesy_name: '静山',
    gender: 'male', birth_date: new Date('1880-03-12'), birth_precision: 'exact',
    birth_place: '河北保定', death_date: new Date('1952-11-02'), death_precision: 'exact',
    death_place: '河北保定', occupation: '塾师', bio: '主持续修族谱',
    generation_no: 1, generation_name: '守', branch: '长房',
  },
  {
    id: 'p2', family_name: '李', given_name: '淑贞',
    gender: 'female', birth_date: new Date('1885-06-20'), birth_precision: 'year',
    is_deceased: true,
  },
  {
    id: 'p3', family_name: '王', given_name: '德昌', courtesy_name: '伯元',
    gender: 'male', birth_date: new Date('1905-01-08'), birth_precision: 'about',
    death_date: new Date('1978-09-30'), death_precision: 'exact',
    is_deceased: true,
  },
];

const parentChild = [
  { parent_id: 'p1', child_id: 'p3', relation_type: 'biological' },
  { parent_id: 'p2', child_id: 'p3', relation_type: 'biological' },
];

const marriages = [
  { id: 'm1', person_a_id: 'p1', person_b_id: 'p2', status: 'ongoing', start_date: null, start_precision: 'unknown', place: '' },
];

test('GEDCOM 导出包含 HEAD / INDI / FAM，且角色按性别排列', () => {
  const text = exportGedcom(persons, parentChild, marriages, '王氏族谱');
  assert.match(text, /0 HEAD/);
  assert.match(text, /@I1@ INDI/);
  assert.match(text, /1 NAME 守仁 \/王\//);
  assert.match(text, /1 NAME 淑贞 \/李\//);

  const fam = text.split('\n').filter((l) => l.startsWith('0 @F1@ FAM'));
  assert.equal(fam.length, 1);
  const block = text.slice(text.indexOf('0 @F1@ FAM'), text.indexOf('0 @F1@ FAM') + 120);
  assert.match(block, /1 HUSB @I1@/);
  assert.match(block, /1 WIFE @I2@/);
  assert.match(block, /1 CHIL @I3@/);
});

test('GEDCOM 日期精度往返：exact / year / about', () => {
  const text = exportGedcom(persons, parentChild, marriages);
  assert.match(text, /2 DATE 12 MAR 1880/);
  assert.match(text, /2 DATE 1885/);
  assert.match(text, /2 DATE ABT 1905/);

  const parsed = parseGedcom(text);
  const byName = (n) => parsed.persons.find((p) => p.given_name === n);
  assert.equal(byName('守仁').birth_date, '1880-03-12');
  assert.equal(byName('守仁').birth_precision, 'exact');
  assert.equal(byName('淑贞').birth_date, '1885-01-01');
  assert.equal(byName('淑贞').birth_precision, 'year');
  assert.equal(byName('德昌').birth_date, '1905-01-01');
  assert.equal(byName('德昌').birth_precision, 'about');
});

test('GEDCOM 往返：人数、家庭数、亲子边一致', () => {
  const text = exportGedcom(persons, parentChild, marriages);
  const parsed = parseGedcom(text);
  assert.equal(parsed.persons.length, 3);
  assert.equal(parsed.families.length, 1);
  assert.equal(parsed.warnings.length, 0);
  const fam = parsed.families[0];
  assert.deepEqual(fam.childXrefs.length, 1);
  assert.ok(fam.husbandXref && fam.wifeXref);
});

test('GEDCOM 解析区间日期（BET … AND …）', () => {
  const text = [
    '0 HEAD',
    '0 @I1@ INDI',
    '1 NAME 测/试',
    '1 BIRT',
    '2 DATE BET 1900 AND 1910',
    '0 TRLR',
  ].join('\n');
  const parsed = parseGedcom(text);
  assert.equal(parsed.persons[0].birth_precision, 'range');
  assert.equal(parsed.persons[0].birth_date, '1900-01-01');
  assert.equal(parsed.persons[0].birth_date_end, '1910-12-31');
});

test('GEDCOM 解析空姓名记录会跳过并给出 warning', () => {
  const text = [
    '0 HEAD',
    '0 @I1@ INDI',
    '1 SEX M',
    '0 TRLR',
  ].join('\n');
  const parsed = parseGedcom(text);
  assert.equal(parsed.persons.length, 0);
  assert.equal(parsed.warnings.length, 1);
});
