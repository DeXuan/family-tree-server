/**
 * 轻量输入校验：不引入 schema 库，集中定义字段长度/枚举，避免路由里散落 if。
 * 返回 null 表示通过，否则返回给用户的错误文案。
 */

const GENDERS = ['male', 'female', 'unknown'];
const PRECISIONS = ['exact', 'year', 'about', 'range', 'unknown'];
const EVENT_TYPES = ['birth', 'adoption', 'marriage', 'divorce', 'education', 'career',
  'migration', 'military', 'award', 'residence', 'death', 'burial', 'custom'];
const VISIBILITY = ['L0', 'L1', 'L2'];

const LIMITS = {
  family_name: 40,
  given_name: 40,
  courtesy_name: 40,
  generation_name: 20,
  branch: 40,
  birth_place: 120,
  death_place: 120,
  burial_place: 120,
  occupation: 80,
  education: 120,
  bio: 5000,
};

const trim = (v) => (typeof v === 'string' ? v.trim() : v);

function checkString(body, field, max) {
  const v = body[field];
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string') return `${field} 必须是字符串`;
  if (v.length > max) return `${field} 长度不能超过 ${max} 个字符`;
  return null;
}

function checkDate(body, field) {
  const v = body[field];
  if (v === undefined || v === null || v === '') return null;
  const d = new Date(v);
  if (isNaN(d.getTime())) return `${field} 不是有效日期`;
  if (d.getFullYear() < 1000 || d.getFullYear() > 2200) return `${field} 年份超出合理范围`;
  return null;
}

/** 成员新增/修改校验；partial=true 时只校验提交了的字段 */
export function validatePersonInput(body, { partial = false } = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return '请求体格式错误';

  for (const [field, max] of Object.entries(LIMITS)) {
    const err = checkString(body, field, max);
    if (err) return err;
  }

  if (body.gender !== undefined && !GENDERS.includes(body.gender)) {
    return '性别取值无效';
  }
  if (body.birth_precision !== undefined && !PRECISIONS.includes(body.birth_precision)) {
    return '出生日期精度无效';
  }
  if (body.death_precision !== undefined && !PRECISIONS.includes(body.death_precision)) {
    return '去世日期精度无效';
  }
  if (body.generation_no !== undefined && body.generation_no !== null && body.generation_no !== '') {
    const n = Number(body.generation_no);
    if (!Number.isInteger(n) || n < 0 || n > 100) return '世代需为 0–100 的整数';
  }
  if (body.former_names !== undefined) {
    if (!Array.isArray(body.former_names)) return '曾用名必须是数组';
    if (body.former_names.length > 10) return '曾用名最多 10 个';
    if (body.former_names.some((n) => typeof n !== 'string' || n.length > 40)) {
      return '曾用名需为不超过 40 字的文本';
    }
  }
  if (body.extra !== undefined) {
    if (typeof body.extra !== 'object' || Array.isArray(body.extra) || body.extra === null) {
      return '自定义字段必须是对象';
    }
    if (JSON.stringify(body.extra).length > 4000) return '自定义字段内容过大';
  }
  if (body.contact !== undefined) {
    const c = body.contact;
    if (typeof c !== 'object' || Array.isArray(c) || c === null) return '联系方式格式错误';
    const err = checkString(c, 'phone', 40) || checkString(c, 'email', 120) || checkString(c, 'address', 200);
    if (err) return '联系方式字段过长';
  }

  const birthErr = checkDate(body, 'birth_date');
  if (birthErr) return birthErr;
  const deathErr = checkDate(body, 'death_date');
  if (deathErr) return deathErr;

  if (!partial) {
    const name = `${trim(body.family_name) || ''}${trim(body.given_name) || ''}`;
    if (!name) return '请至少填写姓或名';
  }
  return null;
}

/** 生平事件校验 */
export function validateEventInput(body, { partial = false } = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return '请求体格式错误';

  if (partial) {
    if (body.eventType !== undefined && !EVENT_TYPES.includes(body.eventType)) return '无效事件类型';
    if (body.eventPrecision !== undefined && !PRECISIONS.includes(body.eventPrecision)) return '无效日期精度';
    if (body.visibility !== undefined && !VISIBILITY.includes(body.visibility)) return '无效可见级别';
  } else {
    if (!EVENT_TYPES.includes(body.eventType || 'custom')) return '无效事件类型';
    if (!PRECISIONS.includes(body.eventPrecision || 'unknown')) return '无效日期精度';
    if (!VISIBILITY.includes(body.visibility || 'L1')) return '无效可见级别';
  }

  if (body.title !== undefined && typeof body.title !== 'string') return '事件标题必须是文本';
  if (body.title !== undefined && body.title.length > 120) return '事件标题不能超过 120 字';
  if (!partial && (!body.title || !body.title.trim())) return '事件标题必填';
  if (body.description !== undefined) {
    if (typeof body.description !== 'string') return '事件经过必须是文本';
    if (body.description.length > 5000) return '事件经过不能超过 5000 字';
  }
  if (body.place !== undefined) {
    if (typeof body.place !== 'string') return '地点必须是文本';
    if (body.place.length > 120) return '地点不能超过 120 字';
  }
  const dateErr = checkDate(body, 'eventDate') || checkDate(body, 'eventDateEnd');
  if (dateErr) return dateErr;
  return null;
}
