import { api } from '../api.js';
import { esc, toast } from '../ui.js';

/** 瓦片 URL 模板（由 renderPlaceMap 依据接口返回赋值） */
let TILE_URL_TPL = '';


/**
 * 自绘 SVG 地图（无任何外部瓦片/地图服务）。
 * 把经纬度线性投影到画布，画地点圆点与迁徙连线。
 */
export async function renderPlaceMap(container) {
  let data;
  try { data = await api('/api/places/map'); }
  catch (err) {
    container.innerHTML = `<div class="notice">${esc(err.message)}</div>`;
    return;
  }

  if (!data.places?.length) {
    container.innerHTML = '<div class="empty">地点库还没有坐标，编辑地点填入经纬度后即可在此地图显示</div>';
    return;
  }

  const W = 760;
  const H = 480;
  const PAD = 56;
  const b = data.bounds;
  const latSpan = Math.max(0.0001, b.maxLat - b.minLat);
  const lngSpan = Math.max(0.0001, b.maxLng - b.minLng);

  // 有底图时用 Web Mercator（与 XYZ 瓦片对齐）；否则线性示意投影
  const tiles = data.tiles || null;
  TILE_URL_TPL = tiles?.urlTemplate || '';
  const mercY = (lat) => {
    const clamped = Math.max(-85, Math.min(85, lat));
    return Math.log(Math.tan(Math.PI / 4 + (clamped * Math.PI) / 360));
  };
  const mercBounds = tiles && b ? {
    yMin: mercY(b.minLat), yMax: mercY(b.maxLat),
    span: Math.max(1e-6, mercY(b.maxLat) - mercY(b.minLat)),
  } : null;

  const project = (lat, lng) => {
    const x = PAD + ((lng - b.minLng) / lngSpan) * (W - PAD * 2);
    const y = mercBounds
      ? PAD + ((mercBounds.yMax - mercY(lat)) / mercBounds.span) * (H - PAD * 2)
      : PAD + ((b.maxLat - lat) / latSpan) * (H - PAD * 2);
    return { x, y };
  };

  const gridLines = [];
  for (let i = 0; i <= 4; i++) {
    const gy = PAD + (i / 4) * (H - PAD * 2);
    gridLines.push(`<line x1="${PAD}" y1="${gy}" x2="${W - PAD}" y2="${gy}" stroke="#e3ddd1" stroke-width="1"/>`);
    const gx = PAD + (i / 4) * (W - PAD * 2);
    gridLines.push(`<line x1="${gx}" y1="${PAD}" x2="${gx}" y2="${H - PAD}" stroke="#e3ddd1" stroke-width="1"/>`);
  }

  const placeById = new Map(data.places.map((p) => [p.id, p]));
  const arrows = (data.migrations || []).map((m) => {
    if (!m.from || !m.to) return '';
    const a = project(m.from.lat, m.from.lng);
    const c = project(m.to.lat, m.to.lng);
    const midX = (a.x + c.x) / 2;
    const midY = (a.y + c.y) / 2 - 18;
    return `<path d="M ${a.x} ${a.y} Q ${midX} ${midY} ${c.x} ${c.y}"
              fill="none" stroke="#9c3d2e" stroke-width="1.6" stroke-dasharray="5 3" opacity="0.75">
              <title>${esc(m.personName)}${m.year ? ` · ${m.year}` : ''}：${esc(m.from.name)} → ${esc(m.to.name)}</title>
            </path>`;
  }).join('');

  const dots = data.places.map((p) => {
    const { x, y } = project(p.lat, p.lng);
    return `<g>
      <circle cx="${x}" cy="${y}" r="9" fill="#9c3d2e" fill-opacity="0.14"/>
      <circle cx="${x}" cy="${y}" r="4.5" fill="#9c3d2e" stroke="#fffdf8" stroke-width="1.5"/>
      <text x="${x + 11}" y="${y + 4}" font-size="13" fill="#24211c">${esc(p.name)}</text>
    </g>`;
  }).join('');

  container.innerHTML = `
    <div class="map-wrap">
      <svg viewBox="0 0 ${W} ${H}" class="place-svg" role="img" aria-label="家族地点分布示意图">
        <rect width="${W}" height="${H}" fill="#faf8f3"/>
${tiles ? tileLayer(W, H, PAD, b, mercY) : ''}
        ${gridLines.join('\n        ')}
        ${arrows}
        ${dots}
        <text x="${PAD}" y="${H - 14}" font-size="11" fill="#8b8377">
          经度 ${b.minLng.toFixed(2)}–${b.maxLng.toFixed(2)} · 纬度 ${b.minLat.toFixed(2)}–${b.maxLat.toFixed(2)}
          （示意图，不代表真实地理比例）
        </text>
      </svg>
    </div>
    <p class="small muted mt-8">
      红点为已标注坐标的地点${data.migrations?.length ? ` · 虚线为 ${data.migrations.length} 条迁徙路径` : ''}。
      ${tiles
        ? `底图瓦片来自 ${esc(tiles.attribution || new URL(tiles.urlTemplate.split('{s}').join('a')).hostname)}（缩放 ≤${tiles.maxZoom}）`
        : '地图完全本地绘制，不请求任何外部地图服务。'}
    </p>`;
}


/**
 * 生成 XYZ 瓦片图层的 <image> 列表（Web Mercator）。
 * 只铺 PAD 区域内的瓦片，按需裁剪到 256px。
 */
function tileLayer(W, H, PAD, b, mercY) {
  const TILE = 256;
  const MAX_TILES = 60;   // 防止一次铺太多图拖慢页面
  // 选择一个合适的缩放级别：让经纬跨度落在 2–6 个瓦片内
  const lngSpan = Math.max(0.02, b.maxLng - b.minLng);
  let z = 5;
  for (let cand = 10; cand >= 1; cand--) {
    const spanTiles = (lngSpan / 360) * Math.pow(2, cand);
    if (spanTiles <= 4) { z = cand; break; }
  }

  const lngToX = (lng, zz) => ((lng + 180) / 360) * Math.pow(2, zz) * TILE;
  const latToY = (lat, zz) => {
    const m = mercY(lat);
    return ((1 - m / Math.PI) / 2) * Math.pow(2, zz) * TILE;
  };

  // 以中心为基准把瓦片坐标映射到画布
  const cLat = (b.minLat + b.maxLat) / 2;
  const cLng = (b.minLng + b.maxLng) / 2;
  const cxTile = lngToX(cLng, z);
  const cyTile = latToY(cLat, z);

  // 画布上每像素对应的瓦片像素数
  const pxPerDegLng = (W - PAD * 2) / Math.max(1e-6, b.maxLng - b.minLng);
  const pxPerTile = (360 / Math.pow(2, z)) * pxPerDegLng;   // 一块瓦片在画布上的像素宽
  if (!Number.isFinite(pxPerTile) || pxPerTile <= 0) return '';

  const halfW = (W - PAD * 2) / 2;
  const halfH = (H - PAD * 2) / 2;
  const tileHalfCount = Math.ceil(halfW / pxPerTile) + 1;
  const tileHalfCountY = Math.ceil(halfH / pxPerTile) + 1;
  const startTX = Math.floor(cxTile / TILE) - tileHalfCount;
  const startTY = Math.floor(cyTile / TILE) - tileHalfCountY;
  const endTX = Math.floor(cxTile / TILE) + tileHalfCount;
  const endTY = Math.floor(cyTile / TILE) + tileHalfCountY;

  const tileUrl = (tx, ty) => {
    // 用目前的配置模板；若含 {s} 用 a/b/c 轮换
    const subs = ['a', 'b', 'c'];
    const s = subs[Math.abs(tx + ty) % subs.length];
    return TILE_URL_TPL.split('{s}').join(s)
      .split('{z}').join(String(z))
      .split('{x}').join(String(tx))
      .split('{y}').join(String(ty));
  };

  // 无需引用外部变量：模板在渲染前由 renderPlaceMap 写入 window 作用域的常量
  const max = Math.pow(2, z);
  const out = [];
  let count = 0;
  for (let ty = startTY; ty <= endTY; ty++) {
    if (ty < 0 || ty >= max) continue;
    for (let tx = startTX; tx <= endTX; tx++) {
      const wrapped = ((tx % max) + max) % max;
      if (count++ >= MAX_TILES) return out.join('');
      const px = W / 2 + (tx * TILE - cxTile) / TILE * pxPerTile;
      const py = H / 2 + (ty * TILE - cyTile) / TILE * pxPerTile;
      out.push(`<image href="${tileUrl(wrapped, ty)}" x="${px.toFixed(1)}" y="${py.toFixed(1)}"
        width="${pxPerTile.toFixed(1)}" height="${pxPerTile.toFixed(1)}" opacity="0.85"
        preserveAspectRatio="none"/>`);
    }
  }
  return out.join('');
}
