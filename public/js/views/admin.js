import { api, session, download } from '../api.js';
import { esc, fmtDate, toast, openModal, badge, ACTION, emptyState, confirmDialog } from '../ui.js';
import { pickPerson } from '../components/personPicker.js';

const ROLE_LABEL = { admin: '管理员', editor: '谱系编辑', member: '族人' };

export async function renderAdmin(root) {
  if (!session.isAdmin) {
    root.innerHTML = `<div class="content"><div class="notice">管理后台仅家族管理员可见。当前角色：${esc(ROLE_LABEL[session.user?.role] || '访客')}</div></div>`;
    return;
  }

  root.innerHTML = `
    <div class="content">
      <div class="page-head">
        <div>
          <h1>管理后台</h1>
          <p class="page-sub">用户与角色 · 审计日志 · 数据导入导出</p>
        </div>
      </div>

      <div class="tabs" role="tablist">
        <button class="tab active" type="button" data-tab="users">用户与角色</button>
        <button class="tab" type="button" data-tab="invitations">邀请管理</button>
        <button class="tab" type="button" data-tab="sources">来源库</button>
        <button class="tab" type="button" data-tab="pending">待审核</button>
        <button class="tab" type="button" data-tab="maintenance">成员维护</button>
        <button class="tab" type="button" data-tab="audit">审计日志</button>
        <button class="tab" type="button" data-tab="data">数据导入导出</button>
      </div>

      <div id="admin-panel"></div>
    </div>`;

  const panel = root.querySelector('#admin-panel');

  root.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      root.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === tab));
      if (tab.dataset.tab === 'users') renderUsers(panel);
      if (tab.dataset.tab === 'invitations') renderInvitations(panel);
      if (tab.dataset.tab === 'sources') renderSources(panel);
      if (tab.dataset.tab === 'pending') renderPending(panel);
      if (tab.dataset.tab === 'maintenance') renderMaintenance(panel);
      if (tab.dataset.tab === 'audit') renderAudit(panel);
      if (tab.dataset.tab === 'data') renderData(panel);
    });
  });

  await renderUsers(panel);
}

// =====================================================================
// 用户与角色
// =====================================================================
async function renderUsers(panel) {
  panel.innerHTML = '<div class="card"><div class="card-body"><div class="empty">正在载入…</div></div></div>';
  let users;
  try { users = await api('/api/admin/users'); }
  catch (err) { panel.innerHTML = `<div class="notice">${esc(err.message)}</div>`; return; }

  panel.innerHTML = `
    <div class="card">
      <div class="card-head">
        <h3>账户列表</h3>
        <div class="spacer"></div>
        <button class="btn btn-primary btn-sm" type="button" id="new-user">＋ 新建账户</button>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>用户名</th><th>绑定成员</th><th>角色</th><th>状态</th><th>创建时间</th><th>操作</th></tr></thead>
          <tbody>
            ${users.map((u) => `
              <tr>
                <td class="cell-name">${esc(u.username)}</td>
                <td>${u.family_name ? esc(u.family_name + u.given_name) : '<span class="muted">未绑定</span>'}</td>
                <td>
                  <select data-role-for="${esc(u.id)}" class="role-select">
                    ${Object.entries(ROLE_LABEL).map(([v, label]) => `<option value="${v}"${u.role === v ? ' selected' : ''}>${label}</option>`).join('')}
                  </select>
                </td>
                <td>${u.status === 'active' ? badge('正常', 'jade') : badge('停用', 'danger')}</td>
                <td class="muted small">${esc(fmtDate(u.created_at))}</td>
                <td>
                  <div class="btn-row">
                    <button class="btn btn-sm" type="button"
                      data-bind-for="${esc(u.id)}" data-bound="${u.person_id ? '1' : '0'}">
                      ${u.person_id ? '解绑' : '绑定成员'}
                    </button>
                    <button class="btn btn-sm" type="button" data-status-for="${esc(u.id)}" data-next="${u.status === 'active' ? 'disabled' : 'active'}">
                      ${u.status === 'active' ? '停用' : '启用'}
                    </button>
                    ${u.id === session.user?.id ? '' : `<button class="btn btn-sm btn-danger" type="button" data-del-user="${esc(u.id)}" data-name="${esc(u.username)}">删除</button>`}
                  </div>
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <div class="card-body">
        <p class="muted small">角色说明：管理员可管理用户、删除成员、导入导出全量数据；谱系编辑可新增/修改成员与关系；族人仅查看与提议（阶段 2 开放）。</p>
      </div>
    </div>`;

  panel.querySelectorAll('[data-role-for]').forEach((sel) => {
    sel.addEventListener('change', async () => {
      try {
        await api(`/api/admin/users/${sel.dataset.roleFor}/role`, { method: 'PUT', body: { role: sel.value } });
        toast('角色已更新', 'ok');
      } catch (err) { toast(err.message, 'error'); renderUsers(panel); }
    });
  });

  panel.querySelectorAll('[data-del-user]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const ok = await confirmDialog(`确认删除账户「${btn.dataset.name}」？该操作不可恢复，成员档案不受影响。`, { danger: true, okText: '删除' });
      if (!ok) return;
      try {
        await api(`/api/admin/users/${btn.dataset.delUser}`, { method: 'DELETE' });
        toast('账户已删除', 'ok');
        renderUsers(panel);
      } catch (err) { toast(err.message, 'error'); }
    });
  });

  panel.querySelectorAll('[data-bind-for]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const userId = btn.dataset.bindFor;
      if (btn.dataset.bound === '1') {
        const ok = await confirmDialog('确认解除该账户与成员节点的绑定？解绑后本人将无法维护资料与隐私。', { danger: true, okText: '解绑' });
        if (!ok) return;
        try {
          await api(`/api/admin/users/${userId}/person`, { method: 'PUT', body: { personId: null } });
          toast('已解除绑定', 'ok');
          renderUsers(panel);
        } catch (err) { toast(err.message, 'error'); }
        return;
      }
      const picked = await pickPerson('选择要绑定的成员');
      if (!picked) return;
      try {
        await api(`/api/admin/users/${userId}/person`, { method: 'PUT', body: { personId: picked.id } });
        toast(`已绑定到 ${picked.name}`, 'ok');
        renderUsers(panel);
      } catch (err) { toast(err.message, 'error'); }
    });
  });

  panel.querySelectorAll('[data-status-for]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await api(`/api/admin/users/${btn.dataset.statusFor}/status`, { method: 'PUT', body: { status: btn.dataset.next } });
        toast(btn.dataset.next === 'active' ? '账户已启用' : '账户已停用', 'ok');
        renderUsers(panel);
      } catch (err) { toast(err.message, 'error'); }
    });
  });

  panel.querySelector('#new-user').addEventListener('click', () => {
    const m = openModal({
      title: '新建账户',
      body: `
        <div class="stack-8">
          <div class="field"><label for="nu-username">用户名</label><input id="nu-username" type="text" autocomplete="off"></div>
          <div class="field"><label for="nu-password">初始密码</label><input id="nu-password" type="password" autocomplete="new-password"><span class="hint">至少 8 位，交付后请本人立即修改</span></div>
          <div class="field"><label for="nu-role">角色</label>
            <select id="nu-role"><option value="member">族人</option><option value="editor">谱系编辑</option><option value="admin">管理员</option></select>
          </div>
          <div id="nu-error" hidden></div>
        </div>`,
      footer: `<button class="btn" type="button" data-act="cancel">取消</button>
               <button class="btn btn-primary" type="button" data-act="ok">创建</button>`,
    });
    m.el.querySelector('[data-act="cancel"]').addEventListener('click', () => m.close());
    m.el.querySelector('[data-act="ok"]').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      const errBox = m.el.querySelector('#nu-error');
      errBox.hidden = true;
      btn.disabled = true;
      try {
        await api('/api/admin/users', {
          method: 'POST',
          body: {
            username: m.el.querySelector('#nu-username').value.trim(),
            password: m.el.querySelector('#nu-password').value,
            role: m.el.querySelector('#nu-role').value,
          },
        });
        m.close();
        toast('账户已创建', 'ok');
        renderUsers(panel);
      } catch (err) {
        errBox.hidden = false;
        errBox.className = 'form-error';
        errBox.textContent = err.message;
        btn.disabled = false;
      }
    });
  });
}

// =====================================================================
// 邀请管理
// =====================================================================
const INVITE_STATE = {
  active: ['有效', 'jade'],
  expired: ['已过期', 'muted'],
  exhausted: ['已用完', 'muted'],
  revoked: ['已撤销', 'danger'],
};

async function renderInvitations(panel) {
  panel.innerHTML = '<div class="card"><div class="card-body"><div class="empty">正在载入…</div></div></div>';
  let invites;
  try { invites = await api('/api/admin/invitations'); }
  catch (err) { panel.innerHTML = `<div class="notice">${esc(err.message)}</div>`; return; }

  panel.innerHTML = `
    <div class="card">
      <div class="card-head">
        <h3>邀请链接</h3>
        <span class="badge badge-muted">注册后自动绑定成员</span>
        <div class="spacer"></div>
        <button class="btn btn-primary btn-sm" type="button" id="new-invite">＋ 生成邀请</button>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>角色</th><th>绑定成员</th><th>使用</th><th>有效期至</th><th>状态</th><th>创建时间</th><th>操作</th></tr></thead>
          <tbody>
            ${invites.length ? invites.map((i) => {
              const [label, kind] = INVITE_STATE[i.state] || [i.state, 'muted'];
              return `<tr>
                <td>${esc(ROLE_LABEL[i.role] || i.role)}</td>
                <td>${i.target_name ? esc(i.target_name) : '<span class="muted">不绑定</span>'}</td>
                <td>${i.used_count} / ${i.max_uses}</td>
                <td class="nowrap muted small">${i.expires_at ? esc(fmtDate(i.expires_at)) : '长期'}</td>
                <td>${badge(label, kind)}</td>
                <td class="muted small nowrap">${esc(fmtDate(i.created_at))}</td>
                <td>
                  <div class="btn-row">
                    ${i.state === 'active' ? `<button class="btn btn-sm" type="button" data-copy="${esc(i.token)}">复制链接</button>` : ''}
                    ${i.state === 'active' ? `<button class="btn btn-sm btn-danger" type="button" data-revoke="${esc(i.id)}">撤销</button>` : ''}
                  </div>
                </td>
              </tr>`;
            }).join('') : `<tr><td colspan="7">${emptyState('还没有邀请，生成一个发给族人吧', '邀')}</td></tr>`}
          </tbody>
        </table>
      </div>
      <div class="card-body">
        <p class="small muted">邀请链接格式：<span class="mono">/#/register?token=…</span>。建议一人一邀请、绑定到具体成员，便于确认身份。</p>
      </div>
    </div>`;

  const buildLink = (token) => `${location.origin}/#/register?token=${encodeURIComponent(token)}`;

  panel.querySelectorAll('[data-copy]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const link = buildLink(btn.dataset.copy);
      try {
        await navigator.clipboard.writeText(link);
        toast('邀请链接已复制', 'ok');
      } catch {
        const ta = document.createElement('textarea');
        ta.value = link;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
        toast('邀请链接已复制', 'ok');
      }
    });
  });

  panel.querySelectorAll('[data-revoke]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const ok = await confirmDialog('撤销后该链接立即失效，已注册的账户不受影响。确认撤销？', { danger: true, okText: '撤销' });
      if (!ok) return;
      try {
        await api(`/api/admin/invitations/${btn.dataset.revoke}/revoke`, { method: 'POST' });
        toast('邀请已撤销', 'ok');
        renderInvitations(panel);
      } catch (err) { toast(err.message, 'error'); }
    });
  });

  panel.querySelector('#new-invite').addEventListener('click', () => {
    let target = null;
    const m = openModal({
      title: '生成邀请',
      body: `
        <div class="stack-8">
          <div class="field"><label for="inv-role">角色</label>
            <select id="inv-role">
              <option value="member">族人</option>
              <option value="editor">谱系编辑</option>
              <option value="admin">管理员</option>
            </select>
          </div>
          <div class="field">
            <label>绑定成员（可选，注册后自动关联）</label>
            <div class="row">
              <button class="btn btn-sm" type="button" id="inv-pick">选择成员</button>
              <span class="small muted" id="inv-target">未选择</span>
            </div>
          </div>
          <div class="row">
            <div class="field flex-1"><label for="inv-days">有效期（天）</label><input id="inv-days" type="number" min="1" max="90" value="7"></div>
            <div class="field flex-1"><label for="inv-uses">可使用次数</label><input id="inv-uses" type="number" min="1" max="50" value="1"></div>
          </div>
          <div id="inv-error" hidden></div>
        </div>`,
      footer: `<button class="btn" type="button" data-act="cancel">取消</button>
               <button class="btn btn-primary" type="button" data-act="ok">生成</button>`,
    });
    const errBox = m.el.querySelector('#inv-error');
    m.el.querySelector('[data-act="cancel"]').addEventListener('click', () => m.close());
    m.el.querySelector('#inv-pick').addEventListener('click', async () => {
      const picked = await pickPerson('选择要绑定的成员');
      if (!picked) return;
      target = picked;
      m.el.querySelector('#inv-target').textContent = picked.name;
    });
    m.el.querySelector('[data-act="ok"]').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      errBox.hidden = true;
      try {
        const inv = await api('/api/admin/invitations', {
          method: 'POST',
          body: {
            role: m.el.querySelector('#inv-role').value,
            targetPersonId: target?.id || null,
            expiresDays: Number(m.el.querySelector('#inv-days').value),
            maxUses: Number(m.el.querySelector('#inv-uses').value),
          },
        });
        m.close();
        toast('邀请已生成', 'ok');
        renderInvitations(panel);
        try {
          await navigator.clipboard.writeText(buildLink(inv.token));
          toast('链接已复制到剪贴板', 'ok');
        } catch { /* 忽略剪贴板权限 */ }
      } catch (err) {
        errBox.hidden = false;
        errBox.className = 'form-error';
        errBox.textContent = err.message;
        btn.disabled = false;
      }
    });
  });
}

// =====================================================================
// 来源库
// =====================================================================
function repoModal(repo, onSaved) {
  const isEdit = !!repo;
  const v = (k) => esc(repo?.[k] || '');
  let submitted = false;
  const m = openModal({
    title: isEdit ? '编辑收藏地' : '新建收藏地',
    body: `
      <div class="stack-8">
        <div class="field"><label for="repo-name">名称 *</label><input id="repo-name" value="${v('name')}" placeholder="如：上海市图书馆家谱馆"></div>
        <div class="field"><label for="repo-address">地址</label><input id="repo-address" value="${v('address')}"></div>
        <div class="field"><label for="repo-contact">联系方式</label><input id="repo-contact" value="${v('contact')}"></div>
        <div class="field"><label for="repo-note">备注</label><textarea id="repo-note">${v('note')}</textarea></div>
        <div id="repo-error" hidden></div>
      </div>`,
    footer: `<button class="btn" type="button" data-act="cancel">取消</button>
             <button class="btn btn-primary" type="button" data-act="ok">${isEdit ? '保存' : '创建'}</button>`,
    onClose: () => { if (!submitted) onSaved?.(null); },
  });
  const errBox = m.el.querySelector('#repo-error');
  m.el.querySelector('[data-act="cancel"]').addEventListener('click', () => m.close());
  m.el.querySelector('[data-act="ok"]').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    errBox.hidden = true;
    const body = {
      name: m.el.querySelector('#repo-name').value.trim(),
      address: m.el.querySelector('#repo-address').value.trim(),
      contact: m.el.querySelector('#repo-contact').value.trim(),
      note: m.el.querySelector('#repo-note').value.trim(),
    };
    btn.disabled = true;
    try {
      if (isEdit) await api(`/api/repositories/${repo.id}`, { method: 'PUT', body });
      else await api('/api/repositories', { method: 'POST', body });
      submitted = true; m.close(); onSaved?.(true);
    } catch (err) {
      errBox.hidden = false; errBox.className = 'form-error'; errBox.textContent = err.message;
      btn.disabled = false;
    }
  });
}


async function sourceModal(source, onSaved) {
  const isEdit = !!source;
  let repos = [];
  try { repos = await api('/api/repositories'); } catch { repos = []; }
  const v = (k) => esc(source?.[k] || '');
  let submitted = false;
  const m = openModal({
    title: isEdit ? '编辑来源' : '新建来源',
    body: `
      <div class="stack-8">
        <div class="field"><label for="src-title">标题 *</label><input id="src-title" value="${v('title')}" placeholder="如：光绪重修王氏族谱"></div>
        <div class="row">
          <div class="field flex-1"><label for="src-author">作者/编纂者</label><input id="src-author" value="${v('author')}"></div>
          <div class="field flex-1"><label for="src-publication">出版/形成信息</label><input id="src-publication" value="${v('publication')}"></div>
        </div>
        <div class="field">
          <label for="src-repository-id">收藏地/档案馆</label>
          <select id="src-repository-id">
            <option value="">（不关联实体）</option>
            ${repos.map((r) => `<option value="${esc(r.id)}" ${source?.repository_id === r.id ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}
          </select>
        </div>
        <div class="field"><label for="src-repository">收藏地文本（可选，关联实体时自动填充）</label><input id="src-repository" value="${v('repository')}"></div>
        <div class="field"><label for="src-note">备注</label><textarea id="src-note">${v('note')}</textarea></div>
        <div id="src-error" hidden></div>
      </div>`,
    footer: `<button class="btn" type="button" data-act="cancel">取消</button>
             <button class="btn btn-primary" type="button" data-act="ok">${isEdit ? '保存' : '创建'}</button>`,
    onClose: () => { if (!submitted) onSaved?.(null); },
  });
  const errBox = m.el.querySelector('#src-error');
  m.el.querySelector('[data-act="cancel"]').addEventListener('click', () => m.close());
  m.el.querySelector('[data-act="ok"]').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    errBox.hidden = true;
    const body = {
      title: m.el.querySelector('#src-title').value.trim(),
      author: m.el.querySelector('#src-author').value.trim(),
      publication: m.el.querySelector('#src-publication').value.trim(),
      repository: m.el.querySelector('#src-repository').value.trim(),
      repositoryId: m.el.querySelector('#src-repository-id').value || null,
      note: m.el.querySelector('#src-note').value.trim(),
    };
    btn.disabled = true;
    try {
      if (isEdit) await api(`/api/sources/${source.id}`, { method: 'PUT', body });
      else await api('/api/sources', { method: 'POST', body });
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

async function renderSources(panel) {
  panel.innerHTML = '<div class="card"><div class="card-body"><div class="empty">正在载入…</div></div></div>';
  let rows, repos;
  try { [rows, repos] = await Promise.all([api('/api/sources'), api('/api/repositories')]); }
  catch (err) { panel.innerHTML = `<div class="notice">${esc(err.message)}</div>`; return; }

  const refresh = () => renderSources(panel);

  panel.innerHTML = `
    <div class="card">
      <div class="card-head">
        <h3>来源库</h3>
        <span class="badge badge-muted">${rows.length} 种</span>
        <div class="spacer"></div>
        <button class="btn btn-primary btn-sm" type="button" id="new-source">＋ 新建来源</button>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>标题</th><th>作者</th><th>出版/形成</th><th>收藏地</th><th>引用</th><th>操作</th></tr></thead>
          <tbody>
            ${rows.length ? rows.map((r) => `
              <tr>
                <td class="cell-name">${esc(r.title)}</td>
                <td>${esc(r.author || '—')}</td>
                <td class="small muted">${esc(r.publication || '—')}</td>
                <td class="small muted">${esc(r.repository || '—')}</td>
                <td>${badge(`${r.citationCount || 0} 处`, 'muted')}</td>
                <td>
                  <div class="btn-row">
                    <button class="btn btn-sm" type="button" data-source-edit="${esc(r.id)}">编辑</button>
                    <button class="btn btn-sm btn-danger" type="button" data-source-del="${esc(r.id)}">删除</button>
                  </div>
                </td>
              </tr>`).join('') : `<tr><td colspan="6">${emptyState('还没有来源，先建立族谱/档案出处吧', '源')}</td></tr>`}
          </tbody>
        </table>
      </div>
      <div class="card-body">
        <p class="small muted">来源可被人物与事件引用；删除来源会级联移除其所有引文。</p>

    <div class="card mt-16">
      <div class="card-head">
        <h3>收藏地 / 档案馆</h3>
        <span class="badge badge-muted">${repos.length} 处</span>
        <div class="spacer"></div>
        <button class="btn btn-sm btn-primary" type="button" id="new-repo">＋ 新建收藏地</button>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>名称</th><th>地址</th><th>联系方式</th><th>关联来源</th><th>操作</th></tr></thead>
          <tbody>
            ${repos.length ? repos.map((r) => `
              <tr>
                <td class="cell-name">${esc(r.name)}</td>
                <td class="small muted">${esc(r.address || '—')}</td>
                <td class="small muted">${esc(r.contact || '—')}</td>
                <td>${badge(`${r.sourceCount || 0} 个`, 'muted')}</td>
                <td><div class="btn-row">
                  <button class="btn btn-sm" type="button" data-repo-edit="${esc(r.id)}">编辑</button>
                  <button class="btn btn-sm btn-danger" type="button" data-repo-del="${esc(r.id)}">删除</button>
                </div></td>
              </tr>`).join('') : `<tr><td colspan="5">${emptyState('还没有收藏地，可把档案馆、藏书楼建成可复用实体', '馆')}</td></tr>`}
          </tbody>
        </table>
      </div>
      <div class="card-body">
        <p class="small muted">收藏地可被多个来源复用；删除时若仍被引用会提示确认。</p>
      </div>
    </div>
      </div>
    </div>`;

  panel.querySelector('#new-source').addEventListener('click', () => {
    sourceModal(null, (ok) => { if (ok) { toast('来源已创建', 'ok'); refresh(); } }).catch((e) => toast(e.message, 'error'));
  });

  panel.querySelectorAll('[data-source-edit]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const row = rows.find((r) => r.id === btn.dataset.sourceEdit);
      if (row) sourceModal(row, (ok) => { if (ok) { toast('来源已保存', 'ok'); refresh(); } }).catch((e) => toast(e.message, 'error'));
    });
  });

  panel.querySelectorAll('[data-source-del]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const ok = await confirmDialog('删除来源会同时移除所有引用该来源的引文，确认删除？', { danger: true, okText: '删除' });
      if (!ok) return;
      try {
        await api(`/api/sources/${btn.dataset.sourceDel}`, { method: 'DELETE' });
        toast('来源已删除', 'ok');
        refresh();
      } catch (err) { toast(err.message, 'error'); }
    });
  });

  panel.querySelector('#new-repo')?.addEventListener('click', () => {
    repoModal(null, (ok) => { if (ok) { toast('收藏地已创建', 'ok'); refresh(); } });
  });
  panel.querySelectorAll('[data-repo-edit]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const row = repos.find((r) => r.id === btn.dataset.repoEdit);
      if (row) repoModal(row, (ok) => { if (ok) { toast('收藏地已保存', 'ok'); refresh(); } });
    });
  });
  panel.querySelectorAll('[data-repo-del]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const ok = await confirmDialog('删除收藏地会解除其与来源的关联（不删除来源）。确认删除？', { danger: true, okText: '删除' });
      if (!ok) return;
      try {
        await api(`/api/repositories/${btn.dataset.repoDel}?force=1`, { method: 'DELETE' });
        toast('收藏地已删除', 'ok'); refresh();
      } catch (err) { toast(err.message, 'error'); }
    });
  });
}

// =====================================================================
// 待审核（族人提交的修改建议）
// =====================================================================
const FIELD_LABEL = {
  family_name: '姓', given_name: '名', courtesy_name: '字/号', former_names: '曾用名',
  generation_name: '字辈', generation_no: '世代', branch: '支系', gender: '性别',
  birth_date: '出生日期', birth_precision: '出生精度', birth_place: '出生地',
  death_date: '去世日期', death_precision: '去世精度', death_place: '去世地',
  burial_place: '安葬地', is_deceased: '已故', occupation: '职业',
  education: '学历', bio: '生平',
};

function describePayload(payload) {
  return Object.entries(payload || {})
    .map(([k, v]) => `${FIELD_LABEL[k] || k}：${Array.isArray(v) ? v.join('、') : (v === null || v === '' ? '（清空）' : v)}`)
    .slice(0, 6)
    .join(' · ');
}

async function renderPending(panel) {
  panel.innerHTML = '<div class="card"><div class="card-body"><div class="empty">正在载入…</div></div></div>';
  let rows;
  try { rows = await api('/api/change-requests?status=pending'); }
  catch (err) { panel.innerHTML = `<div class="notice">${esc(err.message)}</div>`; return; }

  panel.innerHTML = `
    <div class="card">
      <div class="card-head">
        <h3>待审核的修改建议</h3>
        <span class="badge badge-muted">${rows.length} 条</span>
        <div class="spacer"></div>
        <span class="small muted">通过后立即写入族谱并记入审计</span>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>提交人</th><th>成员</th><th>建议内容</th><th>说明</th><th>时间</th><th>操作</th></tr></thead>
          <tbody>
            ${rows.length ? rows.map((r) => `
              <tr>
                <td>${esc(r.requester || '未知')}</td>
                <td><a href="#/person/${esc(r.person_id)}">${esc(r.personName)}</a></td>
                <td class="small">${esc(describePayload(r.payload))}</td>
                <td class="small muted">${esc(r.note || '—')}</td>
                <td class="small muted nowrap">${esc(fmtDate(r.created_at))}</td>
                <td>
                  <div class="btn-row">
                    <button class="btn btn-sm btn-primary" type="button" data-approve="${esc(r.id)}">通过</button>
                    <button class="btn btn-sm btn-danger" type="button" data-reject="${esc(r.id)}">驳回</button>
                  </div>
                </td>
              </tr>`).join('') : `<tr><td colspan="6">${emptyState('暂无待审核建议', '审')}</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>`;

  panel.querySelectorAll('[data-approve]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        await api(`/api/change-requests/${btn.dataset.approve}/approve`, { method: 'POST' });
        toast('已通过并应用修改', 'ok');
        renderPending(panel);
      } catch (err) {
        toast(err.message, 'error');
        btn.disabled = false;
      }
    });
  });

  panel.querySelectorAll('[data-reject]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const m = openModal({
        title: '驳回建议',
        body: `<div class="field"><label for="rej-note">驳回理由（可选，会展示给提交人）</label>
                 <textarea id="rej-note" placeholder="如：日期仍需核对族中长辈口述"></textarea></div>`,
        footer: `<button class="btn" type="button" data-act="cancel">取消</button>
                 <button class="btn btn-danger" type="button" data-act="ok">确认驳回</button>`,
      });
      m.el.querySelector('[data-act="cancel"]').addEventListener('click', () => m.close());
      m.el.querySelector('[data-act="ok"]').addEventListener('click', async () => {
        try {
          await api(`/api/change-requests/${btn.dataset.reject}/reject`, {
            method: 'POST',
            body: { note: m.el.querySelector('#rej-note').value.trim() },
          });
          m.close();
          toast('已驳回', 'ok');
          renderPending(panel);
        } catch (err) { toast(err.message, 'error'); }
      });
    });
  });
}

// =====================================================================
// 成员维护：重复检测 + 合并
// =====================================================================
async function mergeDialog(pair) {
  const a = pair.a, b = pair.b;

  // 先拉取双方完整档案，供逐字段对比取边
  let pa = {}, pb = {};
  try {
    [pa, pb] = await Promise.all([
      api(`/api/persons/${a.id}`), api(`/api/persons/${b.id}`),
    ]);
  } catch (err) {
    toast('读取成员档案失败：' + err.message, 'error');
    return;
  }

  const FIELDS = [
    ['courtesy_name', '字/号'],
    ['generation_name', '字辈'],
    ['generation_no', '世代'],
    ['branch', '支系'],
    ['gender', '性别'],
    ['birth_date', '出生日期'],
    ['birth_place', '出生地'],
    ['death_date', '去世日期'],
    ['occupation', '职业'],
    ['education', '学历'],
    ['bio', '生平'],
  ];
  const GENDER_LABEL = { male: '男', female: '女', unknown: '未知' };
  const show = (v, key) => {
    if (v === null || v === undefined || v === '') return '<span class="muted">—</span>';
    if (key === 'gender') return GENDER_LABEL[v] || esc(v);
    const text = String(v);
    return esc(text.length > 40 ? text.slice(0, 40) + '…' : text);
  };

  const rows = FIELDS.map(([key, label]) => ({
    key, label,
    va: pa[key], vb: pb[key],
    same: String(pa[key] ?? '') === String(pb[key] ?? ''),
  }));

  const m = openModal({
    title: '合并重复成员',
    body: `
      <p class="small">系统判断：${esc(pair.reason)}（相似度 ${pair.score}）</p>
      <div class="grid grid-2 mt-16">
        <div class="card"><div class="card-body">
          <strong>${esc(a.name)}</strong><div class="small muted">左侧</div>
        </div></div>
        <div class="card"><div class="card-body">
          <strong>${esc(b.name)}</strong><div class="small muted">右侧</div>
        </div></div>
      </div>
      <div class="table-wrap mt-16">
        <table>
          <thead><tr><th>字段</th><th>左侧</th><th>右侧</th><th>该字段取</th></tr></thead>
          <tbody>
            ${rows.map((r) => `
              <tr>
                <td>${esc(r.label)}</td>
                <td class="${r.same ? 'muted' : ''}">${show(r.va, r.key)}</td>
                <td class="${r.same ? 'muted' : ''}">${show(r.vb, r.key)}</td>
                <td>
                  <select data-choice="${esc(r.key)}">
                    <option value="target">保留方</option>
                    <option value="source">被合并方</option>
                  </select>
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <p class="small muted mt-16">
        关系、事件、媒体、引文与账户绑定会自动转移到保留方；此操作不可恢复，建议先备份。
      </p>`,
    footer: `<button class="btn" type="button" data-act="cancel">取消</button>
             <button class="btn" type="button" data-target="${esc(a.id)}" data-source="${esc(b.id)}">保留左侧，合并右侧</button>
             <button class="btn btn-primary" type="button" data-target="${esc(b.id)}" data-source="${esc(a.id)}">保留右侧，合并左侧</button>`,
  });
  m.el.querySelector('[data-act="cancel"]').addEventListener('click', () => m.close());

  m.el.querySelectorAll('[data-target]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      // 'target' = 取保留方的值；'source' = 取被合并方的值（后端按此语义解释）
      const fieldChoices = {};
      m.el.querySelectorAll('[data-choice]').forEach((sel) => {
        fieldChoices[sel.dataset.choice] = sel.value;
      });
      try {
        const res = await api('/api/admin/merge', {
          method: 'POST',
          body: { sourceId: btn.dataset.source, targetId: btn.dataset.target, fieldChoices },
        });
        m.close();
        toast(`已合并「${res.merged}」：关系 ${res.counts.parents + res.counts.children}、婚姻 ${res.counts.marriages}、事件 ${res.counts.events}、媒体 ${res.counts.media}`, 'ok');
        document.querySelector('[data-tab="maintenance"]')?.click();
      } catch (err) {
        toast(err.message, 'error');
        btn.disabled = false;
      }
    });
  });
}

async function renderMaintenance(panel) {
  panel.innerHTML = '<div class="card"><div class="card-body"><div class="empty">正在检测重复成员…</div></div></div>';
  let fam = { settings: {} };
  try { fam = await api('/api/admin/family-settings'); } catch { /* 非管理员忽略 */ }
  let pairs;
  try { pairs = await api('/api/admin/duplicates'); }
  catch (err) { panel.innerHTML = `<div class="notice">${esc(err.message)}</div>`; return; }

  panel.innerHTML = `
    <div class="card">
      <div class="card-head">
        <h3>家族称谓与字辈</h3>
      </div>
      <div class="card-body">
        <div class="row">
          <div class="field flex-1">
            <label for="fam-dialect">方言称谓</label>
            <select id="fam-dialect">
              <option value="standard">标准（普通话）</option>
              <option value="wu">吴语（江浙沪）</option>
              <option value="yue">粤语（广府）</option>
              <option value="minnan">闽南语</option>
              <option value="hakka">客家话</option>
              <option value="southwest">西南官话（川渝）</option>
              <option value="jiaoliao">胶辽官话（胶东）</option>
            </select>
          </div>
          <div class="field flex-1">
            <label for="fam-poem">字辈派语（逗号或空格分隔）</label>
            <input id="fam-poem" placeholder="如：守 德 建 明 一"
                   value="${esc((fam.settings?.generationPoem || []).join(' '))}">
          </div>
        </div>
        <div class="btn-row mt-16">
          <button class="btn btn-primary btn-sm" type="button" id="save-fam-settings">保存称谓设置</button>
          <button class="btn btn-sm" type="button" id="preview-dialect">查看对照表</button>
        </div>
        <p class="small muted mt-16">方言只影响称谓显示（如「父亲」显示为「阿爸」），不改动任何数据。</p>
      </div>
    </div>

    <div class="card">
      <div class="card-head">
        <h3>疑似重复成员</h3>
        <span class="badge badge-muted">${pairs.length} 组</span>
        <div class="spacer"></div>
        <span class="small muted">姓名一致且出生年相差 ≤2 年</span>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>相似度</th><th>成员 A</th><th>成员 B</th><th>判断依据</th><th>操作</th></tr></thead>
          <tbody>
            ${pairs.length ? pairs.map((p, i) => `
              <tr>
                <td><span class="badge ${p.score >= 90 ? 'badge-accent' : 'badge-muted'}">${p.score}</span></td>
                <td><a href="#/person/${esc(p.a.id)}">${esc(p.a.name)}</a>
                  <div class="cell-sub">${p.a.birthYear || '生年不详'}${p.a.gen ? ` · ${p.a.gen}世` : ''}</div></td>
                <td><a href="#/person/${esc(p.b.id)}">${esc(p.b.name)}</a>
                  <div class="cell-sub">${p.b.birthYear || '生年不详'}${p.b.gen ? ` · ${p.b.gen}世` : ''}</div></td>
                <td class="small muted">${esc(p.reason)}</td>
                <td><button class="btn btn-sm" type="button" data-merge-pair="${i}">合并…</button></td>
              </tr>`).join('') : `<tr><td colspan="5">${emptyState('没有发现疑似重复的成员', '查')}</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>`;

  panel.querySelectorAll('[data-merge-pair]').forEach((btn) => {
    btn.addEventListener('click', () => mergeDialog(pairs[Number(btn.dataset.mergePair)]));
  });

  const dialectSel = panel.querySelector('#fam-dialect');
  if (dialectSel) dialectSel.value = fam.settings?.dialect || 'standard';

  panel.querySelector('#save-fam-settings')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const poem = panel.querySelector('#fam-poem').value
        .split(/[,，\s]+/).map((x) => x.trim()).filter(Boolean);
      await api('/api/admin/family-settings', {
        method: 'PUT',
        body: { dialect: panel.querySelector('#fam-dialect').value, generationPoem: poem },
      });
      toast('称谓设置已保存', 'ok');
    } catch (err) {
      toast(err.message, 'error');
    }
    btn.disabled = false;
  });

  panel.querySelector('#preview-dialect')?.addEventListener('click', async () => {
    const d = panel.querySelector('#fam-dialect').value;
    try {
      const res = await api(`/api/tree/kinship/dialects?dialect=${encodeURIComponent(d)}`);
      const m = openModal({
        title: '方言称谓对照表',
        body: `<div class="table-wrap"><table>
                 <thead><tr><th>标准称谓</th><th>${esc(res.dialects.find((x) => x.key === d)?.label || d)}</th></tr></thead>
                 <tbody>${res.glossary.map((row) => `
                   <tr><td>${esc(row.standard)}</td>
                       <td class="${row.dialect === row.standard ? 'muted' : ''}">${esc(row.dialect)}</td></tr>`).join('')}
                 </tbody></table></div>`,
        footer: '<button class="btn btn-primary" type="button" data-act="ok">知道了</button>',
      });
      m.el.querySelector('[data-act="ok"]').addEventListener('click', () => m.close());
    } catch (err) { toast(err.message, 'error'); }
  });
}


// =====================================================================
// 审计日志
// =====================================================================
async function renderAudit(panel) {
  panel.innerHTML = `
    <div class="card">
      <div class="card-head">
        <h3>审计日志</h3>
        <div class="spacer"></div>
        <select id="audit-action">
          <option value="">全部动作</option>
          ${['create', 'update', 'delete', 'login', 'export', 'import'].map((a) => `<option value="${a}">${ACTION[a] || a}</option>`).join('')}
        </select>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>时间</th><th>操作者</th><th>动作</th><th>对象</th><th>变更摘要</th><th>操作</th></tr></thead>
          <tbody id="audit-body"><tr><td colspan="6"><div class="empty">正在载入…</div></td></tr></tbody>
        </table>
      </div>
    </div>`;

  const tbody = panel.querySelector('#audit-body');
  const sel = panel.querySelector('#audit-action');
  let auditRows = [];

  async function load() {
    try {
      const q = sel.value ? `&action=${encodeURIComponent(sel.value)}` : '';
      const rows = await api(`/api/admin/audit?pageSize=60${q}`);
      auditRows = rows;
      tbody.innerHTML = rows.length ? rows.map((r, i) => `
        <tr>
          <td class="muted small nowrap">${esc(fmtDate(r.created_at))}</td>
          <td>${esc(r.actor_label || '系统')}</td>
          <td>${badge(ACTION[r.action] || r.action, r.action === 'delete' ? 'danger' : r.action === 'create' ? 'jade' : 'muted')}</td>
          <td><span class="mono">${esc(r.entity_type)}</span></td>
          <td class="small muted">${esc(summarize(r))}</td>
          <td><button class="btn btn-sm" type="button" data-audit-detail="${i}">详情</button></td>
        </tr>`).join('') : `<tr><td colspan="6">${emptyState('暂无日志', '记')}</td></tr>`;
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="6"><div class="notice">${esc(err.message)}</div></td></tr>`;
    }
  }

  tbody.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-audit-detail]');
    if (!btn) return;
    const row = auditRows[Number(btn.dataset.auditDetail)];
    if (!row) return;
    const fmt = (v) => (v ? JSON.stringify(v, null, 2) : '—');
    const m = openModal({
      title: `变更详情 · ${ACTION[row.action] || row.action}`,
      body: `
        <p class="small muted">${esc(row.actor_label || '系统')} · ${esc(fmtDate(row.created_at))} · ${esc(row.entity_type)}</p>
        <div class="stack-8 mt-16">
          <div><div class="small muted">修改前</div><pre class="json-pre">${esc(fmt(row.before))}</pre></div>
          <div><div class="small muted">修改后</div><pre class="json-pre">${esc(fmt(row.after))}</pre></div>
        </div>`,
      footer: '<button class="btn btn-primary" type="button" data-act="ok">关闭</button>',
    });
    m.el.querySelector('[data-act="ok"]').addEventListener('click', () => m.close());
  });

  sel.addEventListener('change', load);
  await load();
}

function summarize(row) {
  const pick = row.after || row.before || {};
  const keys = ['event', 'family_name', 'given_name', 'username', 'role', 'format', 'inserted'];
  const parts = [];
  for (const k of keys) {
    if (pick[k] !== undefined && pick[k] !== null && pick[k] !== '') {
      if (k === 'inserted') parts.push(`导入 ${pick[k]} 人`);
      else if (k === 'event') parts.push(String(pick[k]));
      else parts.push(`${k}=${pick[k]}`);
    }
  }
  return parts.join(' · ') || '—';
}

// =====================================================================
// 数据导入导出
// =====================================================================
function renderData(panel) {
  panel.innerHTML = `
    <div class="grid grid-2">
      <div class="card">
        <div class="card-head"><h3>导出</h3></div>
        <div class="card-body">
          <p class="small muted">任何时刻都可完整带走数据，避免平台锁定。</p>
          <div class="btn-row mt-16">
            <button class="btn" type="button" data-export="json">全量 JSON</button>
            <button class="btn" type="button" data-export="excel">成员 Excel</button>
            <button class="btn" type="button" data-export="gedcom">GEDCOM</button>
          </div>
          <div class="divider"></div>
          <p class="small muted">GEDCOM 兼容主流家谱软件；JSON 含成员、亲子、婚姻全量结构。</p>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h3>导入</h3></div>
        <div class="card-body">
          <p class="small muted">流程：选择文件 → 解析预览（含冲突检测）→ 人工确认 → 落库。不会静默覆盖。</p>
          <div class="field mt-16">
            <label for="imp-file">选择 .xlsx / .ged / .gedcom 文件</label>
            <input id="imp-file" type="file" accept=".xlsx,.ged,.gedcom,.txt">
          </div>
          <div class="btn-row mt-16">
            <button class="btn btn-primary" type="button" id="imp-preview">解析预览</button>
          </div>
          <div id="imp-result" class="mt-16"></div>
        </div>
      </div>
    </div>

    <div class="card mt-16">
      <div class="card-head">
        <h3>口述 / 表格建谱</h3>
        <span class="badge badge-muted">先预览，确认后入库</span>
      </div>
      <div class="card-body">
        <p class="small muted">
          说一段家族往事，或粘贴「姓名/性别/出生年/父亲/母亲/配偶」表格。系统只生成草稿，
          可先核对再导入；不确定的称呼会给出提示。
        </p>
        <div class="row mt-8">
          <select id="nar-mode">
            <option value="narrative">口述文本</option>
            <option value="table">粘贴表格</option>
          </select>
          <button class="btn btn-primary btn-sm" type="button" id="nar-preview">解析预览</button>
        </div>
        <textarea id="nar-text" class="mt-8" placeholder="例：我叫王小明，1997年出生在北京。我父亲是王德明，1952年生。我母亲叫陈玉兰。我妻子是周静。我儿子叫王一诺，2021年出生。"></textarea>
        <div id="nar-result" class="mt-16"></div>
      </div>
    </div>

    <div class="card mt-16">
      <div class="card-head">
        <h3>备份快照</h3>
        <span class="badge badge-muted">含密码哈希与加密私密字段</span>
        <div class="spacer"></div>
        <button class="btn btn-primary btn-sm" type="button" id="do-backup">立即备份</button>
      </div>
      <div class="card-body">
        <p class="small muted">
          备份写入 <code>backups/</code>，包含成员、关系、事件与账户。恢复须先停止服务，再执行
          <code>node scripts/restore.js &lt;文件&gt; --yes</code>；请定期做恢复演练。
        </p>
        <div class="table-wrap mt-16" id="backup-list"><div class="empty">正在载入…</div></div>
      </div>
    </div>

    <div class="card mt-16">
      <div class="card-head">
        <h3>归档清理</h3>
        <span class="badge badge-muted" id="archived-count">…</span>
        <div class="spacer"></div>
        <button class="btn btn-danger btn-sm" type="button" id="purge-archived">永久清理归档</button>
      </div>
      <div class="card-body">
        <p class="small muted">
          归档是软删除：成员不再出现在名录与世系树中，但数据仍保留。
          永久清理会删除<strong>全部归档成员</strong>及其关系、事件、媒体原文件，不可恢复。
        </p>
      </div>
    </div>`;

  panel.querySelectorAll('[data-export]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const fmt = btn.dataset.export;
      const map = {
        json: ['/api/export/json', 'family-tree-export.json'],
        excel: ['/api/export/excel', 'family-tree.xlsx'],
        gedcom: ['/api/export/gedcom', 'family-tree.ged'],
      };
      btn.disabled = true;
      try {
        await download(...map[fmt]);
        toast('导出已开始下载', 'ok');
      } catch (err) { toast(err.message, 'error'); }
      btn.disabled = false;
    });
  });

  // ---------- 备份 ----------
  const backupList = panel.querySelector('#backup-list');

  async function loadBackups() {
    try {
      const rows = await api('/api/admin/backups');
      backupList.innerHTML = rows.length
        ? `<table>
             <thead><tr><th>文件</th><th>大小</th><th>生成时间</th><th>操作</th></tr></thead>
             <tbody>${rows.map((b) => `
               <tr>
                 <td class="mono">${esc(b.file)}</td>
                 <td class="nowrap">${(b.bytes / 1024).toFixed(1)} KB</td>
                 <td class="small muted nowrap">${esc(fmtDate(b.createdAt))}</td>
                 <td>
                   <div class="btn-row">
                     <button class="btn btn-sm" type="button" data-backup-dl="${esc(b.file)}">下载</button>
                     <button class="btn btn-sm btn-danger" type="button" data-backup-rm="${esc(b.file)}">删除</button>
                   </div>
                 </td>
               </tr>`).join('')}</tbody>
           </table>`
        : emptyState('还没有备份，建议先做一次', '备');
    } catch (err) {
      backupList.innerHTML = `<div class="notice">${esc(err.message)}</div>`;
    }
  }

  panel.querySelector('#do-backup').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = '备份中…';
    try {
      const res = await api('/api/admin/backup', { method: 'POST' });
      toast(`备份完成：${(res.bytes / 1024).toFixed(1)} KB${res.pruned ? `（清理旧备份 ${res.pruned} 份）` : ''}`, 'ok');
      await loadBackups();
    } catch (err) {
      toast(err.message, 'error');
    }
    btn.disabled = false;
    btn.textContent = '立即备份';
  });

  backupList.addEventListener('click', async (e) => {
    const dl = e.target.closest('[data-backup-dl]');
    if (dl) {
      try { await download(`/api/admin/backups/${encodeURIComponent(dl.dataset.backupDl)}`, dl.dataset.backupDl); }
      catch (err) { toast(err.message, 'error'); }
      return;
    }
    const rm = e.target.closest('[data-backup-rm]');
    if (rm) {
      const ok = await confirmDialog('确认删除该备份文件？删除后无法恢复（其他备份不受影响）。', { danger: true, okText: '删除' });
      if (!ok) return;
      try {
        await api(`/api/admin/backups/${encodeURIComponent(rm.dataset.backupRm)}`, { method: 'DELETE' });
        toast('备份已删除', 'ok');
        await loadBackups();
      } catch (err) { toast(err.message, 'error'); }
    }
  });

  loadBackups();

  // ---------- 归档清理 ----------
  const archivedCount = panel.querySelector('#archived-count');
  const purgeBtn = panel.querySelector('#purge-archived');

  async function loadArchivedCount() {
    try {
      const stats = await api('/api/stats');
      archivedCount.textContent = `${stats.archived || 0} 位归档成员`;
      purgeBtn.disabled = !(stats.archived > 0);
    } catch {
      archivedCount.textContent = '读取失败';
    }
  }

  purgeBtn.addEventListener('click', async () => {
    const ok = await confirmDialog(
      '确认永久清理全部归档成员？其关系、事件与媒体原文件都会删除，且无法恢复。建议先做一次备份。',
      { danger: true, okText: '永久清理' }
    );
    if (!ok) return;
    purgeBtn.disabled = true;
    try {
      const res = await api('/api/admin/purge-archived', { method: 'POST' });
      toast(`已清理 ${res.deletedPersons} 位归档成员、${res.deletedMedia} 个媒体文件`, 'ok');
      await loadArchivedCount();
      await loadBackups();
    } catch (err) {
      toast(err.message, 'error');
      purgeBtn.disabled = false;
    }
  });

  loadArchivedCount();

  // ---------- 口述 / 表格建谱 ----------
  const narText = panel.querySelector('#nar-text');
  const narMode = panel.querySelector('#nar-mode');
  const narResult = panel.querySelector('#nar-result');
  let narDraft = null;

  panel.querySelector('#nar-preview').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const text = narText.value.trim();
    if (!text) { toast('请先输入文本或粘贴表格', 'error'); return; }
    btn.disabled = true;
    btn.textContent = '解析中…';
    narResult.innerHTML = '';
    try {
      const draft = await api('/api/import/narrative/preview', {
        method: 'POST',
        body: { text, mode: narMode.value },
      });
      narDraft = draft;
      renderNarPreview(draft);
    } catch (err) {
      narResult.innerHTML = `<div class="notice">${esc(err.message)}</div>`;
    }
    btn.disabled = false;
    btn.textContent = '解析预览';
  });

  function renderNarPreview(draft) {
    const persons = draft.persons || [];
    const relations = draft.relations || [];
    const invalidCount = persons.filter((p) => p.invalidReason).length;

    narResult.innerHTML = `
      <div class="notice notice-info">
        识别到 ${draft.stats.persons} 人（新增 ${draft.stats.newPersons} · 已有 ${draft.stats.existing}）·
        关系 ${draft.stats.relations} 条（有效 ${draft.stats.validRelations}）
        ${invalidCount ? ` · <strong>${invalidCount} 人需先修正姓名</strong>` : ''}
      </div>
      ${(draft.warnings || []).length ? `<div class="notice mt-8">${draft.warnings.map(esc).join('<br>')}</div>` : ''}
      <div class="table-wrap mt-8">
        <table>
          <thead><tr><th>姓名</th><th>性别</th><th>出生</th><th>出生地</th><th>状态</th></tr></thead>
          <tbody>
            ${persons.map((p) => `
              <tr>
                <td class="cell-name">${esc(p.name)}</td>
                <td>${esc(p.genderLabel)}</td>
                <td>${p.birthYear || '—'}</td>
                <td>${esc(p.birthPlace || '—')}</td>
                <td>${p.invalidReason
                  ? `<span class="badge badge-danger">${esc(p.invalidReason)}</span>`
                  : p.exists ? badge('已存在，将复用', 'muted') : badge('新增', 'jade')}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
      ${relations.length ? `<div class="small mt-8"><strong>关系草稿：</strong>
        ${relations.map((r) => `${esc(r.from)} ${r.kind === 'parent' ? (r.role === 'mother' ? '→(母)' : '→(父)') : '⇄'} ${esc(r.to)}${r.valid ? '' : `（${esc(r.reason)}）`}`).join('；')}
      </div>` : ''}
      <div class="btn-row mt-16">
        <button class="btn btn-primary" type="button" id="nar-commit" ${invalidCount ? 'disabled' : ''}>确认导入 ${draft.stats.newPersons} 位新成员</button>
        <button class="btn btn-ghost" type="button" id="nar-cancel">取消</button>
      </div>`;

    narResult.querySelector('#nar-cancel').addEventListener('click', () => {
      narResult.innerHTML = '';
      narDraft = null;
    });

    const commitBtn = narResult.querySelector('#nar-commit');
    if (!commitBtn) return;
    commitBtn.addEventListener('click', async () => {
      commitBtn.disabled = true;
      commitBtn.textContent = '导入中…';
      try {
        const report = await api('/api/import/narrative/commit', {
          method: 'POST',
          body: { persons: narDraft.persons, relations: narDraft.relations },
        });
        narResult.innerHTML = `<div class="notice notice-info">
          导入完成：新增 ${report.created} 人、复用 ${report.reused} 人、
          亲子关系 ${report.parentEdges} 条、婚姻 ${report.spouseEdges} 条、跳过 ${report.skipped} 条。
          <a href="#/people">查看成员名录 →</a>
        </div>`;
        narText.value = '';
        toast('建谱草稿已导入', 'ok');
      } catch (err) {
        toast(err.message, 'error');
        commitBtn.disabled = false;
        commitBtn.textContent = '重试导入';
      }
    });
  }

  const fileInput = panel.querySelector('#imp-file');
  const result = panel.querySelector('#imp-result');

  panel.querySelector('#imp-preview').addEventListener('click', async (e) => {
    const file = fileInput.files?.[0];
    if (!file) { toast('请先选择文件', 'error'); return; }
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = '解析中…';
    result.innerHTML = '';
    try {
      const fd = new FormData();
      fd.append('file', file);
      const preview = await api('/api/import/preview', { method: 'POST', form: fd });
      result.innerHTML = `
        <div class="notice notice-info">
          解析完成：${preview.counts.persons} 位成员、${preview.counts.families} 组家庭关系
          ${preview.conflicts.length ? ` · 冲突 ${preview.conflicts.length} 条（将跳过）` : ''}
        </div>
        ${preview.warnings.length ? `<div class="notice mt-8">${preview.warnings.map(esc).join('<br>')}</div>` : ''}
        ${preview.conflicts.length ? `
          <div class="mt-8 small">
            <strong>疑似重复：</strong>
            ${preview.conflicts.slice(0, 5).map((c) => esc(c.incoming)).join('、')}${preview.conflicts.length > 5 ? ' …' : ''}
          </div>` : ''}
        <div class="table-wrap mt-8">
          <table>
            <thead><tr><th>姓名</th><th>性别</th><th>出生</th><th>支系</th></tr></thead>
            <tbody>
              ${preview.sample.map((p) => `<tr>
                <td>${esc((p.family_name || '') + (p.given_name || ''))}</td>
                <td>${p.gender === 'male' ? '男' : p.gender === 'female' ? '女' : '未知'}</td>
                <td>${esc(fmtDate(p.birth_date) || '—')}</td>
                <td>${esc(p.branch || '—')}</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
        <div class="btn-row mt-16">
          <button class="btn btn-primary" type="button" data-commit="${esc(preview.previewId)}">确认导入 ${preview.counts.persons} 位成员</button>
          <button class="btn btn-ghost" type="button" id="imp-cancel">取消</button>
        </div>`;

      result.querySelector('#imp-cancel').addEventListener('click', () => { result.innerHTML = ''; });
      result.querySelector('[data-commit]').addEventListener('click', async (ev) => {
        const commitBtn = ev.currentTarget;
        commitBtn.disabled = true;
        commitBtn.textContent = '导入中…';
        try {
          const report = await api('/api/import/commit', { method: 'POST', body: { previewId: preview.previewId } });
          result.innerHTML = `<div class="notice notice-info">
            导入完成：新增 ${report.inserted} 人、跳过 ${report.skipped} 人、建立婚姻 ${report.unionsCreated} 组、亲子关系 ${report.edgesCreated} 条。
          </div>`;
          toast('导入完成', 'ok');
          fileInput.value = '';
        } catch (err) {
          toast(err.message, 'error');
          commitBtn.disabled = false;
          commitBtn.textContent = '重试导入';
        }
      });
    } catch (err) {
      result.innerHTML = `<div class="notice">${esc(err.message)}</div>`;
    }
    btn.disabled = false;
    btn.textContent = '解析预览';
  });
}
