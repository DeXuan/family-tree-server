/**
 * 路径/查询参数中的 UUID 校验。
 * 不校验的话，非法字符串会进入 SQL 的 uuid 比较并抛错；
 * Express 4 不捕获 async 错误，可能导致进程退出（DoS）。
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

/** 用法：router.param('id', uuidParam) */
export function uuidParam(req, res, next, value) {
  if (!isUuid(value)) {
    return res.status(400).json({ error: '无效的 ID 格式' });
  }
  next();
}

/** 查询参数校验：任一非法则直接返回 400 */
export function requireUuidQuery(req, res, ...names) {
  for (const name of names) {
    if (!isUuid(req.query[name])) {
      res.status(400).json({ error: `参数 ${name} 不是有效的 ID` });
      return false;
    }
  }
  return true;
}
