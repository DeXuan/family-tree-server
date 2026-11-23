import test from 'node:test';
import assert from 'node:assert/strict';
import { auditCompleteness, matchesFilter } from '../server/modules/completeness.js';

const persons = [
  { id: 'a', family_name: '王', given_name: '甲', gender: 'male', birth_date: new Date('1980-01-01'),
    birth_place: '河北保定', generation_no: 1, generation_name: '守', bio: '生平', is_deceased: false },
  { id: 'b', family_name: '王', given_name: '乙', gender: null, birth_date: null,
    birth_place: '', generation_no: null, generation_name: '', bio: '', is_deceased: true },
];

const ctx = {
  hasParent: (id) => id === 'a',
  hasEvent: (id) => id === 'a',
  hasCitation: () => false,
  hasMedia: () => false,
};

test('完整度：字段齐全者得分高', () => {
  const r = auditCompleteness(persons, ctx);
  assert.ok(persons[0].completeness > persons[1].completeness);
  assert.equal(r.totalPersons, 2);
  assert.ok(r.overall > 0 && r.overall <= 100);
});

test('完整度：缺来源全族都记一条', () => {
  const r = auditCompleteness(persons, ctx);
  const source = r.items.find((i) => i.key === 'source');
  assert.equal(source.missingCount, 2);
});

test('完整度：最需补录按分数升序', () => {
  const r = auditCompleteness(persons, ctx);
  assert.equal(r.weakest[0].id, 'b');
});

test('筛选：missing=source 命中无来源者', () => {
  auditCompleteness(persons, ctx);
  const hit = persons.filter((p) => matchesFilter(p, { missing: 'source' }, ctx));
  assert.equal(hit.length, 2);
  const noHit = persons.filter((p) => matchesFilter(p, { missing: 'bio' }, ctx));
  assert.equal(noHit.length, 1);
  assert.equal(noHit[0].id, 'b');
});

test('筛选：incompleteBelow 阈值', () => {
  auditCompleteness(persons, ctx);
  const low = persons.filter((p) => matchesFilter(p, { incompleteBelow: 50 }, ctx));
  assert.equal(low.length, 1);
  assert.equal(low[0].id, 'b');
});

test('筛选：alive 与性别', () => {
  auditCompleteness(persons, ctx);
  const alive = persons.filter((p) => matchesFilter(p, { alive: 'true' }, ctx));
  assert.equal(alive.length, 1);
  assert.equal(alive[0].id, 'a');
  const male = persons.filter((p) => matchesFilter(p, { gender: 'male' }, ctx));
  assert.equal(male.length, 1);
});

test('筛选：无 filter 全部通过', () => {
  assert.equal(persons.filter((p) => matchesFilter(p, null, ctx)).length, 2);
});
