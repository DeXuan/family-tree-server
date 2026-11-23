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

export function wireTree(container) {
  container.addEventListener('click', (e) => {
    const toggle = e.target.closest('[data-toggle]');
    if (toggle) {
      const li = toggle.closest('li');
      const kids = li.querySelector(':scope > .tree-children');
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
