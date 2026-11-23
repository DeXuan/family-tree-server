import test from 'node:test';
import assert from 'node:assert/strict';
import {
  esc, cnNum, fmtDate, fmtYear, lifespan, initials, dash, genLabel,
} from '../public/js/lib/format.js';

test('esc 转义 HTML 特殊字符', () => {
  assert.equal(esc('<script>alert("x")</script>'),
    '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
  assert.equal(esc("a & b 'c'"), 'a &amp; b &#39;c&#39;');
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
});

test('cnNum 中文数字', () => {
  assert.equal(cnNum(1), '一');
  assert.equal(cnNum(10), '十');
  assert.equal(cnNum(11), '十一');
  assert.equal(cnNum(NaN), '—');
});

test('fmtDate 去时间、容错', () => {
  assert.equal(fmtDate('2024-03-05T00:00:00.000Z'), '2024-03-05');
  assert.equal(fmtDate('2024-03-05'), '2024-03-05');
  assert.equal(fmtDate(''), '');
  assert.equal(fmtDate(null), '');
});

test('fmtYear 取年份', () => {
  assert.equal(fmtYear('2024-03-05'), '2024');
  assert.equal(fmtYear(''), '');
});

test('lifespan 各种组合', () => {
  assert.equal(lifespan({ birth_date: '1901-01-01', death_date: '1985-01-01' }), '1901–1985');
  assert.equal(lifespan({ birth_date: '1901-01-01', is_deceased: false }), '1901–');
  assert.equal(lifespan({ birth_date: '1901-01-01', is_deceased: true }), '1901–?');
  assert.equal(lifespan({}), '生卒不详');
  // 优先使用 birth_year/death_year（树接口形态）
  assert.equal(lifespan({ birth_year: 1926, death_year: null, is_deceased: false }), '1926–');
});

test('initials 取末字', () => {
  assert.equal(initials('王守仁'), '仁');
  assert.equal(initials('王'), '王');
  assert.equal(initials(''), '?');
  assert.equal(initials(null), '?');
});

test('dash 空值占位', () => {
  assert.equal(dash(''), '—');
  assert.equal(dash(null), '—');
  assert.equal(dash(undefined), '—');
  assert.equal(dash('x'), 'x');
});

test('genLabel 世代标签', () => {
  assert.equal(genLabel(3), '第三世');
  assert.equal(genLabel(11), '第十一世');
  assert.equal(genLabel(null), '');
});
