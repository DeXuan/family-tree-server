import { logger } from '../modules/logger.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { encryptJSON, isEncrypted } from '../modules/crypto.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');
dotenv.config({ path: path.join(PROJECT_ROOT, '.env') });

const RAW_URL = process.env.DATABASE_URL || 'pglite:./data/pgdata';

// =====================================================================
// 双驱动：默认 PGlite（零安装，数据落本地目录）；生产切 PostgreSQL
//   pglite:./data/pgdata                       → PGlite
//   postgres://user:pass@host:5432/dbname     → node-postgres Pool
// =====================================================================
let backend;
let pool;
let pglite;

function isPgliteUrl(url) {
  return url.startsWith('pglite:');
}

function resolvePglitePath(url) {
  const raw = url.replace(/^pglite:(\/\/)?/, '');
  return path.isAbsolute(raw) ? raw : path.resolve(PROJECT_ROOT, raw);
}

let pgliteLockPath = null;

/**
 * PGlite 是单写者数据库：多个进程同时打开同一目录会损坏数据（WAL/control）。
 * 用带 pid 的锁文件阻止并发打开；进程崩溃留下的陈旧锁会在下次启动时自动清理。
 */
function acquirePgliteLock(dataDir) {
  const lockPath = `${dataDir}.lock`;  // 放在数据目录同级：PGlite 初始化要求数据目录为空
  const writeLock = () => {
    const fd = fs.openSync(lockPath, 'wx');
    fs.writeFileSync(fd, String(process.pid));
    fs.closeSync(fd);
  };
  try {
    writeLock();
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
    let holder = NaN;
    try { holder = parseInt(fs.readFileSync(lockPath, 'utf8').trim(), 10); } catch { /* 忽略 */ }
    let alive = false;
    if (Number.isInteger(holder) && holder > 0) {
      try { process.kill(holder, 0); alive = true; } catch { alive = false; }
    }
    if (alive && holder !== process.pid) {
      throw new Error(`数据库正被进程 ${holder} 使用。PGlite 为单写者，请先停止该进程再启动。`);
    }
    fs.rmSync(lockPath, { force: true });
    writeLock();
  }
  pgliteLockPath = lockPath;
}

if (isPgliteUrl(RAW_URL)) {
  const { PGlite } = await import('@electric-sql/pglite');
  const dataDir = resolvePglitePath(RAW_URL);
  fs.mkdirSync(dataDir, { recursive: true });
  acquirePgliteLock(dataDir);
  pglite = new PGlite(dataDir);
  backend = 'pglite';
  logger.info(`[db] backend=pglite dataDir=${dataDir}`);
} else {
  const pg = (await import('pg')).default;
  pool = new pg.Pool({ connectionString: RAW_URL, max: 10, idleTimeoutMillis: 30000 });
  backend = 'postgres';
  logger.info('[db] backend=postgres');
}

export { backend };

const SLOW_MS = Number(process.env.SLOW_QUERY_MS || 500);

export async function query(text, params = []) {
  const start = Date.now();
  try {
    const res = pglite ? await pglite.query(text, params) : await pool.query(text, params);
    const duration = Date.now() - start;
    if (process.env.NODE_ENV !== 'test' && duration > SLOW_MS) {
      logger.warn('slow query', {
        ms: duration,
        sql: String(text).replace(/\s+/g, ' ').slice(0, 160),
        paramCount: params.length,
      });
    }
    return res;
  } catch (err) {
    // 唯一约束冲突属于预期业务分支（重复提交），降为 warn 减少噪音
    const isConstraint = err.code === '23505' || err.code === '23503';
    logger[isConstraint ? 'warn' : 'error']('query failed', {
      ms: Date.now() - start,
      sql: String(text).replace(/\s+/g, ' ').slice(0, 160),
      err: err.message,
      code: err.code,
    });
    throw err;
  }
}

// 事务封装：fn 接收带 query 方法的 client
export async function withTransaction(fn) {
  if (pglite) {
    // PGlite 单连接，串行执行；手动 BEGIN/COMMIT
    await pglite.query('BEGIN');
    try {
      const result = await fn({ query: (t, p = []) => pglite.query(t, p) });
      await pglite.query('COMMIT');
      return result;
    } catch (err) {
      await pglite.query('ROLLBACK');
      throw err;
    }
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// 兼容迁移：把历史明文联系方式就地加密（幂等）
async function migrateLegacyContacts() {
  const { rows } = await query(
    `SELECT id, contact FROM person
     WHERE contact IS NOT NULL AND contact <> '{}'::jsonb
       AND (contact->>'__enc') IS NULL`
  );
  for (const row of rows) {
    if (isEncrypted(row.contact)) continue;
    await query('UPDATE person SET contact = $1 WHERE id = $2',
      [JSON.stringify(encryptJSON(row.contact)), row.id]);
  }
  if (rows.length) logger.info(`[db] encrypted ${rows.length} legacy contact records`);
}

// 仅建表（恢复脚本复用；不播种）
export async function initSchema() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  if (pglite) {
    await pglite.exec(sql);
  } else {
    await pool.query(sql);
  }
  logger.info('[db] schema ready');
}

// PostgreSQL 可选优化：trigram 索引（PGlite 无此扩展，自动跳过）
async function ensureOptionalIndexes() {
  if (backend !== 'postgres') return;
  try {
    await query('CREATE EXTENSION IF NOT EXISTS pg_trgm');
    await query(
      `CREATE INDEX IF NOT EXISTS idx_person_name_trgm
       ON person USING gin ((coalesce(family_name, '') || coalesce(given_name, '')) gin_trgm_ops)`
    );
    logger.info('[db] trigram index ready');
  } catch (err) {
    logger.info('[db] pg_trgm unavailable, skip trigram index');
  }
}

// 首次启动：建表 + 空库播种
export async function initDb() {
  await initSchema();
  await ensureOptionalIndexes();
  await migrateLegacyContacts();

  if (process.env.SEED_ON_EMPTY !== 'false') {
    const { rows } = await query('SELECT COUNT(*)::int AS c FROM family');
    if (rows[0].c === 0) {
      logger.info('[db] empty database detected, seeding demo data...');
      const { seedDatabase } = await import('../../scripts/seed.js');
      await seedDatabase();
    }
  }
}

export async function closeDb() {
  if (pglite) {
    await pglite.close();
    if (pgliteLockPath) {
      fs.rmSync(pgliteLockPath, { force: true });
      pgliteLockPath = null;
    }
  } else {
    await pool.end();
  }
}
