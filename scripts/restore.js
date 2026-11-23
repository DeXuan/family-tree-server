#!/usr/bin/env node
/**
 * 从备份恢复数据（必须在服务停止后运行；PGlite 为单写者）。
 *
 * 用法：
 *   node scripts/restore.js backups/family-tree-20261123-120000-ab12.json --dry-run
 *   node scripts/restore.js backups/xxx.json --yes
 *
 * 选项：
 *   --dry-run  只校验并打印将要恢复的行数，不写库
 *   --yes      跳过交互确认（自动化/演练用）
 *
 * 安全：恢复会清空并重建 family/person/关系/事件/用户表，请先确认已另有备份。
 */
import fs from 'fs';
import path from 'path';
import readline from 'readline';

const args = process.argv.slice(2);
const fileArg = args.find((a) => !a.startsWith('--'));
const dryRun = args.includes('--dry-run');
const yes = args.includes('--yes');

if (!fileArg) {
  console.error('用法：node scripts/restore.js <备份文件> [--dry-run] [--yes]');
  process.exit(2);
}

const fullPath = path.resolve(fileArg);
if (!fs.existsSync(fullPath)) {
  console.error(`备份文件不存在：${fullPath}`);
  process.exit(2);
}

let db;
try {
  // db.js 在模块加载时获取 PGlite 锁；服务运行中会明确报错
  db = await import('../server/db/db.js');
} catch (err) {
  console.error(`[restore] 无法打开数据库：${err.message}`);
  console.error('[restore] 请先停止服务（PGlite 同一数据目录只允许一个进程）。');
  process.exit(1);
}

const { initSchema, withTransaction, closeDb } = db;
const { readBackupFile, restoreInto, countRows } = await import('../server/modules/backup.js');

let parsed;
try {
  parsed = readBackupFile(fullPath);
} catch (err) {
  console.error(`[restore] ${err.message}`);
  await closeDb().catch(() => {});
  process.exit(1);
}

const { payload, check } = parsed;
console.log(`[restore] 文件：${path.basename(fullPath)}`);
console.log(`[restore] 生成时间：${payload.createdAt || '未知'}`);
console.log(`[restore] 校验通过，内容：${JSON.stringify(check.counts)}`);

if (dryRun) {
  console.log(`DRY-RUN OK persons=${check.counts.person} parent_child=${check.counts.parent_child} `
    + `marriage=${check.counts.marriage} event=${check.counts.event} users=${check.counts.users}`);
  await closeDb();
  process.exit(0);
}

if (!yes) {
  if (!process.stdin.isTTY) {
    console.error('[restore] 非交互环境请加 --yes 确认');
    await closeDb();
    process.exit(2);
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((resolve) => {
    rl.question(`将清空当前数据库并恢复上述数据，输入 yes 继续：`, resolve);
  });
  rl.close();
  if (answer.trim().toLowerCase() !== 'yes') {
    console.log('[restore] 已取消');
    await closeDb();
    process.exit(1);
  }
}

try {
  await initSchema();
  const restored = await withTransaction(async (client) => {
    await restoreInto(client, payload);
    return countRows(client);
  });

  const mismatch = Object.entries(check.counts)
    .filter(([table, expected]) => restored[table] !== expected);
  if (mismatch.length) {
    console.error('[restore] 行数不一致：', mismatch);
    await closeDb();
    process.exit(1);
  }

  console.log(`[restore] 完成：${JSON.stringify(restored)}`);
  console.log(`RESTORED persons=${restored.person} parent_child=${restored.parent_child} `
    + `marriage=${restored.marriage} event=${restored.event} story=${restored.story} `
    + `place=${restored.place} association=${restored.association} users=${restored.users}`);
  await closeDb();
  process.exit(0);
} catch (err) {
  console.error('[restore] 失败（事务已回滚）：', err.message);
  await closeDb().catch(() => {});
  process.exit(1);
}
