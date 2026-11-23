import fs from 'fs';
import path from 'path';
import { randomBytes } from 'crypto';
import { config } from '../config/index.js';
import { query } from '../db/db.js';
import {
  BACKUP_VERSION, TABLE_ORDER, TABLE_COLUMNS, JSON_COLUMNS,
  validateBackup, summarize, insertStatement, selectPrunable,
} from './backupFormat.js';

const NAME_RE = /^family-tree-\d{8}-\d{6}-[a-z0-9]{4}\.json$/;

export function getBackupDir() {
  const dir = config.backupDir;
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function stamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-`
    + `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
}

/** 生成全量备份（不含审计日志；包含用户哈希与加密后的 L2 字段） */
export async function createBackup() {
  const data = {};
  for (const table of TABLE_ORDER) {
    const cols = TABLE_COLUMNS[table].join(',');
    const { rows } = await query(`SELECT ${cols} FROM ${table}`);
    data[table] = rows;
  }

  const payload = {
    app: 'family-tree',
    version: BACKUP_VERSION,
    createdAt: new Date().toISOString(),
    familyId: config.familyId,
    counts: null,
    data,
  };
  payload.counts = summarize(payload);

  const file = `family-tree-${stamp()}-${randomBytes(2).toString('hex')}.json`;
  const full = path.join(getBackupDir(), file);
  fs.writeFileSync(full, JSON.stringify(payload, null, 2), { mode: 0o600 });
  const stat = fs.statSync(full);

  return {
    file,
    bytes: stat.size,
    createdAt: payload.createdAt,
    counts: payload.counts,
    warning: '备份包含密码哈希与加密后的私密字段，请妥善保管；媒体原文件在 uploads/ 目录，需单独备份',
  };
}

export function backupPath(name) {
  if (!NAME_RE.test(name)) throw new Error('备份文件名非法');
  const full = path.resolve(getBackupDir(), name);
  if (!full.startsWith(path.resolve(getBackupDir()) + path.sep)) throw new Error('路径越界');
  return full;
}

export function listBackups() {
  const dir = getBackupDir();
  return fs.readdirSync(dir)
    .filter((name) => NAME_RE.test(name))
    .map((name) => {
      const stat = fs.statSync(path.join(dir, name));
      return { file: name, bytes: stat.size, createdAt: stat.mtime.toISOString() };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** 只保留最近的 keep 份（至少 1 份），返回删除数量 */
export function pruneBackups(keep = config.backupKeep) {
  const list = listBackups();
  const victims = selectPrunable(list, keep);
  for (const item of victims) {
    try { fs.unlinkSync(path.join(getBackupDir(), item.file)); } catch { /* 忽略单个失败 */ }
  }
  return { deleted: victims.length, kept: Math.min(list.length, Math.max(1, Number(keep) || 1)) };
}

export function readBackupFile(fullPath) {
  const text = fs.readFileSync(fullPath, 'utf8');
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error('备份文件不是合法 JSON');
  }
  const check = validateBackup(payload);
  if (!check.ok) throw new Error(`备份校验失败：${check.errors.join('；')}`);
  return { payload, check };
}

/**
 * 在事务内用备份替换现有数据（清空后重建）。
 * @param {{query: Function}} client
 * @param {object} payload 已通过 validateBackup 的备份
 */
export async function restoreInto(client, payload) {
    // 只清根表，子表由外键 CASCADE 级联
    await client.query('TRUNCATE TABLE family RESTART IDENTITY CASCADE');

  for (const table of TABLE_ORDER) {
    const rows = payload.data[table];
    if (!rows.length) continue;
    const cols = TABLE_COLUMNS[table];
    const jsonCols = new Set(JSON_COLUMNS[table] || []);
    const batchSize = 100;

    for (let start = 0; start < rows.length; start += batchSize) {
      const batch = rows.slice(start, start + batchSize);
      const params = [];
      for (const row of batch) {
        for (const col of cols) {
          const v = row[col] ?? null;
          params.push(jsonCols.has(col) && v !== null ? JSON.stringify(v) : v);
        }
      }
      await client.query(insertStatement(table, batch.length), params);
    }
  }
}

/** 恢复后核对行数 */
export async function countRows(client) {
  const counts = {};
  for (const table of TABLE_ORDER) {
    const { rows } = await client.query(`SELECT COUNT(*)::int AS c FROM ${table}`);
    counts[table] = rows[0].c;
  }
  return counts;
}
