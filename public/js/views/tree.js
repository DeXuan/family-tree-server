import { api, download } from '../api.js';
import { esc, debounce, toast } from '../ui.js';
import { renderTreeNodes, renderOrgChart, wireTree } from '../components/tree.js';

let treeHideHandler = null;

const LAYOUT_KEY = 'ft_tree_layout';   // 'list' | 'org'
const ZOOM_KEY = 'ft_tree_zoom';       // 50–150（百分比整数）

function savedLayout() {
  const v = localStorage.getItem(LAYOUT_KEY);
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
  let zoom = savedZoom();
  let lastData = null;

  const zoomBar = root.querySelector('#org-zoom');
  const zoomLabel = root.querySelector('#zoom-label');
  const stage = () => canvas.querySelector('.org-stage');

  function applyZoom(pct) {
    zoom = Math.min(150, Math.max(50, Math.round(pct / 10) * 10));
    const el = stage();
    // 用 CSSOM 设置（CSP 禁止内联 style 属性）
    if (el) { el.style.zoom = String(zoom / 100); el.dataset.zoom = String(zoom); }
    zoomLabel.textContent = `${zoom}%`;
    root.querySelector('#zoom-out').disabled = zoom <= 50;
    root.querySelector('#zoom-in').disabled = zoom >= 150;
    localStorage.setItem(ZOOM_KEY, String(zoom));
  }

  function fitWidth() {
    const el = stage();
    const vp = canvas.querySelector('.org-viewport');
    if (!el || !vp) return;
    applyZoom(100);
    const natural = el.scrollWidth || 1;
    const avail = vp.clientWidth - 12;
    applyZoom(Math.min(100, (avail / natural) * 100));
  }

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
    zoomBar.hidden = layout !== 'org';
    root.querySelectorAll('[data-layout]').forEach((b) => {
      b.classList.toggle('is-active', b.dataset.layout === layout);
      b.setAttribute('aria-pressed', String(b.dataset.layout === layout));
    });
    if (layout === 'org') applyZoom(zoom);
    const note = root.querySelector('#legend-note');
    if (note) {
      note.textContent = layout === 'org'
        ? '父节点在上、子节点在下；点 ▾ 展开/收起，可滚动或用缩放栏查看'
        : '同一行的配偶并列显示，子女挂在下方';
    }
    applyInitialCollapse();
  }

  async function load() {
    const params = new URLSearchParams();
    if (branchSel.value) params.set('branch', branchSel.value);
    params.set('depth', depthSel.value);
    canvas.innerHTML = '<div class="empty">正在载入…</div>';
    try {
      const data = await api('/api/tree?' + params.toString());
      lastData = data;
      renderCurrent();
      summary.textContent = `共 ${data.total} 位成员${stats.aliveGenerations >= 5 ? ' · 五世同堂（5 代在世）' : ''}`
        + ` · 当前展开 ${depthSel.value === '8' ? '全部世代' : '前 ' + depthSel.value + ' 代'}`
        + ` · 已渲染 ${data.renderedNodes || 0} 节点`
        + (data.truncated ? "（已达节点上限，请用支系筛选）" : "");
    } catch (err) {
      canvas.innerHTML = `<div class="notice">${esc(err.message)}</div>`;
    }
  }

  function applyInitialCollapse() {
    // 初始状态：展开前两代，更深层折叠，避免一屏塞满
    if (depthSel.value === '8') return;
    canvas.querySelectorAll('.tree-children .tree-children, .org-children .org-children').forEach((ul) => {
      ul.classList.add('collapsed');
      const btn = ul.parentElement.querySelector(':scope > .org-self [data-toggle], :scope > .tree-node [data-toggle]');
      if (btn) btn.textContent = '▸';
      ul.parentElement.classList.add('has-collapsed');
    });
  }

  function setAll(collapsed) {
    canvas.querySelectorAll('.tree-children, .org-children').forEach((ul) => ul.classList.toggle('collapsed', collapsed));
    canvas.querySelectorAll('[data-toggle]').forEach((btn) => { btn.textContent = collapsed ? '▸' : '▾'; });
    canvas.querySelectorAll('.org-node, .tree li').forEach((li) => li.classList.toggle('has-collapsed', collapsed));
  }

  // 布局切换（两种模式共用同一份数据，不重复请求）
  root.querySelectorAll('[data-layout]').forEach((btn) => {
    btn.addEventListener('click', () => {
      layout = btn.dataset.layout === 'org' ? 'org' : 'list';
      localStorage.setItem(LAYOUT_KEY, layout);
      renderCurrent();
      if (layout === 'org') toast('已切换到结构图：可滚动查看，用缩放栏调整大小', 'ok');
    });
  });

  root.querySelector('#zoom-out').addEventListener('click', () => applyZoom(zoom - 10));
  root.querySelector('#zoom-in').addEventListener('click', () => applyZoom(zoom + 10));
  root.querySelector('#zoom-reset').addEventListener('click', () => applyZoom(100));
  root.querySelector('#zoom-fit').addEventListener('click', fitWidth);

  // 展开/收起时同步按钮箭头状态
  canvas.addEventListener('click', (e) => {
    const toggle = e.target.closest('[data-toggle]');
    if (!toggle) return;
    const li = toggle.closest('li');
    const kids = li?.querySelector(':scope > .tree-children, :scope > .org-children');
    if (kids) li.classList.toggle('has-collapsed', kids.classList.contains('collapsed'));
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
    setAll(false);
    const card = canvas.querySelector(`[data-person="${CSS.escape(id)}"]`);
    if (card) {
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      card.classList.add('flash');
      setTimeout(() => card.classList.remove('flash'), 2200);
    }
  });

  if (treeHideHandler) document.removeEventListener('click', treeHideHandler);
  treeHideHandler = (e) => { if (!e.target.closest('.search-box')) results.hidden = true; };
  document.addEventListener('click', treeHideHandler);

  await load();
}
