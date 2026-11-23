import { fileURLToPath } from 'url';
import path from 'path';
import dotenv from 'dotenv';

// 必须在读取 process.env 之前加载 .env（否则 PORT 等配置不生效）
dotenv.config({ path: path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../../.env') });

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  jwtSecret: process.env.JWT_SECRET || 'dev-insecure-secret-change-me',
  databaseUrl: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/family_tree',
  familyId: process.env.FAMILY_ID || '00000000-0000-0000-0000-000000000001',
  backupDir: process.env.BACKUP_DIR || path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../../backups'),
  uploadDir: process.env.UPLOAD_DIR || path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../../uploads'),
  backupKeep: Math.max(1, parseInt(process.env.BACKUP_KEEP || '14', 10)),
  backupIntervalHours: parseFloat(process.env.BACKUP_INTERVAL_HOURS || '0'),
  seedOnEmpty: process.env.SEED_ON_EMPTY === 'true',
  isProd: process.env.NODE_ENV === 'production',
};

// 隐私级别
export const LEVEL = { L0: 'L0', L1: 'L1', L2: 'L2' };

// 角色
export const ROLE = { ADMIN: 'admin', EDITOR: 'editor', MEMBER: 'member', GUEST: 'guest' };

// 日期精度
export const PRECISION = { EXACT: 'exact', YEAR: 'year', ABOUT: 'about', RANGE: 'range', UNKNOWN: 'unknown' };

// 关系类型
export const RELATION_TYPE = { BIOLOGICAL: 'biological', ADOPTED: 'adopted', STEP: 'step', FOSTER: 'foster', ACKNOWLEDGED: 'acknowledged' };

// 确信度
export const CERTAINTY = { CONFIRMED: 'confirmed', PROBABLE: 'probable', DISPUTED: 'disputed' };
