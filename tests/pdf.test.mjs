import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizePdfOptions, parseMargin, PDF_PRESETS,
  issueTicket, consumeTicket, __resetTickets, pdfCapability,
} from '../server/modules/pdf.js';

test('默认选项为 A4 纵向、无覆盖', () => {
  const o = normalizePdfOptions({});
  assert.equal(o.preset, 'a4_portrait');
  assert.equal(o.format, 'A4');
  assert.equal(o.landscape, false);
  assert.equal(o.scale, 1);
  assert.equal(o.printBackground, true);
});

test('横向预设正确映射', () => {
  const o = normalizePdfOptions({ preset: 'a4_landscape' });
  assert.equal(o.format, 'A4');
  assert.equal(o.landscape, true);
});

test('A3 横向可用', () => {
  const o = normalizePdfOptions({ preset: 'a3_landscape' });
  assert.equal(o.format, 'A3');
  assert.equal(o.landscape, true);
});

test('非法预设回退默认', () => {
  const o = normalizePdfOptions({ preset: 'nope' });
  assert.equal(o.preset, 'a4_portrait');
});

test('scale 被钳制在 0.5–2', () => {
  assert.equal(normalizePdfOptions({ scale: 99 }).scale, 2);
  assert.equal(normalizePdfOptions({ scale: -3 }).scale, 0.5);
  assert.equal(normalizePdfOptions({ scale: 1.5 }).scale, 1.5);
  assert.equal(normalizePdfOptions({ scale: 'abc' }).scale, 1);
});

test('标题被裁剪到 60 字', () => {
  const o = normalizePdfOptions({ title: 'X'.repeat(200) });
  assert.equal(o.title.length, 60);
});

test('空标题回退为「族谱」', () => {
  assert.equal(normalizePdfOptions({ title: '   ' }).title, '族谱');
});

test('margin 非法时用预设值', () => {
  const o = normalizePdfOptions({ margin: 'not-a-margin' });
  assert.equal(o.margin, PDF_PRESETS.a4_portrait.margin);
});

test('margin 合法时保留', () => {
  const o = normalizePdfOptions({ margin: '5mm 6mm' });
  assert.equal(o.margin, '5mm 6mm');
});

test('printBackground 可关闭', () => {
  assert.equal(normalizePdfOptions({ printBackground: false }).printBackground, false);
});

test('parseMargin 单值展开为四边', () => {
  assert.deepEqual(parseMargin('10mm'), { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' });
});

test('parseMargin 两值：上下 / 左右', () => {
  assert.deepEqual(parseMargin('10mm 20mm'), { top: '10mm', right: '20mm', bottom: '10mm', left: '20mm' });
});

test('parseMargin 四值按 top/right/bottom/left', () => {
  assert.deepEqual(parseMargin('1mm 2mm 3mm 4mm'), { top: '1mm', right: '2mm', bottom: '3mm', left: '4mm' });
});

test('parseMargin 非法单位回退默认', () => {
  const m = parseMargin('abc');
  assert.equal(m.top, '14mm');
  assert.equal(m.left, '12mm');
});

test('parseMargin 支持 cm/in/px/pt', () => {
  for (const unit of ['1cm', '0.5in', '20px', '12pt']) {
    assert.equal(parseMargin(unit).top, unit);
  }
});

test('票据可签发并一次性消费', () => {
  __resetTickets();
  const { token, expiresIn } = issueTicket({ userId: 'u1', familyId: 'f1', path: '{}' });
  assert.ok(token.length > 20);
  assert.equal(expiresIn, 60);

  const first = consumeTicket(token);
  assert.equal(first.ok, true);
  assert.equal(first.userId, 'u1');

  const second = consumeTicket(token);
  assert.equal(second.ok, false);
  assert.match(second.error, /已使用|无效/);
});

test('无效票据被拒', () => {
  __resetTickets();
  assert.equal(consumeTicket('not-a-ticket').ok, false);
  assert.equal(consumeTicket('').ok, false);
  assert.equal(consumeTicket(null).ok, false);
});

test('票据清理过期项', () => {
  __resetTickets();
  const a = issueTicket({ userId: 'u1', familyId: 'f1', path: '{}' });
  // 签发新票据会清理未使用但过期的（此处仅确认不报错且旧票据仍可用）
  const b = issueTicket({ userId: 'u2', familyId: 'f1', path: '{}' });
  assert.equal(consumeTicket(a.token).ok, true);
  assert.equal(consumeTicket(b.token).ok, true);
});

test('能力探测返回可用并说明来源', () => {
  const cap = pdfCapability();
  assert.equal(cap.available, true);
  assert.ok(typeof cap.note === 'string' && cap.note.length > 0);
});