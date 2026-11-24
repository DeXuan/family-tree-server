/**
 * 关联角色：内置词表 + 家族自定义扩展。
 *
 * 设计要点：
 * - 内置角色保持不变，保证历史数据可读；
 * - 自定义角色存入 family.settings.customRoles，形如
 *   [{ key: 'clan_elder', label: '族老', note: '' }]；
 * - key 自动加前缀 `custom_`，避免与内置键冲突；
 * - 上图/校验/展示统一走 resolveRoles()，避免各处硬编码。
 *
 * 纯函数，便于单元测试。
 */

export const BUILTIN_ROLES = [
  'godparent', 'godchild', 'witness', 'employer', 'employee',
  'neighbor', 'friend', 'teacher', 'student', 'successor', 'other',
];

export const BUILTIN_LABELS = {
  godparent: '义父/义母', godchild: '义子/义女', witness: '见证人',
  employer: '雇主', employee: '雇员', neighbor: '邻里', friend: '好友',
  teacher: '师长', student: '门生', successor: '继承人', other: '其他',
};

export const CUSTOM_PREFIX = 'custom_';
export const MAX_CUSTOM_ROLES = 30;
export const MAX_LABEL_LEN = 12;

/** 规整自定义角色列表：校验、去重、限量 */
export function normalizeCustomRoles(input) {
  if (!Array.isArray(input)) return [];
  const out = [];
  const seen = new Set();
  for (const raw of input) {
    if (out.length >= MAX_CUSTOM_ROLES) break;
    if (!raw || typeof raw !== 'object') continue;
    const label = String(raw.label || '').trim().slice(0, MAX_LABEL_LEN);
    if (!label) continue;
    // key 可以由前端给，也可以由 label 派生（此处只接受合法 key）
    let key = String(raw.key || '').trim();
    if (key && !/^[a-z][a-z0-9_]{0,40}$/.test(key)) continue;
    if (!key) {
      // 中文标签无法直接做 key，用序号兜底；实际调用方会传 key
      key = `${CUSTOM_PREFIX}${out.length + 1}`;
    }
    if (!key.startsWith(CUSTOM_PREFIX)) key = CUSTOM_PREFIX + key;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      key,
      label,
      note: String(raw.note || '').trim().slice(0, 100),
    });
  }
  return out;
}

/**
 * 合并内置与自定义角色。
 * @returns {{ all: string[], labels: Record<string,string>, custom: Array }}
 */
export function resolveRoles(customRoles = []) {
  const custom = normalizeCustomRoles(customRoles);
  const labels = { ...BUILTIN_LABELS };
  for (const c of custom) labels[c.key] = c.label;
  return {
    all: [...BUILTIN_ROLES, ...custom.map((c) => c.key)],
    labels,
    custom,
  };
}

/** 角色是否合法（内置或自定义） */
export function isKnownRole(role, customRoles = []) {
  const { all } = resolveRoles(customRoles);
  return all.includes(String(role || ''));
}

/** 角色显示名，未知角色原样返回 */
export function roleLabel(role, customRoles = []) {
  const { labels } = resolveRoles(customRoles);
  return labels[role] || String(role || '');
}

/** 校验「新增自定义角色」的请求体，返回 { ok, role } 或 { ok:false, error } */
export function validateNewRole(body, existing = []) {
  const label = String(body?.label || '').trim();
  if (!label) return { ok: false, error: '角色名称必填' };
  if (label.length > MAX_LABEL_LEN) return { ok: false, error: `角色名称不能超过 ${MAX_LABEL_LEN} 字` };

  const list = normalizeCustomRoles(existing);
  if (list.length >= MAX_CUSTOM_ROLES) {
    return { ok: false, error: `自定义角色最多 ${MAX_CUSTOM_ROLES} 个` };
  }
  if (list.some((r) => r.label === label)) {
    return { ok: false, error: '该角色名称已存在' };
  }
  // 与内置标签重名也拒绝，避免同一个术语两种 key
  if (Object.values(BUILTIN_LABELS).includes(label)) {
    return { ok: false, error: '该名称与内置角色重复' };
  }

  const key = `${CUSTOM_PREFIX}${Date.now().toString(36).slice(-5)}${list.length}`;
  return { ok: true, role: { key, label, note: String(body?.note || '').trim().slice(0, 100) } };
}

/** 删除自定义角色（内置不可删） */
export function removeRole(customRoles, key) {
  const list = normalizeCustomRoles(customRoles);
  if (!String(key || '').startsWith(CUSTOM_PREFIX)) {
    return { ok: false, error: '内置角色不可删除', roles: list };
  }
  const next = list.filter((r) => r.key !== key);
  if (next.length === list.length) return { ok: false, error: '角色不存在', roles: list };
  return { ok: true, roles: next };
}