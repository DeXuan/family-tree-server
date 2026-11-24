import test from 'node:test';
import assert from 'node:assert/strict';
import { renderOrgChart, renderTreeNodes } from '../public/js/components/tree.js';

const node = (id, name, kids = [], extra = {}) => ({
  id, name, gender: 'male', gen: 1, birth_year: 1950, death_year: null,
  deceased: false, branch: '', courtesy: '', spouses: [], children: kids, ...extra,
});

function sample() {
  return [
    node('r1', '王守仁', [
      node('c1', '王德昌', [
        node('g1', '王建国', []),
      ]),
      node('c2', '王德明', []),
    ]),
  ];
}

test('结构图包含视口、舞台与树容器', () => {
  const html = renderOrgChart(sample());
  assert.ok(html.includes('class="org-viewport"'));
  assert.ok(html.includes('class="org-stage"'));
  assert.ok(html.includes('class="org-tree"'));
});

test('有子女的节点渲染 org-children 容器', () => {
  const html = renderOrgChart(sample());
  assert.ok(html.includes('class="org-children"'));
  // 根 1 个 + 长子 1 个 = 2 个容器
  assert.equal((html.match(/class="org-children"/g) || []).length, 2);
});

test('有子女的节点带展开按钮，叶子节点不带 ', () => {
  const html = renderOrgChart(sample());
  const toggles = (html.match(/data-toggle/g) || []).length;
  assert.equal(toggles, 2, '根与长子有子女，各一个按钮');
});

test('每个成员都带 data-person 便于点击跳转', () => {
  const html = renderOrgChart(sample());
  for (const id of ['r1', 'c1', 'c2', 'g1']) {
    assert.ok(html.includes(`data-person="${id}"`), id);
  }
});

test('姓名与世代正常渲染', () => {
  const html = renderOrgChart(sample());
  assert.ok(html.includes('王守仁'));
  assert.ok(html.includes('王建国'));
  assert.ok(html.includes('1世'));
});

test('配偶卡片渲染在 org-self 内', () => {
  const withSpouse = [node('r1', '王守仁', [], {
    spouses: [{ id: 's1', name: '李淑贞', gender: 'female', gen: 1, unionType: 'married', unionStatus: 'married' }],
  })];
  const html = renderOrgChart(withSpouse);
  assert.ok(html.includes('李淑贞'));
  assert.ok(html.includes('class="spouse-link"'));
  assert.ok(/class="org-self"[\s\S]*李淑贞[\s\S]*org-self|org-self[\s\S]*李淑贞/.test(html));
});

test('禁止内联 style 属性（CSP 要求）', () => {
  const html = renderOrgChart(sample(), { zoom: 1.2 });
  assert.ok(!/\sstyle="/.test(html), '不得输出 style 属性，缩放应由 CSSOM 设置');
});

test('缩放值写入 data-zoom 并在 50–150 之间钳制', () => {
  assert.ok(renderOrgChart(sample(), { zoom: 1 }).includes('data-zoom="100"'));
  assert.ok(renderOrgChart(sample(), { zoom: 0.1 }).includes('data-zoom="50"'));
  assert.ok(renderOrgChart(sample(), { zoom: 9 }).includes('data-zoom="150"'));
  assert.ok(renderOrgChart(sample(), { zoom: 1.25 }).includes('data-zoom="125"'));
});

test('异常缩放参数回退 100%', () => {
  assert.ok(renderOrgChart(sample(), { zoom: 'abc' }).includes('data-zoom="100"'));
  assert.ok(renderOrgChart(sample(), { zoom: null }).includes('data-zoom="100"'));
});

test('名称中的 HTML 特殊字符被转义', () => {
  const html = renderOrgChart([node('x', '<script>alert(1)</script>')]);
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(html.includes('&lt;script&gt;'));
});

test('空树渲染空容器而不是报错', () => {
  const html = renderOrgChart([]);
  assert.ok(html.includes('org-tree'));
  assert.ok(!html.includes('data-person'));
});

test('与缩进列表共用同一套卡片样式类', () => {
  const org = renderOrgChart(sample());
  const list = renderTreeNodes(sample());
  for (const cls of ['person-card', 'pc-main', 'pc-name', 'pc-meta', 'couple', 'tree-toggle']) {
    assert.ok(org.includes(cls), `org 缺少 ${cls}`);
    assert.ok(list.includes(cls), `list 缺少 ${cls}`);
  }
});

test('多层嵌套结构闭合正确（li/ul 数量匹配）', () => {
  const html = renderOrgChart(sample());
  const lis = (html.match(/<li class="org-node">/g) || []).length;
  const uls = (html.match(/<ul class="org-(tree|children)"/g) || []).length;
  assert.equal(lis, 4, '四个成员各一个 li');
  assert.equal(uls, 3, '树根 + 两个子容器');
});
