/**
 * 客户端图片压缩：在浏览器里用 canvas 缩放并重编码，减少上传体积。
 *
 * 设计要点：
 * - 只处理位图（jpeg/png/webp），GIF/SVG/音视频/PDF 原样放行；
 * - 目标长边可配（默认 1920），质量默认 0.85；
 * - 压缩后反而更大时返回原文件（避免"压了还变大"）；
 * - canvas 部分单独放 compressImageBlob()，纯计算部分（needsCompression/
 *   fitDimensions）可单元测试，不依赖 DOM。
 */

export const DEFAULTS = {
  maxEdge: 1920,
  quality: 0.85,
  // 小于此体积不压缩：重编码反而可能变大
  minBytes: 400 * 1024,
};

const RASTER_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

/** 是否需要压缩（纯函数）：返回 {needed, reason} */
export function needsCompression(fileMeta, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const { type, size, width, height } = fileMeta || {};
  if (!type) return { needed: false, reason: 'unknown-type' };
  if (!RASTER_TYPES.has(type)) return { needed: false, reason: 'not-raster' };
  if (type === 'image/png' && size < o.minBytes) {
    // 小 PNG 常是图标/截图，重编码成 webp 可能失真
    return { needed: false, reason: 'small-png' };
  }
  const longEdge = Math.max(width || 0, height || 0);
  if (longEdge > o.maxEdge) return { needed: true, reason: 'oversize' };
  if (size > o.minBytes) return { needed: true, reason: 'overweight' };
  return { needed: false, reason: 'small' };
}

/** 等比缩放后的尺寸（纯函数），不放大 */
export function fitDimensions(width, height, maxEdge = DEFAULTS.maxEdge) {
  const w = Math.max(0, Math.floor(width || 0));
  const h = Math.max(0, Math.floor(height || 0));
  if (!w || !h) return { width: w, height: h };
  const longEdge = Math.max(w, h);
  if (longEdge <= maxEdge) return { width: w, height: h };
  const scale = maxEdge / longEdge;
  return {
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
  };
}

/** 输出文件名：把扩展名换成 .webp 或保留 jpg */
export function compressedName(name, mime) {
  const base = String(name || 'image').replace(/\.[^.]+$/, '');
  const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
  return `${base}.${ext}`;
}

/** 读取图片自然尺寸（依赖 DOM，测试时跳过） */
function loadBitmap(blob) {
  if (typeof createImageBitmap === 'function') {
    return createImageBitmap(blob).then((bmp) => ({
      source: bmp,
      width: bmp.width,
      height: bmp.height,
      release: () => bmp.close?.(),
    }));
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => resolve({
      source: img,
      width: img.naturalWidth,
      height: img.naturalHeight,
      release: () => URL.revokeObjectURL(url),
    });
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('图片解码失败')); };
    img.src = url;
  });
}

/**
 * 压缩一张图片。
 * @returns {Promise<{blob: Blob, name: string, width: number, height: number,
 *                    compressed: boolean, reason: string, savedBytes: number}>}
 */
export async function compressImage(file, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const original = { blob: file, name: file.name, size: file.size, type: file.type };

  if (!RASTER_TYPES.has(file.type)) {
    return { ...original, width: 0, height: 0, compressed: false, reason: 'not-raster', savedBytes: 0 };
  }

  let bitmap;
  try {
    bitmap = await loadBitmap(file);
  } catch {
    return { ...original, width: 0, height: 0, compressed: false, reason: 'decode-failed', savedBytes: 0 };
  }

  try {
    const decision = needsCompression(
      { type: file.type, size: file.size, width: bitmap.width, height: bitmap.height }, o
    );
    if (!decision.needed) {
      return {
        ...original, width: bitmap.width, height: bitmap.height,
        compressed: false, reason: decision.reason, savedBytes: 0,
      };
    }

    const target = fitDimensions(bitmap.width, bitmap.height, o.maxEdge);
    const canvas = document.createElement('canvas');
    canvas.width = target.width;
    canvas.height = target.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas 不可用');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap.source, 0, 0, target.width, target.height);

    const outMime = file.type === 'image/png' ? 'image/webp' : file.type;
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, outMime, o.quality));
    if (!blob) throw new Error('编码失败');

    // 没变小就放弃
    if (blob.size >= file.size) {
      return {
        ...original, width: bitmap.width, height: bitmap.height,
        compressed: false, reason: 'no-gain', savedBytes: 0,
      };
    }

    return {
      blob,
      name: compressedName(file.name, outMime),
      size: blob.size,
      type: outMime,
      width: target.width,
      height: target.height,
      compressed: true,
      reason: decision.reason,
      savedBytes: file.size - blob.size,
    };
  } finally {
    bitmap.release?.();
  }
}