import { logger } from '../modules/logger.js';

/**
 * Express 4 不捕获 async handler 的 rejected promise：
 * 未处理的错误会让请求一直挂起（客户端等到超时），且不会进入错误中间件。
 *
 * 本模块在挂载 router 后**原地位替换**其 stack 中的 AsyncFunction handler，
 * 零侵入地给所有 async 路由补上错误捕获——不需要逐个改 105 个路由。
 *
 * 用法（index.js）：
 *   app.use('/api/x', wrapRouterAsync(xRoutes));
 */

const isAsyncFunction = (fn) => fn && fn.constructor && fn.constructor.name === 'AsyncFunction';

function wrapHandler(fn) {
  return function asyncWrapped(req, res, next) {
    let result;
    try {
      result = fn(req, res, next);
    } catch (err) {
      // 同步抛错也走统一处理
      return fail(err);
    }
    if (result && typeof result.then === 'function') {
      result.catch(fail);
    }

    function fail(err) {
      logger.error('unhandled route error', {
        method: req.method,
        path: req.originalUrl ? req.originalUrl.split('?')[0] : undefined,
        err: err && err.message,
        code: err && err.code,
        stack: process.env.NODE_ENV === 'production' ? undefined : (err && err.stack),
      });
      if (res.headersSent) return next(err);
      const status = err && err.status >= 400 && err.status < 600 ? err.status : 500;
      const message = status < 500 && err && err.message ? err.message : '服务器内部错误';
      res.status(status).json({ error: message });
    }
  };
}

/** 原地包装 router 中所有 async handler，返回同一个 router */
export function wrapRouterAsync(router) {
  if (!router || !Array.isArray(router.stack)) return router;
  let wrapped = 0;
  for (const layer of router.stack) {
    // 普通路由：layer.route.stack[]
    if (layer.route && Array.isArray(layer.route.stack)) {
      for (const h of layer.route.stack) {
        if (isAsyncFunction(h.handle) && !h.handle.__asyncWrapped) {
          const original = h.handle;
          h.handle = wrapHandler(original);
          h.handle.__asyncWrapped = true;
          wrapped++;
        }
      }
      continue;
    }
    // 子 router（嵌套 router.use）
    if (layer.handle && Array.isArray(layer.handle.stack)) {
      wrapRouterAsync(layer.handle);
      continue;
    }
    // 直接挂的 async 中间件
    if (isAsyncFunction(layer.handle) && !layer.handle.__asyncWrapped) {
      const original = layer.handle;
      layer.handle = wrapHandler(original);
      layer.handle.__asyncWrapped = true;
      wrapped++;
    }
  }
  logger.debug('router async wrapped', { count: wrapped });
  return router;
}

/** 一次性包装多个 router */
export function wrapAll(routers = []) {
  for (const r of routers) wrapRouterAsync(r);
  return routers;
}