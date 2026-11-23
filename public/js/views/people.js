import { api, session } from '../api.js';
import { esc, fmtDate, dash, GENDER, emptyState, badge } from '../ui.js';

export async function renderPeople(root) {
  const state = { keyword: '', gen: '', branch: '', deceased: '', quality: '', page: 1, pageSize: 20 };
  let branchOptions = [];

  try {
    const stats = await api('/api/stats');
    branchOptions = stats.branches || [];
  } catch { /* 统计失败不阻断列表 */ }

  root.innerHTML = `
    <div class="content">
      <div class="page-head">
        <div>
          <h1>成员名录</h1>
          <p class="page-sub" id="people-count">正在载入…</p>
        </div>
        <div class="spacer"></div>
        ${session.canEdit ? '<a class="btn btn-primary" href="#/new">录入成员</a>' : ''}
      </div>

      <div class="card">
        <div class="card-body">
          <form class="filters" id="people-filters">
            <div class="field">
              <label for="f-keyword">姓名 / 字号 / 字辈</label>
              <input id="f-keyword" type="search" placeholder="如：王大伯" autocomplete="off">
            </div>
            <div class="field">
              <label for="f-gen">世代</label>
              <input id="f-gen" type="number" min="1" placeholder="不限" inputmode="numeric">
            </div>
            <div class="field">
              <label for="f-branch">支系</label>
              <select id="f-branch">
                <option value="">不限</option>
                ${branchOptions.map((b) => `<option value="${esc(b.branch)}">${esc(b.branch)}</option>`).join('')}
              </select>
            </div>
            <div class="field">
              <label for="f-deceased">状态</label>
              <select id="f-deceased">
                <option value="">不限</option>
                <option value="false">在世</option>
                <option value="true">已故</option>
              </select>
            </div>
            <div class="field">
              <label for="f-quality">资料完整度</label>
              <select id="f-quality">
                <option value="">不限</option>
                <option value="missing:source">缺来源考证</option>
                <option value="missing:birth_place">缺出生地</option>
                <option value="missing:parents">缺父母</option>
                <option value="below:60">完整度低于 60%</option>
                <option value="below:80">完整度低于 80%</option>
              </select>
            </div>
            <button class="btn" type="submit">筛选</button>
            <button class="btn btn-ghost" type="button" id="f-reset">重置</button>
          </form>
        </div>
      </div>

      <div class="card mt-16">
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>姓名</th><th>世代 / 支系</th><th>性别</th>
                <th>生卒</th><th>出生地</th><th>职业</th><th>状态</th>
              </tr>
            </thead>
            <tbody id="people-body">
              <tr><td colspan="7"><div class="empty">正在载入…</div></td></tr>
            </tbody>
          </table>
        </div>
        <div class="pager" id="people-pager" hidden>
          <span id="pager-info"></span>
          <div class="spacer"></div>
          <button class="btn btn-sm" type="button" id="prev-page">上一页</button>
          <button class="btn btn-sm" type="button" id="next-page">下一页</button>
        </div>
      </div>
    </div>`;

  const tbody = root.querySelector('#people-body');
  const pager = root.querySelector('#people-pager');
  const countEl = root.querySelector('#people-count');

  async function load() {
    // 资料质量筛选走 /api/quality/search（带完整度），其他走 /api/persons（带分页）
    if (state.quality) {
      const [kind, value] = state.quality.split(':');
      const qp = new URLSearchParams();
      if (state.keyword) qp.set('keyword', state.keyword);
      if (state.branch) qp.set('branch', state.branch);
      if (state.deceased !== '') qp.set('alive', state.deceased === 'true' ? 'false' : 'true');
      if (kind === 'missing') qp.set('missing', value);
      if (kind === 'below') qp.set('incompleteBelow', value);
      try {
        const data = await api('/api/quality/search?' + qp.toString());
        countEl.textContent = `共 ${data.total} 位成员 · 资料筛选`;
        if (!data.items.length) {
          tbody.innerHTML = `<tr><td colspan="7">${emptyState('没有符合条件的成员', '录')}</td></tr>`;
          pager.hidden = true;
          return;
        }
        tbody.innerHTML = data.items.map((p) => `
          <tr class="clickable" data-id="${esc(p.id)}">
            <td>
              <div class="cell-name">${esc(p.name)}</div>
              <div class="cell-sub">完整度 ${p.completeness}%</div>
            </td>
            <td>${p.gen ? `<span class="badge badge-muted">${p.gen}世</span>` : dash()} ${esc(p.branch || '')}</td>
            <td>${GENDER[p.gender] || '未知'}</td>
            <td class="nowrap">${p.birth_year ?? '?'}</td>
            <td>${p.hasSource ? badge('有来源', 'jade') : badge('缺来源', 'muted')}</td>
            <td>${p.hasParents ? '已录' : badge('未录', 'muted')}</td>
            <td>${p.is_deceased ? badge('已故', 'muted') : badge('在世', 'jade')}</td>
          </tr>`).join('');
        pager.hidden = true;
        return;
      } catch (err) {
        tbody.innerHTML = `<tr><td colspan="7"><div class="notice">${esc(err.message)}</div></td></tr>`;
        pager.hidden = true;
        return;
      }
    }

    const params = new URLSearchParams();
    if (state.keyword) params.set('keyword', state.keyword);
    if (state.gen) params.set('gen', state.gen);
    if (state.branch) params.set('branch', state.branch);
    if (state.deceased !== '') params.set('deceased', state.deceased);
    params.set('page', state.page);
    params.set('pageSize', state.pageSize);

    try {
      const data = await api('/api/persons?' + params.toString());
      countEl.textContent = `共 ${data.total} 位成员${state.keyword ? ` · 关键词「${state.keyword}」` : ''}`;
      if (!data.items.length) {
        tbody.innerHTML = `<tr><td colspan="7">${emptyState('没有符合条件的成员', '录')}</td></tr>`;
        pager.hidden = true;
        return;
      }
      tbody.innerHTML = data.items.map((p) => `
        <tr class="clickable" data-id="${esc(p.id)}">
          <td>
            <div class="cell-name">${esc(p.family_name + p.given_name)}</div>
            <div class="cell-sub">${p.courtesy_name ? '字 ' + esc(p.courtesy_name) : ''}${p.generation_name ? ' · 字辈 ' + esc(p.generation_name) : ''}</div>
          </td>
          <td>${p.generation_no ? `<span class="badge badge-muted">${p.generation_no}世</span>` : dash()} ${p.branch ? esc(p.branch) : ''}</td>
          <td>${GENDER[p.gender] || '未知'}</td>
          <td class="nowrap">${esc(fmtDate(p.birth_date) || '?')} – ${esc(fmtDate(p.death_date) || (p.is_deceased ? '?' : ''))}</td>
          <td>${esc(dash(p.birth_place))}</td>
          <td>${esc(dash(p.occupation))}</td>
          <td>${p.is_deceased ? badge('已故', 'muted') : badge('在世', 'jade')}</td>
        </tr>`).join('');

      pager.hidden = false;
      const totalPages = Math.max(1, Math.ceil(data.total / state.pageSize));
      root.querySelector('#pager-info').textContent = `第 ${state.page} / ${totalPages} 页`;
      root.querySelector('#prev-page').disabled = state.page <= 1;
      root.querySelector('#next-page').disabled = state.page >= totalPages;
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="7"><div class="notice">${esc(err.message)}</div></td></tr>`;
      pager.hidden = true;
    }
  }

  root.querySelector('#people-filters').addEventListener('submit', (e) => {
    e.preventDefault();
    state.keyword = root.querySelector('#f-keyword').value.trim();
    state.gen = root.querySelector('#f-gen').value.trim();
    state.branch = root.querySelector('#f-branch').value;
    state.deceased = root.querySelector('#f-deceased').value;
    state.quality = root.querySelector('#f-quality').value;
    state.page = 1;
    load();
  });

  root.querySelector('#f-reset').addEventListener('click', () => {
    root.querySelector('#people-filters').reset();
    Object.assign(state, { keyword: '', gen: '', branch: '', deceased: '', quality: '', page: 1 });
    load();
  });

  root.querySelector('#prev-page').addEventListener('click', () => { state.page--; load(); });
  root.querySelector('#next-page').addEventListener('click', () => { state.page++; load(); });

  tbody.addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-id]');
    if (tr) location.hash = `#/person/${tr.dataset.id}`;
  });

  await load();
}
