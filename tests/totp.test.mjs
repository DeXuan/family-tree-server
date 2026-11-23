import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateTotpSecret, verifyTotp, totpForTest,
  generateRecoveryCodes, hashRecoveryCode, consumeRecoveryCode,
} from '../server/modules/totp.js';

test('生成密钥与 otpauth URI', () => {
  const { secret, uri } = generateTotpSecret('admin');
  assert.match(secret, /^[A-Z2-7]{32}$/);
  assert.ok(uri.startsWith('otpauth://totp/'));
  assert.ok(uri.includes('secret=' + secret));
});

test('TOTP 校验当前码与 ±1 时间窗', () => {
  const { secret } = generateTotpSecret('admin');
  const now = 1700000000000;
  const counter = Math.floor(now / 1000 / 30);
  const current = totpForTest(secret, counter);
  assert.equal(current.length, 6);
  assert.ok(verifyTotp(secret, current, { now }));
  assert.ok(verifyTotp(secret, totpForTest(secret, counter - 1), { now }));
  assert.ok(verifyTotp(secret, totpForTest(secret, counter + 1), { now }));
  // 超出窗口
  assert.ok(!verifyTotp(secret, totpForTest(secret, counter + 2), { now }));
});

test('错误码/格式被拒', () => {
  const { secret } = generateTotpSecret('x');
  assert.ok(!verifyTotp(secret, '0000000', {}));
  assert.ok(!verifyTotp(secret, 'abcdef', {}));
  assert.ok(!verifyTotp(secret, '', {}));
});

test('RFC 6238 标准测试向量（SHA1, 8位取前6）', () => {
  //secret = "12345678901234567890" (base32 of ASCII "12345678901234567890")
  const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  // RFC 给出 8 位码，本实现输出 6 位，取其低 6 位比对
  const cases = [
    { t: 59, expect: '287082' },
    { t: 1111111109, expect: '081804' },
    { t: 1234567890, expect: '005924' },
  ];
  for (const c of cases) {
    const counter = Math.floor(c.t / 30);
    assert.equal(totpForTest(secret, counter), c.expect);
  }
});

test('恢复码生成/哈希/消费', () => {
  const codes = generateRecoveryCodes(5);
  assert.equal(codes.length, 5);
  assert.match(codes[0], /^[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}$/);
  const hashes = codes.map(hashRecoveryCode);
  const remaining = consumeRecoveryCode(hashes, codes[2]);
  assert.equal(remaining.length, 4);
  assert.ok(!remaining.includes(hashes[2]));
  assert.equal(consumeRecoveryCode(hashes, 'XXXX-XXXX-XXXX'), null);
  // 同一码不能复用（消费后的集合里找不到）
  assert.equal(consumeRecoveryCode(remaining, codes[2]), null);
});
