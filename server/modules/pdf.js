/**
 * 服务端原生 PDF 合成：用无头 Chrome 打开内部打印页并输出 PDF。
 *
 * 设计取舍：
 * - 不引入 Adobe/Fontkit 类大依赖，直接复用已在 CI 里装好的 Chromium；
 * - 内部页面走一次性 token（短期有效、只读、限同源），避免把管理员会话
 *   暴露给渲染进程；
 * - 无 Chromium 时不硬失败，返回 501 并让前端退回 window.print()。
 *
 * 纯逻辑（选项归一、token 生成/校验）与浏览器调用分离，便于单元测试。
 */

import crypto from 'node:crypto';
import { logger } from './logger.js';

/** A4 与常用版式预设 */
export const PDF_PRESETS = {
  a4_portrait: { format: 'A4', landscape: false, margin: '14mm 12mm' },
  a4_landscape: { format: 'A4', landscape: true, margin: '10mm 10mm' },
  a3_landscape: { format: 'A3', landscape: true, margin: '10mm' },
  letter_portrait: { format: 'Letter', landscape: false, margin: '12mm' },
};

/** 归一化打印选项；非法值退回默认，避免把任意字符串传给 Chromium */
export function normalizePdfOptions(input = {}) {
  const presetKey = PDF_PRESETS[input.preset] ? input.preset : 'a4_portrait';
  const preset = PDF_PRESETS[presetKey];
  const title = String(input.title || '族谱').trim().slice(0, 60) || '族谱';
  const scale = Number.isFinite(Number(input.scale))
    ? Math.min(2, Math.max(0.5, Number(input.scale)))
    : 1;
  const printBackground = input.printBackground !== false;
  // 只接受 1–4 个带单位的长度值，其余回退预设（防止把任意字符串传给 Chromium）
  const marginOk = typeof input.margin === 'string'
    && input.margin.length <= 30
    && /^\d+(?:\.\d+)?(?:mm|cm|in|px|pt)(?:[ ]+\d+(?:\.\d+)?(?:mm|cm|in|px|pt)){0,3}$/.test(input.margin.trim());
  const margin = marginOk ? input.margin.trim() : preset.margin;
  return {
    preset: presetKey,
    format: preset.format,
    landscape: input.landscape === undefined ? preset.landscape : !!input.landscape,
    margin,
    scale,
    printBackground,
    title,
  };
}

// ---------------------------------------------------------------------------
// 一次性渲染票据：内存表，60 秒过期，仅单次可用
// ---------------------------------------------------------------------------
const TICKET_TTL_MS = 60 * 1000;
const tickets = new Map();  // token -> { userId, familyId, path, expiresAt, used }

export function issueTicket({ userId, familyId, path }) {
  const token = crypto.randomBytes(24).toString('base64url');
  const now = Date.now();
  // 顺手清理过期票据，避免长跑进程内存缓慢增长
  for (const [k, v] of tickets) {
    if (v.expiresAt <= now || v.used) tickets.delete(k);
  }
  tickets.set(token, {
    userId, familyId, path: String(path || '/'), expiresAt: now + TICKET_TTL_MS, used: false,
  });
  return { token, expiresIn: Math.floor(TICKET_TTL_MS / 1000) };
}

/** 校验并消费票据（一次性） */
export function consumeTicket(token) {
  const t = tickets.get(String(token || ''));
  if (!t) return { ok: false, error: '票据无效' };
  if (t.used) return { ok: false, error: '票据已使用' };
  if (t.expiresAt <= Date.now()) {
    tickets.delete(String(token));
    return { ok: false, error: '票据已过期' };
  }
  t.used = true;
  tickets.delete(String(token));
  return { ok: true, ...t };
}

/** 仅供测试：清空票据表 */
export function __resetTickets() {
  tickets.clear();
}

/**
 * 用 Chromium 把 URL 渲染成 PDF。
 * @returns {Promise<Buffer>}
 */
export async function renderPdf({ url, cookieHeader = '', options = {} }) {
  const opts = normalizePdfOptions(options);
  const { chromium } = await import('playwright-core');

  const launchArgs = ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none'];
  // 允许用环境变量指定可执行文件（服务器上常见 /usr/bin/chromium-browser）
  const executablePath = process.env.CHROMIUM_PATH || undefined;

  let browser;
  try {
    browser = await chromium.launch({ args: launchArgs, executablePath });
    const context = await browser.newContext({
      viewport: { width: 1240, height: 1754 },
      deviceScaleFactor: 1,
    });
    if (cookieHeader) {
      // 把调用方的会话 cookie 带进去，内部打印页才能通过鉴权
      const cookies = cookieHeader.split(';').map((raw) => {
        const idx = raw.indexOf('=');
        const name = idx > -1 ? raw.slice(0, idx).trim() : raw.trim();
        const value = idx > -1 ? raw.slice(idx + 1).trim() : '';
        return { name, value, domain: new URL(url).hostname, path: '/' };
      }).filter((c) => c.name);
      if (cookies.length) await context.addCookies(cookies);
    }
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'networkidle', timeout: 45_000 });
    // 等打印样式与字体就绪
    await page.emulateMedia({ media: 'print' });
    await page.waitForTimeout(400);

    const pdf = await page.pdf({
      format: opts.format,
      landscape: opts.landscape,
      printBackground: opts.printBackground,
      margin: parseMargin(opts.margin),
      scale: opts.scale,
      preferCSSPageSize: false,
    });
    await context.close();
    return Buffer.from(pdf);
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

/** "14mm 12mm" → { top, right, bottom, left } */
export function parseMargin(margin) {
  const parts = String(margin || '').trim().split(/\s+/).filter(Boolean);
  const fallback = { top: '14mm', right: '12mm', bottom: '14mm', left: '12mm' };
  if (!parts.length) return fallback;
  const [a, b = a, c = a, d = b] = parts;
  const valid = (v) => /^\d+(\.\d+)?(mm|cm|in|px|pt)$/.test(v);
  return {
    top: valid(a) ? a : fallback.top,
    right: valid(b) ? b : fallback.right,
    bottom: valid(c) ? c : fallback.bottom,
    left: valid(d) ? d : fallback.left,
  };
}

/** 是否具备服务端 PDF 能力（供路由返回明确的 501 提示） */
export function pdfCapability() {
  const hasChromiumPath = !!process.env.CHROMIUM_PATH;
  return {
    available: true,  // playwright-core 已随项目安装
    executablePath: process.env.CHROMIUM_PATH || '(auto-detect)',
    note: hasChromiumPath
      ? '使用 CHROMIUM_PATH 指定的浏览器'
      : '使用 Playwright 自动探测的浏览器（需先 npx playwright install chromium）',
  };
}

export function logPdfFailure(err) {
  logger.error('[pdf] render failed:', err);
}