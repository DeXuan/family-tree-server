/**
 * 方言称谓映射：标准称谓 → 各方言的口语称呼。
 *
 * 覆盖常见汉语方言区（吴语/粤语/闽南/客家/西南官话/胶辽官话），
 * 只映射高频、口语中确实不同的称谓；没有对应项时回退标准称谓。
 *
 * 纯数据 + 纯函数，便于单元测试。
 */

export const DIALECT_LABEL = {
  standard: '标准（普通话）',
  wu: '吴语（江浙沪）',
  yue: '粤语（广府）',
  minnan: '闽南语',
  hakka: '客家话',
  southwest: '西南官话（川渝）',
  jiaoliao: '胶辽官话（胶东）',
};

/** 按方言分组的称谓覆盖表 */
const TABLE = {
  wu: {
    父亲: '阿爸', 母亲: '姆妈',
    祖父: '阿爷', 祖母: '阿娘',
    外祖父: '外公', 外祖母: '外婆',
    伯父: '大伯', 叔父: '小叔', 姑母: '娘娘',
    舅父: '娘舅', 舅母: '舅妈',
    姨母: '姨妈', 姨父: '姨夫',
    姐姐: '阿姐', 妹妹: '妹妹', 哥哥: '阿哥', 弟弟: '弟弟',
    儿子: '儿子', 女儿: '囡囡',
    孙子: '孙子', 孙女: '囡孙',
    丈夫: '老公', 妻子: '老婆',
  },
  yue: {
    父亲: '老豆', 母亲: '老母',
    祖父: '阿爷', 祖母: '阿嫲',
    外祖父: '公公', 外祖母: '婆婆',
    伯父: '伯父', 叔父: '叔父', 姑母: '姑姐',
    舅父: '舅父', 舅母: '妗母',
    姨母: '姨妈', 姨父: '姨丈',
    姐姐: '家姐', 妹妹: '细妹', 哥哥: '大佬', 弟弟: '细佬',
    儿子: '仔', 女儿: '女',
    孙子: '孙', 孙女: '孙女',
    丈夫: '老公', 妻子: '老婆',
  },
  minnan: {
    父亲: '阿爸', 母亲: '阿母',
    祖父: '阿公', 祖母: '阿嬷',
    外祖父: '外公', 外祖母: '外嬷',
    伯父: '阿伯', 叔父: '阿叔', 姑母: '阿姑',
    舅父: '阿舅', 舅母: '阿妗',
    姨母: '阿姨', 姨父: '姨丈',
    姐姐: '阿姐', 妹妹: '小妹', 哥哥: '阿兄', 弟弟: '小弟',
    儿子: '后生', 女儿: '查某囝',
    丈夫: '丈夫', 妻子: '某',
  },
  hakka: {
    父亲: '阿爸', 母亲: '阿姆',
    祖父: '阿公', 祖母: '阿婆',
    外祖父: '姐公', 外祖母: '姐婆',
    伯父: '阿伯', 叔父: '阿叔', 姑母: '阿姑',
    舅父: '阿舅', 舅母: '舅娘',
    姨母: '阿姨', 姨父: '姨丈',
    姐姐: '阿姐', 妹妹: '老妹', 哥哥: '阿哥', 弟弟: '老弟',
    儿子: '赖子', 女儿: '妹子',
    丈夫: '老公', 妻子: '老婆',
  },
  southwest: {
    父亲: '老汉儿', 母亲: '妈',
    祖父: '爷爷', 祖母: '婆婆',
    外祖父: '外公', 外祖母: '外婆',
    伯父: '大伯', 叔父: '幺爸', 姑母: '嬢嬢',
    舅父: '舅舅', 舅母: '舅妈',
    姨母: '姨妈', 姨父: '姨爹',
    姐姐: '姐', 妹妹: '妹儿', 哥哥: '哥', 弟弟: '弟娃儿',
    儿子: '娃儿', 女儿: '女娃儿',
    丈夫: '老公', 妻子: '婆娘',
  },
  jiaoliao: {
    父亲: '爹', 母亲: '娘',
    祖父: '爷爷', 祖母: '奶奶',
    外祖父: '姥爷', 外祖母: '姥姥',
    伯父: '大爷', 叔父: '叔叔', 姑母: '姑姑',
    舅父: '舅舅', 舅母: '舅母',
    姨母: '姨', 姨父: '姨父',
    姐姐: '姐', 妹妹: '妹', 哥哥: '哥', 弟弟: '弟',
    儿子: '儿', 女儿: '闺女',
    丈夫: '对象', 妻子: '媳妇',
  },
};

/** 支持的方言键 */
export function dialectKeys() {
  return Object.keys(DIALECT_LABEL);
}

/** 该方言是否有覆盖表 */
export function hasDialect(dialect) {
  if (!dialect || dialect === 'standard') return true;
  return Object.prototype.hasOwnProperty.call(TABLE, dialect);
}

/**
 * 把标准称谓翻译成方言口语称呼。
 * 无对应项、或方言为 standard/未知时返回标准称谓。
 */
export function toDialect(term, dialect) {
  const std = String(term || '').trim();
  if (!std) return std;
  if (!dialect || dialect === 'standard') return std;
  const table = TABLE[dialect];
  if (!table) return std;
  return table[std] || std;
}

/**
 * 给 kinship 结果附加方言字段。
 * @param {{term:string}} result
 * @param {string} dialect
 * @returns {object} 新对象，含 term（标准）与 dialectTerm
 */
export function withDialect(result, dialect) {
  if (!result || typeof result !== 'object') return result;
  const dialectTerm = toDialect(result.term, dialect);
  return {
    ...result,
    dialect: dialect && dialect !== 'standard' ? dialect : 'standard',
    dialectTerm,
    // 是否与标准称谓不同（前端据此决定要不要显示括号注）
    dialectDiffers: dialectTerm !== result.term,
  };
}

/** 供 UI 渲染的完整对照表（某方言 vs 标准） */
export function dialectGlossary(dialect) {
  const table = dialect === 'standard' ? {} : (TABLE[dialect] || {});
  return Object.keys({ ...TABLE.wu, ...TABLE.yue, ...TABLE.minnan, ...TABLE.hakka, ...TABLE.southwest, ...TABLE.jiaoliao })
    .sort((a, b) => a.localeCompare(b, 'zh'))
    .map((standard) => ({ standard, dialect: table[standard] || standard }));
}

// ---------------------------------------------------------------------------
// 家族自定义词条：允许覆盖内置映射里的个别称谓
// 存 family.settings.dialectOverrides = { wu: { 父亲: '阿爹' }, ... }
// ---------------------------------------------------------------------------

export const MAX_OVERRIDES = 60;
const MAX_TERM_LEN = 10;

/** 规整自定义词条：只保留合法方言键 + 非空短词条，限量 */
export function normalizeOverrides(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const out = {};
  let count = 0;
  for (const [dialect, map] of Object.entries(input)) {
    if (dialect === 'standard' || !TABLE[dialect]) continue;
    if (!map || typeof map !== 'object' || Array.isArray(map)) continue;
    const clean = {};
    for (const [std, term] of Object.entries(map)) {
      if (count >= MAX_OVERRIDES) break;
      const s = String(std || '').trim();
      const t = String(term || '').trim();
      if (!s || !t) continue;
      if (s.length > MAX_TERM_LEN || t.length > MAX_TERM_LEN) continue;
      clean[s] = t;
      count++;
    }
    if (Object.keys(clean).length) out[dialect] = clean;
  }
  return out;
}

/**
 * 带自定义词条的翻译：先查家族覆盖，再查内置表。
 * @param {string} term 标准称谓
 * @param {string} dialect 方言键
 * @param {object} overrides 家族自定义词条
 */
export function toDialectWithOverrides(term, dialect, overrides = {}) {
  const std = String(term || '').trim();
  if (!std) return std;
  if (!dialect || dialect === 'standard') return std;
  const ov = overrides?.[dialect];
  if (ov && typeof ov === 'object' && ov[std]) return ov[std];
  return toDialect(std, dialect);
}

/** 该方言生效的完整映射（内置 + 覆盖），用于对照表展示 */
export function effectiveTable(dialect, overrides = {}) {
  const builtin = dialect === 'standard' ? {} : { ...(TABLE[dialect] || {}) };
  const ov = overrides?.[dialect];
  if (ov && typeof ov === 'object') {
    for (const [k, v] of Object.entries(ov)) builtin[k] = v;
  }
  return builtin;
}

/** 对照表（含自定义覆盖标记） */
export function glossaryWithOverrides(dialect, overrides = {}) {
  const builtin = effectiveTable(dialect, {});
  const ov = overrides?.[dialect] || {};
  const merged = effectiveTable(dialect, overrides);
  const keys = Object.keys({ ...builtin, ...merged }).sort((a, b) => a.localeCompare(b, 'zh'));
  return keys.map((standard) => ({
    standard,
    dialect: merged[standard] ?? standard,
    overridden: Object.prototype.hasOwnProperty.call(ov, standard),
  }));
}

/** 校验一条覆盖词条 */
export function validateOverride({ dialect, standard, term }) {
  const d = String(dialect || '').trim();
  if (d === 'standard' || !TABLE[d]) return { ok: false, error: '请选择受支持的方言' };
  const s = String(standard || '').trim();
  const t = String(term || '').trim();
  if (!s) return { ok: false, error: '标准称谓必填' };
  if (!t) return { ok: false, error: '方言称谓必填' };
  if (s.length > MAX_TERM_LEN) return { ok: false, error: `标准称谓不能超过 ${MAX_TERM_LEN} 字` };
  if (t.length > MAX_TERM_LEN) return { ok: false, error: `方言称谓不能超过 ${MAX_TERM_LEN} 字` };
  return { ok: true, override: { dialect: d, standard: s, term: t } };
}

/** 应用一条覆盖（返回新的 overrides 对象） */
export function applyOverride(overrides, { dialect, standard, term }) {
  const base = normalizeOverrides(overrides);
  const next = { ...base, [dialect]: { ...(base[dialect] || {}), [standard]: term } };
  let count = 0;
  for (const m of Object.values(next)) count += Object.keys(m).length;
  if (count > MAX_OVERRIDES) return { ok: false, error: `自定义词条最多 ${MAX_OVERRIDES} 条`, overrides: base };
  return { ok: true, overrides: next };
}

/** 移除一条覆盖 */
export function removeOverride(overrides, { dialect, standard }) {
  const base = normalizeOverrides(overrides);
  const map = base[dialect];
  if (!map || !Object.prototype.hasOwnProperty.call(map, standard)) {
    return { ok: false, error: '没有这条自定义词条', overrides: base };
  }
  const nextMap = { ...map };
  delete nextMap[standard];
  const next = { ...base };
  if (Object.keys(nextMap).length) next[dialect] = nextMap;
  else delete next[dialect];
  return { ok: true, overrides: next };
}

/** 让 withDialect 支持覆盖（保持向后兼容：不传 overrides 时行为不变） */
export function withDialectAndOverrides(result, dialect, overrides = {}) {
  if (!result || typeof result !== 'object') return result;
  const dialectTerm = toDialectWithOverrides(result.term, dialect, overrides);
  return {
    ...result,
    dialect: dialect && dialect !== 'standard' ? dialect : 'standard',
    dialectTerm,
    dialectDiffers: dialectTerm !== result.term,
  };
}
