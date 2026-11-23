import { api, session } from '../api.js';
import { esc, toast, badge, emptyState, openModal } from '../ui.js';

const MISSING_OPTIONS = [
  ['', '不限'],
  ['birth', '缺出生日期'],
  ['birth_place', '缺出生地'],
  ['parents', '缺父母'],
  ['gender', '缺性别'],
  ['generation', '缺世代/字辈'],
  ['bio', '缺生平或事件'],
  ['source', '缺来源考证'],
];

export async function renderQuality(root) {
  root.innerHTML = '<div class="content"><div class="empty">正在核查资料完整度…</div></div>';

  let overview;
  try {
    overview = await api('/api/quality/completeness');
  } catch (err) {
    root.innerHTML = `<div class="content"><div class="notice">${esc(err.message)}</div></div>`;
    return;
  }

  const canEdit = session.canEdit;
  const maxMissing = Math.max(1, ...overview.items.map((i) => i.missingCount));

  root.innerHTML = `
    <div class="content">
      <div class="page-head">
        <div>
          <h1>资料完整度</h1>
          <p class="page-sub">按姓名/性别/生卒/地点/父母/世代/生平/来源八项加权核查 · 越靠前越值得优先补录</p>
        </div>
        <div class="spacer"></div>
        ${canEdit ? '<a class="btn btn-sm" href="#/people">去名录批量维护</a>' : ''}
      </div>

      <div class="grid grid-4">
        <div class="card stat ${overview.overall >= 80 ? 'stat-jade' : overview.overall >= 60 ? '' : 'stat-accent'}">
          <span class="stat-label">整体完整度</span>
          <span class="stat-value">${overview.overall}<small class="small muted">%</small></span>
          <span class="stat-sub">${overview.totalPersons} 位成员平均</span>
        </div>
        ${overview.items.slice(0, 3).map((item) => `
          <div class="card stat">
            <span class="stat-label">缺 ${esc(item.label)}</span>
            <span class="stat-value">${item.missingCount}</span>
            <span class="stat-sub">权重 ${item.weight}</span>
          </div>`).join('')}
      </div>

      <div class="card mt-16">
        <div class="card-head"><h3>待补项分布</h3><span class="badge badge-muted">点击查看名单</span></div>
        <div class="card-body">
          ${overview.items.map((item) => `
            <button class="ql-row" type="button" data-missing="${esc(item.key)}">
              <span class="ql-label">${esc(item.label)}</span>
              <span class="ql-bar"><i data-w="${(item.missingCount / maxMissing) * 100}"></i></span>
              <span class="ql-count">${item.missingCount}</span>
            </button>`).join('')}
        </div>
      </div>

      <div class="grid grid-2 mt-16">
        <div class="card">
          <div class="card-head"><h3>最需补录</h3><span class="badge badge-muted">完整度最低</span></div>
          <div class="card-body tight">
            <div class="table-wrap">
              <table>
                <thead><tr><th>成员</th><th>完整度</th></tr></thead>
                <tbody>
                  ${overview.weakest.map((w) => `
                    <tr class="clickable" data-goto="${esc(w.id)}">
                      <td class="cell-name">${esc(w.name)}</td>
                      <td>
                        <span class="q-mini"><i data-w="${w.completeness}"></i></span>
                        <span class="small muted">${w.completeness}%</span>
                      </td>
                    </tr>`).join('')}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-head"><h3>待补名单</h3><span class="badge badge-muted" id="q-count">—</span></div>
          <div class="card-body">
            <div class="row">
              <div class="field flex-1">
                <label for="q-missing">缺少项</label>
                <select id="q-missing">
                  ${MISSING_OPTIONS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}
                </select>
              </div>
              <div class="field flex-1">
                <label for="q-threshold">完整度低于</label>
                <input id="q-threshold" type="number" min="0" max="100" value="60">
              </div>
            </div>
            <div class="btn-row mt-8">
              <button class="btn btn-sm" type="button" id="q-run">查询</button>
              <button class="btn btn-sm btn-ghost" type="button" id="q-reset">重置</button>
            </div>
            <div id="q-result" class="mt-16"><div class="empty">选择条件后查询</div></div>
          </div>
        </div>
      </div>
    </div>`;

  // 条形宽度（CSSOM，避免 CSP 拦截内联样式）
  root.querySelectorAll('[data-w]').forEach((el) => {
    const w = Number(el.dataset.w);
    if (Number.isFinite(w)) el.style.width = `${Math.max(0, Math.min(100, w))}%`;
  });

  const result = root.querySelector('#q-result');
  const countEl = root.querySelector('#q-count');

  async function runQuery(filter) {
    result.innerHTML = '<div class="empty">查询中…</div>';
    try {
      const data = await api('/api/quality/incomplete?' + new URLSearchParams(filter).toString());
      countEl.textContent = `${data.total} 人`;
      if (!data.items.length) {
        result.innerHTML = '<div class="empty">没有符合条件的成员</div>';
        return;
      }
      result.innerHTML = `
        <div class="table-wrap">
          <table>
            <thead><tr>
              ${canEdit ? '<th><input type="checkbox" id="q-all"></th>' : ''}
              <th>成员</th><th>世代</th><th>完整度</th>
            </tr></thead>
            <tbody>
              ${data.items.map((p) => `
                <tr>
                  ${canEdit ? `<td><input type="checkbox" data-pick="${esc(p.id)}"></td>` : ''}
                  <td><a href="#/person/${esc(p.id)}">${esc(p.name)}</a></td>
                  <td>${p.gen ?? '—'}</td>
                  <td><span class="small muted">${p.completeness}%</span></td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
        ${canEdit ? `<div class="btn-row mt-16">
          <button class="btn btn-sm btn-primary" type="button" id="q-bulk">批量设置所选成员</button>
          <span class="small muted" id="q-picked">已选 0 人</span>
        </div>` : ''}`;

      const picked = () => [...result.querySelectorAll('[data-pick]:checked')].map((el) => el.dataset.pick);
      const all = result.querySelector('#q-all');
      const pickedLabel = result.querySelector('#q-picked');
      const syncPicked = () => {
        if (pickedLabel) pickedLabel.textContent = `已选 ${picked().length} 人`;
      };
      all?.addEventListener('change', () => {
        result.querySelectorAll('[data-pick]').forEach((el) => { el.checked = all.checked; });
        syncPicked();
      });
      result.querySelectorAll('[data-pick]').forEach((el) => el.addEventListener('change', syncPicked));

      result.querySelector('#q-bulk')?.addEventListener('click', () => {
        const ids = picked();
        if (!ids.length) { toast('请先勾选成员', 'error'); return; }
        bulkDialog(ids, () => runQuery(filter));
      });
    } catch (err) {
      result.innerHTML = `<div class="notice">${esc(err.message)}</div>`;
    }
  }

  root.querySelectorAll('[data-missing]').forEach((btn) => {
    btn.addEventListener('click', () => {
      root.querySelector('#q-missing').value = btn.dataset.missing;
      runQuery({ missing: btn.dataset.missing });
    });
  });

  root.querySelector('#q-run').addEventListener('click', () => {
    const missing = root.querySelector('#q-missing').value;
    const threshold = root.querySelector('#q-threshold').value;
    const filter = {};
    if (missing) filter.missing = missing;
    if (threshold !== '' && Number(threshold) > 0) filter.incompleteBelow = threshold;
    runQuery(filter);
  });

  root.querySelector('#q-reset').addEventListener('click', () => {
    root.querySelector('#q-missing').value = '';
    root.querySelector('#q-threshold').value = '60';
    result.innerHTML = '<div class="empty">选择条件后查询</div>';
    countEl.textContent = '—';
  });

  root.querySelectorAll('[data-goto]').forEach((row) => {
    row.addEventListener('click', () => { location.hash = `#/person/${row.dataset.goto}`; });
  });
}

/** 批量修改支系/世代/字辈（Ancestris 类批量维护） */
function bulkDialog(ids, onDone) {
  const m = openModal({
    title: `批量修改 ${ids.length} 位成员`,
    body: `
      <p class="small muted">只改填写了的项；留空表示不修改。</p>
      <div class="stack-8 mt-8">
        <div class="field"><label for="bk-branch">支系</label><input id="bk-branch" placeholder="如：长房"></div>
        <div class="row">
          <div class="field flex-1"><label for="bk-genno">世代</label><input id="bk-genno" type="number" min="0" max="100" placeholder="如：3"></div>
          <div class="field flex-1"><label for="bk-genname">字辈</label><input id="bk-genname" placeholder="如：建"></div>
        </div>
        <div id="bk-error" hidden></div>
      </div>`,
    footer: `<button class="btn" type="button" data-act="cancel">取消</button>
             <button class="btn btn-primary" type="button" data-act="ok">确认修改</button>`,
  });
  const errBox = m.el.querySelector('#bk-error');
  m.el.querySelector('[data-act="cancel"]').addEventListener('click', () => m.close());
  m.el.querySelector('[data-act="ok"]').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const set = {};
    const branch = m.el.querySelector('#bk-branch').value.trim();
    const genno = m.el.querySelector('#bk-genno').value;
    const genname = m.el.querySelector('#bk-genname').value.trim();
    if (branch) set.branch = branch;
    if (genno !== '') set.generation_no = Number(genno);
    if (genname) set.generation_name = genname;
    if (!Object.keys(set).length) {
      errBox.hidden = false;
      errBox.className = 'form-error';
      errBox.textContent = '请至少填写一项';
      return;
    }
    btn.disabled = true;
    try {
      const res = await api('/api/quality/bulk-update', {
        method: 'POST', body: { personIds: ids, set },
      });
      m.close();
      toast(`已更新 ${res.updated} 位成员`, 'ok');
      onDone?.();
    } catch (err) {
      errBox.hidden = false;
      errBox.className = 'form-error';
      errBox.textContent = err.message;
      btn.disabled = false;
    }
  });
}