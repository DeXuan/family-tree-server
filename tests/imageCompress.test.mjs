import test from 'node:test';
import assert from 'node:assert/strict';
import {
  needsCompression, fitDimensions, compressedName, DEFAULTS,
} from '../public/js/lib/imageCompress.js';

test('大尺寸图片需要压缩', () => {
  const r = needsCompression({ type: 'image/jpeg', size: 100 * 1024, width: 4000, height: 3000 });
  assert.equal(r.needed, true);
  assert.equal(r.reason, 'oversize');
});

test('体积超阈值也触发压缩（尺寸正常时）', () => {
  const r = needsCompression({ type: 'image/jpeg', size: 3 * 1024 * 1024, width: 1600, height: 1200 });
  assert.equal(r.needed, true);
  assert.equal(r.reason, 'overweight');
});

test('小图不压缩', () => {
  const r = needsCompression({ type: 'image/jpeg', size: 120 * 1024, width: 800, height: 600 });
  assert.equal(r.needed, false);
  assert.equal(r.reason, 'small');
});

test('非位图格式一律放行（gif/svg/pdf/视频）', () => {
  for (const type of ['image/gif', 'image/svg+xml', 'application/pdf', 'video/mp4', 'audio/mpeg']) {
    const r = needsCompression({ type, size: 9 * 1024 * 1024, width: 8000, height: 8000 });
    assert.equal(r.needed, false, type);
    assert.equal(r.reason, 'not-raster');
  }
});

test('小体积 png 不重编码（避免图标失真）', () => {
  const r = needsCompression({ type: 'image/png', size: 30 * 1024, width: 4000, height: 4000 });
  assert.equal(r.needed, false);
  assert.equal(r.reason, 'small-png');
});

test('大 png 仍会压缩', () => {
  const r = needsCompression({ type: 'image/png', size: 2 * 1024 * 1024, width: 3000, height: 2000 });
  assert.equal(r.needed, true);
});

test('缺少类型时不处理', () => {
  const r = needsCompression({ size: 5 * 1024 * 1024 });
  assert.equal(r.needed, false);
  assert.equal(r.reason, 'unknown-type');
});

test('等比缩放保持比例', () => {
  assert.deepEqual(fitDimensions(4000, 3000, 1920), { width: 1920, height: 1440 });
  assert.deepEqual(fitDimensions(3000, 4000, 1920), { width: 1440, height: 1920 });
});

test('未超长边时尺寸不变', () => {
  assert.deepEqual(fitDimensions(1000, 800, 1920), { width: 1000, height: 800 });
  assert.deepEqual(fitDimensions(1920, 1000, 1920), { width: 1920, height: 1000 });
});

test('不放大：极小图原样返回', () => {
  assert.deepEqual(fitDimensions(10, 10, 1920), { width: 10, height: 10 });
});

test('异常尺寸不崩溃', () => {
  assert.deepEqual(fitDimensions(0, 0, 1920), { width: 0, height: 0 });
  assert.deepEqual(fitDimensions(undefined, 100, 1920), { width: 0, height: 100 });
  assert.deepEqual(fitDimensions(-5, -5, 1920), { width: 0, height: 0 });
});

test('缩放后至少 1 像素（超长宽比）', () => {
  const d = fitDimensions(10000, 3, 1920);
  assert.equal(d.width, 1920);
  assert.ok(d.height >= 1);
});

test('输出文件名按 mime 换扩展名', () => {
  assert.equal(compressedName('全家福.jpeg', 'image/webp'), '全家福.webp');
  assert.equal(compressedName('a.png', 'image/png'), 'a.png');
  assert.equal(compressedName('照片', 'image/jpeg'), '照片.jpg');
  assert.equal(compressedName('x.y.z.jpg', 'image/jpeg'), 'x.y.z.jpg');
});

test('默认参数：长边 1920 / 质量 0.85 / 400KB 门槛', () => {
  assert.equal(DEFAULTS.maxEdge, 1920);
  assert.equal(DEFAULTS.quality, 0.85);
  assert.equal(DEFAULTS.minBytes, 400 * 1024);
});

test('可覆盖 maxEdge 与 minBytes', () => {
  const r = needsCompression(
    { type: 'image/jpeg', size: 500 * 1024, width: 1200, height: 900 },
    { maxEdge: 800, minBytes: 1024 * 1024 }
  );
  assert.equal(r.needed, true);
  assert.equal(r.reason, 'oversize');
  assert.deepEqual(fitDimensions(1200, 900, 800), { width: 800, height: 600 });
});