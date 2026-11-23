/**
 * 纯格式化与转义函数（无 DOM 依赖，可在 Node 中直接单测）。
 * ui.js 从这里转发，保持既有调用方不变。
 */

export const esc = (v) => String(v ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const CN_NUM = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];

export function cnNum(n) {
  if (!Number.isFinite(n)) return '—';
  if (n <= 10) return CN_NUM[n] ?? String(n);
  if (n < 20) return `十${CN_NUM[n - 10]}`;
  return String(n);
}

/** 日期显示：兼容 'YYYY-MM-DD' 与 ISO datetime，去掉时间部分 */
export function fmtDate(v) {
  if (!v) return '';
  const s = String(v);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : s;
}

export function fmtYear(v) {
  const d = fmtDate(v);
  return d ? d.slice(0, 4) : '';
}

/** 生卒显示：1901–1985 / 1901– / –1985 / 生卒不详 */
export function lifespan(p) {
  const b = p?.birth_year ?? fmtYear(p?.birth_date);
  const d = p?.death_year ?? fmtYear(p?.death_date);
  if (!b && !d) return '生卒不详';
  return `${b || '?'}–${d || (p?.is_deceased ? '?' : '')}`;
}

/** 头像/印章用首字：取名字最后一个字 */
export function initials(name) {
  if (!name) return '?';
  return [...name].slice(-1)[0];
}

export const dash = (v) => (v === null || v === undefined || v === '' ? '—' : v);

/** 生成"第 N 世"标签 */
export function genLabel(gen) {
  if (gen === null || gen === undefined || gen === '') return '';
  return `第${cnNum(Number(gen))}世`;
}