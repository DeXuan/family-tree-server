import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';
import { config } from './config/index.js';
import { initDb, closeDb, query } from './db/db.js';
import { wrapAll } from './middleware/wrapRouterAsync.js';
import { logger } from './modules/logger.js';
import authRoutes from './routes/auth.js';
import personRoutes from './routes/persons.js';
import relationRoutes from './routes/relations.js';
import treeRoutes from './routes/tree.js';
import adminRoutes from './routes/admin.js';
import statsRoutes from './routes/stats.js';
import exportImportRoutes from './routes/exportImport.js';
import meRoutes from './routes/me.js';
import invitationRoutes from './routes/invitations.js';
import eventRoutes from './routes/events.js';
import mediaRoutes from './routes/media.js';
import changeRequestRoutes from './routes/changeRequests.js';
import maintenanceRoutes from './routes/maintenance.js';
import repositoryRoutes from './routes/repositories.js';
import sourceRoutes from './routes/sources.js';
import citationRoutes from './routes/citations.js';
import narrativeRoutes from './routes/narrativeImport.js';
import placeRoutes from './routes/places.js';
import associationRoutes from './routes/associations.js';
import qualityRoutes from './routes/quality.js';
import storyRoutes from './routes/stories.js';
import storyVersionRoutes from './routes/storyVersions.js';
import { createBackup, pruneBackups } from './modules/backup.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.set('trust proxy', 1);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'blob:'],
    },
  },
}));
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// 请求级结构化日志（仅 API）：便于排查慢请求与异常
app.use('/api', (req, res, next) => {
  const started = process.hrtime.bigint();
  const reqId = randomUUID().slice(0, 8);
  res.setHeader('X-Request-Id', reqId);
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
    logger[level]('http', {
      reqId,
      method: req.method,
      path: req.originalUrl.split('?')[0],
      status: res.statusCode,
      ms: Math.round(ms),
      ip: req.ip,
    });
  });
  next();
});

// 认证限速：防撞库/刷注册。
// 开发环境（非 production）对回环地址豁免，保证本地测试可重复；
// 生产环境（PM2 已设置 NODE_ENV=production）对所有来源生效。
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  message: { error: '注册尝试过于频繁，请稍后再试' },
});

const loginLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: parseInt(process.env.LOGIN_RATE_LIMIT_MAX || '20', 10),
  skipSuccessfulRequests: true,   // 只统计失败尝试，正常登录不消耗额度
  standardHeaders: true,
  message: { error: '失败尝试过多，请 10 分钟后再试' },
});

const LOOPBACK = new Set(['::1', '127.0.0.1', '::ffff:127.0.0.1']);
const devLoopbackBypass = (limiter) => (req, res, next) => {
  if (process.env.NODE_ENV !== 'production' && LOOPBACK.has(req.ip)) return next();
  return limiter(req, res, next);
};

app.use('/api/auth/register', devLoopbackBypass(registerLimiter));
app.use('/api/auth/login', devLoopbackBypass(loginLimiter));

app.get('/api/healthz', async (req, res) => {
  try {
    await query('SELECT 1');
    res.json({ ok: true, db: 'up', backend: process.env.DATABASE_URL?.startsWith('pglite') ? 'pglite' : 'postgres' });
  } catch (err) {
    res.status(503).json({ ok: false, db: 'down', error: err.message });
  }
});

// Express 4 不会捕获 async 路由的 rejected promise：统一原地包装（零侵入）
wrapAll([
  authRoutes, personRoutes, relationRoutes, treeRoutes, adminRoutes, meRoutes,
  invitationRoutes, eventRoutes, mediaRoutes, changeRequestRoutes, sourceRoutes,
  citationRoutes, narrativeRoutes, placeRoutes, associationRoutes, qualityRoutes,
  storyRoutes, storyVersionRoutes, maintenanceRoutes, statsRoutes, exportImportRoutes,
  repositoryRoutes,
]);

app.use('/api/auth', authRoutes);
app.use('/api/persons', personRoutes);
app.use('/api/relations', relationRoutes);
app.use('/api/tree', treeRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/me', meRoutes);
app.use('/api/invitations', invitationRoutes);
app.use('/api/events', eventRoutes);
app.use('/api/media', mediaRoutes);
app.use('/api/change-requests', changeRequestRoutes);
app.use('/api/sources', sourceRoutes);
app.use('/api/repositories', repositoryRoutes);
app.use('/api/citations', citationRoutes);
app.use('/api/import', narrativeRoutes);
app.use('/api/places', placeRoutes);
app.use('/api/associations', associationRoutes);
app.use('/api/quality', qualityRoutes);
app.use('/api/stories', storyRoutes);
app.use('/api/stories', storyVersionRoutes);
app.use('/api/admin', maintenanceRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/export', exportImportRoutes);
app.use('/api/import', exportImportRoutes);

// 前端静态资源 + SPA 回退（/api 不吞）
// index:false —— 让下面的 SPA 回退负责返回 index.html（便于注入 app-base）
app.use(express.static(path.join(__dirname, '../public'), { index: false }));
// SPA 回退：注入 app-base（部署在子路径时前端 API 需要前缀）
const INDEX_HTML = path.join(__dirname, '../public/index.html');
app.get(/^\/(?!api\/).*/, (req, res) => {
  try {
    const base = (process.env.APP_BASE || '').replace(/\/$/, '');
    let html = fs.readFileSync(INDEX_HTML, 'utf8');
    if (base) {
      html = html.replace(/<meta name="app-base" content="[^"]*">/,
        `<meta name="app-base" content="${base}">`);
    }
    res.type('html').send(html);
  } catch (err) {
    logger.error('index template failed', { err: err.message });
    res.status(500).send('页面加载失败');
  }
});

app.use('/api', (req, res) => res.status(404).json({ error: '接口不存在' }));

// 全局错误处理（含 multer 文件过滤错误）
app.use((err, req, res, next) => {
  const status4xx = (err.status && err.status >= 400 && err.status < 500)
    || (typeof err.message === 'string' && err.message.includes('仅支持'));
  const clientErr = status4xx;
  logger[clientErr ? 'warn' : 'error']('middleware error', {
    err: err.message,
    code: err.code,
    path: req.originalUrl ? req.originalUrl.split('?')[0] : undefined,
  });
  if (res.headersSent) return next(err);
  let status = err.status || (err.message?.includes('仅支持') ? 400 : 500);
  let message = err.message || '服务器内部错误';
  if (err.code === 'LIMIT_FILE_SIZE') {
    status = 400;
    message = '文件不能超过 15MB';
  }
  res.status(status).json({ error: message });
});

let server;
try {
  await initDb();
  server = app.listen(config.port, () => {
    logger.info('server listening', { port: config.port });
    if (config.backupIntervalHours > 0) {
      const ms = config.backupIntervalHours * 3600 * 1000;
      const timer = setInterval(async () => {
        try {
          const result = await createBackup();
          const pruned = pruneBackups(config.backupKeep);
          logger.info('scheduled backup', { file: result.file, pruned: pruned.deleted });
        } catch (err) {
          logger.error('scheduled backup failed', { err: err.message });
        }
      }, ms);
      timer.unref();
      logger.info('auto backup enabled', { hours: config.backupIntervalHours, keep: config.backupKeep });
    }
  });
} catch (err) {
  logger.error('db init failed', { err: err.message });
  process.exit(1);
}

async function shutdown(sig) {
  logger.info('shutting down', { signal: sig });
  server.close();
  await closeDb().catch(() => {});
  process.exit(0);
}
// 兜底：Express 4 不捕获 async 错误；记录但不退出，避免单个坏请求打挂服务
process.on('unhandledRejection', (err) => {
  logger.error('unhandledRejection', { err: err.message });
});

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

export default app;
