import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeOverrides, toDialectWithOverrides, effectiveTable, glossaryWithOverrides,
  validateOverride, applyOverride, removeOverride, withDialectAndOverrides,
  MAX_OVERRIDES,
} from '../server/modules/kinshipDialect.js';

test('normalizeOverrides 过滤未知方言键', () => {
  const out = normalizeOverrides({ klingon: { 父亲: 'x' }, standard: { 父亲: 'y' } });
  assert.deepEqual(out, {});
});

test('normalizeOverrides 过滤空值', () => {
  const out = normalizeOverrides({ wu: { 父亲: '', '': '阿爹', 母亲: '   ' } });
  assert.deepEqual(out, {});
});

test('normalizeOverrides 保留合法词条', () => {
  const out = normalizeOverrides({ wu: { 父亲: '阿爹' } });
  assert.deepEqual(out, { wu: { 父亲: '阿爹' } });
});

test('normalizeOverrides 过滤超长词条', () => {
  const out = normalizeOverrides({ wu: { 父亲: 'X'.repeat(20) } });
  assert.deepEqual(out, {});
});

test('normalizeOverrides 非对象输入返回空', () => {
  assert.deepEqual(normalizeOverrides(null), {});
  assert.deepEqual(normalizeOverrides([]), {});
  assert.deepEqual(normalizeOverrides('str'), {});
});

test('normalizeOverrides 限量 60 条', () => {
  const map = {};
  for (let i = 0; i < 100; i++) map[`称谓${i}`] = `方言${i}`;
  const out = normalizeOverrides({ wu: map });
  const total = Object.values(out.wu || {}).length;
  assert.equal(total, MAX_OVERRIDES);
});

test('toDialectWithOverrides 优先用覆盖', () => {
  assert.equal(toDialectWithOverrides('父亲', 'wu', { wu: { 父亲: '阿爹' } }), '阿爹');
});

test('toDialectWithOverrides 无覆盖时回退内置', () => {
  assert.equal(toDialectWithOverrides('父亲', 'wu', {}), '阿爸');
});

test('toDialectWithOverrides 方言无覆盖时回退内置', () => {
  assert.equal(toDialectWithOverrides('祖父', 'wu', { wu: { 父亲: '阿爹' } }), '阿爷');
});

test('toDialectWithOverrides standard 原样返回', () => {
  assert.equal(toDialectWithOverrides('父亲', 'standard', { standard: { 父亲: 'x' } }), '父亲');
});

test('toDialectWithOverrides 空称谓不报错', () => {
  assert.equal(toDialectWithOverrides('', 'wu', {}), '');
});

test('effectiveTable 合并内置与覆盖', () => {
  const t = effectiveTable('wu', { wu: { 父亲: '阿爹' } });
  assert.equal(t['父亲'], '阿爹');
  assert.equal(t['祖父'], '阿爷');
});

test('glossaryWithOverrides 标记覆盖项', () => {
  const g = glossaryWithOverrides('wu', { wu: { 父亲: '阿爹' } });
  const father = g.find((r) => r.standard === '父亲');
  assert.equal(father.dialect, '阿爹');
  assert.equal(father.overridden, true);
  const mother = g.find((r) => r.standard === '母亲');
  assert.equal(mother.dialect, '姆妈');
  assert.equal(mother.overridden, false);
});

test('validateOverride 正常通过', () => {
  const r = validateOverride({ dialect: 'wu', standard: '父亲', term: '阿爹' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.override, { dialect: 'wu', standard: '父亲', term: '阿爹' });
});

test('validateOverride 拒绝 standard 方言', () => {
  assert.equal(validateOverride({ dialect: 'standard', standard: '父亲', term: 'x' }).ok, false);
});

test('validateOverride 拒绝未知方言', () => {
  assert.equal(validateOverride({ dialect: 'xx', standard: '父亲', term: 'x' }).ok, false);
});

test('validateOverride 拒绝空值', () => {
  assert.equal(validateOverride({ dialect: 'wu', standard: '', term: 'x' }).ok, false);
  assert.equal(validateOverride({ dialect: 'wu', standard: '父亲', term: '' }).ok, false);
});

test('validateOverride 拒绝超长', () => {
  assert.equal(validateOverride({ dialect: 'wu', standard: 'X'.repeat(20), term: 'y' }).ok, false);
  assert.equal(validateOverride({ dialect: 'wu', standard: '父亲', term: 'y'.repeat(20) }).ok, false);
});

test('applyOverride 新增覆盖', () => {
  const r = applyOverride({}, { dialect: 'wu', standard: '父亲', term: '阿爹' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.overrides, { wu: { 父亲: '阿爹' } });
});

test('applyOverride 覆盖已有值', () => {
  const r = applyOverride({ wu: { 父亲: '阿爹' } }, { dialect: 'wu', standard: '父亲', term: '老爹' });
  assert.equal(r.overrides.wu['父亲'], '老爹');
});

test('applyOverride 超额时拒绝', () => {
  const map = {};
  for (let i = 0; i < MAX_OVERRIDES; i++) map[`称谓${i}`] = `方言${i}`;
  const r = applyOverride({ wu: map }, { dialect: 'wu', standard: '新称谓', term: '新方言' });
  assert.equal(r.ok, false);
  assert.match(r.error, /最多/);
});

test('removeOverride 删除指定词条', () => {
  const r = removeOverride({ wu: { 父亲: '阿爹', 母亲: '姆妈' } }, { dialect: 'wu', standard: '父亲' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.overrides, { wu: { 母亲: '姆妈' } });
});

test('removeOverride 删空方言组时移除该键', () => {
  const r = removeOverride({ wu: { 父亲: '阿爹' } }, { dialect: 'wu', standard: '父亲' });
  assert.equal(r.ok, true);
  assert.equal(r.overrides.wu, undefined);
});

test('removeOverride 词条不存在时报错', () => {
  const r = removeOverride({}, { dialect: 'wu', standard: '父亲' });
  assert.equal(r.ok, false);
});

test('withDialectAndOverrides 应用覆盖并标记差异', () => {
  const r = withDialectAndOverrides({ term: '父亲' }, 'wu', { wu: { 父亲: '阿爹' } });
  assert.equal(r.dialectTerm, '阿爹');
  assert.equal(r.dialectDiffers, true);
  assert.equal(r.term, '父亲');
});

test('withDialectAndOverrides 无覆盖时回退内置', () => {
  const r = withDialectAndOverrides({ term: '母亲' }, 'wu', {});
  assert.equal(r.dialectTerm, '姆妈');
});

test('withDialectAndOverrides 空值透传', () => {
  assert.equal(withDialectAndOverrides(null, 'wu', {}), null);
});