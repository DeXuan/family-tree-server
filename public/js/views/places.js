import { api, session } from '../api.js';
import { esc, toast, openModal, confirmDialog, badge, dash } from '../ui.js';
import { renderPlaceMap } from '../components/placeMap.js';

const PLACE_KEY = 'place';

function placeModal(place, onSaved, allPlaces = []) {
  const isEdit = !!place;
  const v = (k) => esc(place?.[k] ?? '');
  const parentOptions = allPlaces
    .filter((x) => x.id !== place?.id)
    .map((x) => `<option value="${esc(x.id)}"${place?.parent_id === x.id ? ' selected' : ''}>${esc(x.name)}${x.province ? `（${esc(x.province)}）` : ''}</option>`)
    .join('');
  let submitted = false;
  const m = openModal({
    title: isEdit ? '编辑地点' : '新增地点',
    body: `
      <div class="stack-8">
        <div class="field"><label for="pl-name">地名 *</label><input id="pl-name" value="${v('name')}" placeholder="如：保定"></div>
        <div class="row">
          <div class="field flex-1"><label for="pl-prov">省/直辖市</label><input id="pl-prov" value="${v('province')}" placeholder="河北"></div>
          <div class="field flex-1"><label for="pl-city">市/县</label><input id="pl-city" value="${v('city')}" placeholder="保定"></div>
        </div>
        <div class="field"><label for="pl-alias">别名/旧称</label><input id="pl-alias" value="${esc((place?.aliases || []).join('、'))}" placeholder="多个用顿号分隔，如：保定府、河北保定"></div>
        <div class="row">
          <div class="field flex-1"><label for="pl-lat">纬度（可选）</label><input id="pl-lat" type="number" step="0.0001" value="${v('lat')}"></div>
          <div class="field flex-1"><label for="pl-lng">经度（可选）</label><input id="pl-lng" type="number" step="0.0001" value="${v('lng')}"></div>
        </div>
        <div class="field"><label for="pl-parent">上级地点（可选，用于层级）</label>
          <select id="pl-parent"><option value="">无（顶层）</option>${parentOptions}</select>
        </div>
        <div class="field"><label for="pl-note">备注</label><textarea id="pl-note">${v('note')}</textarea></div>
        <div id="pl-error" hidden></div>
      </div>`,
    footer: `<button class="btn" type="button" data-act="cancel">取消</button>
             <button class="btn btn-primary" type="button" data-act="ok">${isEdit ? '保存' : '创建'}</button>`,
    onClose: () => { if (!submitted) onSaved?.(null); },
  });

  const errBox = m.el.querySelector('#pl-error');
  m.el.querySelector('[data-act="cancel"]').addEventListener('click', () => m.close());
  m.el.querySelector('[data-act="ok"]').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    errBox.hidden = true;
    const body = {
      name: m.el.querySelector('#pl-name').value.trim(),
      province: m.el.querySelector('#pl-prov').value.trim(),
      city: m.el.querySelector('#pl-city').value.trim(),
      aliases: m.el.querySelector('#pl-alias').value.split(/[、,，;；\s]+/).map((x) => x.trim()).filter(Boolean),
      lat: m.el.querySelector('#pl-lat').value || null,
      lng: m.el.querySelector('#pl-lng').value || null,
      note: m.el.querySelector('#pl-note').value.trim(),
      parentId: m.el.querySelector('#pl-parent').value || null,
    };
    try {
      if (isEdit) await api(`/api/places/${place.id}`, { method: 'PUT', body });
      else await api('/api/places', { method: 'POST', body });
      submitted = true;
      m.close();
      onSaved?.(true);
    } catch (err) {
      errBox.hidden = false;
      errBox.className = 'form-error';
      errBox.textContent = err.message;
      btn.disabled = false;
    }
  });
}

export async function renderPlaces(root) {
  root.innerHTML = '<div class="content"><div class="empty">正在汇总地点与迁徙…</div></div>';

  let data, stats, migrations;
  try {
    [data, stats, migrations] = await Promise.all([
      api('/api/places'),
      api('/api/places/stats'),
      api('/api/places/migrations'),
    ]);
  } catch (err) {
    root.innerHTML = `<div class="content"><div class="notice">${esc(err.message)}</div></div>`;
    return;
  }

  const places = data.places || [];
  const unmatched = data.unmatched || [];
  const maxProvince = Math.max(1, ...stats.provinces.map((p) => p.count));
  const isAdmin = session.isAdmin;

  root.innerHTML = `
    <div class="content">
      <div class="page-head">
        <div>
          <h1>地点与迁徙</h1>
          <p class="page-sub">按地名归并成员分布 · 迁徙来自「迁徙」类型事件 · 离线聚合，不加载外部地图</p>
        </div>
        <div class="spacer"></div>
        ${isAdmin ? '<button class="btn btn-primary btn-sm" type="button" id="new-place">＋ 新增地点</button>' : ''}
      </div>

      <div class="grid grid-4">
        <div class="card stat">
          <span class="stat-label">地点库</span>
          <span class="stat-value">${stats.totalPlaces}</span>
          <span class="stat-sub">规范地名 + 别名匹配</span>
        </div>
        <div class="card stat stat-jade">
          <span class="stat-label">已归类成员</span>
          <span class="stat-value">${stats.coveredPersons}</span>
          <span class="stat-sub">共 ${stats.totalPersons} 位成员</span>
        </div>
        <div class="card stat">
          <span class="stat-label">未归类</span>
          <span class="stat-value">${stats.uncoveredPersons}</span>
          <span class="stat-sub">${unmatched.length} 个待收录地名</span>
        </div>
        <div class="card stat stat-accent">
          <span class="stat-label">迁徙记录</span>
          <span class="stat-value">${migrations.length}</span>
          <span class="stat-sub">来自生平事件</span>
        </div>
      </div>

      <div class="grid grid-2 mt-16">
        <div class="card">
          <div class="card-head"><h3>地理分布</h3><span class="badge badge-muted">本地绘制 · 无外部地图</span></div>
          <div class="card-body" id="place-map"><div class="empty">正在绘制地图…</div></div>
        </div>

        <div class="card">
          <div class="card-head"><h3>省份分布</h3><span class="badge badge-muted">按已归类成员</span></div>
          <div class="card-body">
            ${stats.provinces.length ? stats.provinces.map((p) => `
              <div class="ins-region">
                <span class="ins-region-name">${esc(p.province)}</span>
                <span class="ins-region-bar"><i data-w="${(p.count / maxProvince) * 100}"></i></span>
                <span class="ins-region-value">${p.count}</span>
              </div>`).join('') : '<div class="empty">还没有可归类的成员，请先在地点库建立地名</div>'}
          </div>
        </div>

        <div class="card">
          <div class="card-head"><h3>地点库</h3><span class="badge badge-muted">${places.length} 个</span></div>
          <div class="card-body tight">
            <div class="table-wrap">
              <table>
                <thead><tr><th>地名</th><th>归属</th><th>成员</th><th>别名</th>${isAdmin ? '<th>操作</th>' : ''}</tr></thead>
                <tbody>
                  ${places.length ? places.map((p) => `
                    <tr>
                      <td class="cell-name">${esc(p.name)}</td>
                      <td class="small muted">${esc([p.province, p.city].filter(Boolean).join(' · ') || '—')}</td>
                      <td>${badge(`${p.memberCount} 人`, p.memberCount ? 'jade' : 'muted')}</td>
                      <td class="small muted">${esc((p.aliases || []).join('、') || '—')}</td>
                      ${isAdmin ? `<td><div class="btn-row">
                        <button class="btn btn-sm" type="button" data-place-edit="${esc(p.id)}">编辑</button>
                        <button class="btn btn-sm" type="button" data-place-merge="${esc(p.id)}">合并…</button>
                        <button class="btn btn-sm btn-danger" type="button" data-place-del="${esc(p.id)}">删除</button>
                      </div></td>` : ''}
                    </tr>`).join('') : `<tr><td colspan="${isAdmin ? 5 : 4}">${'<div class="empty">地点库为空，先新增一个地名</div>'}</td></tr>`}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      <div class="grid grid-2 mt-16">
        <div class="card">
          <div class="card-head"><h3>迁徙路径</h3><span class="badge badge-muted">出生地 → 迁居地</span></div>
          <div class="card-body">
            ${migrations.length ? `<div class="mig-list">
              ${migrations.map((m) => `
                <div class="mig-row">
                  <a href="#/person/${esc(m.personId)}" class="mig-person">${esc(m.personName)}</a>
                  <span class="mig-from">${esc(m.from || '?')}</span>
                  <span class="mig-arrow">→</span>
                  <span class="mig-to">${esc(m.to || '?')}</span>
                  <span class="mig-year">${m.year || ''}</span>
                </div>`).join('')}
            </div>` : '<div class="empty">尚无迁徙事件。在成员档案的「生平时间线」添加类型为「迁徙」的事件即可出现在这里。</div>'}
          </div>
        </div>

        <div class="card">
          <div class="card-head"><h3>待收录地名</h3><span class="badge badge-muted">${unmatched.length} 个</span></div>
          <div class="card-body">
            ${unmatched.length ? `<div class="table-wrap">
              <table>
                <thead><tr><th>原文</th><th>出现</th>${isAdmin ? '<th>操作</th>' : ''}</tr></thead>
                <tbody>
                  ${unmatched.slice(0, 20).map((u) => `
                    <tr>
                      <td>${esc(u.name)}</td>
                      <td class="muted small">${u.count} 次</td>
                      ${isAdmin ? `<td><button class="btn btn-sm" type="button" data-place-add="${esc(u.name)}">收录</button></td>` : ''}
                    </tr>`).join('')}
                </tbody>
              </table>
            </div>` : '<div class="empty">所有填写过的地名都已归类</div>'}
          </div>
        </div>
      </div>
    </div>`;

  // 条形宽度（CSP：不用内联 style，改用 CSSOM）
  root.querySelectorAll('[data-w]').forEach((el) => {
    const w = Number(el.dataset.w);
    if (Number.isFinite(w)) el.style.width = `${Math.max(0, Math.min(100, w))}%`;
  });

  renderPlaceMap(root.querySelector('#place-map')).catch(() => {});

  const refresh = () => renderPlaces(root);
  root.querySelector('#new-place')?.addEventListener('click', () => {
    placeModal(null, (ok) => { if (ok) { toast('地点已创建', 'ok'); refresh(); } }, places);
  });
  root.querySelectorAll('[data-place-edit]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const place = places.find((p) => p.id === btn.dataset.placeEdit);
      if (place) placeModal(place, (ok) => { if (ok) { toast('地点已保存', 'ok'); refresh(); } }, places);
    });
  });
  root.querySelectorAll('[data-place-del]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const ok = await confirmDialog('删除地点只会移除归类条目，不会修改成员档案里的地名。确认删除？', { danger: true, okText: '删除' });
      if (!ok) return;
      try {
        await api(`/api/places/${btn.dataset.placeDel}`, { method: 'DELETE' });
        toast('地点已删除', 'ok');
        refresh();
      } catch (err) { toast(err.message, 'error'); }
    });
  });
  root.querySelectorAll('[data-place-merge]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const source = places.find((p) => p.id === btn.dataset.placeMerge);
      if (!source) return;
      const others = places.filter((p) => p.id !== source.id);
      if (!others.length) { toast('至少需要另一个地点才能合并', 'error'); return; }

      let submitted = false;
      const m = openModal({
        title: `合并「${source.name}」`,
        body: `
          <p class="small muted">选择保留哪一个。源地点的别名会并入保留方，其下级地点会重新挂接。</p>
          <div class="field mt-8"><label for="mg-target">保留</label>
            <select id="mg-target">
              ${others.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}${p.province ? `（${esc(p.province)}）` : ''} · ${p.memberCount} 人</option>`).join('')}
            </select>
          </div>`,
        footer: `<button class="btn" type="button" data-act="cancel">取消</button>
                 <button class="btn btn-danger" type="button" data-act="ok">合并</button>`,
        onClose: () => { if (!submitted) toast('已取消', ''); },
      });
      m.el.querySelector('[data-act="cancel"]').addEventListener('click', () => m.close());
      m.el.querySelector('[data-act="ok"]').addEventListener('click', async () => {
        try {
          const res = await api('/api/places/merge', {
            method: 'POST',
            body: { sourceId: source.id, targetId: m.el.querySelector('#mg-target').value },
          });
          submitted = true;
          m.close();
          toast(`已把「${res.mergedFrom}」并入「${res.into}」`, 'ok');
          refresh();
        } catch (err) { toast(err.message, 'error'); }
      });
    });
  });

  root.querySelectorAll('[data-place-add]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const name = btn.dataset.placeAdd;
      placeModal({ name, province: '', city: '', aliases: [], lat: '', lng: '', note: '', parent_id: null }, (ok) => {
        if (ok) { toast('已收录，成员会自动归类', 'ok'); refresh(); }
      });
    });
  });
}