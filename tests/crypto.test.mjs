import test from 'node:test';
import assert from 'node:assert/strict';
import {
  encryptJSON, decryptJSON, tryDecryptJSON, isEncrypted,
} from '../server/modules/crypto.js';

test('加密/解密往返保持对象内容', () => {
  const contact = { phone: '13800000000', email: 'a@b.com', address: '河北保定' };
  const enc = encryptJSON(contact);
  assert.equal(enc.__enc, 1);
  assert.equal(isEncrypted(enc), true);
  assert.deepEqual(decryptJSON(enc), contact);
});

test('密文不包含明文内容（base64 中看不到电话）', () => {
  const enc = encryptJSON({ phone: '13812345678' });
  const serialized = JSON.stringify(enc);
  assert.ok(!serialized.includes('13812345678'));
  assert.ok(enc.ct.length > 0);
});

test('相同明文两次加密产生不同密文（随机 IV）', () => {
  const a = encryptJSON({ phone: '13900000000' });
  const b = encryptJSON({ phone: '13900000000' });
  assert.notEqual(a.iv, b.iv);
  assert.notEqual(a.ct, b.ct);
});

test('明文输入原样返回（兼容历史数据）', () => {
  const plain = { phone: '13700000000' };
  assert.deepEqual(decryptJSON(plain), plain);
  assert.equal(isEncrypted(plain), false);
});

test('密文被篡改时解密抛错，tryDecrypt 返回 null', () => {
  const enc = encryptJSON({ phone: '13600000000' });
  const tampered = { ...enc, ct: Buffer.from('tampered-data').toString('base64') };
  assert.throws(() => decryptJSON(tampered));
  assert.equal(tryDecryptJSON(tampered), null);
});

test('null/undefined 安全处理', () => {
  assert.equal(encryptJSON(null), null);
  assert.equal(decryptJSON(undefined), undefined);
});
