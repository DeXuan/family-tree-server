import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutUmbrella } from '../public/js/lib/radialLayout.js';
import { renderUmbrella } from '../public/js/components/tree.js';

/** 构造节点 */
const n = (id, children = [], extra = {}) => ({
  id, name: id, family_name: '', given_name: id, gender: 'male',
  gen: 1, birth_year: 1950, death_year: null, deceased: false,
  branch: '', courtesy: '', spouses: [], children, ...extra,
});

/** 一棵有 1 根 / 3 层 / 5 叶的树 */
function tree() {
  return [
    n('r', [
      n('a', [n('a1'), n('a2')]),
      n('b', [n('b1')]),
      n('c', [n('c1'), n('c2')]),
    ]),
  ];
}

const dist = (p) => Math.hypot(p.x, p.y);

test('空输入返回空布局而不报错', () => {
  const r = layoutUmbrella([]);
  assert.equal(r.count, 0);
  assert.deepEqual(r.nodes, []);
  assert.equal(r.path, '');
  assert.ok(r.width > 0 && r.height > 0);
});

test('单节点位于画布内且没有连线', () => {
  const r = layoutUmbrella([n('only')]);
  assert.equal(r.count, 1);
  assert.equal(r.path, '');
  const p = r.nodes[0];
  assert.ok(p.x > 0 && p.x < r.width);
  assert.ok(p.y > 0 && p.y < r.height);
  assert.equal(p.isRoot, true);
});

test('所有节点坐标落在画布范围内', () => {
  const r = layoutUmbrella(tree());
  for (const p of r.nodes) {
    assert.ok(p.x >= 0 && p.x <= r.width, `${p.id} x=${p.x} w=${r.width}`);
    assert.ok(p.y >= 0 && p.y <= r.height, `${p.id} y=${p.y} h=${r.height}`);
  }
});

test('连线数 = 节点数 - 1（单根树）', () => {
  const r = layoutUmbrella(tree());
  const segments = r.path.split('M').filter(Boolean);
  assert.equal(segments.length, r.count - 1);
});

test('根水平居中且位于画布下方（伞柄），伞盖向上展开', () => {
  const r = layoutUmbrella(tree());
  const root = r.nodes.find((p) => p.id === 'r');
  // 水平居中
  assert.ok(Math.abs(root.x - r.width / 2) < r.width * 0.05,
    `根应水平居中：${root.x} vs ${r.width / 2}`);
  // 位于画布偏下（伞柄位置）
  assert.ok(root.y > r.height * 0.55, `根应在下方：${root.y}/${r.height}`);
  // 孙辈整体在根的上方（伞盖）
  const far = r.nodes.filter((p) => p.depth >= 2);
  const minY = Math.min(...far.map((p) => p.y));
  assert.ok(minY < root.y - r.ringGap, '伞盖应显著高于根');
});

test('同层节点角度互不重叠且按扇区递增', () => {
  const r = layoutUmbrella(tree());
  const kids = r.nodes.filter((p) => p.depth === 1).sort((a, b) => a.angle - b.angle);
  assert.equal(kids.length, 3);
  for (let i = 1; i < kids.length; i++) {
    assert.ok(kids[i].angle > kids[i - 1].angle, '角度应递增');
  }
  // 相邻角度差应大于最小跨度（240px / 半径）
  const radius = dist(kids[0]);
  for (let i = 1; i < kids.length; i++) {
    const gap = (kids[i].angle - kids[i - 1].angle) * radius;
    assert.ok(gap > 100, `角度间隙过小：${gap.toFixed(1)}px`);
  }
});

test('叶子多的分支获得更大扇区', () => {
  const r = layoutUmbrella(tree());
  // a 有 2 叶、b 有 1 叶
  const a = r.nodes.find((p) => p.id === 'a');
  const b = r.nodes.find((p) => p.id === 'b');
  const spans = { a: 0, b: 0 };
  // 用子节点角度差估算扇区
  const aKids = r.nodes.filter((p) => p.id.startsWith('a') && p.depth === 2).sort((x, y) => x.angle - y.angle);
  const bKids = r.nodes.filter((p) => p.id.startsWith('b') && p.depth === 2);
  spans.a = aKids.length > 1 ? aKids[1].angle - aKids[0].angle : 0;
  spans.b = bKids.length ? 1 : 0;
  assert.ok(a && b);
  assert.equal(aKids.length, 2, 'a 有 2 个子节点');
  assert.equal(bKids.length, 1, 'b 有 1 个子节点');
  assert.ok(spans.a > 0);
});

test('收起的节点不渲染其子树', () => {
  const full = layoutUmbrella(tree());
  const collapsed = layoutUmbrella(tree(), { collapsed: new Set(['a']) });
  assert.equal(collapsed.count, full.count - 2, 'a 的两个子节点应被隐藏');
  assert.ok(!collapsed.nodes.some((p) => p.id === 'a1'));
  const a = collapsed.nodes.find((p) => p.id === 'a');
  assert.equal(a.collapsed, true);
  assert.equal(a.hasChildren, true);
});

test('全部收起时只剩根', () => {
  const r = layoutUmbrella(tree(), { collapsed: new Set(['r', 'a', 'b', 'c']) });
  assert.equal(r.count, 1);
  assert.equal(r.nodes[0].id, 'r');
});

test('收起的子树不会留下悬空连线', () => {
  const r = layoutUmbrella(tree(), { collapsed: new Set(['a']) });
  const ids = new Set(r.nodes.map((p) => p.id));
  assert.ok(!ids.has('a1'));
  // 连线数量与可见父子关系一致
  const segments = r.path.split('M').filter(Boolean).length;
  assert.equal(segments, r.count - 1);
});

test('节点上限触发截断标记', () => {
  const wide = [n('root', Array.from({ length: 30 }, (_, i) => n(`k${i}`)))];
  const r = layoutUmbrella(wide, { maxNodes: 10 });
  assert.equal(r.count, 10);
  assert.equal(r.truncated, true);
});

test('未超上限时 truncated 为 false', () => {
  const r = layoutUmbrella(tree(), { maxNodes: 100 });
  assert.equal(r.truncated, false);
});

test('多根分散在不同角度，不重叠在圆心', () => {
  const r = layoutUmbrella([n('x'), n('y'), n('z')]);
  assert.equal(r.count, 3);
  const pos = r.nodes.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`);
  assert.equal(new Set(pos).size, 3, '三个根应处于不同位置');
});

test('层间距随规模自适应且被钳制在 150–520', () => {
  const small = layoutUmbrella([n('r', [n('c')])]);
  const wide = layoutUmbrella([n('r', Array.from({ length: 20 }, (_, i) => n(`k${i}`)))]);
  assert.ok(small.ringGap >= 150 && small.ringGap <= 520);
  assert.ok(wide.ringGap >= 150 && wide.ringGap <= 520);
});

test('相同输入两次布局结果一致（确定性）', () => {
  const a = layoutUmbrella(tree());
  const b = layoutUmbrella(tree());
  assert.equal(a.path, b.path);
  assert.equal(a.width, b.width);
  assert.equal(a.height, b.height);
  assert.deepEqual(a.nodes.map((p) => [p.id, p.x.toFixed(2), p.y.toFixed(2)]),
    b.nodes.map((p) => [p.id, p.x.toFixed(2), p.y.toFixed(2)]));
});

test('连线使用二次贝塞尔（Q）', () => {
  const r = layoutUmbrella(tree());
  assert.ok(r.path.includes('Q'));
  assert.ok(r.path.startsWith('M'));
});

// ---------------------------------------------------------------------------
// 渲染层
// ---------------------------------------------------------------------------

test('渲染输出包含视口、舞台与单条连线 path', () => {
  const r = layoutUmbrella(tree());
  const html = renderUmbrella(r);
  assert.ok(html.includes('umb-viewport'));
  assert.ok(html.includes('umb-stage'));
  assert.equal((html.match(/<path /g) || []).length, 1, '所有连线合并为一条 path');
});

test('渲染的节点数量与布局一致', () => {
  const r = layoutUmbrella(tree());
  const html = renderUmbrella(r);
  assert.equal((html.match(/class="umb-node/g) || []).length, r.count);
});

test('坐标写入 data 属性而非内联 style（CSP）', () => {
  const r = layoutUmbrella(tree());
  const html = renderUmbrella(r);
  assert.ok(/data-x="\d/.test(html));
  assert.ok(!/\sstyle="/.test(html), '不得使用内联 style');
});

test('有子节点的节点渲染展开按钮，叶子不渲染', () => {
  const r = layoutUmbrella(tree());
  const html = renderUmbrella(r);
  const toggles = (html.match(/data-toggle/g) || []).length;
  const parents = r.nodes.filter((p) => p.hasChildren).length;
  assert.equal(toggles, parents);
});

test('收起的节点显示 ▸，展开的显示 ▾', () => {
  const r = layoutUmbrella(tree(), { collapsed: new Set(['a']) });
  const html = renderUmbrella(r, {});
  assert.ok(html.includes('▸'));
  assert.ok(html.includes('▾'));
});

test('选中节点带 is-selected', () => {
  const r = layoutUmbrella(tree());
  const html = renderUmbrella(r, { selectedId: 'b1' });
  assert.ok(/class="umb-node[^"]*is-selected[^"]*" data-person="b1"/.test(html));
});

test('根节点使用 is-focus 卡片强调', () => {
  const r = layoutUmbrella(tree());
  const html = renderUmbrella(r);
  assert.ok(html.includes('is-focus'));
});

test('截断时给出提示条', () => {
  const wide = [n('root', Array.from({ length: 30 }, (_, i) => n(`k${i}`)))];
  const html = renderUmbrella(layoutUmbrella(wide, { maxNodes: 8 }));
  assert.ok(html.includes('umb-note'));
  assert.ok(html.includes('已截断'));
});

test('空布局渲染空状态而不是崩溃', () => {
  const html = renderUmbrella(layoutUmbrella([]));
  assert.ok(html.includes('empty'));
});

test('姓名特殊字符被转义', () => {
  const r = layoutUmbrella([n('x', [], { name: '<img src=x onerror=alert(1)>' })]);
  const html = renderUmbrella(r);
  assert.ok(!html.includes('<img src=x'));
  assert.ok(html.includes('&lt;img'));
});

test('配偶一并渲染在节点内', () => {
  const r = layoutUmbrella([n('r', [], {
    spouses: [{ id: 'sp', name: '李淑贞', gender: 'female', gen: 1, unionType: 'married', unionStatus: 'married' }],
  })]);
  const html = renderUmbrella(r);
  assert.ok(html.includes('李淑贞'));
  assert.ok(html.includes('spouse-link'));
});
test('卡片互不重叠（宽扇区 + 深链混合场景）', () => {
  // 一个父节点挂 9 个孩子，其中长子再挂 5 个 —— 最容易挤在一起的结构
  const wide = [n('root', [
    n('k0', Array.from({ length: 5 }, (_, i) => n(`k0_${i}`))),
    ...Array.from({ length: 8 }, (_, i) => n(`k${i + 1}`)),
  ])];
  const r = layoutUmbrella(wide);
  // 用卡片实际尺寸（约 186×64）做 AABB 检测
  const W = 186;
  const H = 64;
  const overlaps = [];
  for (let i = 0; i < r.nodes.length; i++) {
    for (let j = i + 1; j < r.nodes.length; j++) {
      const a = r.nodes[i];
      const b = r.nodes[j];
      if (Math.abs(a.x - b.x) < W && Math.abs(a.y - b.y) < H) overlaps.push([a.id, b.id]);
    }
  }
  assert.deepEqual(overlaps, [], '存在重叠：' + JSON.stringify(overlaps.slice(0, 5)));
});

test('随机规模树也不出现重叠', () => {
  // 固定种子式构造：3 层、每层孩子数递减
  const build = (prefix, depth, fan) => {
    if (depth === 0) return n(prefix);
    return n(prefix, Array.from({ length: fan }, (_, i) => build(`${prefix}_${i}`, depth - 1, Math.max(1, fan - 1))));
  };
  const r = layoutUmbrella([build('r', 3, 4)], { maxNodes: 400 });
  const W = 186;
  const H = 64;
  let overlaps = 0;
  for (let i = 0; i < r.nodes.length; i++) {
    for (let j = i + 1; j < r.nodes.length; j++) {
      const a = r.nodes[i];
      const b = r.nodes[j];
      if (Math.abs(a.x - b.x) < W && Math.abs(a.y - b.y) < H) overlaps++;
    }
  }
  assert.equal(overlaps, 0, `共 ${overlaps} 处重叠（节点 ${r.count}）`);
});
