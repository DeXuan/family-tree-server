import { api, session } from '../api.js';
import { esc, toast, dash, fmtDate, badge, openModal, confirmDialog } from '../ui.js';

const ROLE_LABEL = { admin: '家族管理员', editor: '谱系编辑', member: '族人', guest: '受限访客' };

const PRIVACY_FIELDS = [
  ['former_names', '曾用名'],
  ['birth_date', '出生日期'],
  ['birth_place', '出生地'],
  ['death_date', '去世日期'],
  ['death_place', '去世地'],
  ['burial_place', '安葬地'],
  ['occupation', '职业'],
  ['education', '学历 / 师承'],
  ['bio', '生平简介'],
  ['contact', '联系方式（电话/邮箱/住址）'],
];

const LEVEL_LABEL = { L1: '族内可见', L2: '仅本人与管理员', L0: '公开（百年规则）' };

export async function renderMe(root) {
  root.innerHTML = '<div class="content"><div class="empty">正在载入我的账户…</div></div>';

  let data;
  try {
    data = await api('/api/me');
  } catch (err) {
    root.innerHTML = `<div class="content"><div class="notice">${esc(err.message)}</div></div>`;
    return;
  }

  const { person, levels } = data;
  let myRequests = [];
  try { myRequests = await api('/api/change-requests/mine'); } catch { /* 忽略 */ }
  let twofa = { enabled: false, recoveryCount: 0 };
  try { twofa = await api('/api/auth/2fa/status'); } catch { /* 忽略 */ }
  const contact = person?.contact || {};
  const canSelfServe = !!person;

  root.innerHTML = `
    <div class="content">
      <div class="page-head">
        <div>
          <h1>我的账户</h1>
          <p class="page-sub">维护本人联系方式与隐私可见范围</p>
        </div>
      </div>

      <div class="grid grid-2">
        <div class="card">
          <div class="card-head"><h3>账户信息</h3></div>
          <div class="card-body">
            <div class="info-grid">
              <div class="info-item"><dt>用户名</dt><dd>${esc(data.user.username)}</dd></div>
              <div class="info-item"><dt>角色</dt><dd>${esc(ROLE_LABEL[data.user.role] || data.user.role)}</dd></div>
              <div class="info-item"><dt>绑定成员</dt><dd>
                ${person
                  ? `<a href="#/person/${esc(person.id)}">${esc(person.family_name + person.given_name)}</a>`
                  : '<span class="badge badge-muted">未绑定</span>'}
              </dd></div>
            </div>
            ${person ? '' : `<div class="notice mt-16">账户尚未绑定成员节点。绑定后即可维护本人联系方式和隐私设置，请联系家族管理员在「管理后台 → 用户与角色」中绑定。</div>`}
          </div>
        </div>

        <div class="card">
          <div class="card-head"><h3>联系方式<span class="badge badge-muted">私密</span></h3></div>
          <div class="card-body">
            ${canSelfServe ? `
              <form id="contact-form" class="stack-8">
                <div class="field"><label for="c-phone">电话</label><input id="c-phone" type="text" value="${esc(contact.phone || '')}" autocomplete="tel"></div>
                <div class="field"><label for="c-email">邮箱</label><input id="c-email" type="email" value="${esc(contact.email || '')}" autocomplete="email"></div>
                <div class="field"><label for="c-address">住址</label><input id="c-address" type="text" value="${esc(contact.address || '')}" autocomplete="street-address"></div>
                <span class="hint">默认仅本人与管理员可见；如需让族人看到，可在下方隐私设置中调整为「族内可见」。</span>
                <div class="btn-row"><button class="btn btn-primary" type="submit">保存联系方式</button></div>
              </form>`
              : '<p class="muted small">绑定成员节点后可填写本人联系方式。</p>'}
          </div>
        </div>
      </div>

      <div class="card mt-16">
        <div class="card-head">
          <h3>隐私设置</h3>
          <div class="spacer"></div>
          <span class="small muted">管理员与本人始终可见；设置只影响其他族人</span>
        </div>
        <div class="card-body">
          ${canSelfServe ? `
            <div class="table-wrap">
              <table>
                <thead><tr><th>信息项</th><th>当前生效级别</th><th>调整为</th></tr></thead>
                <tbody>
                  ${PRIVACY_FIELDS.map(([field, label]) => `
                    <tr>
                      <td>${esc(label)}</td>
                      <td class="muted small">${esc(LEVEL_LABEL[levels[field]] || dash(levels[field]))}</td>
                      <td>
                        <select data-pv-field="${esc(field)}">
                          <option value="L1"${levels[field] === 'L1' ? ' selected' : ''}>族内可见</option>
                          <option value="L2"${levels[field] !== 'L1' ? ' selected' : ''}>仅本人与管理员</option>
                        </select>
                      </td>
                    </tr>`).join('')}
                </tbody>
              </table>
            </div>
            <div class="btn-row mt-16">
              <button class="btn btn-primary" type="button" id="save-privacy">保存隐私设置</button>
            </div>
            <p class="small muted mt-8">说明：生卒年份属于公开信息，任何登录族人都能看到；将日期设为私密后，列表与档案中只显示“私密”占位。已故满百年的成员，其族内信息将按家史公开规则放宽。</p>`
            : '<p class="muted small">绑定成员节点后可设置本人隐私。</p>'}
        </div>
      </div>

      <div class="card mt-16">
        <div class="card-head">
          <h3>账号安全</h3>
          <div class="spacer"></div>
          <button class="btn btn-sm" type="button" id="me-change-pw">修改密码</button>
        </div>
        <div class="card-body">
          <div class="row-between">
            <div class="min-w-0">
              <div class="row"><strong>双因素认证（2FA）</strong>
                ${twofa.enabled ? badge('已开启', 'jade') : badge('未开启', 'muted')}
              </div>
              <div class="small muted">登录时除密码外还需验证器验证码，可防密码泄露。启用后旧令牌会立即失效。</div>
              ${twofa.enabled ? `<div class="small muted mt-8">剩余恢复码：${twofa.recoveryCount} 个</div>` : ''}
            </div>
            <div class="btn-row">
              <button class="btn btn-sm" type="button" id="me-2fa-toggle">${twofa.enabled ? '关闭' : '开启'}</button>
              ${twofa.enabled ? '<button class="btn btn-sm" type="button" id="me-2fa-recovery">重置恢复码</button>' : ''}
            </div>
          </div>
        </div>
      </div>

      ${myRequests.length ? `
      <div class="card mt-16">
        <div class="card-head"><h3>我的修改建议</h3><span class="badge badge-muted">${myRequests.length} 条</span></div>
        <div class="card-body">
          ${myRequests.map((r) => `
            <div class="row-between py-1">
              <div class="min-w-0">
                <a href="#/person/${esc(r.person_id)}">${esc(r.personName)}</a>
                <span class="small muted"> · ${esc(fmtDate(r.created_at))}</span>
                ${r.review_note ? `<div class="small muted">审核意见：${esc(r.review_note)}</div>` : ''}
              </div>
              ${r.status === 'pending' ? badge('待审核', 'amber')
                : r.status === 'approved' ? badge('已通过', 'jade') : badge('已驳回', 'danger')}
            </div>`).join('')}
        </div>
      </div>` : ''}
    </div>`;

  if (!canSelfServe) return;

  bind2fa(root, twofa);

  root.querySelector('#contact-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.currentTarget.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      await api('/api/me/profile', {
        method: 'PUT',
        body: {
          phone: root.querySelector('#c-phone').value.trim(),
          email: root.querySelector('#c-email').value.trim(),
          address: root.querySelector('#c-address').value.trim(),
        },
      });
      toast('联系方式已保存', 'ok');
    } catch (err) {
      toast(err.message, 'error');
    }
    btn.disabled = false;
  });

  root.querySelector('#save-privacy').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const overrides = {};
    root.querySelectorAll('[data-pv-field]').forEach((sel) => {
      overrides[sel.dataset.pvField] = sel.value;
    });
    btn.disabled = true;
    try {
      const res = await api('/api/me/privacy', { method: 'PUT', body: { overrides } });
      toast('隐私设置已更新', 'ok');
      // 更新"当前生效级别"列
      PRIVACY_FIELDS.forEach(([field]) => {
        const td = root.querySelector(`[data-pv-field="${field}"]`)?.closest('tr')?.children[1];
        if (td) td.textContent = LEVEL_LABEL[res.levels[field]] || res.levels[field] || '—';
      });
    } catch (err) {
      toast(err.message, 'error');
    }
    btn.disabled = false;
  });
}

function bind2fa(root, twofa) {
  const toggle = root.querySelector('#me-2fa-toggle');
  if (!toggle) return;

  toggle.addEventListener('click', async () => {
    if (twofa.enabled) {
      const ok = await confirmDialog('关闭双因素认证会降低账户安全性，确认关闭？需输入当前密码。', { danger: true, okText: '继续' });
      if (!ok) return;
      const m = openModal({
        title: '关闭双因素认证',
        body: '<div class="field"><label for="d2-pw">当前密码</label><input id="d2-pw" type="password"></div>',
        footer: `<button class="btn" type="button" data-act="cancel">取消</button>
                 <button class="btn btn-danger" type="button" data-act="ok">确认关闭</button>`,
      });
      m.el.querySelector('[data-act="cancel"]').addEventListener('click', () => m.close());
      m.el.querySelector('[data-act="ok"]').addEventListener('click', async () => {
        try {
          await api('/api/auth/2fa/disable', { method: 'POST', body: { password: m.el.querySelector('#d2-pw').value } });
          m.close(); toast('双因素认证已关闭', 'ok'); location.reload();
        } catch (err) { toast(err.message, 'error'); }
      });
      return;
    }

    try {
      const setup = await api('/api/auth/2fa/setup', { method: 'POST' });
      const m = openModal({
        title: '开启双因素认证',
        body: `
          <p class="small muted">用验证器扫描下方 URI 或手动输入密钥，再填入 6 位验证码确认。</p>
          <div class="field mt-8"><label>密钥（手动输入）</label><input id="e2-secret" readonly value="${esc(setup.secret)}"></div>
          <div class="field mt-8"><label>otpauth URI（可生成二维码）</label><textarea id="e2-uri" readonly rows="3">${esc(setup.uri)}</textarea></div>
          <div class="field mt-8"><label for="e2-code">验证器中的 6 位验证码</label><input id="e2-code" inputmode="numeric" maxlength="6" placeholder="000000"></div>
          <div id="e2-error" hidden></div>`,
        footer: `<button class="btn" type="button" data-act="cancel">取消</button>
                 <button class="btn btn-primary" type="button" data-act="ok">确认开启</button>`,
      });
      const errBox = m.el.querySelector('#e2-error');
      m.el.querySelector('[data-act="cancel"]').addEventListener('click', () => m.close());
      m.el.querySelector('[data-act="ok"]').addEventListener('click', async () => {
        try {
          const res = await api('/api/auth/2fa/enable', {
            method: 'POST', body: { code: m.el.querySelector('#e2-code').value.trim() },
          });
          m.close();
          sessionStorage.setItem('ft_recovery_codes', JSON.stringify(res.recoveryCodes));
          toast('双因素认证已开启，请保存恢复码', 'ok');
          location.reload();
        } catch (err) {
          errBox.hidden = false; errBox.className = 'form-error'; errBox.textContent = err.message;
        }
      });
    } catch (err) { toast(err.message, 'error'); }
  });

  root.querySelector('#me-2fa-recovery')?.addEventListener('click', async () => {
    const ok = await confirmDialog('重置后原恢复码全部失效，确认生成 10 个新恢复码？', { danger: true, okText: '重置' });
    if (!ok) return;
    const m = openModal({
      title: '重置恢复码',
      body: '<div class="field"><label for="r2-pw">当前密码</label><input id="r2-pw" type="password"></div>',
      footer: `<button class="btn" type="button" data-act="cancel">取消</button>
               <button class="btn btn-primary" type="button" data-act="ok">生成</button>`,
    });
    m.el.querySelector('[data-act="cancel"]').addEventListener('click', () => m.close());
    m.el.querySelector('[data-act="ok"]').addEventListener('click', async () => {
      try {
        const res = await api('/api/auth/2fa/recovery', { method: 'POST', body: { password: m.el.querySelector('#r2-pw').value } });
        m.close();
        sessionStorage.setItem('ft_recovery_codes', JSON.stringify(res.recoveryCodes));
        toast('新恢复码已生成', 'ok'); location.reload();
      } catch (err) { toast(err.message, 'error'); }
    });
  });
}

// 展示刚生成/重置的恢复码（只显示一次）
window.addEventListener('DOMContentLoaded', () => {
  const raw = sessionStorage.getItem('ft_recovery_codes');
  if (!raw) return;
  sessionStorage.removeItem('ft_recovery_codes');
  let codes = [];
  try { codes = JSON.parse(raw); } catch { return; }
  const m = openModal({
    title: '请保存恢复码',
    body: `<p class="small muted">这 10 个恢复码只显示这一次，每个只能用一次。请妥善保存，用于验证器丢失时登录。</p>
           <pre class="json-pre mt-8">${esc(codes.join(String.fromCharCode(10)))}</pre>`,
    footer: '<button class="btn btn-primary" type="button" data-act="ok">我已保存</button>',
  });
  m.el.querySelector('[data-act="ok"]').addEventListener('click', () => m.close());
});
