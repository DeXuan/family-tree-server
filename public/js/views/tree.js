import { api, download } from '../api.js';
import { esc, debounce, toast } from '../ui.js';
import { renderTreeNodes, wireTree } from '../components/tree.js';

let treeHideHandler = null;

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
        <span class="legend-note">同一行的配偶并列显示，子女挂在下方</span>
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

  async function load() {
    const params = new URLSearchParams();
    if (branchSel.value) params.set('branch', branchSel.value);
    params.set('depth', depthSel.value);
    canvas.innerHTML = '<div class="empty">正在载入…</div>';
    try {
      const data = await api('/api/tree?' + params.toString());
      canvas.innerHTML = data.roots.length
        ? renderTreeNodes(data.roots)
        : '<div class="empty"><div class="empty-mark">谱</div>该筛选条件下暂无成员</div>';
      wireTree(canvas);
      summary.textContent = `共 ${data.total} 位成员${stats.aliveGenerations >= 5 ? ' · 五世同堂（5 代在世）' : ''}`
        + ` · 当前展开 ${depthSel.value === '8' ? '全部世代' : '前 ' + depthSel.value + ' 代'}`
        + ` · 已渲染 ${data.renderedNodes || 0} 节点`
        + (data.truncated ? "（已达节点上限，请用支系筛选）" : "");
      bindToggles();
    } catch (err) {
      canvas.innerHTML = `<div class="notice">${esc(err.message)}</div>`;
    }
  }

  function bindToggles() {
    // 初始状态：展开前两代，更深层折叠，避免一屏塞满
    if (depthSel.value === '8') return;
    canvas.querySelectorAll('.tree-children .tree-children').forEach((ul) => {
      ul.classList.add('collapsed');
      const btn = ul.parentElement.querySelector(':scope > .tree-node [data-toggle]');
      if (btn) btn.textContent = '▸';
    });
  }

  function setAll(collapsed) {
    canvas.querySelectorAll('.tree-children').forEach((ul) => ul.classList.toggle('collapsed', collapsed));
    canvas.querySelectorAll('[data-toggle]').forEach((btn) => { btn.textContent = collapsed ? '▸' : '▾'; });
  }

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
