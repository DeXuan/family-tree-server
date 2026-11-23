/**
 * 结构化日志（单行 JSON，便于 grep / 采集）。
 * 不使用第三方库：字段固定、开销可控。
 */

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const MIN_LEVEL = LEVELS[process.env.LOG_LEVEL] ?? LEVELS.info;

function emit(level, message, fields) {
  if (LEVELS[level] < MIN_LEVEL) return;

  // 支持 logger.error('msg', err) 这种把 Error 直接当字段的用法
  let normalized = fields;
  if (fields instanceof Error) {
    normalized = {
      err: fields.message,
      code: fields.code,
      stack: process.env.NODE_ENV === 'production' ? undefined : fields.stack,
    };
  } else if (fields && typeof fields === 'object') {
    normalized = { ...fields };
    for (const [k, v] of Object.entries(normalized)) {
      if (v instanceof Error) {
        normalized[k] = v.message;
        if (process.env.NODE_ENV !== 'production' && normalized[`${k}Stack`] === undefined) {
          normalized[`${k}Stack`] = v.stack;
        }
      }
    }
  }

  const line = {
    t: new Date().toISOString(),
    level,
    msg: message,
    ...(normalized || {}),
  };
  for (const k of Object.keys(line)) {
    if (line[k] === undefined) delete line[k];
  }
  const text = JSON.stringify(line);
  if (level === 'error') process.stderr.write(text + '\n');
  else process.stdout.write(text + '\n');
}

export const logger = {
  debug: (msg, fields) => emit('debug', msg, fields),
  info: (msg, fields) => emit('info', msg, fields),
  warn: (msg, fields) => emit('warn', msg, fields),
  error: (msg, fields) => emit('error', msg, fields),
};