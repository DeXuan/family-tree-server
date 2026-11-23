import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { imageSize } from '../server/modules/imageSize.js';

function tmpFile(buf) {
  const p = path.join(os.tmpdir(), `img-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.writeFileSync(p, buf);
  return p;
}

test('解析 PNG 尺寸', () => {
  // 1x1 PNG
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=', 'base64');
  const p = tmpFile(png);
  assert.deepEqual(imageSize(p), { width: 1, height: 1 });
  fs.unlinkSync(p);
});

test('解析 GIF 尺寸', () => {
  const gif = Buffer.from('R0lGODlhCgAKAIAAAP///wAAACH5BAEAAAAALAAAAAAKAAoAAAIRhI+py+0Po5y02ouzQjs=' , 'base64');
  // 手动构造更可靠：GIF89a + 10x10 LE
  const buf = Buffer.alloc(16);
  buf.write('GIF89a', 0);
  buf.writeUInt16LE(10, 6);
  buf.writeUInt16LE(10, 8);
  const p = tmpFile(buf);
  assert.deepEqual(imageSize(p), { width: 10, height: 10 });
  fs.unlinkSync(p);
});

test('非图片返回 null', () => {
  const p = tmpFile(Buffer.from('hello world'));
  assert.equal(imageSize(p), null);
  fs.unlinkSync(p);
});
