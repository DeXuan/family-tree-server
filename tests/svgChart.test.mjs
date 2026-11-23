import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDescendantSvg } from '../server/modules/svgChart.js';

const persons = [
  { id: 'a', family_name: '王', given_name: '守仁', generation_no: 1, gender: 'male', birth_date: new Date('1926-03-12'), is_deceased: false },
  { id: 'b', family_name: '王', given_name: '德昌', generation_no: 2, gender: 'male', birth_date: new Date('1949-01-08'), is_deceased: false },
  { id: 'c', family_name: '王', given_name: '建国', generation_no: 3, gender: 'male', birth_date: new Date('1972-07-04'), is_deceased: false },
];
const edges = [
  { parent_id: 'a', child_id: 'b' },
  { parent_id: 'b', child_id: 'c' },
];
const marriages = [{ person_a_id: 'a', person_b_id: 'spouse' }];

test('生成包含成员与世代的合法 SVG', () => {
  const svg = buildDescendantSvg({ persons, edges, marriages, title: '王氏族谱' });
  assert.match(svg, /^<\?xml/);
  assert.match(svg, /<svg[^>]+xmlns="http:\/\/www.w3.org\/2000\/svg"/);
  assert.ok(svg.includes('王守仁'));
  assert.ok(svg.includes('王德昌'));
  assert.ok(svg.includes('王建国'));
  assert.ok(svg.includes('3世'));
  assert.ok(!svg.includes('NaN'));
  assert.ok(!svg.includes('undefined'));
});

test('XML 特殊字符被转义', () => {
  const risky = [
    { id: 'x', family_name: '王', given_name: '<script>', generation_no: 1, gender: 'male', is_deceased: false },
  ];
  const svg = buildDescendantSvg({ persons: risky, edges: [], marriages: [] });
  assert.ok(svg.includes('&lt;script&gt;'));
  assert.ok(!svg.includes('<script>'));
});

test('指定 focus 时只展开该成员的后代', () => {
  const svg = buildDescendantSvg({ persons, edges, marriages, focusId: 'b' });
  assert.ok(svg.includes('王德昌'));
  assert.ok(svg.includes('王建国'));
  assert.ok(!svg.includes('王守仁'));
});

test('空成员列表返回占位 SVG', () => {
  const svg = buildDescendantSvg({ persons: [], edges: [], marriages: [] });
  assert.ok(svg.includes('<svg'));
  assert.ok(svg.includes('暂无成员'));
});
