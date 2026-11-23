/**
 * 轻量请求体校验器（无第三方依赖）。
 * 目标：把"缺字段/类型错"从 500 变成 400，并给出明确字段名。
 *
 * 用法：
 *   const v = validateBody(req, {
 *     title: { type: 'string', required: true, max: 200 },
 *     visibility: { type: 'enum', values: ['L0','L1','L2'] },
 *     personIds: { type: 'array', max: 50 },
 *   });
 *   if (v.error) return res.status(400).json({ error: v.error });
 */

const TYPE_LABEL = { string: '文本', number: '数字', boolean: '布尔值', array: '数组', object: '对象' };

/**
 * @returns {{ok:boolean, error?:string, value:object}}
 */
export function validateBody(req, schema) {
  const body = (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) ? req.body : {};
  const value = {};

  for (const [field, rule] of Object.entries(schema)) {
    const raw = body[field];
    const present = raw !== undefined && raw !== null;

    if (!present) {
      if (rule.required) return { ok: false, error: `${rule.label || field} 必填` };
      continue;
    }

    switch (rule.type) {
      case 'string': {
        if (typeof raw !== 'string') return { ok: false, error: `${rule.label || field} 必须是${TYPE_LABEL.string}` };
        const trimmed = rule.trim === false ? raw : raw.trim();
        if (rule.required && !trimmed) return { ok: false, error: `${rule.label || field} 不能为空` };
        if (rule.min && trimmed.length < rule.min) {
          return { ok: false, error: `${rule.label || field} 至少 ${rule.min} 个字符` };
        }
        if (rule.max && trimmed.length > rule.max) {
          return { ok: false, error: `${rule.label || field} 不能超过 ${rule.max} 个字符` };
        }
        if (rule.pattern && !rule.pattern.test(trimmed)) {
          return { ok: false, error: `${rule.label || field} 格式不正确` };
        }
        value[field] = trimmed;
        break;
      }
      case 'number': {
        const n = Number(raw);
        if (!Number.isFinite(n)) return { ok: false, error: `${rule.label || field} 必须是数字` };
        if (rule.integer && !Number.isInteger(n)) return { ok: false, error: `${rule.label || field} 必须是整数` };
        if (rule.min !== undefined && n < rule.min) return { ok: false, error: `${rule.label || field} 不能小于 ${rule.min}` };
        if (rule.max !== undefined && n > rule.max) return { ok: false, error: `${rule.label || field} 不能大于 ${rule.max}` };
        value[field] = n;
        break;
      }
      case 'boolean': {
        if (typeof raw !== 'boolean') return { ok: false, error: `${rule.label || field} 必须是布尔值` };
        value[field] = raw;
        break;
      }
      case 'enum': {
        if (!rule.values.includes(raw)) {
          return { ok: false, error: `${rule.label || field} 取值必须是：${rule.values.join(' / ')}` };
        }
        value[field] = raw;
        break;
      }
      case 'array': {
        if (!Array.isArray(raw)) return { ok: false, error: `${rule.label || field} 必须是数组` };
        if (rule.max && raw.length > rule.max) {
          return { ok: false, error: `${rule.label || field} 最多 ${rule.max} 项` };
        }
        value[field] = raw;
        break;
      }
      case 'object': {
        if (typeof raw !== 'object' || Array.isArray(raw)) {
          return { ok: false, error: `${rule.label || field} 必须是对象` };
        }
        value[field] = raw;
        break;
      }
      default:
        value[field] = raw;
    }

    // 自定义校验
    if (rule.validate) {
      const msg = rule.validate(value[field]);
      if (msg) return { ok: false, error: msg };
    }
  }

  return { ok: true, value };
}