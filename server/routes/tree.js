import { withDialect, dialectKeys, dialectGlossary, DIALECT_LABEL } from '../modules/kinshipDialect.js';
import { logger } from '../modules/logger.js';
import express from 'express';
import { query } from '../db/db.js';
import { auth } from '../middleware/auth.js';
import { isUuid, uuidParam } from '../middleware/params.js';
import { buildDescendantSvg, buildHourglassSvg } from '../modules/svgChart.js';
import { buildGraph, kinship, fiveFuSet } from '../modules/kinship.js';
import { buildInsights } from '../modules/insights.js';
import { config } from '../config/index.js';

const router = express.Router();
router.param('personId', uuidParam);
const FAMILY_ID = config.familyId;

const yearOf = (v) => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return isNaN(d.getTime()) ? null : d.getUTCFullYear();
};

const personNode = (p) => ({
  id: p.id,
  name: `${p.family_name || ''}${p.given_name || ''}`,
  courtesy: p.courtesy_name || '',
  generation: p.generation_name || '',
  gen: p.generation_no,
  branch: p.branch || '',
  gender: p.gender,
  birth_year: yearOf(p.birth_date),
  death_year: yearOf(p.death_date),
  deceased: p.is_deceased,
  occupation: p.occupation || '',
  children: [],
});

/**
 * GET /api/tree?root=&depth=8&branch=&gen=
 * 返回完整嵌套世系树（下行）。
 * 夫妻合并为一户：配偶作为节点上的 spouses 展示，子女只展开一次。
 */
router.get('/', auth, async (req, res) => {
  try {
    const { root, depth = 8, branch, gen } = req.query;
    if (root !== undefined && !isUuid(root)) {
      return res.status(400).json({ error: '参数 root 不是有效的 ID' });
    }

    const params = [FAMILY_ID];
    let where = "family_id = $1 AND status = 'active'";
    if (branch) { params.push(branch); where += ` AND branch = $${params.length}`; }
    if (gen) { params.push(Number(gen)); where += ` AND generation_no = $${params.length}`; }

    const [{ rows: persons }, { rows: edges }, { rows: marriages }] = await Promise.all([
      query(
        `SELECT id, family_name, given_name, courtesy_name, generation_name, generation_no,
                branch, gender, birth_date, birth_precision, death_date, is_deceased, occupation
         FROM person WHERE ${where}
         ORDER BY generation_no NULLS LAST, birth_date NULLS LAST, family_name, given_name`,
        params
      ),
      query(
        `SELECT pc.parent_id, pc.child_id, pc.relation_type, pc.certainty
         FROM parent_child pc
         JOIN person p ON p.id = pc.child_id
         WHERE p.family_id = $1 AND p.status = 'active'`,
        [FAMILY_ID]
      ),
      query(
        `SELECT u.id, u.person_a_id, u.person_b_id, u.union_type, u.status
         FROM marriage u JOIN person p ON p.id = u.person_a_id
         WHERE p.family_id = $1`,
        [FAMILY_ID]
      ),
    ]);

    const byId = new Map(persons.map((p) => [p.id, p]));
    const childIds = new Set(edges.map((e) => e.child_id));  // 有父母的人不是根

    const childrenMap = new Map();
    for (const e of edges) {
      if (!byId.has(e.parent_id) || !byId.has(e.child_id)) continue;
      if (!childrenMap.has(e.parent_id)) childrenMap.set(e.parent_id, []);
      childrenMap.get(e.parent_id).push(e);
    }

    const spouseMap = new Map();
    for (const m of marriages) {
      if (!byId.has(m.person_a_id) || !byId.has(m.person_b_id)) continue;
      if (!spouseMap.has(m.person_a_id)) spouseMap.set(m.person_a_id, []);
      if (!spouseMap.has(m.person_b_id)) spouseMap.set(m.person_b_id, []);
      spouseMap.get(m.person_a_id).push({ ...m, partnerId: m.person_b_id });
      spouseMap.get(m.person_b_id).push({ ...m, partnerId: m.person_a_id });
    }
    const spouseIdsOf = (id) => (spouseMap.get(id) || []).map((m) => m.partnerId);

    const maxDepth = Math.min(12, Math.max(1, Number(depth) || 8));
    const NODE_BUDGET = 2000; // 大谱保护
    let renderedNodes = 0;

    function build(id, level, visited) {
      const p = byId.get(id);
      if (!p) return null;
      renderedNodes++;
      if (renderedNodes > NODE_BUDGET && level > 0) return null;
      const node = personNode(p);

      node.spouses = (spouseMap.get(id) || [])
        .map((m) => {
          const sp = byId.get(m.partnerId);
          if (!sp) return null;
          return {
            id: sp.id,
            name: `${sp.family_name || ''}${sp.given_name || ''}`,
            gender: sp.gender,
            gen: sp.generation_no,
            birth_year: yearOf(sp.birth_date),
            death_year: yearOf(sp.death_date),
            deceased: sp.is_deceased,
            unionType: m.union_type,
            unionStatus: m.status,
            unionId: m.id,
          };
        })
        .filter(Boolean);

      if (level >= maxDepth) {
        node.truncated = (childrenMap.get(id) || []).length > 0;
        return node;
      }
      if (visited.has(id)) { node.cycle = true; return node; }
      visited.add(id);

      // 子女 = 本人子女 ∪ 配偶子女（去重），保证只出现一次
      const kidEdges = [];
      const seenKids = new Set();
      for (const pid of [id, ...spouseIdsOf(id)]) {
        for (const e of childrenMap.get(pid) || []) {
          if (seenKids.has(e.child_id)) continue;
          seenKids.add(e.child_id);
          kidEdges.push(e);
        }
      }
      const dateKey = (v) => {
        if (!v) return Number.MAX_SAFE_INTEGER;  // 日期不详排在最后
        const d = v instanceof Date ? v : new Date(v);
        return isNaN(d.getTime()) ? Number.MAX_SAFE_INTEGER : d.getTime();
      };
      kidEdges.sort((a, b) => dateKey(byId.get(a.child_id)?.birth_date) - dateKey(byId.get(b.child_id)?.birth_date));

      node.children = kidEdges.map((k) => {
        const child = build(k.child_id, level + 1, visited);
        if (child) { child.relation = k.relation_type; child.certainty = k.certainty; }
        return child;
      }).filter(Boolean);
      return node;
    }

    // 根 = 无父母者；排除娶入/嫁入的姻亲；夫妻均无父母时只保留一人（男性优先，其次年长）
    let roots;
    if (root) {
      const node = build(root, 0, new Set());
      roots = node ? [node] : [];
    } else {
      const isBloodRoot = (p) => {
        const sps = (spouseMap.get(p.id) || []).map((m) => byId.get(m.partnerId)).filter(Boolean);
        if (sps.some((s) => childIds.has(s.id))) return false;  // 配偶有父母 → 本人是姻亲
        const peers = [p, ...sps.filter((s) => !childIds.has(s.id))];
        const ordered = peers.slice().sort((a, b) =>
          (a.gender === 'male' ? 0 : 1) - (b.gender === 'male' ? 0 : 1)
          || String(a.birth_date || '').localeCompare(String(b.birth_date || ''))
          || String(a.id).localeCompare(String(b.id)));
        return ordered[0].id === p.id;
      };
      const candidates = persons.filter((p) => !childIds.has(p.id) && isBloodRoot(p));
      const seed = candidates.length ? candidates : persons.slice(0, 1);
      roots = seed.map((p) => build(p.id, 0, new Set())).filter(Boolean);
    }

    res.json({
      roots,
      total: persons.length,
      renderedNodes,
      truncated: renderedNodes >= NODE_BUDGET,
      maxDepth,
    });
  } catch (err) {
    logger.error('[tree] get:', err);
    res.status(500).json({ error: '族谱树查询失败' });
  }
});

async function loadGraph() {
  const [{ rows: persons }, { rows: edges }, { rows: marriages }] = await Promise.all([
    query(
      `SELECT id, family_name, given_name, courtesy_name, generation_name, generation_no,
              branch, gender, birth_date, birth_precision, birth_place,
              death_date, death_precision, death_place, is_deceased
       FROM person WHERE family_id = $1 AND status = 'active'`,
      [FAMILY_ID]
    ),
    query(
      `SELECT pc.parent_id, pc.child_id FROM parent_child pc
       JOIN person p ON p.id = pc.child_id
       WHERE p.family_id = $1 AND p.status = 'active'`,
      [FAMILY_ID]
    ),
    query(
      `SELECT u.person_a_id, u.person_b_id, u.union_type, u.status FROM marriage u
       JOIN person p ON p.id = u.person_a_id WHERE p.family_id = $1`,
      [FAMILY_ID]
    ),
  ]);
  const byId = new Map(persons.map((p) => [p.id, {
    ...p,
    birth_year: p.birth_date ? new Date(p.birth_date).getUTCFullYear() : null,
    death_year: p.death_date ? new Date(p.death_date).getUTCFullYear() : null,
  }]));
  return {
    persons: [...byId.values()],
    edges,
    marriages,
    graph: buildGraph([...byId.values()], edges, marriages),
  };
}

/**
 * GET /api/tree/kinship?a=&b=
 * 中文称谓推导（借鉴 yimai：谁该叫谁什么）。
 */
router.get('/kinship', auth, async (req, res) => {
  const { a, b } = req.query;
  if (!isUuid(a) || !isUuid(b)) {
    return res.status(400).json({ error: '参数 a/b 不是有效的 ID' });
  }
  try {
    const { graph, persons } = await loadGraph();
    if (!graph.byId.has(a) || !graph.byId.has(b)) {
      return res.status(404).json({ error: '成员不存在' });
    }
    const aPerson = graph.byId.get(a);
    const bPerson = graph.byId.get(b);
    const { rows: famRows } = await query('SELECT settings FROM family WHERE id = $1', [FAMILY_ID]);
    const dialect = famRows[0]?.settings?.dialect || 'standard';
    const result = kinship(a, b, graph);
    const reverse = kinship(b, a, graph);
    res.json({
      from: { id: a, name: `${aPerson.family_name || ''}${aPerson.given_name || ''}` },
      to: { id: b, name: `${bPerson.family_name || ''}${bPerson.given_name || ''}` },
      ...withDialect(result, dialect),
      // 反向称谓（对方叫我什么）
      reverse: { ...withDialect(reverse, dialect), kind: reverse.kind },
      totalPersons: persons.length,
    });
  } catch (err) {
    logger.error('[tree] kinship:', err);
    res.status(500).json({ error: '称谓推导失败' });
  }
});

// 方言称谓对照表（供设置页预览/教学）
router.get('/kinship/dialects', auth, async (req, res) => {
  const dialect = String(req.query.dialect || 'standard');
  res.json({
    dialects: dialectKeys().map((k) => ({ key: k, label: DIALECT_LABEL[k] })),
    dialect,
    glossary: dialectGlossary(dialect),
  });
});



/**
 * GET /api/tree/five-fu?center=:id
 * 五服范围（上下五代，含配偶）。
 */
router.get('/five-fu', auth, async (req, res) => {
  const { center } = req.query;
  if (!isUuid(center)) return res.status(400).json({ error: '参数 center 不是有效的 ID' });
  try {
    const { graph } = await loadGraph();
    if (!graph.byId.has(center)) return res.status(404).json({ error: '成员不存在' });
    const { ids, generations } = fiveFuSet(center, graph);
    res.json({
      center,
      total: ids.length,
      persons: ids.map((id) => {
        const p = graph.byId.get(id);
        return {
          id,
          name: `${p.family_name || ''}${p.given_name || ''}`,
          gen: p.generation_no,
          relativeGeneration: generations.get(id) ?? 0,
          gender: p.gender,
          deceased: p.is_deceased,
        };
      }),
    });
  } catch (err) {
    logger.error('[tree] five-fu:', err);
    res.status(500).json({ error: '五服查询失败' });
  }
});

/**
 * GET /api/tree/insights
 * 家族洞察（借鉴 yimai 六类洞察）。
 */
router.get('/insights', auth, async (req, res) => {
  try {
    const { persons, edges, marriages } = await loadGraph();
    // 家族设置中的字辈派语
    const { rows: famRows } = await query('SELECT settings, surname FROM family WHERE id = $1', [FAMILY_ID]);
    const generationPoem = famRows[0]?.settings?.generationPoem || null;
    const surname = famRows[0]?.surname || null;
    res.json(buildInsights({ persons, edges, marriages }, { generationPoem, surname }));
  } catch (err) {
    logger.error('[tree] insights:', err);
    res.status(500).json({ error: '洞察分析失败' });
  }
});

/**
 * GET /api/tree/export.svg?root=&depth=6
 * 服务端生成世系 SVG（参考 Topola 的 SVG 导出）。
 */
router.get('/export.svg', auth, async (req, res) => {
  try {
    const { root, depth = 6, title = '族谱世系图' } = req.query;
    if (root !== undefined && !isUuid(root)) {
      return res.status(400).json({ error: '参数 root 不是有效的 ID' });
    }
    const [{ rows: persons }, { rows: edges }, { rows: marriages }] = await Promise.all([
      query(
        `SELECT id, family_name, given_name, courtesy_name, generation_no, branch,
                gender, birth_date, death_date, is_deceased
         FROM person WHERE family_id = $1 AND status = 'active'`,
        [FAMILY_ID]
      ),
      query(
        `SELECT pc.parent_id, pc.child_id FROM parent_child pc
         JOIN person p ON p.id = pc.child_id
         WHERE p.family_id = $1 AND p.status = 'active'`,
        [FAMILY_ID]
      ),
      query(
        `SELECT u.person_a_id, u.person_b_id FROM marriage u
         JOIN person p ON p.id = u.person_a_id WHERE p.family_id = $1`,
        [FAMILY_ID]
      ),
    ]);

    const svg = buildDescendantSvg({
      persons, edges, marriages,
      focusId: root || null,
      title: String(title).slice(0, 60) || '族谱世系图',
      depth: Number(depth) || 6,
    });
    res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="family-tree.svg"');
    res.send(svg);
  } catch (err) {
    logger.error('[tree] svg:', err);
    res.status(500).json({ error: '生成 SVG 失败' });
  }
});

/**
 * GET /api/tree/hourglass.svg?focus=&up=4&down=4
 * 沙漏世系 SVG（上祖先、下后裔）。
 */
router.get('/hourglass.svg', auth, async (req, res) => {
  try {
    const { focus, up = 4, down = 4, title = '沙漏世系图' } = req.query;
    if (!focus || !isUuid(focus)) return res.status(400).json({ error: '参数 focus 无效' });
    const [{ rows: persons }, { rows: edges }, { rows: marriages }] = await Promise.all([
      query(
        `SELECT id, family_name, given_name, courtesy_name, generation_no, branch,
                gender, birth_date, death_date, is_deceased
         FROM person WHERE family_id = $1 AND status = 'active'`,
        [FAMILY_ID]
      ),
      query(
        `SELECT pc.parent_id, pc.child_id FROM parent_child pc
         JOIN person p ON p.id = pc.child_id
         WHERE p.family_id = $1 AND p.status = 'active'`,
        [FAMILY_ID]
      ),
      query(
        `SELECT u.person_a_id, u.person_b_id FROM marriage u
         JOIN person p ON p.id = u.person_a_id WHERE p.family_id = $1`,
        [FAMILY_ID]
      ),
    ]);
    if (!persons.some((p) => p.id === focus)) {
      return res.status(404).json({ error: '成员不存在' });
    }
    const svg = buildHourglassSvg({
      persons, edges, marriages,
      focusId: focus,
      title: String(title).slice(0, 60) || '沙漏世系图',
      ancestorDepth: up === '' ? 4 : Number(up),
      descendantDepth: down === '' ? 4 : Number(down),
    });
    res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="hourglass.svg"');
    res.send(svg);
  } catch (err) {
    logger.error('[tree] hourglass svg:', err);
    res.status(500).json({ error: '生成沙漏图失败' });
  }
});

/**
 * GET /api/tree/ancestors/:personId?depth=6
 * 向上追溯祖先，返回扁平列表（含距中心代数），供沙漏/祖先视图使用。
 */
router.get('/ancestors/:personId', auth, async (req, res) => {
  try {
    const { depth = 6 } = req.query;
    const maxDepth = Math.min(10, Math.max(1, Number(depth) || 6));

    const { rows: persons } = await query(
      `SELECT id, family_name, given_name, courtesy_name, generation_name, generation_no,
              branch, gender, birth_date, death_date, is_deceased
       FROM person WHERE family_id = $1 AND status = 'active'`,
      [FAMILY_ID]
    );
    const byId = new Map(persons.map((p) => [p.id, p]));
    const focus = byId.get(req.params.personId);
    if (!focus) return res.status(404).json({ error: '成员不存在' });

    const { rows: edges } = await query(
      `SELECT pc.parent_id, pc.child_id, pc.relation_type, pc.certainty
       FROM parent_child pc JOIN person p ON p.id = pc.child_id
       WHERE p.family_id = $1 AND p.status = 'active'`,
      [FAMILY_ID]
    );
    const parentMap = new Map();
    for (const e of edges) {
      if (!parentMap.has(e.child_id)) parentMap.set(e.child_id, []);
      parentMap.get(e.child_id).push(e);
    }

    const node = (p) => ({
      id: p.id,
      name: `${p.family_name || ''}${p.given_name || ''}`,
      courtesy: p.courtesy_name || '',
      gen: p.generation_no,
      branch: p.branch || '',
      gender: p.gender,
      birth_year: yearOf(p.birth_date),
      death_year: yearOf(p.death_date),
      deceased: p.is_deceased,
    });

    const ancestors = [];
    const visited = new Set([focus.id]);
    const queue = [{ id: focus.id, distance: 0 }];

    while (queue.length) {
      const cur = queue.shift();
      if (cur.distance >= maxDepth) continue;
      for (const edge of parentMap.get(cur.id) || []) {
        if (visited.has(edge.parent_id)) continue;
        const parent = byId.get(edge.parent_id);
        if (!parent) continue;
        visited.add(edge.parent_id);
        ancestors.push({
          distance: cur.distance + 1,
          relation: parent.gender === 'male' ? '父' : parent.gender === 'female' ? '母' : '父母',
          relationType: edge.relation_type,
          certainty: edge.certainty,
          person: node(parent),
        });
        queue.push({ id: edge.parent_id, distance: cur.distance + 1 });
      }
    }

    ancestors.sort((a, b) => a.distance - b.distance || a.person.birth_year - b.person.birth_year);
    res.json({
      focus: node(focus),
      ancestors,
      maxDistance: ancestors.length ? Math.max(...ancestors.map((a) => a.distance)) : 0,
    });
  } catch (err) {
    logger.error('[tree] ancestors:', err);
    res.status(500).json({ error: '祖先查询失败' });
  }
});

/**
 * GET /api/tree/path?a=&b=
 * 关系路径：最近共同祖先 + 两侧距离。
 */
router.get('/path', auth, async (req, res) => {
  const { a, b } = req.query;
  if (!a || !b) return res.status(400).json({ error: '参数 a 和 b 必填' });
  if (!isUuid(a) || !isUuid(b)) {
    return res.status(400).json({ error: '参数 a/b 不是有效的 ID' });
  }
  try {
    async function ancestorsOf(pid) {
      const map = new Map([[pid, { id: pid, of: null, dist: 0 }]]);
      const queue = [pid];
      while (queue.length) {
        const cur = queue.shift();
        const { rows } = await query('SELECT parent_id FROM parent_child WHERE child_id = $1', [cur]);
        for (const r of rows) {
          if (!map.has(r.parent_id)) {
            map.set(r.parent_id, { id: r.parent_id, of: cur, dist: map.get(cur).dist + 1 });
            queue.push(r.parent_id);
          }
        }
      }
      return map;
    }
    const [ancA, ancB] = await Promise.all([ancestorsOf(a), ancestorsOf(b)]);
    const common = [...ancA.keys()].filter((id) => ancB.has(id));
    if (!common.length) return res.json({ related: false, message: '未找到共同祖先' });

    let best = common[0], bestScore = Infinity;
    for (const c of common) {
      const score = ancA.get(c).dist + ancB.get(c).dist;
      if (score < bestScore) { bestScore = score; best = c; }
    }
    const { rows } = await query(
      'SELECT family_name, given_name, generation_no FROM person WHERE id = $1', [best]
    );
    res.json({
      related: true,
      commonAncestor: { id: best, name: `${rows[0]?.family_name || ''}${rows[0]?.given_name || ''}`, gen: rows[0]?.generation_no },
      aDistance: ancA.get(best).dist,
      bDistance: ancB.get(best).dist,
    });
  } catch (err) {
    logger.error('[tree] path:', err);
    res.status(500).json({ error: '关系路径查询失败' });
  }
});

export default router;
