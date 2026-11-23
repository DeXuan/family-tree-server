/**
 * 中文称谓推导（借鉴 yimai 的 kinship 思路，重构为纯函数 + 单元可测）。
 *
 * 与 yimai 的差别：
 * - 深度上限 10，超限给出明确说明而非空串
 * - 区分父系/母系，支持堂/表、伯叔姑舅姨、侄甥、姻亲
 * - 输出"称谓 + 关系类型 + 代数距离 + 是否五服内 + 依据说明"
 *
 * 数据适配：本项目用 parent_child 关系表，这里先构建 father/mother 视图。
 */

const MAX_DEPTH = 10;

const norm = (g) => (g === 'female' ? 'F' : g === 'male' ? 'M' : 'U');

const bornOf = (p) => {
  const y = p?.birth_year
    ?? (p?.birth_date ? new Date(p.birth_date).getUTCFullYear() : null);
  return Number.isFinite(y) ? y : null;
};

/** a 是否比 b 年长；不确定返回 null */
function olderThan(a, b) {
  const ya = bornOf(a);
  const yb = bornOf(b);
  if (ya === null || yb === null || ya === yb) return null;
  return ya < yb;
}

/**
 * 构建推导所需的图视图。
 * @param {Array} persons 成员行（需 id/gender/birth_year 或 birth_date）
 * @param {Array} parentChild [{parent_id, child_id}]
 * @param {Array} marriages [{person_a_id, person_b_id, union_type, status}]
 */
export function buildGraph(persons, parentChild, marriages = []) {
  const byId = new Map();
  for (const p of persons) {
    byId.set(p.id, {
      ...p,
      father: null,
      mother: null,
      birth_year: bornOf(p),
    });
  }

  for (const e of parentChild) {
    const child = byId.get(e.child_id);
    const parent = byId.get(e.parent_id);
    if (!child || !parent || child.id === parent.id) continue;
    const g = norm(parent.gender);
    if (g === 'M' && !child.father) child.father = parent.id;
    else if (g === 'F' && !child.mother) child.mother = parent.id;
    else if (!child.father) child.father = parent.id;   // 性别未知时先占用父位
  }

  const childrenMap = new Map();
  for (const e of parentChild) {
    if (!byId.has(e.parent_id) || !byId.has(e.child_id)) continue;
    if (!childrenMap.has(e.parent_id)) childrenMap.set(e.parent_id, []);
    childrenMap.get(e.parent_id).push(e.child_id);
  }

  const spouseMap = new Map();
  for (const m of marriages) {
    if (!byId.has(m.person_a_id) || !byId.has(m.person_b_id)) continue;
    const a = byId.get(m.person_a_id);
    const b = byId.get(m.person_b_id);
    if (!spouseMap.has(a.id)) spouseMap.set(a.id, []);
    if (!spouseMap.has(b.id)) spouseMap.set(b.id, []);
    spouseMap.get(a.id).push({ id: b.id, ...b, unionType: m.union_type, status: m.status });
    spouseMap.get(b.id).push({ id: a.id, ...a, unionType: m.union_type, status: m.status });
  }

  return {
    byId,
    spouseMap,
    childIdsOf: (id) => childrenMap.get(id) || [],
    parentsOf: (id) => {
      const p = byId.get(id);
      return [p?.father, p?.mother].filter(Boolean);
    },
  };
}

/** 祖先路径：ancestorId -> { dist, path:[{via:'F'|'M', sex}] } */
function ancestorPaths(graph, startId, maxDepth = MAX_DEPTH) {
  const { byId } = graph;
  const res = new Map();
  const queue = [{ id: startId, d: 0, path: [] }];
  const best = new Map([[startId, 0]]);

  while (queue.length) {
    const cur = queue.shift();
    if (cur.d >= maxDepth) continue;
    const node = byId.get(cur.id);
    if (!node) continue;
    for (const [via, parentId] of [['F', node.father], ['M', node.mother]]) {
      if (!parentId || !byId.has(parentId)) continue;
      const parent = byId.get(parentId);
      const nextPath = cur.path.concat([{ via, sex: norm(parent.gender) }]);
      const existing = res.get(parentId);
      if (!existing || existing.dist > cur.d + 1) {
        res.set(parentId, { dist: cur.d + 1, path: nextPath });
      }
      if ((best.get(parentId) ?? Infinity) > cur.d + 1) {
        best.set(parentId, cur.d + 1);
        queue.push({ id: parentId, d: cur.d + 1, path: nextPath });
      }
    }
  }
  return res;
}

function siblingsOf(graph, id) {
  const me = graph.byId.get(id);
  if (!me) return [];
  const out = new Map();
  for (const parentId of [me.father, me.mother].filter(Boolean)) {
    for (const sibId of graph.childIdsOf(parentId)) {
      if (sibId !== id && graph.byId.has(sibId)) out.set(sibId, graph.byId.get(sibId));
    }
  }
  return [...out.values()];
}

function spousesOf(graph, id) {
  return (graph.spouseMap.get(id) || []).filter((s) => s.id !== id);
}

/**
 * 直系长辈称谓。
 * 关键规则：**第一跳**（经由父亲还是母亲）决定是本宗还是外亲；
 * 末位的性别决定是祖/祖母。跨代时第二跳起统一按"祖辈"处理。
 */
function ancestorTerm(path, target) {
  const t = norm(target.gender);
  const d = path.length;

  if (d === 1) return path[0].via === 'F' ? '父亲' : '母亲';

  // 经由父亲 → 本宗；经由母亲 → 外亲
  const paternalLine = path[0].via === 'F';

  if (d === 2) {
    if (paternalLine) return t === 'F' ? '祖母' : '祖父';
    return t === 'F' ? '外祖母' : '外祖父';
  }
  if (d === 3) {
    if (paternalLine) return t === 'F' ? '曾祖母' : '曾祖父';
    return t === 'F' ? '曾外祖母' : '曾外祖父';
  }
  if (d === 4) {
    if (paternalLine) return t === 'F' ? '高祖母' : '高祖父';
    return t === 'F' ? '高外祖母' : '高外祖父';
  }
  const rank = { 5: '天祖', 6: '烈祖', 7: '太祖', 8: '远祖', 9: '鼻祖' };
  const base = rank[d] || `${d} 世祖`;
  const prefix = paternalLine ? '' : '外';
  return t === 'F' ? `${base}${prefix}母` : `${base}${prefix}父`;
}

/** 直系晚辈称谓 */
function descendantTerm(dist, target) {
  const t = norm(target.gender);
  if (dist === 1) return t === 'F' ? '女儿' : t === 'M' ? '儿子' : '子女';
  if (dist === 2) return t === 'F' ? '孙女' : t === 'M' ? '孙子' : '孙辈';
  if (dist === 3) return t === 'F' ? '曾孙女' : t === 'M' ? '曾孙' : '曾孙辈';
  if (dist === 4) return t === 'F' ? '玄孙女' : t === 'M' ? '玄孙' : '玄孙辈';
  return t === 'F' ? `${dist} 世孙女` : t === 'M' ? `${dist} 世孙` : `${dist} 世孙辈`;
}

const RESULT = (term, kind, distance, inFiveFu, note = '') =>
  ({ term, kind, distance, inFiveFu, note });

/**
 * 从 a 的视角称呼 b。
 * @returns {{term:string, kind:string, distance:number|null, inFiveFu:boolean, note:string}}
 */
export function kinship(aId, bId, graph) {
  const unknown = RESULT('', 'unknown', null, false, '');
  if (!aId || !bId) return { ...unknown, note: '缺少成员' };
  if (aId === bId) return RESULT('本人', 'self', 0, true, '');

  const a = graph.byId.get(aId);
  const b = graph.byId.get(bId);
  if (!a || !b) return { ...unknown, note: '成员不存在' };

  const tb = norm(b.gender);

  // 1) 配偶
  if (spousesOf(graph, aId).some((s) => s.id === bId)) {
    return RESULT(tb === 'F' ? '妻' : tb === 'M' ? '夫' : '配偶', 'spouse', 1, true);
  }

  // 2) 姻亲：配偶的父母（必须先于祖先链，否则会被误判为外祖父母）
  for (const sp of spousesOf(graph, aId)) {
    const isParentOfSpouse = sp.father === bId || sp.mother === bId;
    if (isParentOfSpouse) {
      const aIsF = norm(a.gender) === 'F';
      const term = aIsF
        ? (tb === 'F' ? '婆婆' : '公公')
        : (tb === 'F' ? '岳母' : '岳父');
      return RESULT(term, 'inlaw', 2, true, '配偶的父母');
    }
  }

  const A = ancestorPaths(graph, aId);
  const B = ancestorPaths(graph, bId);

  // 2.5) 旁系长辈的配偶：伯母 / 婶母 / 姑父 / 舅母 / 姨父
  // 判定：b 是 a 的父母之兄弟姐妹（伯叔姑舅姨）的配偶
  for (const parentId of graph.parentsOf(aId)) {
    if (!graph.byId.has(parentId)) continue;
    for (const uncle of siblingsOf(graph, parentId)) {
      if (!spousesOf(graph, uncle.id).some((sp) => sp.id === bId)) continue;
      const paternalSide = a.father === parentId;
      const ref = a.father ? graph.byId.get(a.father) : null;
      const older = ref ? olderThan(uncle, ref) : null;
      if (norm(uncle.gender) === 'M') {
        if (paternalSide) {
          return RESULT(older === false ? '婶母' : '伯母', 'inlaw', 3, true,
            older === null ? '伯父/叔父的配偶（长幼未定）' : '伯父/叔父的配偶');
        }
        return RESULT('舅母', 'inlaw', 3, true, '舅父的配偶');
      }
      return RESULT(paternalSide ? '姑父' : '姨父', 'inlaw', 3, true,
        paternalSide ? '姑母的配偶' : '姨母的配偶');
    }
  }

  // 3) b 是 a 的长辈
  if (A.has(bId)) {
    const info = A.get(bId);
    return RESULT(
      ancestorTerm(info.path, b), 'ancestor', info.dist, info.dist <= 5,
      info.path.map((x) => (x.via === 'F' ? '父系' : '母系')).join(' → ')
    );
  }

  // 3) b 是 a 的晚辈
  if (B.has(aId)) {
    const dist = B.get(aId).dist;
    return RESULT(descendantTerm(dist, b), 'descendant', dist, dist <= 5);
  }

  // 4) 姻亲：兄弟姐妹的配偶
  for (const sib of siblingsOf(graph, aId)) {
    if (spousesOf(graph, sib.id).some((s) => s.id === bId)) {
      const older = olderThan(sib, a);
      if (norm(sib.gender) === 'F') {
        return RESULT(older === false ? '妹夫' : '姐夫', 'inlaw', 2, true, '姐妹的配偶');
      }
      return RESULT(older === false ? '弟媳' : '嫂子', 'inlaw', 2, true, '兄弟的配偶');
    }
  }

  // 5) 姻亲：子女的配偶
  for (const kidId of graph.childIdsOf(aId)) {
    const kid = graph.byId.get(kidId);
    if (!kid) continue;
    if (spousesOf(graph, kidId).some((s) => s.id === bId)) {
      return RESULT(norm(kid.gender) === 'F' ? '女婿' : '儿媳', 'inlaw', 2, true, '子女的配偶');
    }
  }

  // 7) 最近共同祖先
  let best = null;
  for (const [cid, infoA] of A) {
    const infoB = B.get(cid);
    if (!infoB) continue;
    const total = infoA.dist + infoB.dist;
    if (!best || total < best.total) {
      best = { cid, total, up: infoA.dist, down: infoB.dist, pathA: infoA.path, pathB: infoB.path };
    }
  }
  if (!best) {
    return RESULT('', 'unknown', null, false, '未找到共同祖先（可能是姻亲或谱系数据不全）');
  }

  const { up, down } = best;
  const common = graph.byId.get(best.cid);
  const commonName = common ? `${common.family_name || ''}${common.given_name || ''}` : '共同祖先';
  const inFiveFu = up <= 5 && down <= 5;
  const viaPaternalA = best.pathA[0]?.via === 'F';

  // 7.1 兄弟姐妹
  if (up === 1 && down === 1) {
    const older = olderThan(b, a);
    const note = older === null ? '生年不详，长幼未定' : '';
    if (tb === 'M') return RESULT(older === true ? '哥哥' : older === false ? '弟弟' : '兄弟', 'sibling', 2, true, note);
    if (tb === 'F') return RESULT(older === true ? '姐姐' : older === false ? '妹妹' : '姐妹', 'sibling', 2, true, note);
    return RESULT('兄弟姐妹', 'sibling', 2, true, note);
  }

  // 7.2 父母的兄弟姐妹：伯父/叔父/姑母 或 舅父/姨母
  if (up === 2 && down === 1) {
    // a 的父/母 与 b 同为 common 的子女 → b 是 a 父/母的兄弟姐妹
    const uncleOlder = a.father && olderThan(b, graph.byId.get(a.father));
    if (viaPaternalA && a.father) {
      if (tb === 'M') {
        return RESULT(uncleOlder === false ? '叔父' : '伯父', 'collateral', 3, true,
          uncleOlder === null ? '父亲的兄弟（长幼未定）' : '父亲的兄弟');
      }
      return RESULT('姑母', 'collateral', 3, true, '父亲的姐妹');
    }
    if (tb === 'M') return RESULT('舅父', 'collateral', 3, true, '母亲的兄弟');
    return RESULT('姨母', 'collateral', 3, true, '母亲的姐妹');
  }

  // 7.3 旁系长辈（与 a 的某位直系长辈同辈，但不在 a 的直系链上）
  // 关键：down === 1 且 up >= 3 → b 与 a 的"up-1 代祖先"同辈，需加"叔/姑"字样
  if (down === 1 && up >= 3) {
    const lift = up - 1;                       // b 比 a 高几辈
    const sidePaternal = best.pathA[0]?.via === 'F';
    const side = sidePaternal ? '' : '外';
    // lift=2 → 祖父辈旁系：伯祖父/叔祖父/姑祖母
    // lift=3 → 曾祖辈旁系：曾伯祖父/曾叔祖父/曾姑祖母
    // lift=4 → 高祖辈旁系：高伯祖父/高叔祖父/高姑祖母
    const rank = { 2: '', 3: '曾', 4: '高' }[lift] ?? `${lift - 1}世`;
    if (tb === 'M') {
      // 与 a 的该代祖先比较长幼：取 a 名下同辈的那位祖先
      // best.pathA 的末位是 a 与共同祖先之间的最后一段；用 a 在该层的直系祖先比较
      const siblingRef = findAncestorAtLevel(graph, aId, lift);
      const older = siblingRef ? olderThan(b, siblingRef) : null;
      const kin = older === false ? '叔' : '伯';
      return RESULT(`${side}${rank}${kin}祖父`, 'collateral', up + down, inFiveFu,
        `与「${a.family_name || ''}${a.given_name || ''}」的 ${lift} 代祖先同辈（共同祖先：${commonName}）`);
    }
    return RESULT(`${side}${rank}姑祖母`, 'collateral', up + down, inFiveFu,
      `与「${a.family_name || ''}${a.given_name || ''}」的 ${lift} 代祖先同辈（共同祖先：${commonName}）`);
  }

  // 7.4 侄甥（b 的父/母 是 a 的兄弟姐妹）
  if (up === 1 && down === 2) {
    const parentOfB = [b.father, b.mother].filter(Boolean);
    const isNephew = parentOfB.some((pid) => siblingsOf(graph, aId).some((s) => s.id === pid));
    if (isNephew) {
      return RESULT(tb === 'M' ? '侄子' : '侄女', 'collateral', 3, true, '兄弟姐妹的子女');
    }
  }

  // 7.5 兄弟姐妹的孙辈
  if (up === 1 && down === 3) {
    return RESULT(tb === 'M' ? '侄孙' : '侄孙女', 'collateral', 4, true, '兄弟姐妹的孙辈');
  }

  // 7.6 同辈堂/表
  if (up === 2 && down === 2) {
    const older = olderThan(b, a);
    const paternal = viaPaternalA && best.pathB[0]?.via === 'F';
    const prefix = paternal ? '堂' : '表';
    const note = `共同祖先：${commonName}`;
    if (tb === 'M') {
      return RESULT(older === true ? `${prefix}兄` : older === false ? `${prefix}弟` : `${prefix}兄弟`,
        'collateral', 4, true, note);
    }
    if (tb === 'F') {
      return RESULT(older === true ? `${prefix}姐` : older === false ? `${prefix}妹` : `${prefix}姐妹`,
        'collateral', 4, true, note);
    }
    return RESULT(`${prefix}兄弟姐妹`, 'collateral', 4, true, note);
  }

  // 7.7 堂表侄辈
  if (up === 2 && down === 3) {
    return RESULT(tb === 'M' ? '堂表侄' : '堂表侄女', 'collateral', 5, true, `共同祖先：${commonName}`);
  }

  // 7.8 旁系晚辈（a 比 b 高辈）：同辈的下一代起
  if (up === 1 && down >= 4) {
    return RESULT(tb === 'M' ? '族孙' : '族孙女', 'collateral', up + down, inFiveFu,
      `共同祖先：${commonName}`);
  }
  if (up >= 2 && down - up === 1) {
    return RESULT(tb === 'M' ? '从侄' : '从侄女', 'collateral', up + down, inFiveFu,
      `共同祖先：${commonName}（比对方高 ${up - 1} 辈）`);
  }

  // 兜底：按代数差给出可读称谓
  const diff = up - down;
  const sidePaternal = best.pathA[0]?.via === 'F';
  const side = sidePaternal ? '' : '外';
  let term;
  if (diff === 0) {
    term = down === 3 ? `${side}从兄弟/从姐妹` : '同辈旁系亲属';
  } else if (diff > 0) {
    // a 比 b 高 diff 辈 → b 是晚辈旁系
    term = diff === 1
      ? (tb === 'M' ? '族侄' : '族侄女')
      : (tb === 'M' ? '族孙' : '族孙女');
  } else {
    // b 比 a 高 |diff| 辈 → b 是长辈旁系
    const lift = Math.abs(diff);
    term = lift === 1
      ? (tb === 'M' ? `${side}族伯叔父` : `${side}族姑母`)
      : (tb === 'M' ? `${side}族祖父` : `${side}族祖母`);
  }
  return RESULT(term, 'collateral', up + down, inFiveFu,
    `共同祖先：${commonName}（距 ${up} / ${down} 代）`);
}

/** 五服内的亲属集合（血缘 + 其配偶），供"五服"视图使用 */
export function fiveFuSet(centerId, graph) {
  const center = graph.byId.get(centerId);
  if (!center) return { ids: [], generations: new Map() };

  const ids = new Set([centerId]);
  const generations = new Map([[centerId, 0]]);

  function walk(id, gen, depth) {
    if (depth <= 0) return;
    const node = graph.byId.get(id);
    if (!node) return;
    for (const parentId of [node.father, node.mother].filter(Boolean)) {
      if (!ids.has(parentId)) { ids.add(parentId); generations.set(parentId, gen + 1); }
      walk(parentId, gen + 1, depth - 1);
    }
    for (const kidId of graph.childIdsOf(id)) {
      if (!ids.has(kidId)) { ids.add(kidId); generations.set(kidId, gen - 1); }
      walk(kidId, gen - 1, depth - 1);
    }
  }
  walk(centerId, 0, 5);

  // 五服含配偶但不含其血亲
  for (const id of [...ids]) {
    for (const sp of graph.spouseMap.get(id) || []) {
      if (!ids.has(sp.id)) { ids.add(sp.id); generations.set(sp.id, generations.get(id) ?? 0); }
    }
  }

  return { ids: [...ids], generations };
}

/** 取 a 在指定代数（1=父, 2=祖父…）的直系祖先，用于与旁系长辈比较长幼 */
function findAncestorAtLevel(graph, aId, levels) {
  let cur = graph.byId.get(aId);
  for (let i = 0; i < levels && cur; i++) {
    const nextId = cur.father || cur.mother;
    cur = nextId ? graph.byId.get(nextId) : null;
  }
  return cur || null;
}
