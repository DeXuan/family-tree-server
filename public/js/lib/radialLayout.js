/**
 * 伞状放射布局（umbrella / radial tree）。
 *
 * 结构：根居中，子代向外呈伞骨状铺开；每个节点占一段圆心角，
 * 角度按「可见叶子数」加权分配，并对最小可读弧长做补偿，
 * 避免窄扇区里卡片互相压叠。
 *
 * 纯函数、不依赖 DOM，便于单元测试。
 */

const DEG = Math.PI / 180;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * @param {Array} roots 树数据（与世系树接口一致：{id, children[], ...}）
 * @param {object} opts
 * @param {Set<string>|Array<string>} opts.collapsed 收起的节点 id
 * @param {number} opts.maxNodes 最多渲染节点数（超出截断）
 * @param {number} opts.centerAngle 伞面中心角（度，数学坐标系，90 = 正上方）
 * @param {number} opts.sweep 张开角度（度）
 * @param {number} opts.minArc 同一层相邻节点的最小弧长（px）
 * @param {number} opts.ringGap 手工指定层间距（px），不传则按规模自适应
 * @param {number} opts.cardW 卡片估算宽度（px，用于留白）
 * @param {number} opts.cardH 卡片估算高度
 */
export function layoutUmbrella(roots, opts = {}) {
  const collapsed = opts.collapsed instanceof Set
    ? opts.collapsed
    : new Set(Array.isArray(opts.collapsed) ? opts.collapsed : []);
  const maxNodes = Math.max(1, Number(opts.maxNodes) || 400);
  const centerDeg = Number.isFinite(opts.centerAngle) ? opts.centerAngle : 90;
  const sweepDeg = clamp(Number.isFinite(opts.sweep) ? opts.sweep : 204, 60, 360);
  const minArc = Math.max(80, Number(opts.minArc) || 240);
  const cardW = Math.max(120, Number(opts.cardW) || 210);
  const cardH = Math.max(40, Number(opts.cardH) || 64);
  // 配偶卡片更窄，但会让节点整体变宽 —— 参与角度与冲突计算
  const spouseW = Math.max(80, Number(opts.spouseW) || 132);
  const pad = Math.max(cardW, cardH) * 0.62 + 28;

  const list = (Array.isArray(roots) ? roots : []).filter(Boolean);
  if (!list.length) {
    return {
      nodes: [], path: '', width: pad * 2, height: pad * 2,
      count: 0, truncated: false, maxDepth: 0, ringGap: 0, leaves: 0,
    };
  }

  // 1) 展开可见节点（跳过 collapsed 子树），同时统计叶子数用于角度加权
  let truncated = false;
  let budget = maxNodes;
  let maxDepth = 0;

  function build(node, depth) {
    if (budget <= 0) { truncated = true; return null; }
    budget--;
    maxDepth = Math.max(maxDepth, depth);
    const kids = Array.isArray(node.children) ? node.children : [];
    const isCollapsed = kids.length > 0 && collapsed.has(node.id);
    const entry = {
      id: node.id,
      data: node,
      depth,
      collapsed: isCollapsed,
      hasChildren: kids.length > 0,
      children: [],
      // 节点盒：左右各有 18px 的展开按钮/占位，居中对称
      w: cardW + 44 + (Array.isArray(node.spouses) ? node.spouses.length : 0) * (spouseW + 8),
      weight: 1,
      angle: 0,
      span: 0,
      x: 0,
      y: 0,
    };
    if (!isCollapsed) {
      for (const kid of kids) {
        const child = build(kid, depth + 1);
        if (child) entry.children.push(child);
        else break;
      }
    }
    entry.weight = entry.children.length
      ? entry.children.reduce((sum, c) => sum + c.weight, 0)
      : 1;
    return entry;
  }

  const tree = [];
  for (const root of list) {
    const t = build(root, 0);
    if (t) tree.push(t);
    else break;
  }

  const leaves = tree.reduce((sum, t) => sum + t.weight, 0) || 1;

  // 2) 层间距：让最外层每个叶子至少分到 minArc 弧长
  const sweepRad = sweepDeg * DEG;
  const autoGap = maxDepth > 0 ? (minArc * leaves) / (sweepRad * maxDepth) : 0;
  const ringGap = clamp(Number(opts.ringGap) || autoGap || 200, 150, 520);

  // 多根时把根放在一个内环上，避免全叠在圆心
  const rootRadius = tree.length > 1 ? ringGap * 0.5 : 0;

  // 3) 角度分配：父扇区按子节点权重切分，并保证最小可读跨度
  // 以 centerDeg 为中心左右张开，形成「向上撑开」的伞面
  const startRad = (centerDeg - sweepDeg / 2) * DEG;
  const rootsSpan = sweepRad / tree.length;

  function allocate(node, a0, a1, radius) {
    node.angle = (a0 + a1) / 2;
    node.span = a1 - a0;
    node.x = radius * Math.cos(node.angle);
    node.y = -radius * Math.sin(node.angle);

    const kids = node.children;
    if (!kids.length) return;

    // 层间距固定为 ringGap；卡片过近由后面的冲突消解处理
    const childRadius = (radius || 0) + ringGap;
    const widest = Math.max(cardW, ...kids.map((c) => c.w));
    const unitArc = Math.max(minArc, widest + 16);
    const minSpan = childRadius > 0 ? Math.min(a1 - a0, unitArc / childRadius) : 0;
    const sumW = kids.reduce((s, c) => s + c.weight, 0) || 1;

    let spans = kids.map((c) => ((a1 - a0) * c.weight) / sumW);
    // 几轮「抬底 + 归一」，让窄扇区也能放下卡片
    for (let round = 0; round < 4; round++) {
      spans = spans.map((s) => Math.max(s, minSpan));
      const total = spans.reduce((s, v) => s + v, 0) || 1;
      spans = spans.map((s) => (s * (a1 - a0)) / total);
    }

    let cursor = a0;
    kids.forEach((kid, i) => {
      const next = i === kids.length - 1 ? a1 : cursor + spans[i];
      allocate(kid, cursor, next, childRadius);
      cursor = next;
    });
  }

  tree.forEach((root, i) => {
    const a0 = startRad + i * rootsSpan;
    allocate(root, a0, a0 + rootsSpan, rootRadius);
  });

  // 4) 冲突消解：卡片框相交时，把较深的节点沿径向推远（确定性、有限轮次）
  {
    const all = [];
    const st = tree.slice();
    while (st.length) {
      const n = st.pop();
      all.push(n);
      for (const k of n.children) st.push(k);
    }
    const gapY = cardH;
    const padX = 10;
    for (let iter = 0; iter < 40; iter++) {
      let moved = false;
      const pushed = new Set();   // 同一轮内每个节点最多外推一次，避免叠加膨胀
      const push = 12;   // 每轮单节点最大位移
      // 交替扫描方向，避免靠后的节点总被「饿死」
      const reverse = iter % 2 === 1;
      for (let ai = 0; ai < all.length; ai++) {
        const a1 = reverse ? all.length - 1 - ai : ai;
        for (let bi = a1 + 1; bi < all.length; bi++) {
          const b1 = reverse ? all.length - 1 - (bi - a1 - 1) : bi;
          const A = all[a1];
          const B = all[b1];
          const rx = (A.w + B.w) / 2 + padX;
          if (Math.abs(A.x - B.x) >= rx || Math.abs(A.y - B.y) >= gapY) continue;
          const deeper = A.depth >= B.depth ? A : B;
          // 同层节点：径向推远无效（可能同向），改为角向互相让开
          if (A.depth === B.depth) {
            const rA = Math.hypot(A.x, A.y);
            const rB = Math.hypot(B.x, B.y);
            if (rA < 1 || rB < 1) continue;
            const angA = Math.atan2(-A.y, A.x);
            const angB = Math.atan2(-B.y, B.x);
            const sign = angA <= angB ? -1 : 1;
            const dA = Math.min(0.12, push / rA);
            const dB = Math.min(0.12, push / rB);
            A.x = rA * Math.cos(angA + sign * dA);
            A.y = -rA * Math.sin(angA + sign * dA);
            B.x = rB * Math.cos(angB - sign * dB);
            B.y = -rB * Math.sin(angB - sign * dB);
            pushed.add(A.id);
            pushed.add(B.id);
            moved = true;
            continue;
          }
          if (pushed.has(deeper.id)) continue;
          const r = Math.hypot(deeper.x, deeper.y);
          if (r < 1) continue;   // 根节点在圆心，无需外推
          pushed.add(deeper.id);
          deeper.x += (deeper.x / r) * push;
          deeper.y += (deeper.y / r) * push;
          moved = true;
        }
      }
      if (!moved) break;
    }
  }


  // 4) 平移到正坐标
  let minX = Infinity; let maxX = -Infinity;
  let minY = Infinity; let maxY = -Infinity;
  const flat = [];
  const stack = tree.slice();
  while (stack.length) {
    const n = stack.pop();
    flat.push(n);
    minX = Math.min(minX, n.x); maxX = Math.max(maxX, n.x);
    minY = Math.min(minY, n.y); maxY = Math.max(maxY, n.y);
    for (const k of n.children) stack.push(k);
  }
  const dx = pad - minX;
  const dy = pad - minY;
  for (const n of flat) { n.x += dx; n.y += dy; }

  // 5) 输出节点与连线（连线用平移后的坐标，一条 path 承载全部子路径）
  const nodes = flat.map((n) => ({
    id: n.id,
    x: n.x,
    y: n.y,
    depth: n.depth,
    angle: n.angle,
    collapsed: n.collapsed,
    hasChildren: n.hasChildren,
    childCount: n.children.length,
    isRoot: n.depth === 0,
    graph: n.data,
  }));

  const segments = [];
  for (const n of flat) {
    for (const kid of n.children) {
      // 控制点取半径与角度中点，形成自然的伞骨弧线
      const r0 = Math.hypot(n.x - dx, n.y - dy);
      const r1 = Math.hypot(kid.x - dx, kid.y - dy);
      const ma = (Math.atan2(-(n.y - dy), n.x - dx) + Math.atan2(-(kid.y - dy), kid.x - dx)) / 2;
      const mr = (r0 + r1) / 2;
      const cx = mr * Math.cos(ma) + dx;
      const cy = -mr * Math.sin(ma) + dy;
      segments.push(
        `M${n.x.toFixed(1)},${n.y.toFixed(1)} Q${cx.toFixed(1)},${cy.toFixed(1)} ${kid.x.toFixed(1)},${kid.y.toFixed(1)}`
      );
    }
  }

  return {
    nodes,
    path: segments.join(' '),
    width: Math.ceil(maxX - minX + pad * 2),
    height: Math.ceil(maxY - minY + pad * 2),
    count: nodes.length,
    truncated,
    maxDepth,
    ringGap,
    leaves,
  };
}