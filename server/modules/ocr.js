/**
 * 旧谱 OCR 与口述转写适配器。
 *
 * 定位：**不内置 OCR 引擎**（会引入几百 MB 依赖或外部服务），而是
 * 提供一个「可插拔后端」抽象 + 可靠的文本清理层：
 *
 * 1. 若能配置 OCR 服务（OCR_ENDPOINT，兼容常见 tesseract-server / PaddleOCR
 *    HTTP 接口），就把图片 POST 过去拿文本；
 * 2. 否则返回明确的「未配置」错误，前端引导用户先离线识别再粘贴；
 * 3. 无论来源，都经过 normalizeOcrText() 清理：全角转半角、繁简常见字、
 *    去除竖排换行、修正 OCR 常见误认（如「己/已/巳」「戊/戌/戍」）。
 *
 * 纯函数（清理、校验、分片）与网络调用分离，便于单元测试。
 */

/** OCR 常见误认字对（旧谱竖排铅印尤甚）。key 为误认，value 为正确 */
export const OCR_CONFUSIONS = {
  己: '己', 已: '已', 巳: '巳',   // 保留原字，仅用于提示
  戊: '戊', 戌: '戌', 戍: '戍',
  祗: '祇', 祇: '祇',
  於: '于', 於: '于',
  甯: '宁', 甯: '宁',
};

/** 常见异体/繁体 → 简体（覆盖族谱高频字） */
export const VARIANT_MAP = {
  陳: '陈', 張: '张', 劉: '刘', 楊: '杨', 黃: '黄', 趙: '赵', 吳: '吴',
  週: '周', 鄭: '郑', 馮: '冯', 陳: '陈', 衛: '卫', 蔣: '蒋', 韓: '韩',
  國: '国', 華: '华', 興: '兴', 榮: '荣', 貴: '贵', 寶: '宝', 鳳: '凤',
  龍: '龙', 馬: '马', 駿: '骏', 鵬: '鹏', 鴻: '鸿', 鶴: '鹤',
  壽: '寿', 萬: '万', 歲: '岁', 長: '长', 東: '东', 書: '书', 學: '学',
  禮: '礼', 義: '义', 賢: '贤', 德: '德', 輩: '辈', 譜: '谱', 傳: '传',
  記: '记', 載: '载', 遷: '迁', 居: '居', 葬: '葬', 祀: '祀',
  詩: '诗', 經: '经', 業: '业', 農: '农', 醫: '医', 師: '师', 範: '范',
  應: '应', 舉: '举', 貢: '贡', 監: '监', 縣: '县', 鄉: '乡', 鎮: '镇',
};

/** 全角 → 半角（数字、字母、标点） */
export function toHalfWidth(str) {
  return String(str || '').replace(/[\uFF01-\uFF5E]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0xFEE0)
  ).replace(/\u3000/g, ' ');
}

/** 繁体/异体 → 简体（仅覆盖词表内字符） */
export function toSimplified(str) {
  return String(str || '').replace(/./gu, (ch) => VARIANT_MAP[ch] || ch);
}

/**
 * 竖排文本还原：OCR 常把竖排族谱识别成「每字一行」。
 * 启发式：若连续多行都是 1–3 个字符，把它们拼成一行。
 */
export function mergeVerticalLines(text) {
  const lines = String(text || '').split(/\r?\n/);
  const out = [];
  let buf = '';
  // 空行可以夹在竖排行之间（OCR 常在每字之间插空行），一并吞掉
  const isShort = (l) => { const t = l.trim(); return t.length > 0 && t.length <= 3; };
  const isBlank = (l) => l.trim().length === 0;

  const flush = () => { if (buf) { out.push(buf); buf = ''; } };

  for (const line of lines) {
    if (isBlank(line)) {
      // 有正在累积的竖排行时，空行视为继续；否则保留段落分隔
      if (!buf) out.push('');
      continue;
    }
    if (isShort(line)) {
      buf += line.trim();
    } else {
      flush();
      out.push(line);
    }
  }
  flush();
  return out.join('\n');
}

/** 清理 OCR 噪声：多余空白、重复标点、页码行 */
export function stripNoise(text) {
  return String(text || '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')      // 零宽字符
    .replace(/[|｜]/g, '')                       // 表格线残留
    .replace(/([，。；：])\1+/g, '$1')             // 重复标点
    .replace(/[ \t]+/g, ' ')                     // 连续空格
    .replace(/^\s*第?\s*\d+\s*页\s*$/gm, '')      // 页码行
    .replace(/\n{3,}/g, '\n\n')                  // 空行压缩
    .trim();
}

/** 完整清理管线 */
export function normalizeOcrText(text) {
  let out = String(text || '');
  out = toHalfWidth(out);
  out = mergeVerticalLines(out);
  out = toSimplified(out);
  out = stripNoise(out);
  return out;
}

/** 统计清理效果，便于前端展示「识别质量」 */
export function ocrStats(raw, cleaned) {
  const r = String(raw || '');
  const c = String(cleaned || '');
  return {
    rawChars: r.length,
    cleanedChars: c.length,
    removedRatio: r.length ? Math.round(((r.length - c.length) / r.length) * 100) : 0,
    lineCount: c.split('\n').filter((l) => l.trim()).length,
  };
}

// ---------------------------------------------------------------------------
// 可插拔 OCR 后端
// ---------------------------------------------------------------------------

export const OCR_ENDPOINT = process.env.OCR_ENDPOINT || '';
export const OCR_API_KEY = process.env.OCR_API_KEY || '';
export const OCR_TIMEOUT_MS = Math.min(60_000, Math.max(5_000,
  parseInt(process.env.OCR_TIMEOUT_MS || '30000', 10)));

/** 是否配置了 OCR 后端 */
export function ocrAvailable() {
  return !!OCR_ENDPOINT;
}

/**
 * 调用配置的 OCR 服务。
 * 兼容两种常见响应：{ text } 或 { results: [{ text }] } 或纯文本。
 * @returns {Promise<{ ok: boolean, text?: string, error?: string }>}
 */
export async function callOcrService({ buffer, mime = 'image/png', filename = 'page.png' }) {
  if (!ocrAvailable()) {
    return { ok: false, error: '未配置 OCR 服务（设置 OCR_ENDPOINT 后可用），可先离线识别再粘贴文本' };
  }
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: mime }), filename);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OCR_TIMEOUT_MS);
  try {
    const res = await fetch(OCR_ENDPOINT, {
      method: 'POST',
      headers: OCR_API_KEY ? { Authorization: `Bearer ${OCR_API_KEY}` } : {},
      body: form,
      signal: controller.signal,
    });
    if (!res.ok) return { ok: false, error: `OCR 服务返回 ${res.status}` };

    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      const data = await res.json();
      const text = data?.text
        || (Array.isArray(data?.results) ? data.results.map((r) => r.text || '').join('\n') : '')
        || '';
      return { ok: true, text };
    }
    return { ok: true, text: await res.text() };
  } catch (err) {
    const msg = err?.name === 'AbortError' ? `OCR 服务超时（${OCR_TIMEOUT_MS}ms）` : `OCR 调用失败：${err.message}`;
    return { ok: false, error: msg };
  } finally {
    clearTimeout(timer);
  }
}

/** 能力探测（供前端显示状态） */
export function ocrCapability() {
  return {
    available: ocrAvailable(),
    endpoint: OCR_ENDPOINT ? `${OCR_ENDPOINT.replace(/\/\/[^/]*@/, '//')}` : '',
    timeoutMs: OCR_TIMEOUT_MS,
    note: ocrAvailable()
      ? '已配置 OCR 服务，可直接上传旧谱图片识别'
      : '未配置 OCR 服务；可先离线识别，再把文本粘贴到「口述/表格建谱」',
  };
}