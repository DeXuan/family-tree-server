import { esc, lifespan } from '../ui.js';

const UNION_LABEL = { married: '配', partner: '伴', concubine: '妾' };

function card(n, extraClass = '') {
  const cls = ['person-card'];
  if (n.deceased) cls.push('is-deceased');
  if (n.gender === 'female') cls.push('is-female');
  if (n.gender === 'male') cls.push('is-male');
  if (extraClass) cls.push(extraClass);
  return `
    <div class="${cls.join(' ')}" data-person="${esc(n.id)}" tabindex="0" role="button">
      <div class="pc-main">
        <div class="pc-name">
          ${esc(n.name)}
          ${n.courtesy ? `<span class="pc-courtesy">字${esc(n.courtesy)}</span>` : ''}
          ${n.gen ? `<span class="pc-gen">${esc(n.gen)}世</span>` : ''}
        </div>
        <div class="pc-meta">
          <span>${esc(lifespan(n))}</span>
          ${n.branch ? `<span>${esc(n.branch)}</span>` : ''}
          ${n.deceased ? '<span>已故</span>' : ''}
        </div>
      </div>
    </div>`;
}

function spouseChip(sp) {
  return `
    <span class="spouse-link">${esc(UNION_LABEL[sp.unionType] || '配')}</span>
    <div class="person-card is-spouse${sp.deceased ? ' is-deceased' : ''}${sp.gender === 'female' ? ' is-female' : ''}"
         data-person="${esc(sp.id)}" tabindex="0" role="button">
      <div class="pc-main">
        <div class="pc-name">
          ${esc(sp.name)}
          ${sp.gen ? `<span class="pc-gen">${esc(sp.gen)}世</span>` : ''}
        </div>
        <div class="pc-meta">
          <span>${esc(lifespan(sp))}</span>
          ${sp.unionStatus === 'divorced' ? '<span>离异</span>' : ''}
          ${sp.unionStatus === 'widowed' ? '<span>丧偶</span>' : ''}
        </div>
      </div>
    </div>`;
}

export function renderTreeNodes(nodes, { mini = false } = {}) {
  const node = (n) => {
    const hasKids = n.children && n.children.length;
    const spouses = n.spouses || [];
    return `
      <li>
        <div class="tree-node">
          ${hasKids
            ? `<button class="tree-toggle" type="button" data-toggle aria-label="展开或收起">▾</button>`
            : `<span class="tree-toggle" aria-hidden="true"></span>`}
          <div class="couple">
            ${card(n)}
            ${spouses.map(spouseChip).join('')}
          </div>
        </div>
        ${hasKids ? `<ul class="tree-children">${n.children.map(node).join('')}</ul>` : ''}
      </li>`;
  };
  return `<ul class="tree">${nodes.map(node).join('')}</ul>`;
}

/**
 * 自上而下的结构图（org-chart）布局。
 * 与缩进列表共用同一套卡片、展开按钮与点击跳转，只是容器结构换成
 * 「父在上、子在下一行居中展开」，连线由 CSS 伪元素绘制。
 *
 * @param {Array} nodes 与 renderTreeNodes 相同的树数据
 * @param {object} opts
 * @param {number} opts.zoom 初始缩放（0.5–1.5，1 = 原尺寸）
 */
export function renderOrgChart(nodes, { zoom = 1 } = {}) {
  const node = (n) => {
    const hasKids = n.children && n.children.length;
    const spouses = n.spouses || [];
    return `
      <li class="org-node">
        <div class="org-self">
          ${hasKids
            ? `<button class="tree-toggle" type="button" data-toggle aria-label="展开或收起">▾</button>`
            : `<span class="tree-toggle" aria-hidden="true"></span>`}
          <div class="couple">
            ${card(n)}
            ${spouses.map(spouseChip).join('')}
          </div>
        </div>
        ${hasKids ? `<ul class="org-children">${n.children.map(node).join('')}</ul>` : ''}
      </li>`;
  };
  const pct = Math.round(Math.min(1.5, Math.max(0.5, Number(zoom) || 1)) * 100);
  return `
    <div class="org-viewport">
      <div class="org-stage" data-zoom="${pct}">
        <ul class="org-tree">${nodes.map(node).join('')}</ul>
      </div>
    </div>`;
}

export function wireTree(container) {
  // 容器会被反复重渲染复用：只绑定一次，避免监听器叠加导致「点一次切换两次」
  if (container.dataset.treeWired === '1') return;
  container.dataset.treeWired = '1';
  container.addEventListener('click', (e) => {
    const toggle = e.target.closest('[data-toggle]');
    if (toggle) {
      // 列表模式用 li，结构图用 li，统一取子容器
      const li = toggle.closest('li');
      const kids = li ? li.querySelector(':scope > .tree-children, :scope > .org-children') : null;
      if (kids) {
        kids.classList.toggle('collapsed');
        toggle.textContent = kids.classList.contains('collapsed') ? '▸' : '▾';
      }
      return;
    }
    const cardEl = e.target.closest('[data-person]');
    if (cardEl) location.hash = `#/person/${cardEl.dataset.person}`;
  });
  container.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const cardEl = e.target.closest('[data-person]');
    if (cardEl) { e.preventDefault(); location.hash = `#/person/${cardEl.dataset.person}`; }
  });
}

