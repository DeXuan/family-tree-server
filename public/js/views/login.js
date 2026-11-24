import { api, session } from '../api.js';
import { esc } from '../ui.js';

export function renderLogin(root) {
  root.innerHTML = `
    <div class="login-wrap">
      <div class="login-card">
        <div class="login-brand">
          <div class="brand-mark">祖</div>
          <h1>家族族谱</h1>
          <p>成 员 · 世 系 · 记 忆</p>
        </div>
        <form class="login-form" id="login-form">
          <div class="field">
            <label for="username">用户名</label>
            <input id="username" name="username" type="text" autocomplete="username" required autofocus>
          </div>
          <div class="field">
            <label for="password">密码</label>
            <input id="password" name="password" type="password" autocomplete="current-password" required>
          </div>
          <div id="login-error" hidden></div>
          <button class="btn btn-primary" type="submit" id="login-submit">登录</button>
        </form>
        <div id="twofa-step" hidden>
          <p class="small muted">请输入验证器中的 6 位验证码；如无法获取，可使用恢复码（XXXX-XXXX-XXXX）。</p>
          <form class="login-form" id="twofa-form">
            <div class="field">
              <label for="twofa-code">验证码 / 恢复码</label>
              <input id="twofa-code" name="code" type="text" autocomplete="one-time-code" required>
            </div>
            <div id="twofa-error" hidden></div>
            <button class="btn btn-primary" type="submit" id="twofa-submit">验证并登录</button>
          </form>
          <button class="btn btn-ghost btn-sm mt-8" type="button" id="twofa-back">返回</button>
        </div>
        <div class="login-hint">
          演示账户：<code>admin</code> / <code>admin123</code><br>
          首次部署后请立即修改密码
        </div>
      </div>
    </div>`;

  const form = root.querySelector('#login-form');
  const errorBox = root.querySelector('#login-error');
  const submit = root.querySelector('#login-submit');
  const twofaBox = root.querySelector('#twofa-step');
  const twofaForm = root.querySelector('#twofa-form');
  const twofaErr = root.querySelector('#twofa-error');
  let challengeToken = null;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorBox.hidden = true;
    submit.disabled = true;
    submit.textContent = '登录中…';
    try {
      const data = await api('/api/auth/login', {
        method: 'POST',
        body: { username: form.username.value.trim(), password: form.password.value },
      });
      if (data.twoFactorRequired) {
        challengeToken = data.challengeToken;
        form.hidden = true;
        twofaBox.hidden = false;
        root.querySelector('#twofa-code').focus();
        return;
      }
      session.set(data.token, data.user);
      // 多家族：记住可访问家族，首个作为默认当前家族
      if (data.families?.length) {
        session.setFamilies(data.families);
        session.setFamilyId(data.families[0].id);
      }
      if (location.hash === '#/login' || !location.hash) location.hash = '#/';
      else location.reload();
    } catch (err) {
      errorBox.hidden = false;
      errorBox.className = 'form-error';
      errorBox.textContent = err.message;
      form.password.value = '';
      form.password.focus();
      submit.disabled = false;
      submit.textContent = '登录';
    }
  });

  twofaForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    twofaErr.hidden = true;
    const btn = root.querySelector('#twofa-submit');
    btn.disabled = true;
    btn.textContent = '验证中…';
    try {
      const data = await api('/api/auth/login/2fa', {
        method: 'POST',
        body: { challengeToken, code: twofaForm.code.value.trim() },
      });
      session.set(data.token, data.user);
      // 多家族：记住可访问家族，首个作为默认当前家族
      if (data.families?.length) {
        session.setFamilies(data.families);
        session.setFamilyId(data.families[0].id);
      }
      location.hash = '#/';
    } catch (err) {
      twofaErr.hidden = false;
      twofaErr.className = 'form-error';
      twofaErr.textContent = err.message;
      twofaForm.code.value = '';
      btn.disabled = false;
      btn.textContent = '验证并登录';
    }
  });

  root.querySelector('#twofa-back').addEventListener('click', () => {
    challengeToken = null;
    twofaBox.hidden = true;
    form.hidden = false;
    twofaForm.code.value = '';
    submit.disabled = false;
    submit.textContent = '登录';
  });
}
