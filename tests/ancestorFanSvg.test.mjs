import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAncestorFanSvg } from '../server/modules/svgChart.js';

const focus = { id: 'me', family_name: '王', given_name: '我', gender: 'male' };

function anc(distance, relation, name, gender) {
  return {
    distance,
    relation,
    person: {
      id: `${name}-${distance}`, family_name: '王', given_name: name,
      gender: gender || (relation === '母' ? 'female' : 'male'),
    },
  };
}

test('输出合法 SVG 骨架', () => {
  const svg = buildAncestorFanSvg({ focus, ancestors: [anc(1, '父', '父'), anc(1, '母', '母')] });
  assert.ok(svg.startsWith('<?xml'));
  assert.ok(svg.includes('<svg xmlns="http://www.w3.org/2000/svg"'));
  assert.ok(svg.trimEnd().endsWith('</svg>'));
});

test('中心显示本人姓名与「本人」标注', () => {
  const svg = buildAncestorFanSvg({ focus, ancestors: [anc(1, '父', '父')] });
  assert.ok(svg.includes('王我'));
  assert.ok(svg.includes('本人'));
});

test('标题与代数说明正确', () => {
  const svg = buildAncestorFanSvg({
    focus, title: '王氏祖先盘',
    ancestors: [anc(1, '父', '父'), anc(2, '父', '祖父')],
  });
  assert.ok(svg.includes('王氏祖先盘'));
  assert.ok(svg.includes('上溯 2 代'));
  assert.ok(svg.includes('左为父系'));
  assert.ok(svg.includes('右为母系'));
});

test('祖先姓名出现在图中', () => {
  const svg = buildAncestorFanSvg({
    focus,
    ancestors: [anc(1, '父', '德昌'), anc(1, '母', '淑贞')],
  });
  assert.ok(svg.includes('王德昌'));
  assert.ok(svg.includes('王淑贞'));
});

test('父系与母系用不同配色区分', () => {
  const svg = buildAncestorFanSvg({
    focus,
    ancestors: [anc(1, '父', '父'), anc(1, '母', '母')],
  });
  assert.ok(svg.includes('#eef4f0'), '父系填充色');
  assert.ok(svg.includes('#f6ece9'), '母系填充色');
});

test('每代产生扇形路径（path 元素）', () => {
  const svg = buildAncestorFanSvg({
    focus,
    ancestors: [anc(1, '父', '父'), anc(1, '母', '母'),
      anc(2, '父', '祖父'), anc(2, '母', '祖母'),
      anc(3, '父', '曾祖')],
  });
  const paths = (svg.match(/<path /g) || []).length;
  assert.equal(paths, 5);
});

test('没有祖先时只画中心', () => {
  const svg = buildAncestorFanSvg({ focus, ancestors: [] });
  assert.ok(svg.includes('王我'));
  assert.equal((svg.match(/<path /g) || []).length, 0);
  assert.ok(svg.includes('上溯 0 代'));
});

test('空 focus 返回占位', () => {
  const svg = buildAncestorFanSvg({ focus: null, ancestors: [] });
  assert.ok(svg.includes('暂无成员'));
});

test('名称中的特殊字符被转义', () => {
  const svg = buildAncestorFanSvg({
    focus: { id: 'x', family_name: '<A>', given_name: '&B', gender: 'male' },
    ancestors: [],
  });
  assert.ok(svg.includes('&lt;A&gt;'));
  assert.ok(!svg.includes('<A>'));
});

test('超过 6 代被截断（防止无限展开）', () => {
  const many = [];
  for (let d = 1; d <= 9; d++) many.push(anc(d, d % 2 ? '父' : '母', `祖${d}`));
  const svg = buildAncestorFanSvg({ focus, ancestors: many });
  assert.ok(svg.includes('上溯 6 代'));
  assert.ok(!svg.includes('祖9'));
});

test('同名祖先不会导致元素丢失（数量对齐）', () => {
  const dups = [anc(1, '父', '同名'), anc(1, '母', '同名')];
  const svg = buildAncestorFanSvg({ focus, ancestors: dups });
  assert.equal((svg.match(/<path /g) || []).length, 2);
});