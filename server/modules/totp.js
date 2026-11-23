import crypto from 'crypto';

/**
 * TOTP（RFC 6238）纯 Node crypto 实现，无第三方依赖。
 * 30 秒周期、6 位数字、SHA-1、允许 ±1 步时间窗（±30 秒）。
 */

const PERIOD = 30;
const DIGITS = 6;
const WINDOW = 1;

/** 生成随机密钥（20 字节 base32），返回 {secret, uri} */
export function generateTotpSecret(accountName, issuer = 'FamilyTree') {
  const buffer = crypto.randomBytes(20);
  const secret = base32Encode(buffer);
  const label = encodeURIComponent(`${issuer}:${accountName}`);
  const uri = `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}`
    + '&algorithm=SHA1&digits=6&period=30';
  return { secret, uri };
}

function base32Encode(buffer) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += alphabet[(value << (5 - bits)) & 31];
  return output;
}

function base32Decode(str) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = String(str).toUpperCase().replace(/=+$/, '').replace(/\s/g, '');
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of clean) {
    const idx = alphabet.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** 计算某个时间步的 TOTP */
function totpAt(secret, counter) {
  const key = base32Decode(secret);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buf.writeUInt32BE(counter >>> 0, 4);

  const hmac = crypto.createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code = ((hmac[offset] & 0x7f) << 24)
    | ((hmac[offset + 1] & 0xff) << 16)
    | ((hmac[offset + 2] & 0xff) << 8)
    | (hmac[offset + 3] & 0xff);
  return String(code % (10 ** DIGITS)).padStart(DIGITS, '0');
}

/** 校验 TOTP；token 为 6 位字符串 */
export function verifyTotp(secret, token, { now = Date.now() } = {}) {
  if (!secret || !/^\d{6}$/.test(String(token || ''))) return false;
  const counter = Math.floor(now / 1000 / PERIOD);
  for (let delta = -WINDOW; delta <= WINDOW; delta++) {
    if (totpAt(secret, counter + delta) === String(token)) return true;
  }
  return false;
}

/** 生成 10 个一次性恢复码（格式 XXXX-XXXX-XXXX，仅存哈希） */
export function generateRecoveryCodes(count = 10) {
  const codes = [];
  for (let i = 0; i < count; i++) {
    const raw = crypto.randomBytes(6).toString('hex').toUpperCase();
    codes.push(`${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`);
  }
  return codes;
}

export function hashRecoveryCode(code) {
  return crypto.createHash('sha256').update(String(code).replace(/-/g, '').toUpperCase()).digest('hex');
}

/** 校验并消费恢复码：返回剩余哈希数组或 null（无效） */
export function consumeRecoveryCode(hashes, code) {
  const hash = hashRecoveryCode(code);
  const idx = hashes.indexOf(hash);
  if (idx === -1) return null;
  return [...hashes.slice(0, idx), ...hashes.slice(idx + 1)];
}

/** 仅导出测试用：生成指定时间的 TOTP */
export function totpForTest(secret, counter) {
  return totpAt(secret, counter);
}
