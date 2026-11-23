/**
 * 轻量图片尺寸解析（只读文件头，无第三方依赖）。
 * 支持 PNG / JPEG / GIF / WebP，失败返回 null。
 */
import fs from 'fs';

export function imageSize(filepath) {
  try {
    const fd = fs.openSync(filepath, 'r');
    const buf = Buffer.alloc(64);
    const n = fs.readSync(fd, buf, 0, 64, 0);
    fs.closeSync(fd);
    const b = buf.subarray(0, n);

    // PNG: 8 字节签名 + IHDR(宽高在 16-23)
    if (b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
      if (b.length >= 24) return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
    }
    // GIF: 'GIF87a'/'GIF89a' 后 6-9 字节
    if (b.subarray(0, 3).toString() === 'GIF' && b.length >= 10) {
      return { width: b.readUInt16LE(6), height: b.readUInt16LE(8) };
    }
    // WebP: RIFF....WEBP VP8X/VP8 /VP8L
    if (b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP') {
      if (b.subarray(12, 16).toString() === 'VP8X' && b.length >= 30) {
        return {
          width: 1 + b.readUIntLE(24, 3),
          height: 1 + b.readUIntLE(27, 3),
        };
      }
      if (b.subarray(12, 16).toString() === 'VP8 ' && b.length >= 30) {
        return {
          width: b.readUInt16LE(26) & 0x3fff,
          height: b.readUInt16LE(28) & 0x3fff,
        };
      }
    }
    // JPEG: 扫描 SOF 标记
    if (b[0] === 0xff && b[1] === 0xd8) {
      let off = 2;
      while (off + 9 < b.length) {
        if (b[off] !== 0xff) { off++; continue; }
        const marker = b[off + 1];
        if (marker === 0xd9 || marker === 0xda) break;
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
          return { width: b.readUInt16BE(off + 7), height: b.readUInt16BE(off + 5) };
        }
        const len = b.readUInt16BE(off + 2);
        off += 2 + len;
      }
    }
  } catch { /* 无法解析 */ }
  return null;
}
