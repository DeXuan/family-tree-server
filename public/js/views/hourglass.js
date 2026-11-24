import { api, download } from '../api.js';
import { esc, lifespan, toast } from '../ui.js';
import { renderTreeNodes, wireTree } from '../components/tree.js';

const ANCESTOR_LABEL = {
  1: '父母', 2: '祖父母', 3: '曾祖父母', 4: '高祖父母',
  5: '天祖父母', 6: '烈祖父母', 7: '太祖父母',
};

function ancestorCard(a) {
  const p = a.person;
  const cls = ['person-card', 'hg-card'];
  if (p.deceased) cls.push('is-deceased');
  if (p.gender === 'female') cls.push('is-female');
  if (p.gender === 'male') cls.push('is-male');
  return `
    <a class="${cls.join(' ')}" href="#/person/${esc(p.id)}">
      <div class="pc-main">
        <div class="pc-name">
          ${esc(p.name)}
          ${p.courtesy ? `<span class="pc-courtesy">字${esc(p.courtesy)}</span>` : ''}
          ${p.gen ? `<span class="pc-gen">${esc(p.gen)}世</span>` : ''}
        </div>
        <div class="pc-meta">
          <span>${esc(lifespan(p))}</span>
          <span>${esc(a.relation)}</span>
          ${p.branch ? `<span>${esc(p.branch)}</span>` : ''}
        </div>
      </div>
    </a>`;
}

export async function renderHourglass(root, id) {
  root.innerHTML = '<div class="content"><div class="empty">正在铺开沙漏世系…</div></div>';

  let anc, desc;
  try {
    [anc, desc] = await Promise.all([
      api(`/api/tree/ancestors/${id}?depth=8`),
      api(`/api/tree?root=${id}&depth=8`),
    ]);
  } catch (err) {
    root.innerHTML = `<div class="content"><div class="notice">${esc(err.message)}</div></div>`;
    return;
  }

  const focus = anc.focus;
  const groups = new Map();
  for (const a of anc.ancestors) {
    if (!groups.has(a.distance)) groups.set(a.distance, []);
    groups.get(a.distance).push(a);
  }
  const distances = [...groups.keys()].sort((a, b) => b - a);
  const totalAnc = anc.ancestors.length;

  root.innerHTML = `
    <div class="content">
      <div class="page-head">
        <a class="btn btn-ghost btn-sm" href="#/person/${esc(id)}">← 返回成员档案</a>
        <div class="spacer"></div>
        <button class="btn btn-sm" type="button" id="hg-export">导出 SVG</button>
        <button class="btn btn-sm" type="button" id="hg-fan">祖先盘</button>
        <a class="btn btn-sm" href="#/tree">完整世系树</a>
      </div>

      <div class="page-head">
        <div>
          <div class="row">
            <h1>沙漏世系</h1>
            ${anc.maxDistance >= 4 ? '<span class="badge badge-jade">五世同堂</span>' : ''}
          </div>
          <p class="page-sub">以「${esc(focus.name)}」为中心 · 上溯 ${anc.maxDistance} 代 · 共 ${totalAnc} 位祖先 · 后裔见下方</p>
        </div>
      </div>

      <div class="card">
        <div class="card-head">
          <h3>祖先</h3>
          <span class="badge badge-muted">${totalAnc} 位</span>
        </div>
        <div class="card-body">
          ${distances.length ? distances.map((d) => `
            <div class="hg-row">
              <div class="hg-label">${esc(ANCESTOR_LABEL[d] || `${d} 代祖先`)}</div>
              <div class="hg-cards">${groups.get(d).map(ancestorCard).join('')}</div>
            </div>`).join('') : '<div class="empty">尚未录入父母信息</div>'}
        </div>
      </div>

      <div class="hg-focus">
        <span class="hg-focus-label">中心</span>
        <a class="person-card is-focus" href="#/person/${esc(focus.id)}">
          <div class="pc-main">
            <div class="pc-name">${esc(focus.name)}
              ${focus.courtesy ? `<span class="pc-courtesy">字${esc(focus.courtesy)}</span>` : ''}
              ${focus.gen ? `<span class="pc-gen">${esc(focus.gen)}世</span>` : ''}
            </div>
            <div class="pc-meta"><span>${esc(lifespan(focus))}</span>${focus.branch ? `<span>${esc(focus.branch)}</span>` : ''}</div>
          </div>
        </a>
      </div>

      <div class="card mt-16">
        <div class="card-head"><h3>中心与后裔</h3></div>
        <div class="card-body tree-scroll" id="hg-descendants">
          ${desc.roots.length ? renderTreeNodes(desc.roots) : '<div class="empty">暂无后裔数据</div>'}
        </div>
      </div>
    </div>`;

  wireTree(root.querySelector('#hg-descendants'));

  root.querySelector('#hg-export').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      await download(`/api/tree/hourglass.svg?focus=${encodeURIComponent(id)}&up=4&down=4`, 'hourglass.svg');
      toast('SVG 沙漏图已开始下载', 'ok');
    } catch (err) { toast(err.message, 'error'); }
    btn.disabled = false;
  });

  root.querySelector('#hg-fan').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      await download(`/api/tree/ancestors.svg?focus=${encodeURIComponent(id)}&depth=6`, 'ancestors.svg');
      toast('祖先盘 SVG 已开始下载', 'ok');
    } catch (err) { toast(err.message, 'error'); }
    btn.disabled = false;
  });

}
