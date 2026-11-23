import { api, session } from '../api.js';
import { esc } from '../ui.js';

const ROLE_LABEL = { admin: '家族管理员', editor: '谱系编辑', member: '族人', guest: '受限访客' };

export async function renderRegister(root, params) {
  const token = params.get('token') || '';

  root.innerHTML = `
    <div class="login-wrap">
      <div class="login-card">
        <div class="login-brand">
          <div class="brand-mark">祖</div>
          <h1>加入族谱</h1>
          <p>凭 邀 请 注 册</p>
        </div>
        <div id="register-body"><div class="empty">正在校验邀请…</div></div>
        <div class="login-hint">
          已有账户？<a href="#/login">返回登录</a>
        </div>
      </div>
    </div>`;

  const body = root.querySelector('#register-body');

  if (!token) {
    body.innerHTML = '<div class="notice">缺少邀请码。请使用管理员发来的邀请链接打开本页。</div>';
    return;
  }

  let invite;
  try {
    invite = await api(`/api/invitations/${encodeURIComponent(token)}`);
  } catch (err) {
    body.innerHTML = `<div class="notice">${esc(err.message)}</div>`;
    return;
  }

  body.innerHTML = `
    <div class="notice notice-info">
      邀请有效：将以「${esc(ROLE_LABEL[invite.role] || invite.role)}」身份加入
      ${invite.targetName ? `，并绑定成员「${esc(invite.targetName)}」` : ''}
    </div>
    <form class="login-form mt-16" id="register-form">
      <div class="field">
        <label for="reg-username">用户名</label>
        <input id="reg-username" type="text" autocomplete="username" required autofocus
               placeholder="3–32 位字母、数字或 . _ @ -">
      </div>
      <div class="field">
        <label for="reg-password">密码</label>
        <input id="reg-password" type="password" autocomplete="new-password" required>
        <span class="hint">至少 8 位</span>
      </div>
      <div class="field">
        <label for="reg-password2">确认密码</label>
        <input id="reg-password2" type="password" autocomplete="new-password" required>
      </div>
      <div id="reg-error" hidden></div>
      <button class="btn btn-primary" type="submit" id="reg-submit">注册并进入</button>
    </form>`;

  const form = root.querySelector('#register-form');
  const errorBox = root.querySelector('#reg-error');
  const submit = root.querySelector('#reg-submit');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorBox.hidden = true;
    const username = form.querySelector('#reg-username').value.trim();
    const pw = form.querySelector('#reg-password').value;
    const pw2 = form.querySelector('#reg-password2').value;
    if (pw !== pw2) {
      errorBox.hidden = false;
      errorBox.className = 'form-error';
      errorBox.textContent = '两次输入的密码不一致';
      return;
    }
    submit.disabled = true;
    submit.textContent = '注册中…';
    try {
      const data = await api('/api/auth/register', {
        method: 'POST',
        body: { token, username, password: pw },
      });
      session.set(data.token, data.user);
      location.hash = '#/';
    } catch (err) {
      errorBox.hidden = false;
      errorBox.className = 'form-error';
      errorBox.textContent = err.message;
      submit.disabled = false;
      submit.textContent = '注册并进入';
    }
  });
}
