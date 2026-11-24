import { api, download } from '../api.js';
import { esc, debounce, toast } from '../ui.js';
import { renderTreeNodes, renderOrgChart, wireTree } from '../components/tree.js';

let treeHideHandler = null;

const LAYOUT_KEY = 'ft_tree_layout';   // 'list' | 'org'（历史值 'umb' 自动回退列表）
const ZOOM_KEY = 'ft_tree_zoom';       // 50–150（百分比整数）

function savedLayout() {
  const v = localStorage.getItem(LAYOUT_KEY);
  // 伞状图已下线：历史遗留的 'umb' 自动迁移为列表并回写，避免重复判断
  if (v === 'umb') {
    localStorage.setItem(LAYOUT_KEY, 'list');
    return 'list';
  }
  return v === 'org' ? 'org' : 'list';
}

function savedZoom() {
  const n = Number(localStorage.getItem(ZOOM_KEY));
  return Number.isFinite(n) && n >= 50 && n <= 150 ? n : 100;
}

export async function renderTreePage(root) {
  root.innerHTML = '<div class="content"><div class="empty">正在展开世系…</div></div>';

  let stats;
  try {
    stats = await api('/api/stats');
  } catch (err) {
    root.innerHTML = `<div class="content"><div class="notice">${esc(err.message)}</div></div>`;
    return;
  }

  root.innerHTML = `
    <div class="content">
      <div class="page-head">
        <div>
          <div class="row">
            <h1>世系树</h1>
            ${stats.aliveGenerations >= 5 ? '<span class="badge badge-jade">五世同堂</span>' : ''}
          </div>
          <p class="page-sub" id="tree-summary">按世代自上而下展开，点击卡片查看成员</p>
        </div>
        <div class="spacer"></div>
        <div class="btn-row">
          <div class="tree-layout" role="group" aria-label="布局模式">
            <span class="seg">
              <button class="seg-btn" type="button" data-layout="list">缩进列表</button>
              <button class="seg-btn" type="button" data-layout="org">结构图</button>
            </span>
          </div>
          <button class="btn btn-sm" type="button" id="expand-all">全部展开</button>
          <button class="btn btn-sm" type="button" id="collapse-all">全部收起</button>
          <button class="btn btn-sm" type="button" id="copy-summary">复制摘要</button>
          <button class="btn btn-sm" type="button" id="export-svg">导出 SVG</button>
        </div>
      </div>

      <div class="tree-toolbar">
        <div class="field">
          <label for="branch-filter">支系</label>
          <select id="branch-filter">
            <option value="">全部支系</option>
            ${(stats.branches || []).map((b) => `<option value="${esc(b.branch)}">${esc(b.branch)}（${b.c}）</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label for="depth-filter">展开世代</label>
          <select id="depth-filter">
            <option value="3">前 3 代</option>
            <option value="5">前 5 代</option>
            <option value="8" selected>全部（五世同堂）</option>
          </select>
        </div>
        <div class="field search-box">
          <label for="tree-search">定位成员</label>
          <input id="tree-search" type="search" placeholder="输入姓名或字辈…" autocomplete="off">
          <div class="search-results" id="tree-search-results" hidden></div>
        </div>
      </div>

      <div class="legend-row">
        <span class="legend-title">凡例</span>
        <span class="legend-item"><b class="lg lg-male"></b>男性</span>
        <span class="legend-item"><b class="lg lg-female"></b>女性</span>
        <span class="legend-item"><b class="lg lg-deceased"></b>已故</span>
        <span class="legend-item"><b class="lg lg-spouse"></b>配偶</span>
        <span class="legend-item"><b class="lg lg-branch"></b>▸/▾ 展开收起</span>
        <span class="legend-note" id="legend-note">同一行的配偶并列显示，子女挂在下方</span>
      </div>

      <div class="org-zoom" id="org-zoom" hidden>
        <span class="small muted">缩放</span>
        <button class="btn btn-sm" type="button" id="zoom-out" aria-label="缩小">－</button>
        <span class="zoom-label" id="zoom-label">100%</span>
        <button class="btn btn-sm" type="button" id="zoom-in" aria-label="放大">＋</button>
        <button class="btn btn-sm" type="button" id="zoom-fit">适应宽度</button>
        <button class="btn btn-sm" type="button" id="zoom-reset">100%</button>
      </div>

      <div class="card">
        <div class="card-body tree-scroll" id="tree-canvas">
          <div class="empty">正在载入…</div>
        </div>
      </div>
    </div>`;

  const canvas = root.querySelector('#tree-canvas');
  const summary = root.querySelector('#tree-summary');
  const branchSel = root.querySelector('#branch-filter');
  const depthSel = root.querySelector('#depth-filter');

let layout = savedLayout();
  let zoom = savedZoom();              // 结构图缩放（百分比）
  let lastData = null;
  let collapsedIds = new Set();        // 跨模式共享的「已收起」节点
  let selectedId = localStorage.getItem('ft_tree_selected') || null;

  const zoomBar = root.querySelector('#org-zoom');
  const zoomLabel = root.querySelector('#zoom-label');

  // ---------- 结构图（org）缩放 ----------
  const orgStage = () => canvas.querySelector('.org-stage');

  function applyZoom(pct) {
    zoom = Math.min(150, Math.max(50, Math.round(pct / 10) * 10));
    const el = orgStage();
    if (el) { el.style.zoom = String(zoom / 100); el.dataset.zoom = String(zoom); }
    zoomLabel.textContent = zoom + '%';
    root.querySelector('#zoom-out').disabled = zoom <= 50;
    root.querySelector('#zoom-in').disabled = zoom >= 150;
    localStorage.setItem(ZOOM_KEY, String(zoom));
  }

  function fitWidth() {
    const el = orgStage();
    const vp = canvas.querySelector('.org-viewport');
    if (!el || !vp) return;
    applyZoom(100);
    const natural = el.scrollWidth || 1;
    applyZoom(Math.min(100, ((vp.clientWidth - 12) / natural) * 100));
  }

  // ---------- 收起状态：DOM <-> Set ----------
  function childContainerOf(li) {
    return li ? li.querySelector(':scope > .tree-children, :scope > .org-children') : null;
  }
  function cardOf(li) {
    return li ? li.querySelector(':scope > .tree-node [data-person], :scope > .org-self [data-person]') : null;
  }

  function readCollapsedFromDom() {
    const set = new Set();
    canvas.querySelectorAll('li').forEach((li) => {
      const kids = childContainerOf(li);
      if (!kids || !kids.classList.contains('collapsed')) return;
      const card = cardOf(li);
      if (card) set.add(card.dataset.person);
    });
    return set;
  }

  function applyCollapsedToDom() {
    canvas.querySelectorAll('li').forEach((li) => {
      const kids = childContainerOf(li);
      const card = cardOf(li);
      if (!kids || !card) return;
      const isC = collapsedIds.has(card.dataset.person);
      kids.classList.toggle('collapsed', isC);
      const btn = li.querySelector(':scope > .tree-node [data-toggle], :scope > .org-self [data-toggle]');
      if (btn) btn.textContent = isC ? '\u25b8' : '\u25be';
      li.classList.toggle('has-collapsed', isC);
    });
  }

  function markSelected() {
    canvas.querySelectorAll('.is-selected').forEach((el) => el.classList.remove('is-selected'));
    if (!selectedId) return;
    const el = canvas.querySelector('[data-person="' + CSS.escape(selectedId) + '"]');
    if (el) el.classList.add('is-selected');
  }

  // ---------- 统一渲染 ----------
  function renderCurrent() {
    if (!lastData) return;
    if (!lastData.roots.length) {
      canvas.innerHTML = '<div class="empty"><div class="empty-mark">谱</div>该筛选条件下暂无成员</div>';
      zoomBar.hidden = layout !== 'org';
      return;
    }

    canvas.innerHTML = layout === 'org'
      ? renderOrgChart(lastData.roots, { zoom: zoom / 100 })
      : renderTreeNodes(lastData.roots);
    wireTree(canvas);
    if (layout === 'org') applyZoom(zoom);
    applyCollapsedToDom();

    zoomBar.hidden = layout !== 'org';
    root.querySelectorAll('[data-layout]').forEach((b) => {
      b.classList.toggle('is-active', b.dataset.layout === layout);
      b.setAttribute('aria-pressed', String(b.dataset.layout === layout));
    });
    markSelected();

    const note = root.querySelector('#legend-note');
    if (note) {
      note.textContent = layout === 'org'
        ? '父节点在上、子节点在下；点 ▾ 展开/收起，可滚动或用缩放栏查看'
        : '同一行的配偶并列显示，子女挂在下方';
    }
  }

  async function load() {
    const params = new URLSearchParams();
    if (branchSel.value) params.set('branch', branchSel.value);
    params.set('depth', depthSel.value);
    canvas.innerHTML = '<div class="empty">正在载入…</div>';
    try {
      const data = await api('/api/tree?' + params.toString());
      lastData = data;
      collapsedIds = defaultCollapsed(data.roots, depthSel.value);
      renderCurrent();
      summary.textContent = '共 ' + data.total + ' 位成员'
        + (stats.aliveGenerations >= 5 ? ' · 五世同堂（5 代在世）' : '')
        + ' · 当前展开 ' + (depthSel.value === '8' ? '全部世代' : '前 ' + depthSel.value + ' 代')
        + ' · 已渲染 ' + (data.renderedNodes || 0) + ' 节点'
        + (data.truncated ? '（已达节点上限，请用支系筛选）' : '');
    } catch (err) {
      canvas.innerHTML = '<div class="notice">' + esc(err.message) + '</div>';
    }
  }

  /** 默认收起：展开世代有限时，把第 1 代以下的分支折叠 */
  function defaultCollapsed(roots, depthValue) {
    const set = new Set();
    if (String(depthValue) === '8') return set;
    const walk = (nodes, depth) => {
      for (const n of nodes) {
        const kids = n.children || [];
        if (depth >= 1 && kids.length) set.add(n.id);
        walk(kids, depth + 1);
      }
    };
    walk(roots || [], 0);
    return set;
  }

  function allParentIds(roots) {
    const set = new Set();
    const walk = (nodes) => {
      for (const n of nodes) {
        const kids = n.children || [];
        if (kids.length) set.add(n.id);
        walk(kids);
      }
    };
    walk(roots || []);
    return set;
  }

  function setAll(collapsed) {
    collapsedIds = collapsed ? allParentIds(lastData ? lastData.roots : []) : new Set();
    canvas.querySelectorAll('.tree-children, .org-children').forEach((ul) => ul.classList.toggle('collapsed', collapsed));
    canvas.querySelectorAll('[data-toggle]').forEach((btn) => { btn.textContent = collapsed ? '\u25b8' : '\u25be'; });
    canvas.querySelectorAll('.org-node, .tree li').forEach((li) => li.classList.toggle('has-collapsed', collapsed));
  }

  // 布局切换（两种模式共用同一份数据、收起集合与选中节点）
  root.querySelectorAll('[data-layout]').forEach((btn) => {
    btn.addEventListener('click', () => {
      collapsedIds = readCollapsedFromDom();
      const next = btn.dataset.layout;
      layout = next === 'org' ? 'org' : 'list';
      localStorage.setItem(LAYOUT_KEY, layout);
      renderCurrent();
      if (layout === 'org') toast('已切换到结构图：可滚动查看，用缩放栏调整大小', 'ok');
    });
  });

  root.querySelector('#zoom-out').addEventListener('click', () => applyZoom(zoom - 10));
  root.querySelector('#zoom-in').addEventListener('click', () => applyZoom(zoom + 10));
  root.querySelector('#zoom-reset').addEventListener('click', () => applyZoom(100));
  root.querySelector('#zoom-fit').addEventListener('click', fitWidth);


  // 展开/收起：列表与结构图同步箭头
  canvas.addEventListener('click', (e) => {
    const toggle = e.target.closest('[data-toggle]');
    if (!toggle) return;
    const li = toggle.closest('li');
    const kids = li ? li.querySelector(':scope > .tree-children, :scope > .org-children') : null;
    if (kids) li.classList.toggle('has-collapsed', kids.classList.contains('collapsed'));
    collapsedIds = readCollapsedFromDom();
  });
  root.querySelector('#copy-summary').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const [ins, stats] = await Promise.all([api('/api/tree/insights'), api('/api/stats')]);
      const lines = [
        `${stats.familyName}｜${ins.total} 位成员 · ${ins.generations} 世 · ${ins.alive} 人在世`,
        ins.birth.from ? `出生跨度 ${ins.birth.from}–${ins.birth.to}（${ins.birth.span} 年）` : '',
        ins.zibei.message,
        ins.longevity.oldest ? `最长寿：${ins.longevity.oldest.name}（${ins.longevity.oldest.age} 岁）` : '',
        ins.longevity.oldestLiving ? `在世最年长：${ins.longevity.oldestLiving.name}（${ins.longevity.oldestLiving.age} 岁）` : '',
        ins.generationStructure.map((g) => `${g.orderLabel}${g.mainGenerationName ? `「${g.mainGenerationName}」` : ''} ${g.total} 人`).join('；'),
        ins.regions.length ? `主要居住地：${ins.regions.slice(0, 3).map((r) => `${r.place}（${r.count}）`).join('、')}` : '',
      ].filter(Boolean);
      const text = lines.join('\n');
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
      }
      toast('摘要已复制到剪贴板', 'ok');
    } catch (err) { toast(err.message, 'error'); }
    btn.disabled = false;
  });

  root.querySelector('#export-svg').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      await download('/api/tree/export.svg?depth=8', 'family-tree.svg');
      toast('SVG 世系图已开始下载', 'ok');
    } catch (err) { toast(err.message, 'error'); }
    btn.disabled = false;
  });

  root.querySelector('#expand-all').addEventListener('click', () => setAll(false));
  root.querySelector('#collapse-all').addEventListener('click', () => setAll(true));
  branchSel.addEventListener('change', load);
  depthSel.addEventListener('change', load);

  // 成员定位
  const searchInput = root.querySelector('#tree-search');
  const results = root.querySelector('#tree-search-results');

  const doSearch = debounce(async () => {
    const q = searchInput.value.trim();
    if (!q) { results.hidden = true; results.innerHTML = ''; return; }
    try {
      const data = await api(`/api/persons?keyword=${encodeURIComponent(q)}&pageSize=8`);
      if (!data.items.length) {
        results.innerHTML = '<button type="button" disabled>没有匹配的成员</button>';
      } else {
        results.innerHTML = data.items.map((p) => `
          <button type="button" data-jump="${esc(p.id)}">
            <span>${esc(p.family_name + p.given_name)}</span>
            <span class="sr-meta">${esc(p.generation_no ? p.generation_no + '世' : '')} ${esc(p.branch || '')}</span>
          </button>`).join('');
      }
      results.hidden = false;
    } catch { results.hidden = true; }
  }, 200);

  searchInput.addEventListener('input', doSearch);
  searchInput.addEventListener('focus', () => { if (results.innerHTML) results.hidden = false; });

  results.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-jump]');
    if (!btn) return;
    const id = btn.dataset.jump;
    results.hidden = true;
    searchInput.value = '';
    // 记录选中节点：切换布局时据此恢复高亮
    selectedId = id;
    localStorage.setItem('ft_tree_selected', id);
    collapsedIds = new Set();
    renderCurrent();
    const target = canvas.querySelector('[data-person="' + CSS.escape(id) + '"]');
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      target.classList.add('flash');
      setTimeout(() => target.classList.remove('flash'), 2200);
    }
  });


  if (treeHideHandler) document.removeEventListener('click', treeHideHandler);
  treeHideHandler = (e) => { if (!e.target.closest('.search-box')) results.hidden = true; };
  document.addEventListener('click', treeHideHandler);

  await load();
}
