import test from 'node:test';
import assert from 'node:assert/strict';
import {
  toDialect, withDialect, hasDialect, dialectKeys, dialectGlossary, DIALECT_LABEL,
} from '../server/modules/kinshipDialect.js';

test('standard/空方言原样返回', () => {
  assert.equal(toDialect('父亲', 'standard'), '父亲');
  assert.equal(toDialect('父亲', null), '父亲');
  assert.equal(toDialect('父亲', undefined), '父亲');
  assert.equal(toDialect('父亲', ''), '父亲');
});

test('吴语映射', () => {
  assert.equal(toDialect('父亲', 'wu'), '阿爸');
  assert.equal(toDialect('母亲', 'wu'), '姆妈');
  assert.equal(toDialect('祖母', 'wu'), '阿娘');
});

test('粤语映射', () => {
  assert.equal(toDialect('父亲', 'yue'), '老豆');
  assert.equal(toDialect('儿子', 'yue'), '仔');
  assert.equal(toDialect('弟弟', 'yue'), '细佬');
});

test('闽南语映射', () => {
  assert.equal(toDialect('祖父', 'minnan'), '阿公');
  assert.equal(toDialect('祖母', 'minnan'), '阿嬷');
});

test('客家话映射', () => {
  assert.equal(toDialect('外祖父', 'hakka'), '姐公');
  assert.equal(toDialect('外祖母', 'hakka'), '姐婆');
});

test('西南官话映射', () => {
  assert.equal(toDialect('叔父', 'southwest'), '幺爸');
  assert.equal(toDialect('姑母', 'southwest'), '嬢嬢');
});

test('胶辽官话映射', () => {
  assert.equal(toDialect('外祖母', 'jiaoliao'), '姥姥');
  assert.equal(toDialect('女儿', 'jiaoliao'), '闺女');
});

test('无对应项回退标准称谓', () => {
  assert.equal(toDialect('高祖父', 'wu'), '高祖父');
  assert.equal(toDialect('族侄', 'yue'), '族侄');
});

test('未知方言键回退标准称谓', () => {
  assert.equal(toDialect('父亲', 'nope'), '父亲');
});

test('空称谓不报错', () => {
  assert.equal(toDialect('', 'wu'), '');
  assert.equal(toDialect(null, 'wu'), '');
});

test('hasDialect 判定', () => {
  assert.equal(hasDialect('standard'), true);
  assert.equal(hasDialect(null), true);
  assert.equal(hasDialect('wu'), true);
  assert.equal(hasDialect('klingon'), false);
});

test('dialectKeys 与 DIALECT_LABEL 一致', () => {
  assert.deepEqual(dialectKeys().sort(), Object.keys(DIALECT_LABEL).sort());
  assert.ok(dialectKeys().includes('standard'));
  assert.ok(dialectKeys().includes('hakka'));
});

test('withDialect 附加字段且保留原 term', () => {
  const r = withDialect({ term: '父亲', kind: 'ancestor' }, 'wu');
  assert.equal(r.term, '父亲');
  assert.equal(r.dialectTerm, '阿爸');
  assert.equal(r.dialect, 'wu');
  assert.equal(r.dialectDiffers, true);
  assert.equal(r.kind, 'ancestor');
});

test('withDialect 无差异时 dialectDiffers=false', () => {
  const r = withDialect({ term: '高祖父' }, 'wu');
  assert.equal(r.dialectTerm, '高祖父');
  assert.equal(r.dialectDiffers, false);
});

test('withDialect 标准方言标记为 standard', () => {
  const r = withDialect({ term: '父亲' }, 'standard');
  assert.equal(r.dialect, 'standard');
  assert.equal(r.dialectTerm, '父亲');
  assert.equal(r.dialectDiffers, false);
});

test('withDialect 不改动原对象', () => {
  const src = { term: '父亲' };
  withDialect(src, 'yue');
  assert.deepEqual(src, { term: '父亲' });
});

test('withDialect 空值透传', () => {
  assert.equal(withDialect(null, 'wu'), null);
  assert.equal(withDialect(undefined, 'wu'), undefined);
});

test('对照表覆盖所有标准称谓且结构正确', () => {
  const g = dialectGlossary('yue');
  assert.ok(g.length > 20);
  for (const row of g) {
    assert.equal(typeof row.standard, 'string');
    assert.equal(typeof row.dialect, 'string');
    assert.ok(row.standard.length > 0);
  }
  const father = g.find((r) => r.standard === '父亲');
  assert.equal(father.dialect, '老豆');
});

test('standard 对照表自身相等', () => {
  const g = dialectGlossary('standard');
  assert.ok(g.every((r) => r.standard === r.dialect));
});