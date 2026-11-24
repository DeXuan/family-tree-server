/**
 * Service Worker：离线外壳 + 静态资源缓存。
 *
 * 策略（有意保守，避免"改了代码但看到旧版"）：
 * - 导航请求（HTML）：network-first，失败回退缓存的壳
 * - 静态资源（js/css/图标）：stale-while-revalidate（先用缓存，后台刷新）
 * - API 请求：**完全不缓存**（族谱数据有时效性与权限，绝不能离线下发旧数据）
 */

const VERSION = 'v3';
const SHELL_CACHE = `ft-shell-${VERSION}`;
const ASSET_CACHE = `ft-asset-${VERSION}`;

// 核心资源一起预缓存：首次访问后即可离线打开登录页
const SHELL_FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './styles.css',
  './js/app.js',
  './js/api.js',
  './js/ui.js',
  './icon-192.svg',
  './icon-512.svg',
  './js/lib/format.js',
  './js/lib/imageCompress.js',
  './js/components/personPicker.js',
  './js/components/placeMap.js',
  './js/components/tree.js',
  './js/views/admin.js',
  './js/views/dashboard.js',
  './js/views/hourglass.js',
  './js/views/insights.js',
  './js/views/login.js',
  './js/views/me.js',
  './js/views/people.js',
  './js/views/person.js',
  './js/views/personForm.js',
  './js/views/places.js',
  './js/views/print.js',
  './js/views/quality.js',
  './js/views/register.js',
  './js/views/stories.js',
  './js/views/tree.js',
];

// 把 './x' 解析成 scope 下的绝对 URL，避免缓存键与请求 URL 不一致
const resolve = (rel) => new URL(rel, self.registration.scope).href;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      // 逐个缓存：个别文件缺失不影响整体安装
      .then((cache) => Promise.all(
        SHELL_FILES.map((f) => {
          const url = resolve(f);
          return cache.add(url).catch(() => {});
        })
      ))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys
        .filter((k) => k.startsWith('ft-') && k !== SHELL_CACHE && k !== ASSET_CACHE)
        .map((k) => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // 只处理同源请求
  if (url.origin !== self.location.origin) return;
  // API 一律走网络，不缓存（数据隐私与时效）
  if (url.pathname.includes('/api/')) return;

  // 导航请求：网络优先
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL_CACHE).then((c) => c.put(resolve('./index.html'), copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(resolve('./index.html')).then((r) => r || caches.match(resolve('./'))))
    );
    return;
  }

  // 静态资源：stale-while-revalidate
  const isAsset = /\.(js|css|svg|png|jpg|jpeg|webp|woff2?|webmanifest)$/i.test(url.pathname);
  if (!isAsset) return;

  event.respondWith((async () => {
    // 预缓存的壳资源在 SHELL_CACHE，运行时资源在 ASSET_CACHE，两处都要查
    const shell = await caches.open(SHELL_CACHE);
    const asset = await caches.open(ASSET_CACHE);
    const cached = (await shell.match(request)) || (await asset.match(request));
    if (cached) {
      // 后台刷新（不阻塞返回）
      fetch(request)
        .then((res) => { if (res.ok) asset.put(request, res.clone()).catch(() => {}); })
        .catch(() => {});
      return cached;
    }
    try {
      const res = await fetch(request);
      if (res.ok) asset.put(request, res.clone()).catch(() => {});
      return res;
    } catch {
      return new Response('', { status: 504 });
    }
  })());
});

// 允许页面主动触发更新
self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});