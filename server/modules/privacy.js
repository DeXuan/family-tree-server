/**
 * 字段级隐私：L0 公开 / L1 族内 / L2 私密
 *
 * 规则：
 * - 管理员：全部可见
 * - 本人（users.person_id = person.id）：全部可见，可自行调整自己的 L1/L2 字段
 * - 族人 / 谱系编辑：L0 + L1；L2 仅出现"私密"占位
 * - 访客：仅 L0（姓名、字辈、世代、支系、生卒年份）
 * - 已故满 100 年（可配置）：L1 放宽为 L0（家史公开）
 *
 * 脱敏在接口层执行：未授权字段不出现在响应里（置 null + restricted 列表），
 * 而不是依赖前端隐藏。
 */

import { tryDecryptJSON } from './crypto.js';

export const LEVEL = { L0: 'L0', L1: 'L1', L2: 'L2' };

/** 字段 → 默认隐私级别 */
export const FIELD_LEVEL = {
  // L0：公开（族谱骨架）
  family_name: 'L0',
  given_name: 'L0',
  courtesy_name: 'L0',
  generation_name: 'L0',
  generation_no: 'L0',
  branch: 'L0',
  gender: 'L0',
  is_deceased: 'L0',
  deceased_assumed: 'L0',
  status: 'L0',

  // L1：族内
  former_names: 'L1',
  birth_date: 'L1',
  birth_precision: 'L1',
  birth_date_end: 'L1',
  birth_place: 'L1',
  death_date: 'L1',
  death_precision: 'L1',
  death_date_end: 'L1',
  death_place: 'L1',
  burial_place: 'L1',
  occupation: 'L1',
  education: 'L1',
  bio: 'L1',
  extra: 'L1',
  avatar_media_id: 'L1',

  // L2：私密
  contact: 'L2',
};

const FIELD_KEYS = Object.keys(FIELD_LEVEL);

/** 本人可自助调整的字段（不允许把私密字段公开为 L0） */
export const SELF_ADJUSTABLE_FIELDS = FIELD_KEYS.filter((f) => FIELD_LEVEL[f] !== 'L0');

const RANK = { L0: 0, L1: 1, L2: 2 };

export function canSee(level, ctx) {
  const max = ctx.isAdmin || ctx.isSelf ? 2 : ctx.role === 'guest' ? 0 : 1;
  return RANK[level] <= max;
}

function yearOf(v) {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return isNaN(d.getTime()) ? null : d.getUTCFullYear();
}

function deceasedOver100Years(person, now = new Date()) {
  if (!person.is_deceased) return false;
  const y = yearOf(person.death_date) ?? (person.birth_date ? yearOf(person.birth_date) + 80 : null);
  if (!y) return false;
  return now.getUTCFullYear() - y >= 100;
}

/** 生效级别：本人/管理员设置的 override 优先；已故满百年 L1 放宽为 L0 */
export function effectiveLevel(person, field, now = new Date()) {
  const override = person.privacy_override?.[field];
  let level = [LEVEL.L0, LEVEL.L1, LEVEL.L2].includes(override) ? override : FIELD_LEVEL[field];
  if (!level) return LEVEL.L0;
  if (level === LEVEL.L1 && deceasedOver100Years(person, now)) level = LEVEL.L0;
  return level;
}

/**
 * 脱敏单个成员。
 * @param {object} person 数据库行
 * @param {{role:string, isSelf:boolean, isAdmin:boolean}} ctx
 */
export function redactPerson(person, ctx) {
  const out = { ...person };
  out.restricted = [];

  // 生卒年份属于 L0，任何登录用户可见
  out.birth_year = yearOf(person.birth_date);
  out.death_year = yearOf(person.death_date);

  for (const field of FIELD_KEYS) {
    if (field === 'contact') continue; // 单独处理
    if (canSee(effectiveLevel(person, field), ctx)) continue;
    if (out[field] !== null && out[field] !== undefined && out[field] !== '') {
      out[field] = null;
      out.restricted.push(field);
    }
  }

  const contactVisible = canSee(effectiveLevel(person, 'contact'), ctx);
  if (!contactVisible) {
    out.contact = null;
    out.restricted.push('contact');
  } else {
    const plain = tryDecryptJSON(person.contact);
    out.contact = plain;
    if (plain === null && person.contact) out.restricted.push('contact');
  }

  if (!(ctx.isAdmin || ctx.isSelf)) {
    out.privacy_override = {};
  }

  out.canEditPrivacy = !!(ctx.isAdmin || ctx.isSelf);
  return out;
}

export function redactList(persons, ctx) {
  return persons.map((p) => redactPerson(p, ctx));
}

/** 当前生效级别的全量映射（个人中心用） */
export function levelMap(person) {
  const map = {};
  for (const field of FIELD_KEYS) map[field] = effectiveLevel(person, field);
  return map;
}
