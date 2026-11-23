/** 成员可编辑字段的统一映射（persons PUT 与变更提案审批共用） */

export function parseDate(v) {
  // undefined = 本次未提交（局部更新保留原值）；null/'' = 明确清空
  if (v === undefined) return undefined;
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

export const EDITABLE_PERSON_FIELDS = [
  'family_name', 'given_name', 'courtesy_name', 'former_names',
  'generation_name', 'generation_no', 'branch', 'gender',
  'birth_date', 'birth_precision', 'birth_place',
  'death_date', 'death_precision', 'death_place', 'burial_place',
  'is_deceased', 'occupation', 'education', 'bio',
];

/** 从请求体构造 person 表的 UPDATE 字段集合（不含 contact / privacy_override） */
export function buildPersonUpdate(body = {}) {
  const fields = {
    family_name: body.family_name,
    given_name: body.given_name,
    courtesy_name: body.courtesy_name,
    generation_name: body.generation_name,
    generation_no: body.generation_no,
    branch: body.branch,
    gender: body.gender,
    birth_date: parseDate(body.birth_date),
    birth_precision: body.birth_precision,
    birth_place: body.birth_place,
    death_date: parseDate(body.death_date),
    death_precision: body.death_precision,
    death_place: body.death_place,
    burial_place: body.burial_place,
    is_deceased: body.is_deceased,
    occupation: body.occupation,
    education: body.education,
    bio: body.bio,
  };
  if (body.former_names !== undefined) {
    fields.former_names = JSON.stringify(Array.isArray(body.former_names) ? body.former_names : []);
  }
  return fields;
}

/** 只保留成员可编辑字段（用于变更提案的 payload） */
export function pickEditablePayload(payload = {}) {
  const out = {};
  for (const field of EDITABLE_PERSON_FIELDS) {
    if (payload[field] !== undefined) out[field] = payload[field];
  }
  return out;
}
