/**
 * 服务端 SVG 世系图（参考 Topola 的 Descendants/Hourglass 图表与 SVG 导出思路）。
 * 纯函数：输入成员、亲子边、婚姻，输出可独立打开的 SVG。
 */

const BOX_W = 176;
const BOX_H = 64;
const H_GAP = 22;
const V_GAP = 92;
const PADDING = 40;
const TITLE_H = 72;
const MAX_NODES = 500;

const esc = (v) => String(v ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

const yearOf = (v) => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return isNaN(d.getTime()) ? null : d.getUTCFullYear();
};

function lifespan(p) {
  const b = yearOf(p.birth_date);
  const d = yearOf(p.death_date);
  if (!b && !d) return '生卒不详';
  return `${b ?? '?'}–${d ?? (p.is_deceased ? '?' : '')}`;
}

/**
 * @param {object} opts
 * @param {Array} opts.persons
 * @param {Array} opts.edges {parent_id, child_id}
 * @param {Array} opts.marriages {person_a_id, person_b_id}
 * @param {string|null} opts.focusId
 * @param {string} opts.title
 * @param {number} opts.depth
 * @returns {string} SVG
 */
export function buildDescendantSvg({ persons, edges, marriages = [], focusId = null, title = '族谱世系图', depth = 6 }) {
  const byId = new Map(persons.map((p) => [p.id, p]));
  const childrenMap = new Map();
  for (const e of edges) {
    if (!byId.has(e.parent_id) || !byId.has(e.child_id)) continue;
    if (!childrenMap.has(e.parent_id)) childrenMap.set(e.parent_id, []);
    childrenMap.get(e.parent_id).push(e.child_id);
  }
  const spouseMap = new Map();
  for (const m of marriages) {
    const a = byId.get(m.person_a_id);
    const b = byId.get(m.person_b_id);
    if (!a || !b) continue;
    if (!spouseMap.has(a.id)) spouseMap.set(a.id, []);
    if (!spouseMap.has(b.id)) spouseMap.set(b.id, []);
    spouseMap.get(a.id).push(`${b.family_name || ''}${b.given_name || ''}`);
    spouseMap.get(b.id).push(`${a.family_name || ''}${a.given_name || ''}`);
  }

  // 选根：显式 focus，或没有父母的第一位
  let rootId = focusId && byId.has(focusId) ? focusId : null;
  if (!rootId) {
    const hasParent = new Set(edges.map((e) => e.child_id));
    const root = persons.find((p) => !hasParent.has(p.id));
    rootId = root?.id || persons[0]?.id;
  }
  if (!rootId) return '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="120"><text x="20" y="60">暂无成员</text></svg>';

  const visited = new Set();
  let count = 0;
  const maxDepth = Math.min(10, Math.max(1, Number(depth) || 6));

  function build(id, level) {
    const p = byId.get(id);
    if (!p) return null;
    count++;
    if (count > MAX_NODES || visited.has(id) || level > maxDepth) {
      return { p, kids: [], truncated: true };
    }
    visited.add(id);
    const kids = (childrenMap.get(id) || [])
      .filter((cid) => byId.has(cid))
      .map((cid) => build(cid, level + 1))
      .filter(Boolean);
    return { p, kids };
  }
  const tree = build(rootId, 0);

  // 宽度测量
  function measure(node) {
    if (!node.kids.length) { node.w = BOX_W; return node.w; }
    let w = 0;
    node.kids.forEach((kid, i) => {
      w += measure(kid);
      if (i < node.kids.length - 1) w += H_GAP;
    });
    node.w = Math.max(BOX_W, w);
    return node.w;
  }
  measure(tree);

  // 摆放
  function place(node, left, level) {
    node.cx = left + node.w / 2;
    node.y = level * (BOX_H + V_GAP);
    if (node.kids.length) {
      let cursor = left;
      for (const kid of node.kids) {
        place(kid, cursor, level + 1);
        cursor += kid.w + H_GAP;
      }
    }
  }
  place(tree, PADDING, 0);

  const totalW = Math.max(tree.w + PADDING * 2, 480);
  let maxY = 0;
  const nodes = [];
  (function collect(n) { nodes.push(n); maxY = Math.max(maxY, n.y); n.kids.forEach(collect); })(tree);
  const totalH = maxY + BOX_H + PADDING * 2 + TITLE_H;

  const lines = [];
  const boxes = [];
  for (const n of nodes) {
    for (const kid of n.kids) {
      const midY = (n.y + BOX_H + kid.y) / 2;
      lines.push(
        `<polyline points="${n.cx},${n.y + BOX_H} ${n.cx},${midY} ${kid.cx},${midY} ${kid.cx},${kid.y}" `
        + 'fill="none" stroke="#d2cabb" stroke-width="1.2"/>'
      );
    }
  }

  for (const n of nodes) {
    const p = n.p;
    const name = `${p.family_name || ''}${p.given_name || ''}`;
    const spouses = (spouseMap.get(p.id) || []).slice(0, 2).join('、');
    const gen = p.generation_no ? `${p.generation_no}世` : '';
    const meta = [lifespan(p), gen].filter(Boolean).join(' · ');
    const x = n.cx - BOX_W / 2;
    boxes.push(`
      <g>
        <rect x="${x.toFixed(1)}" y="${n.y}" width="${BOX_W}" height="${BOX_H}" rx="8"
          fill="${p.is_deceased ? '#faf8f3' : '#fffdf8'}" stroke="${p.gender === 'female' ? '#b9867c' : '#3e6b58'}"
          stroke-width="1.4"/>
        <text x="${n.cx}" y="${n.y + 24}" text-anchor="middle"
          font-family="Songti SC, SimSun, serif" font-size="15" fill="#24211c">${esc(name)}${n.truncated ? ' …' : ''}</text>
        ${spouses ? `<text x="${n.cx}" y="${n.y + 41}" text-anchor="middle"
          font-family="PingFang SC, Microsoft YaHei, sans-serif" font-size="11" fill="#8b8377">配 ${esc(spouses)}</text>` : ''}
        <text x="${n.cx}" y="${n.y + 56}" text-anchor="middle"
          font-family="PingFang SC, Microsoft YaHei, sans-serif" font-size="11" fill="#8b8377">${esc(meta)}</text>
      </g>`);
  }

  const today = new Date().toISOString().slice(0, 10);
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(totalW)}" height="${Math.round(totalH)}"
  viewBox="0 0 ${Math.round(totalW)} ${Math.round(totalH)}">
  <rect width="100%" height="100%" fill="#f6f3ec"/>
  <text x="${Math.round(totalW / 2)}" y="38" text-anchor="middle"
    font-family="Songti SC, SimSun, serif" font-size="22" fill="#24211c">${esc(title)}</text>
  <text x="${Math.round(totalW / 2)}" y="60" text-anchor="middle"
    font-family="PingFang SC, Microsoft YaHei, sans-serif" font-size="11" fill="#8b8377">
    共 ${nodes.length} 人 · 生成于 ${today}${nodes.length >= MAX_NODES ? ' · 已截断' : ''}
  </text>
  <g transform="translate(0, ${TITLE_H})">
    ${lines.join('\n    ')}
    ${boxes.join('\n    ')}
  </g>
</svg>`;
}

/**
 * 沙漏图：上为祖先（逐代向上），下为后裔（逐代向下），中轴聚焦本人。
 * 参考 Topola Hourglass 的布局思路，但用单轴居中 + 两侧展开的简化版：
 * 祖先层每层人数翻倍，横向按层宽均分。
 *
 * @param {object} opts 与 buildDescendantSvg 相同，另有 ancestorDepth/descendantDepth
 * @returns {string} SVG
 */
export function buildHourglassSvg({
  persons, edges, marriages = [], focusId,
  title = '沙漏世系图',
  ancestorDepth = 4,
  descendantDepth = 4,
}) {
  const byId = new Map(persons.map((p) => [p.id, p]));
  const nameOf = (p) => `${p?.family_name || ''}${p?.given_name || ''}`;

  const parentMap = new Map();   // child -> [parentIds]
  const childrenMap = new Map(); // parent -> [childIds]
  for (const e of edges) {
    if (!byId.has(e.parent_id) || !byId.has(e.child_id)) continue;
    if (!parentMap.has(e.child_id)) parentMap.set(e.child_id, []);
    parentMap.get(e.child_id).push(e.parent_id);
    if (!childrenMap.has(e.parent_id)) childrenMap.set(e.parent_id, []);
    childrenMap.get(e.parent_id).push(e.child_id);
  }
  const spouseMap = new Map();
  for (const m of marriages) {
    if (!byId.has(m.person_a_id) || !byId.has(m.person_b_id)) continue;
    for (const [x, y] of [[m.person_a_id, m.person_b_id], [m.person_b_id, m.person_a_id]]) {
      if (!spouseMap.has(x)) spouseMap.set(x, []);
      spouseMap.get(x).push(y);
    }
  }

  const focus = focusId && byId.has(focusId) ? focusId : persons[0]?.id;
  if (!focus) return '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="120"><text x="20" y="60">暂无成员</text></svg>';

  // 注意：0 是合法值（只看本人），不能用 `|| 4` 兜底；仅在非数字时取默认
  const toDepth = (v, dflt) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return dflt;
    return Math.min(8, Math.max(0, Math.floor(n)));
  };
  const aDepth = toDepth(ancestorDepth, 4);
  const dDepth = toDepth(descendantDepth, 4);

  // 祖先层：level 0 = 父母, 1 = 祖父母 ...
  const ancLevels = [];
  {
    let frontier = [focus];
    const seen = new Set([focus]);
    for (let lv = 0; lv < aDepth && frontier.length; lv++) {
      const next = [];
      const levelIds = [];
      for (const id of frontier) {
        for (const pid of parentMap.get(id) || []) {
          if (seen.has(pid)) continue;
          seen.add(pid);
          levelIds.push(pid);
          next.push(pid);
        }
      }
      if (levelIds.length) ancLevels.push(levelIds);
      frontier = next;
      if (seen.size > MAX_NODES) break;
    }
  }
  // 后裔层
  const descLevels = [];
  {
    let frontier = [focus];
    const seen = new Set([focus]);
    for (let lv = 0; lv < dDepth && frontier.length; lv++) {
      const next = [];
      const levelIds = [];
      for (const id of frontier) {
        for (const cid of childrenMap.get(id) || []) {
          if (seen.has(cid)) continue;
          seen.add(cid);
          levelIds.push(cid);
          next.push(cid);
        }
      }
      if (levelIds.length) descLevels.push(levelIds);
      frontier = next;
      if (seen.size > MAX_NODES) break;
    }
  }

  const nLevels = ancLevels.length + 1 + descLevels.length;
  const widest = Math.max(
    1,
    ...ancLevels.map((l) => l.length),
    ...descLevels.map((l) => l.length)
  );
  const rowW = Math.max(BOX_W * 1.4, widest * (BOX_W + H_GAP) - H_GAP);
  const totalW = Math.max(rowW + PADDING * 2, 640);
  const totalH = nLevels * (BOX_H + V_GAP) - V_GAP + PADDING * 2 + TITLE_H;

  const slots = [];   // {id, x, y, isFocus}
  const lines = [];

  // 祖先层从下往上排：父亲的父母在更上方
  ancLevels.forEach((levelIds, i) => {
    // i=0 是父母（紧邻本人上方），所以 y 要往上数
    const y = (ancLevels.length - 1 - i) * (BOX_H + V_GAP);
    levelIds.forEach((id, j) => {
      const x = totalW / 2 - (levelIds.length * (BOX_W + H_GAP) - H_GAP) / 2 + j * (BOX_W + H_GAP) + BOX_W / 2;
      slots.push({ id, x, y, isFocus: false });
    });
  });

  const focusY = ancLevels.length * (BOX_H + V_GAP);
  slots.push({ id: focus, x: totalW / 2, y: focusY, isFocus: true });

  descLevels.forEach((levelIds, i) => {
    const y = focusY + (i + 1) * (BOX_H + V_GAP);
    levelIds.forEach((id, j) => {
      const x = totalW / 2 - (levelIds.length * (BOX_W + H_GAP) - H_GAP) / 2 + j * (BOX_W + H_GAP) + BOX_W / 2;
      slots.push({ id, x, y, isFocus: false });
    });
  });

  // 连线：子 -> 父（祖先方向）与 父 -> 子（后裔方向）
  const posOf = new Map(slots.map((s) => [s.id, s]));
  for (const e of edges) {
    const P = posOf.get(e.parent_id);
    const C = posOf.get(e.child_id);
    if (!P || !C) continue;
    const up = C.y < P.y;  // 子在上方 => 这条边朝上是祖先方向
    if (!up && !posOf.has(e.child_id)) continue;
    const midY = (P.y + BOX_H + C.y) / 2;
    const sameCol = Math.abs(P.x - C.x) < 1;
    if (sameCol) {
      lines.push(`<line x1="${P.x}" y1="${up ? P.y + BOX_H : P.y + BOX_H}" x2="${C.x}" y2="${up ? C.y + BOX_H : C.y}" stroke="#d2cabb" stroke-width="1.2"/>`);
    } else {
      lines.push(
        `<polyline points="${P.x},${P.y + BOX_H} ${P.x},${midY} ${C.x},${midY} ${C.x},${C.y}" `
        + 'fill="none" stroke="#d2cabb" stroke-width="1.2"/>'
      );
    }
  }

  const boxes = slots.map((s) => {
    const p = byId.get(s.id);
    if (!p) return '';
    const spouses = (spouseMap.get(s.id) || []).map((sid) => nameOf(byId.get(sid))).slice(0, 1).join('、');
    const gen = p.generation_no ? `${p.generation_no}世` : '';
    const meta = [lifespan(p), gen].filter(Boolean).join(' · ');
    const x = s.x - BOX_W / 2;
    const stroke = s.isFocus ? '#8c6d3f' : (p.gender === 'female' ? '#b9867c' : '#3e6b58');
    const sw = s.isFocus ? 2.6 : 1.4;
    return `
      <g>
        <rect x="${x.toFixed(1)}" y="${s.y}" width="${BOX_W}" height="${BOX_H}" rx="8"
          fill="${s.isFocus ? '#fff9ec' : (p.is_deceased ? '#f7f4ee' : '#fffdf8')}"
          stroke="${stroke}" stroke-width="${sw}"/>
        <text x="${s.x}" y="${s.y + 24}" text-anchor="middle"
          font-family="Songti SC, SimSun, serif" font-size="15" fill="#24211c">${esc(nameOf(p))}</text>
        ${spouses ? `<text x="${s.x}" y="${s.y + 41}" text-anchor="middle"
          font-family="PingFang SC, Microsoft YaHei, sans-serif" font-size="11" fill="#8b8377">配 ${esc(spouses)}</text>` : ''}
        <text x="${s.x}" y="${s.y + 56}" text-anchor="middle"
          font-family="PingFang SC, Microsoft YaHei, sans-serif" font-size="11" fill="#8b8377">${esc(meta)}</text>
      </g>`;
  });

  const today = new Date().toISOString().slice(0, 10);
  const fp = byId.get(focus);
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(totalW)}" height="${Math.round(totalH)}"
  viewBox="0 0 ${Math.round(totalW)} ${Math.round(totalH)}">
  <rect width="100%" height="100%" fill="#f6f3ec"/>
  <text x="${Math.round(totalW / 2)}" y="38" text-anchor="middle"
    font-family="Songti SC, SimSun, serif" font-size="22" fill="#24211c">${esc(title)}</text>
  <text x="${Math.round(totalW / 2)}" y="60" text-anchor="middle"
    font-family="PingFang SC, Microsoft YaHei, sans-serif" font-size="11" fill="#8b8377">
    中心：${esc(nameOf(fp))} · 上溯 ${ancLevels.length} 代 · 下延 ${descLevels.length} 代 · 生成于 ${today}
  </text>
  <g transform="translate(0, ${TITLE_H})">
    ${lines.join('\n    ')}
    ${boxes.join('\n    ')}
  </g>
</svg>`;
}

/**
 * 祖先盘（扇形/同心环）：中心是本人，向外每环一代；父系在左半、母系在右半。
 * 参考 Topola Ancestors（扇形）的布局，用 Ahnentafel 位置推导扇区：
 *   - 1 = 本人（圆心）
 *   - 2n = 父，2n+1 = 母（n 为子节点位置）
 * 第 d 代的扇区数 = 2^d，扇区角度 = PI / 2^d（总角度 PI，左右各半）。
 *
 * @param {object} opts
 * @param {object} opts.focus 中心成员
 * @param {Array}  opts.ancestors [{distance, person}]
 * @param {string} opts.title
 * @returns {string} SVG
 */
export function buildAncestorFanSvg({ focus, ancestors = [], title = '祖先盘' }) {
  if (!focus || !focus.id) {
    return '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="120"><text x="20" y="60">暂无成员</text></svg>';
  }

  const maxDepth = Math.min(6, Math.max(0, ancestors.reduce((m, a) => Math.max(m, a.distance), 0)));
  const RING_W = 108;
  const CORE_R = 62;
  const R0 = CORE_R;
  const outer = R0 + maxDepth * RING_W;
  const size = outer * 2 + 60;
  const cx = size / 2;
  const cy = size / 2;

  // 按代数分桶，同代内按父/母侧排序
  const byDepth = new Map();
  for (const a of ancestors) {
    if (a.distance < 1 || a.distance > maxDepth) continue;
    if (!byDepth.has(a.distance)) byDepth.set(a.distance, []);
    byDepth.get(a.distance).push(a);
  }

  const halves = [];  // 每个扇区: {a0,a1,r0,r1,person,side}
  for (let d = 1; d <= maxDepth; d++) {
    const list = (byDepth.get(d) || []).slice().sort((x, y) => {
      const sx = x.relation === '母' ? 1 : 0;
      const sy = y.relation === '母' ? 1 : 0;
      return sx - sy || (x.person.birth_year || 9999) - (y.person.birth_year || 9999);
    });
    if (!list.length) continue;
    const slots = Math.pow(2, d);
    const step = Math.PI / slots;      // 单侧总角 = PI
    const r0 = R0 + (d - 1) * RING_W;
    const r1 = r0 + RING_W;
    list.forEach((a, i) => {
      // 父系从正中偏左开始向左侧铺开，母系从正中偏右向右侧铺开
      const idx = Math.min(i, slots - 1);
      const isMother = a.relation === '母';
      const k = isMother ? Math.floor(idx / 2) : Math.floor(idx / 2);
      const start = isMother
        ? -Math.PI / 2 + k * step    // 右半：从 -90° 顺时针展开
        : -Math.PI / 2 - (k + 1) * step; // 左半
      const a0 = start;
      const a1 = start + step;
      halves.push({ a0, a1, r0, r1, person: a.person, side: isMother ? 'M' : 'F', distance: d });
    });
  }

  const arc = (r0, r1, a0, a1) => {
    const p = (r, ang) => [cx + r * Math.cos(ang), cy + r * Math.sin(ang)];
    const [x0, y0] = p(r0, a0);
    const [x1, y1] = p(r0, a1);
    const [x2, y2] = p(r1, a1);
    const [x3, y3] = p(r1, a0);
    const large = a1 - a0 > Math.PI ? 1 : 0;
    return `M${x0.toFixed(1)},${y0.toFixed(1)} L${x1.toFixed(1)},${y1.toFixed(1)} `
      + `A${r0},${r0} 0 ${large} 0 ${x2.toFixed(1)},${y2.toFixed(1)} `
      + `L${x3.toFixed(1)},${y3.toFixed(1)} A${r1},${r1} 0 ${large} 1 ${x0.toFixed(1)},${y0.toFixed(1)} Z`;
  };

  const wedges = halves.map((h) => {
    const mid = (h.a0 + h.a1) / 2;
    const labelR = (h.r0 + h.r1) / 2;
    const lx = cx + labelR * Math.cos(mid);
    const ly = cy + labelR * Math.sin(mid);
    const name = `${h.person.family_name || ''}${h.person.given_name || ''}`;
    const short = name.length > 6 ? name.slice(0, 6) : name;
    const fill = h.side === 'M' ? '#f6ece9' : '#eef4f0';
    const stroke = h.side === 'M' ? '#d8bdb5' : '#bdd0c4';
    const rotate = (mid * 180) / Math.PI;
    // 扇区较窄时文字沿半径排布
    const narrow = h.a1 - h.a0 < 0.35;
    return `
      <g>
        <path d="${arc(h.r0, h.r1, h.a0, h.a1)}" fill="${fill}" stroke="${stroke}" stroke-width="1"/>
        <text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="middle" dominant-baseline="middle"
          font-family="Songti SC, SimSun, serif" font-size="${narrow ? 9 : 11}" fill="#24211c"
          ${narrow ? `transform="rotate(${rotate.toFixed(1)} ${lx.toFixed(1)} ${ly.toFixed(1)})"` : ''}>${esc(short)}</text>
      </g>`;
  });

  const focusName = `${focus.family_name || ''}${focus.given_name || ''}`;
  const genCount = maxDepth;
  const today = new Date().toISOString().slice(0, 10);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(size)}" height="${Math.round(size + 56)}"
  viewBox="0 0 ${Math.round(size)} ${Math.round(size + 56)}">
  <rect width="100%" height="100%" fill="#f6f3ec"/>
  <text x="${Math.round(size / 2)}" y="30" text-anchor="middle"
    font-family="Songti SC, SimSun, serif" font-size="20" fill="#24211c">${esc(title)}</text>
  <text x="${Math.round(size / 2)}" y="48" text-anchor="middle"
    font-family="PingFang SC, Microsoft YaHei, sans-serif" font-size="10" fill="#8b8377">
    上溯 ${genCount} 代 · 左为父系 · 右为母系 · 生成于 ${today}
  </text>
  <g transform="translate(0, 56)">
    ${wedges.join('\n    ')}
    <circle cx="${cx}" cy="${cy}" r="${CORE_R}" fill="#fff9ec" stroke="#8c6d3f" stroke-width="2.4"/>
    <text x="${cx}" y="${cy - 4}" text-anchor="middle" dominant-baseline="middle"
      font-family="Songti SC, SimSun, serif" font-size="14" fill="#24211c">${esc(focusName)}</text>
    <text x="${cx}" y="${cy + 16}" text-anchor="middle" dominant-baseline="middle"
      font-family="PingFang SC, Microsoft YaHei, sans-serif" font-size="9" fill="#8b8377">本人</text>
  </g>
</svg>`;
}
