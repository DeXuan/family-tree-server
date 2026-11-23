// 统一 HTTP 客户端：令牌注入、401 处理、错误归一化

/**
 * 部署基址：反向代理到子路径时（如 /web/family-tree/）通过 <meta name="app-base"> 指定。
 * 默认空字符串 = 站点根，行为与本地开发一致。
 */
export const APP_BASE = (() => {
  const meta = document.querySelector('meta[name="app-base"]');
  const raw = meta?.getAttribute('content') || '';
  if (!raw) return '';
  return raw.endsWith('/') ? raw.slice(0, -1) : raw;
})();

/** 把站内绝对路径（/api/...）转换为带基址的路径 */
export function withBase(path) {
  if (!path || !path.startsWith('/')) return path;
  return APP_BASE + path;
}

const TOKEN_KEY = 'ft_token';
const USER_KEY = 'ft_user';

export const session = {
  get token() { return localStorage.getItem(TOKEN_KEY) || ''; },
  get user() {
    try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); } catch { return null; }
  },
  set(token, user) {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
  },
  clear() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  },
  get isAdmin() { return this.user?.role === 'admin'; },
  get canEdit() { return ['admin', 'editor'].includes(this.user?.role); },
};

export class ApiError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

export async function api(path, { method = 'GET', body, form, raw = false } = {}) {
  const headers = {};
  if (session.token) headers.Authorization = `Bearer ${session.token}`;
  if (body && !form) headers['Content-Type'] = 'application/json';

  const res = await fetch(withBase(path), {
    method,
    headers,
    body: form ? form : body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401 && session.token) {
    session.clear();
    location.hash = '#/login';
    throw new ApiError('登录已过期，请重新登录', 401);
  }

  if (raw) {
    if (!res.ok) throw new ApiError('请求失败', res.status);
    return res;
  }

  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('json') ? await res.json() : await res.text();
  if (!res.ok) throw new ApiError(data?.error || `请求失败（${res.status}）`, res.status);
  return data;
}

/** 带认证下载文件 */
export async function download(path, filename) {
  const res = await fetch(withBase(path), { headers: { Authorization: `Bearer ${session.token}` } });
  if (!res.ok) {
    let msg = '下载失败';
    try { msg = (await res.json()).error || msg; } catch { /* ignore */ }
    throw new ApiError(msg, res.status);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
