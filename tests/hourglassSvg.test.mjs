import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHourglassSvg, buildDescendantSvg } from '../server/modules/svgChart.js';

function people() {
  // 三代：祖父/祖母 -> 父 -> 本人 -> 子
  return [
    { id: 'gf', family_name: '王', given_name: '祖', gender: 'male', generation_no: 1, birth_date: '1900-01-01' },
    { id: 'gm', family_name: '李', given_name: '氏', gender: 'female', generation_no: 1, birth_date: '1902-01-01' },
    { id: 'f', family_name: '王', given_name: '父', gender: 'male', generation_no: 2, birth_date: '1930-01-01' },
    { id: 'me', family_name: '王', given_name: '我', gender: 'male', generation_no: 3, birth_date: '1960-01-01' },
    { id: 'son', family_name: '王', given_name: '子', gender: 'male', generation_no: 4, birth_date: '1990-01-01' },
  ];
}
const edges = [
  { parent_id: 'gf', child_id: 'f' },
  { parent_id: 'gm', child_id: 'f' },
  { parent_id: 'f', child_id: 'me' },
  { parent_id: 'me', child_id: 'son' },
];
const marriages = [{ person_a_id: 'gf', person_b_id: 'gm' }, { person_a_id: 'f', person_b_id: 'me' }];

test('沙漏图输出合法 SVG 骨架', () => {
  const svg = buildHourglassSvg({ persons: people(), edges, marriages, focusId: 'me' });
  assert.ok(svg.startsWith('<?xml'));
  assert.ok(svg.includes('<svg xmlns="http://www.w3.org/2000/svg"'));
  assert.ok(svg.trimEnd().endsWith('</svg>'));
  assert.ok(svg.includes('width="') && svg.includes('height="'));
});

test('标题与副标题包含中心成员和代数', () => {
  const svg = buildHourglassSvg({ persons: people(), edges, marriages, focusId: 'me', title: '王氏沙漏' });
  assert.ok(svg.includes('王氏沙漏'));
  assert.ok(svg.includes('中心：王我'));
  assert.ok(svg.includes('上溯'));
  assert.ok(svg.includes('下延'));
});

test('中心成员被高亮（描边色与加粗）', () => {
  const svg = buildHourglassSvg({ persons: people(), edges, marriages, focusId: 'me' });
  assert.ok(svg.includes('stroke="#8c6d3f" stroke-width="2.6"'));
});

test('祖先前代出现在图中', () => {
  const svg = buildHourglassSvg({ persons: people(), edges, marriages, focusId: 'me', ancestorDepth: 2 });
  assert.ok(svg.includes('王祖'));
  assert.ok(svg.includes('李氏'));
});

test('后裔出现在图中', () => {
  const svg = buildHourglassSvg({ persons: people(), edges, marriages, focusId: 'me', descendantDepth: 1 });
  assert.ok(svg.includes('王子'));
});

test('ancestorDepth=0 时不含祖父母文本', () => {
  const svg = buildHourglassSvg({ persons: people(), edges, marriages, focusId: 'me', ancestorDepth: 0 });
  // 实现里会被钳到至少 1 代（父母），因此父名应在、祖父名不在
  assert.ok(svg.includes('王父'));
  assert.ok(!svg.includes('王祖'));
});

test('未知 focus 回退到第一位成员', () => {
  const svg = buildHourglassSvg({ persons: people(), edges, marriages, focusId: 'nope' });
  assert.ok(svg.includes('中心：王祖'));
});

test('空成员时给出占位而不是崩溃', () => {
  const svg = buildHourglassSvg({ persons: [], edges: [], marriages: [], focusId: null });
  assert.ok(svg.includes('暂无成员'));
});

test('名称中的 XML 特殊字符被转义', () => {
  const ppl = [{ id: 'x', family_name: '<A&B>', given_name: '"Q"', gender: 'male', generation_no: 1 }];
  const svg = buildHourglassSvg({ persons: ppl, edges: [], marriages: [], focusId: 'x' });
  assert.ok(svg.includes('&lt;A&amp;B&gt;'));
  assert.ok(!svg.includes('<A&B>'));
});

test('死亡的非焦点成员用浅色底（与在世区分）', () => {
  const ppl = [
    { id: 'x', family_name: '王', given_name: '子', gender: 'male', generation_no: 2 },
    { id: 'dead', family_name: '王', given_name: '故', gender: 'male', is_deceased: true, generation_no: 1 },
  ];
  const svg = buildHourglassSvg({
    persons: ppl,
    edges: [{ parent_id: 'dead', child_id: 'x' }],
    marriages: [],
    focusId: 'x',
  });
  assert.ok(svg.includes('#f7f4ee'));
});

test('后裔图的既有行为不受影响', () => {
  const svg = buildDescendantSvg({ persons: people(), edges, marriages, focusId: 'f', depth: 3 });
  assert.ok(svg.includes('王父'));
  assert.ok(svg.includes('王我'));
  assert.ok(svg.includes('王子'));
});

test('sandglass 与 descendant 图对同一数据都能稳定输出', () => {
  for (const p of people()) {
    const a = buildHourglassSvg({ persons: people(), edges, marriages, focusId: p.id });
    const b = buildDescendantSvg({ persons: people(), edges, marriages, focusId: p.id });
    assert.ok(a.includes('</svg>'));
    assert.ok(b.includes('</svg>'));
    assert.ok(a.length > 300);
    assert.ok(b.length > 300);
  }
});