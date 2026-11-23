import { logger } from './logger.js';

/**
 * Express 4 不捕获 async 抛错：未处理的 rejected promise 会让请求挂起，
 * 严重时导致进程不稳定。所有 async 路由都必须用它包裹。
 *
 * 用法：router.get('/path', auth, asyncHandler(async (req, res) => { ... }))
 */
export function asyncHandler(fn) {
  return function wrapped(req, res, next) {
    Promise.resolve(fn(req, res, next)).catch((err) => {
      logger.error('route failed', {
        method: req.method,
        path: req.originalUrl?.split('?')[0],
        err: err?.message,
        code: err?.code,
        // 仅开发环境输出堆栈，避免日志泄露内网细节
        stack: process.env.NODE_ENV === 'production' ? undefined : err?.stack,
      });
      if (res.headersSent) return next(err);
      const status = err?.status && err.status >= 400 && err.status < 600 ? err.status : 500;
      const message = (status < 500 && err?.message) ? err.message : '服务器内部错误';
      res.status(status).json({ error: message });
    });
  };
}

/** 业务错误：可安全返回给调用方 */
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
    this.expose = true;
  }
}