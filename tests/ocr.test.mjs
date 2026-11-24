import test from 'node:test';
import assert from 'node:assert/strict';
import {
  toHalfWidth, toSimplified, mergeVerticalLines, stripNoise, normalizeOcrText,
  ocrStats, ocrAvailable, ocrCapability, VARIANT_MAP,
} from '../server/modules/ocr.js';

const NL = '\n';

test('全角数字与字母转半角', () => {
  assert.equal(toHalfWidth('１９４９'), '1949');
  assert.equal(toHalfWidth('ＡＢＣ'), 'ABC');
});

test('全角标点转半角（中文句号保留）', () => {
  assert.equal(toHalfWidth('，。！'), ',。!');
  assert.equal(toHalfWidth('，；：'), ',;:');
});

test('全角空格转普通空格', () => {
  assert.equal(toHalfWidth('a\u3000b'), 'a b');
});

test('繁体姓氏转简体', () => {
  assert.equal(toSimplified('陳張劉楊'), '陈张刘杨');
});

test('繁体内文转简体', () => {
  assert.equal(toSimplified('國華興榮'), '国华兴荣');
});

test('未收录字符原样保留', () => {
  assert.equal(toSimplified('王大明'), '王大明');
});

test('VARIANT_MAP 覆盖常见姓氏', () => {
  for (const s of ['陈', '张', '刘', '杨', '黄', '赵', '吴', '周']) {
    assert.ok(Object.values(VARIANT_MAP).includes(s), s);
  }
});

test('竖排短行合并为一行', () => {
  const vertical = ['王', '守', '仁', '生', '于', '一', '九', '二', '六', '年'].join(NL);
  assert.equal(mergeVerticalLines(vertical), '王守仁生于一九二六年');
});

test('正常段落不被误合并', () => {
  const text = ['王守仁生于1926年。', '他在村里教书。'].join(NL);
  assert.equal(mergeVerticalLines(text), text);
});

test('长行保留不合并', () => {
  const text = ['这是一段比较长的说明文字', '另一段也很长的文字内容'].join(NL);
  assert.equal(mergeVerticalLines(text), text);
});

test('去除零宽字符', () => {
  assert.equal(stripNoise('王\u200B守\uFEFF仁'), '王守仁');
});

test('去除表格线残留', () => {
  assert.equal(stripNoise('王|守|仁'), '王守仁');
});

test('重复标点折叠', () => {
  assert.equal(stripNoise('甲，，乙。。丙'), '甲，乙。丙');
});

test('去除页码行（留下空行，后续压缩）', () => {
  const out = stripNoise(['正文内容', '第 12 页', '后续'].join(NL));
  assert.ok(!out.includes('第 12 页'), out);
  assert.ok(out.includes('正文内容') && out.includes('后续'));
});

test('压缩多余空行', () => {
  assert.equal(stripNoise(['a', '', '', '', 'b'].join(NL)), ['a', '', 'b'].join(NL));
});

test('清理管线组合生效', () => {
  const raw = ['陳', '守', '仁', '１９２６'].join(NL);
  const out = normalizeOcrText(raw);
  assert.ok(out.replace(/\s+/g, '').includes('陈守仁1926'), out);
  const withPage = normalizeOcrText(['陳守仁', '第 3 页'].join(NL));
  assert.ok(!withPage.includes('第 3 页'), withPage);
});

test('ocrStats 统计正确', () => {
  const s = ocrStats('a'.repeat(100), 'a'.repeat(80));
  assert.equal(s.rawChars, 100);
  assert.equal(s.cleanedChars, 80);
  assert.equal(s.removedRatio, 20);
});

test('ocrStats 空输入不除零', () => {
  const s = ocrStats('', '');
  assert.equal(s.removedRatio, 0);
  assert.equal(s.lineCount, 0);
});

test('未配置 OCR 时 capability 说明清楚', () => {
  const cap = ocrCapability();
  assert.equal(typeof cap.available, 'boolean');
  assert.ok(cap.note.length > 0);
  if (!ocrAvailable()) assert.match(cap.note, /未配置/);
});

test('清理后行数统计只算非空行', () => {
  const s = ocrStats(['a', '', '', 'b'].join(NL), ['a', '', 'b'].join(NL));
  assert.equal(s.lineCount, 2);
});

test('混合场景：繁体竖排 + 全角 + 噪声', () => {
  const raw = ['陳', '', '張', '', '氏', '', '生', '', '於', '', '１', '９', '２', '６', '年|'].join(NL);
  const out = normalizeOcrText(raw);
  assert.ok(out.includes('陈张氏'), out);
  assert.ok(out.includes('1926'), out);
  assert.ok(!out.includes('|'), out);
});