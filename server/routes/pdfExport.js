import { logger } from '../modules/logger.js';
import express from 'express';
import { query } from '../db/db.js';
import { auth } from '../middleware/auth.js';
import { currentFamilyId } from '../middleware/tenant.js';
import {
  normalizePdfOptions, issueTicket, consumeTicket, renderPdf,
  pdfCapability, logPdfFailure,
} from '../modules/pdf.js';
import { buildInsights } from '../modules/insights.js';

const router = express.Router();

/**
 * POST /api/export/pdf/ticket
 * 为一份打印稿签发一次性票据。前端拿到 renderUrl 后直接打开即可下载 PDF。
 *
 * body: { kind: 'genealogy'|'person'|'insights', personId?, options? }
 */
router.post('/pdf/ticket', auth, async (req, res) => {
  const { kind = 'genealogy', personId = null, options = {} } = req.body || {};
  if (!['genealogy', 'person', 'insights'].includes(kind)) {
    return res.status(400).json({ error: '不支持的打印类型' });
  }
  if (kind === 'person' && !personId) {
    return res.status(400).json({ error: '个人谱需要 personId' });
  }
  const opts = normalizePdfOptions({ ...options, title: options.title || defaultTitle(kind) });
  const { token, expiresIn } = issueTicket({
    userId: req.user.id,
    familyId: currentFamilyId(),
    path: JSON.stringify({ kind, personId, options: opts }),
  });
  res.json({
    ticket: token,
    expiresIn,
    renderUrl: `/api/export/pdf/render?ticket=${encodeURIComponent(token)}`,
    capability: pdfCapability(),
  });
});

/**
 * GET /api/export/pdf/render?ticket=
 * 消耗票据，服务端渲染 HTML → Chromium 打印为 PDF。
 * 该端点**不需要** Authorization 头：票据本身就是一次性的临时凭证。
 */
router.get('/pdf/render', async (req, res) => {
  const t = consumeTicket(req.query.ticket);
  if (!t.ok) return res.status(401).json({ error: t.error });

  let job = {};
  try { job = JSON.parse(t.path || '{}'); } catch { job = {}; }
  const { kind = 'genealogy', personId = null, options = {} } = job;

  try {
    const html = await buildPrintHtml({ kind, personId, options });
    // 用 data: URL 塞入 HTML：无需再起临时静态服务，也不会泄漏到公网
    const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
    const pdf = await renderPdf({ url: dataUrl, options });

    const filename = encodeURIComponent(`${options.title || '族谱'}.pdf`);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="family-tree.pdf"; filename*=UTF-8''${filename}`);
    res.setHeader('Content-Length', pdf.length);
    res.end(pdf);
  } catch (err) {
    logPdfFailure(err);
    // Chromium 不可用时给出可操作提示，前端可退回 window.print()
    const msg = String(err?.message || '');
    const noBrowser = /Executable doesn't exist|BrowserType.launch|spawn .*ENOENT|Cannot find module/i.test(msg);
    res.status(noBrowser ? 501 : 500).json({
      error: noBrowser ? '服务端未安装 Chromium，无法生成 PDF；请改用浏览器打印，或运行 npx playwright install chromium' : 'PDF 生成失败',
      fallback: 'browser-print',
      capability: pdfCapability(),
    });
  }
});

/** GET /api/export/pdf/capability —— 供前端决定是否显示「下载 PDF」按钮 */
router.get('/pdf/capability', auth, (req, res) => {
  res.json(pdfCapability());
});

function defaultTitle(kind) {
  if (kind === 'person') return '个人谱';
  if (kind === 'insights') return '家族洞察报告';
  return '宗谱';
}

// ---------------------------------------------------------------------------
// 打印 HTML 生成（纯字符串拼接，不依赖前端 JS，保证 Chromium 里一定能渲染）
// ---------------------------------------------------------------------------

const esc = (v) => String(v ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

const yearOf = (v) => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return isNaN(d.getTime()) ? null : d.getUTCFullYear();
};

async function loadGraph() {
  const [{ rows: persons }, { rows: edges }, { rows: marriages }] = await Promise.all([
    query(
      `SELECT id, family_name, given_name, courtesy_name, generation_name, generation_no,
              branch, gender, birth_date, death_date, birth_place, death_place, is_deceased,
              occupation, education, bio
       FROM person WHERE family_id = $1 AND status = 'active'`,
      [currentFamilyId()]
    ),
    query(
      `SELECT pc.parent_id, pc.child_id FROM parent_child pc
       JOIN person p ON p.id = pc.child_id
       WHERE p.family_id = $1 AND p.status = 'active'`,
      [currentFamilyId()]
    ),
    query(
      `SELECT u.person_a_id, u.person_b_id FROM marriage u
       JOIN person p ON p.id = u.person_a_id WHERE p.family_id = $1`,
      [currentFamilyId()]
    ),
  ]);
  return { persons, edges, marriages };
}

const baseStyle = `
  *{box-sizing:border-box}
  body{font-family:"Songti SC","SimSun",serif;color:#24211c;background:#fff;margin:0}
  h1{font-size:26px;text-align:center;margin:0 0 6px}
  .sub{text-align:center;font-size:11px;color:#8b8377;margin-bottom:22px}
  table{width:100%;border-collapse:collapse;font-size:11px}
  th,td{border:1px solid #ddd6c8;padding:5px 7px;text-align:left;vertical-align:top}
  th{background:#f4f0e7;font-weight:600}
  tr{break-inside:avoid}
  .gen{font-weight:700;color:#3e6b58}
  .muted{color:#8b8377}
  .row{display:flex;gap:16px}
  .col{flex:1}
  .card{border:1px solid #e4ded1;border-radius:6px;padding:9px 11px;margin-bottom:9px}
  .card h3{margin:0 0 6px;font-size:12px}
  .kv{font-size:11px;line-height:1.7}
  .kv b{font-weight:600;color:#4a453d;display:inline-block;min-width:64px}
  @page{margin:0}
`;

/** 宗谱：全族按世代排列的表格 */
async function genealogyHtml({ options }) {
  const { persons, edges, marriages } = await loadGraph();
  const byId = new Map(persons.map((p) => [p.id, p]));
  const childIds = new Set(edges.map((e) => e.child_id));
  const spouseMap = new Map();
  for (const m of marriages) {
    if (!byId.has(m.person_a_id) || !byId.has(m.person_b_id)) continue;
    const a = byId.get(m.person_a_id);
    const b = byId.get(m.person_b_id);
    if (!spouseMap.has(a.id)) spouseMap.set(a.id, []);
    if (!spouseMap.has(b.id)) spouseMap.set(b.id, []);
    spouseMap.get(a.id).push(`${b.family_name || ''}${b.given_name || ''}`);
    spouseMap.get(b.id).push(`${a.family_name || ''}${a.given_name || ''}`);
  }
  const parentMap = new Map();
  for (const e of edges) {
    if (!parentMap.has(e.child_id)) parentMap.set(e.child_id, []);
    parentMap.get(e.child_id).push(e.parent_id);
  }

  // 按世代排序；世代未知的用「父代 +1」推断
  const genOf = new Map();
  const infer = (id, depth = 0) => {
    if (genOf.has(id)) return genOf.get(id);
    const p = byId.get(id);
    if (!p) return null;
    const explicit = p.generation_no;
    if (explicit) { genOf.set(id, explicit); return explicit; }
    if (depth > 12) { genOf.set(id, null); return null; }
    const parents = parentMap.get(id) || [];
    let g = null;
    for (const pid of parents) {
      const pg = infer(pid, depth + 1);
      if (pg) g = Math.max(g || 0, pg + 1);
    }
    genOf.set(id, g);
    return g;
  };
  for (const p of persons) infer(p.id);

  const sorted = persons.slice().sort((a, b) => {
    const ga = genOf.get(a.id) ?? 999;
    const gb = genOf.get(b.id) ?? 999;
    return ga - gb || (yearOf(a.birth_date) || 9999) - (yearOf(b.birth_date) || 9999);
  });

  const rows = sorted.map((p, i) => {
    const life = [yearOf(p.birth_date) ?? '?', p.is_deceased ? (yearOf(p.death_date) ?? '?') : ''].filter(Boolean).join('–');
    return `<tr>
      <td>${i + 1}</td>
      <td class="gen">${genOf.get(p.id) ? `第${genOf.get(p.id)}世` : '—'}</td>
      <td>${esc(`${p.family_name || ''}${p.given_name || ''}`)}</td>
      <td class="muted">${esc(p.courtesy_name || '')}${p.generation_name ? ` · 字辈「${esc(p.generation_name)}」` : ''}</td>
      <td>${esc(p.branch || '')}</td>
      <td>${esc(life)}</td>
      <td class="muted">${esc((spouseMap.get(p.id) || []).join('、'))}</td>
      <td class="muted">${esc([p.birth_place, p.occupation].filter(Boolean).join(' · '))}</td>
    </tr>`;
  }).join('');

  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>${baseStyle}</style></head>
<body>
  <h1>${esc(options.title || '宗谱')}</h1>
  <div class="sub">共 ${persons.length} 人 · 打印于 ${new Date().toISOString().slice(0, 10)}</div>
  <table>
    <thead><tr><th>#</th><th>世代</th><th>姓名</th><th>字号/字辈</th><th>支系</th><th>生卒</th><th>配偶</th><th>生地/职业</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</body></html>`;
}

/** 个人谱：单个成员的完整档案卡 */
async function personHtml({ personId, options }) {
  const { rows } = await query(
    `SELECT * FROM person WHERE id = $1 AND family_id = $2`, [personId, currentFamilyId()]
  );
  if (!rows.length) throw new Error('成员不存在');
  const p = rows[0];
  const [{ rows: edges }, { rows: marriages }] = await Promise.all([
    query(
      `SELECT pc.parent_id, pc.child_id, pc.relation_type, pc.certainty,
              pp.family_name, pp.given_name, pp.gender
       FROM parent_child pc JOIN person pp ON pp.id = pc.parent_id
       WHERE pc.child_id = $1`, [p.id]
    ),
    query(
      `SELECT m.*, pa.family_name AS a_family, pa.given_name AS a_given,
              pb.family_name AS b_family, pb.given_name AS b_given
       FROM marriage m
       JOIN person pa ON pa.id = m.person_a_id
       JOIN person pb ON pb.id = m.person_b_id
       WHERE m.person_a_id = $1 OR m.person_b_id = $1`, [p.id]
    ),
  ]);
  const { rows: kids } = await query(
    `SELECT pp.family_name, pp.given_name, pp.gender, pc.relation_type
     FROM parent_child pc JOIN person pp ON pp.id = pc.child_id
     WHERE pc.parent_id = $1 ORDER BY pp.birth_date NULLS LAST`, [p.id]
  );
  const { rows: events } = await query(
    `SELECT event_type, title, description, event_date, event_precision, place
     FROM event WHERE person_id = $1 ORDER BY event_date NULLS LAST, created_at`, [p.id]
  );

  const kv = (label, value) => (value
    ? `<div class="kv"><b>${esc(label)}</b>${esc(value)}</div>` : '');

  const parents = edges.map((e) => `${e.family_name || ''}${e.given_name || ''}（${e.gender === 'female' ? '母' : '父'}）`).join('、');
  const spouses = marriages.map((m) => {
    const other = m.person_a_id === p.id
      ? `${m.b_family || ''}${m.b_given || ''}`
      : `${m.a_family || ''}${m.a_given || ''}`;
    const status = { married: '已婚', divorced: '离异', widowed: '丧偶' }[m.status] || m.status;
    return `${other}（${status}）`;
  }).join('、');
  const children = kids.map((k) => `${k.family_name || ''}${k.given_name || ''}`).join('、');

  const life = `${yearOf(p.birth_date) ?? '?'}–${p.is_deceased ? (yearOf(p.death_date) ?? '?') : ''}`;
  const eventRows = events.map((e) => `<tr>
      <td>${e.event_date ? String(e.event_date).slice(0, 10) : (e.event_precision === 'unknown' ? '—' : '')}</td>
      <td>${esc(e.title || e.event_type)}</td>
      <td class="muted">${esc(e.description || '')}${e.place ? ` @${esc(e.place)}` : ''}</td>
    </tr>`).join('');

  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>${baseStyle}</style></head>
<body>
  <h1>${esc(`${p.family_name || ''}${p.given_name || ''}`)}${p.courtesy_name ? ` <span class="muted">字${esc(p.courtesy_name)}</span>` : ''}</h1>
  <div class="sub">${esc(options.title || '个人谱')} · 打印于 ${new Date().toISOString().slice(0, 10)}</div>
  <div class="row">
    <div class="col">
      <div class="card">
        <h3>基本信息</h3>
        ${kv('世代', p.generation_no ? `第${p.generation_no}世` : '')}
        ${kv('字辈', p.generation_name)}
        ${kv('支系', p.branch)}
        ${kv('性别', p.gender === 'female' ? '女' : p.gender === 'male' ? '男' : '')}
        ${kv('生卒', life)}
        ${kv('出生地', p.birth_place)}
        ${kv('安葬地', p.burial_place)}
        ${kv('职业', p.occupation)}
        ${kv('学历', p.education)}
      </div>
    </div>
    <div class="col">
      <div class="card">
        <h3>亲属关系</h3>
        ${kv('父母', parents)}
        ${kv('配偶', spouses)}
        ${kv('子女', children)}
      </div>
    </div>
  </div>
  ${p.bio ? `<div class="card"><h3>生平</h3><div class="kv">${esc(p.bio)}</div></div>` : ''}
  ${events.length ? `<div class="card"><h3>生平事件</h3>
    <table><thead><tr><th>时间</th><th>事件</th><th>详情</th></tr></thead><tbody>${eventRows}</tbody></table></div>` : ''}
</body></html>`;
}

/** 家族洞察报告 */
async function insightsHtml({ options }) {
  const { persons, edges, marriages } = await loadGraph();
  const { rows: famRows } = await query(
    'SELECT settings, surname FROM family WHERE id = $1', [currentFamilyId()]
  );
  const insights = buildInsights(
    { persons, edges, marriages },
    {
      generationPoem: famRows[0]?.settings?.generationPoem || null,
      surname: famRows[0]?.surname || null,
    }
  );

  const cards = [];
  const push = (title, lines) => {
    if (!lines.length) return;
    cards.push(`<div class="card"><h3>${esc(title)}</h3>${lines.map((l) => `<div class="kv">${esc(l)}</div>`).join('')}</div>`);
  };

  if (insights.population) {
    push('人丁结构', [
      `总人数 ${insights.population.total} 人`,
      `在世 ${insights.population.alive} 人 · 已故 ${insights.population.deceased} 人`,
      `男性 ${insights.population.male} · 女性 ${insights.population.female}`,
    ]);
  }
  if (insights.generation) {
    push('字辈谱', (insights.generation.levels || []).slice(0, 12)
      .map((g) => `第${g.gen}世：${g.count} 人${g.chars?.length ? `（派字 ${g.chars.join('、')}）` : ''}`));
  }
  if (insights.lifespan?.average) {
    push('代际寿数', [`平均享年 ${insights.lifespan.average} 岁`, ...(insights.lifespan.byGen || []).slice(0, 8).map((x) => `第${x.gen}世：${x.average} 岁`)]);
  }
  if (insights.regions?.length) {
    push('地域分布', insights.regions.slice(0, 10).map((r) => `${r.name}：${r.count} 人`));
  }
  if (insights.timeline?.length) {
    push('家族年表', insights.timeline.slice(0, 14).map((t) => `${t.year}：${t.text}`));
  }

  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>${baseStyle}</style></head>
<body>
  <h1>${esc(options.title || '家族洞察报告')}</h1>
  <div class="sub">打印于 ${new Date().toISOString().slice(0, 10)}</div>
  ${cards.join('\n')}
</body></html>`;
}

async function buildPrintHtml({ kind, personId, options }) {
  if (kind === 'person') return personHtml({ personId, options });
  if (kind === 'insights') return insightsHtml({ options });
  return genealogyHtml({ options });
}

export default router;