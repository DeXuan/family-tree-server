import crypto from 'crypto';
import { logger } from '../modules/logger.js';

/**
 * L2 敏感字段静态加密（AES-256-GCM）。
 *
 * 密钥优先级：
 * 1. DATA_ENCRYPTION_KEY：32 字节的 base64（生产必须显式配置并妥善保管）
 * 2. 未配置时由 JWT_SECRET 经 scrypt 派生（单机/演示可用，换 JWT_SECRET 会导致旧密文不可解）
 *
 * 存储格式：{ __enc: 1, v: 1, iv, tag, ct }，与明文 JSON 可共存（兼容历史数据）。
 */

let cachedKey = null;
let warned = false;

function getKey() {
  if (cachedKey) return cachedKey;
  const raw = process.env.DATA_ENCRYPTION_KEY;
  if (raw) {
    const buf = Buffer.from(raw, 'base64');
    if (buf.length !== 32) {
      throw new Error('DATA_ENCRYPTION_KEY 必须是 32 字节的 base64 字符串');
    }
    cachedKey = buf;
  } else {
    const secret = process.env.JWT_SECRET || 'dev-insecure-secret-change-me';
    cachedKey = crypto.scryptSync(secret, 'family-tree/contact/v1', 32);
    if (!warned) {
      logger.warn('[crypto] 未配置 DATA_ENCRYPTION_KEY，已由 JWT_SECRET 派生（请勿更换 JWT_SECRET，否则旧密文无法解密）');
      warned = true;
    }
  }
  return cachedKey;
}

export function isEncrypted(value) {
  return !!value && typeof value === 'object' && value.__enc === 1;
}

/** 加密任意 JSON 值；null/undefined 原样返回 */
export function encryptJSON(value) {
  if (value === null || value === undefined) return value;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const plaintext = JSON.stringify(value);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    __enc: 1,
    v: 1,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ct: ct.toString('base64'),
  };
}

/** 解密；明文原样返回；密文损坏/密钥不匹配时抛错 */
export function decryptJSON(value) {
  if (value === null || value === undefined) return value;
  if (!isEncrypted(value)) return value;
  const iv = Buffer.from(value.iv, 'base64');
  const tag = Buffer.from(value.tag, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(value.ct, 'base64')),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString('utf8'));
}

/** 解密失败返回 null（用于展示层，避免一条坏数据导致整页 500） */
export function tryDecryptJSON(value) {
  try {
    return decryptJSON(value);
  } catch {
    return null;
  }
}
