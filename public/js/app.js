import { session, api } from './api.js';
import { esc, openModal, toast } from './ui.js';
import { renderLogin } from './views/login.js';
import { renderDashboard } from './views/dashboard.js';
import { renderTreePage } from './views/tree.js';
import { renderPeople } from './views/people.js';
import { renderPerson } from './views/person.js';
import { renderPersonForm } from './views/personForm.js';
import { renderAdmin } from './views/admin.js';
import { renderMe } from './views/me.js';
import { renderRegister } from './views/register.js';
import { renderHourglass } from './views/hourglass.js';
import { renderInsights } from './views/insights.js';
import { renderPlaces } from './views/places.js';
import { renderQuality } from './views/quality.js';
import { renderPrint } from './views/print.js';
import { renderStories, renderStory } from './views/stories.js';

const root = document.getElementById('app');
let navSeq = 0;
let familyName = sessionStorage.getItem('ft_family') || '家族族谱';

async function ensureFamilyName() {
  if (sessionStorage.getItem('ft_family')) return;
  try {
    const s = await api('/api/stats');
    familyName = s.familyName || familyName;
    sessionStorage.setItem('ft_family', familyName);
  } catch { /* 忽略 */ }
}

const ROLE_LABEL = { admin: '管理员', editor: '谱系编辑', member: '族人', guest: '访客' };

const NAV = [
  { path: '/', label: '家族概览', icon: '◉' },
  { path: '/tree', label: '世系树', icon: '⌘' },
  { path: '/people', label: '成员名录', icon: '☰' },
  { path: '/insights', label: '家族洞察', icon: '◎' },
  { path: '/places', label: '地点与迁徙', icon: '⌖' },
  { path: '/quality', label: '资料完整度', icon: '✓' },
  { path: '/stories', label: '故事与回忆录', icon: '书' },
  { path: '/print', label: '打印宗谱', icon: '印' },
  { path: '/new', label: '录入成员', icon: '＋', canEdit: true },
  { path: '/me', label: '我的', icon: '人' },
  { path: '/admin', label: '管理后台', icon: '⚙', admin: true },
];

const TITLES = {
  '/': '家族概览',
  '/tree': '世系树',
  '/people': '成员名录',
  '/insights': '家族洞察',
  '/places': '地点与迁徙',
  '/quality': '资料完整度',
  '/stories': '故事与回忆录',
  '/print': '打印宗谱',
  '/new': '录入成员',
  '/me': '我的账户',
  '/admin': '管理后台',
};

function navHtml(activePath) {
  const items = NAV.filter((n) => (!n.admin || session.isAdmin) && (!n.canEdit || session.canEdit));
  return items.map((n) => {
    const active = n.path === '/' ? activePath === '/' : activePath.startsWith(n.path);
    return `<a href="#${n.path}" class="${active ? 'active' : ''}">
      <span class="nav-icon" aria-hidden="true">${n.icon}</span>${n.label}
    </a>`;
  }).join('');
}

function shell(activePath, title) {
  const user = session.user || {};
  root.innerHTML = `
    <div class="app">
      <aside class="sidebar">
        <div class="brand">
          <div class="brand-mark">祖</div>
          <div class="brand-text"><strong>${esc(familyName)}</strong><span>FAMILY ARCHIVE</span></div>
        </div>
        <nav class="nav">
          ${navHtml(activePath)}
        </nav>
        <div class="sidebar-foot">
          ${esc(ROLE_LABEL[user.role] || '')}<br>数据存于本地，可随时导出
        </div>
      </aside>
      <div class="main">
        <div class="topbar">
          <h2>${esc(title)}</h2>
          <div class="topbar-spacer"></div>
          <div class="user-chip">
            <span class="avatar">${esc((user.username || '?').slice(0, 1).toUpperCase())}</span>
            <span>${esc(user.username || '')}</span>
          </div>
          <button class="btn btn-ghost btn-sm" type="button" id="change-pw">改密</button>
          <button class="btn btn-ghost btn-sm" type="button" id="logout">退出</button>
        </div>
        <div id="view"></div>
      </div>
    </div>`;

  root.querySelector('#change-pw').addEventListener('click', () => {
    const m = openModal({
      title: '修改密码',
      body: `
        <div class="stack-8">
          <div class="field"><label for="cp-old">当前密码</label><input id="cp-old" type="password" autocomplete="current-password"></div>
          <div class="field"><label for="cp-new">新密码</label><input id="cp-new" type="password" autocomplete="new-password"><span class="hint">至少 8 位</span></div>
          <div class="field"><label for="cp-new2">确认新密码</label><input id="cp-new2" type="password" autocomplete="new-password"></div>
          <div id="cp-error" hidden></div>
        </div>`,
      footer: `<button class="btn" type="button" data-act="cancel">取消</button>
               <button class="btn btn-primary" type="button" data-act="ok">保存</button>`,
    });
    const errBox = m.el.querySelector('#cp-error');
    m.el.querySelector('[data-act="cancel"]').addEventListener('click', () => m.close());
    m.el.querySelector('[data-act="ok"]').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      const oldPw = m.el.querySelector('#cp-old').value;
      const newPw = m.el.querySelector('#cp-new').value;
      const newPw2 = m.el.querySelector('#cp-new2').value;
      errBox.hidden = true;
      if (newPw !== newPw2) {
        errBox.hidden = false;
        errBox.className = 'form-error';
        errBox.textContent = '两次输入的新密码不一致';
        return;
      }
      btn.disabled = true;
      try {
        const res = await api('/api/auth/change-password', {
          method: 'POST', body: { oldPassword: oldPw, newPassword: newPw },
        });
        // 服务端已令旧令牌失效，这里换上新令牌保持当前会话
        if (res.token) session.set(res.token, res.user);
        m.close();
        toast('密码已修改，其他设备的登录已失效', 'ok');
      } catch (err) {
        errBox.hidden = false;
        errBox.className = 'form-error';
        errBox.textContent = err.message;
        btn.disabled = false;
      }
    });
  });

  root.querySelector('#logout').addEventListener('click', async () => {
    try { await api('/api/auth/logout', { method: 'POST' }); } catch { /* 忽略 */ }
    session.clear();
    location.hash = '#/login';
  });
}

async function router() {
  const seq = ++navSeq;
  const raw = location.hash.slice(1) || '/';
  const [rawPath, rawQuery] = raw.split('?');
  const path = rawPath;
  const query = new URLSearchParams(rawQuery || '');

  window.dispatchEvent(new Event('route:leave'));
  const toastHost = document.getElementById('toast-host');
  if (toastHost) toastHost.innerHTML = '';

  if (path === '/login') {
    renderLogin(root);
    return;
  }
  if (path === '/register') {
    renderRegister(root, query);
    return;
  }
  if (!session.token) {
    location.hash = '#/login';
    return;
  }

  await ensureFamilyName();

  let title = TITLES[path] || '族谱';
  if (path.startsWith('/person/')) title = '成员档案';
  if (path.startsWith('/hourglass/')) title = '沙漏世系';
  if (path.startsWith('/story/')) title = '家族故事';

  shell(path, title);
  const view = root.querySelector('#view');
  window.scrollTo(0, 0);

  const stale = () => seq !== navSeq;

  try {
    let m;
    if (path === '/') {
      await renderDashboard(view);
    } else if (path === '/tree') {
      await renderTreePage(view);
    } else if (path === '/people') {
      await renderPeople(view);
    } else if (path === '/insights') {
      await renderInsights(view);
    } else if (path === '/places') {
      await renderPlaces(view);
    } else if (path === '/quality') {
      await renderQuality(view);
    } else if (path === '/stories') {
      await renderStories(view);
    } else if (path === '/print') {
      await renderPrint(view);
    } else if ((m = path.match(/^\/story\/([^/]+)$/))) {
      await renderStory(view, m[1]);
    } else if (path === '/new') {
      if (!session.canEdit) { view.innerHTML = notice('仅管理员或谱系编辑可录入成员'); return; }
      await renderPersonForm(view, null);
    } else if ((m = path.match(/^\/person\/([^/]+)\/edit$/))) {
      if (!session.canEdit) { view.innerHTML = notice('仅管理员或谱系编辑可编辑成员'); return; }
      await renderPersonForm(view, m[1]);
    } else if ((m = path.match(/^\/person\/([^/]+)$/))) {
      await renderPerson(view, m[1]);
    } else if ((m = path.match(/^\/hourglass\/([^/]+)$/))) {
      await renderHourglass(view, m[1]);
    } else if (path === '/me') {
      await renderMe(view);
    } else if (path === '/admin') {
      await renderAdmin(view);
    } else {
      view.innerHTML = `
        <div class="content">
          <div class="card"><div class="card-body">
            <div class="empty">
              <div class="empty-mark">谱</div>
              <p>页面不存在或已被移除</p>
              <p class="mt-16"><a class="btn btn-primary" href="#/">返回家族概览</a></p>
            </div>
          </div></div>
        </div>`;
    }
    if (stale()) return;
  } catch (err) {
    if (stale()) return;
    view.innerHTML = notice(err.message || '页面加载失败');
  }
}

function notice(text) {
  return `<div class="content"><div class="notice">${esc(text)}</div></div>`;
}

window.addEventListener('hashchange', router);
router();
