/**
 * 备份文件格式与校验（纯函数，不依赖数据库，便于单元测试）。
 */

export const BACKUP_VERSION = 1;
export const TABLE_ORDER = [
  'family', 'person', 'place', 'association', 'story', 'story_person', 'story_version',
  'repository', 'source', 'citation', 'media', 'media_link',
  'parent_child', 'marriage', 'event', 'users', 'user_family_role',
];

/** 每张表的列（恢复时按此顺序写，避免依赖 SELECT * 的列顺序） */
export const TABLE_COLUMNS = {
  family: ['id', 'name', 'surname', 'privacy_policy', 'settings', 'created_at', 'updated_at'],
  person: [
    'id', 'family_id', 'family_name', 'given_name', 'former_names', 'courtesy_name',
    'generation_name', 'generation_no', 'branch', 'gender',
    'birth_date', 'birth_precision', 'birth_date_end', 'birth_place',
    'death_date', 'death_precision', 'death_date_end', 'death_place', 'burial_place',
    'is_deceased', 'deceased_assumed', 'occupation', 'education', 'bio',
    'avatar_media_id', 'contact', 'privacy_override', 'extra', 'status',
    'created_at', 'updated_at',
  ],
  place: [
    'id', 'family_id', 'name', 'province', 'city', 'lat', 'lng',
    'aliases', 'note', 'parent_id', 'created_at', 'updated_at',
  ],
  story: [
    'id', 'family_id', 'title', 'body', 'author_name', 'story_date', 'date_precision',
    'visibility', 'created_by', 'created_at', 'updated_at',
  ],
  story_person: ['id', 'story_id', 'person_id', 'role'],
  story_version: [
    'id', 'story_id', 'version_no', 'title', 'body', 'author_name', 'story_date',
    'date_precision', 'visibility', 'person_ids', 'saved_by', 'saved_label', 'note', 'created_at',
  ],
  association: [
    'id', 'family_id', 'person_a_id', 'person_b_id', 'role', 'note', 'created_by', 'created_at',
  ],
  repository: [
    'id', 'family_id', 'name', 'address', 'contact', 'note',
    'created_by', 'created_at', 'updated_at',
  ],
  source: [
    'id', 'family_id', 'title', 'author', 'publication', 'repository', 'repository_id', 'note',
    'created_by', 'created_at', 'updated_at',
  ],
  citation: [
    'id', 'family_id', 'source_id', 'target_type', 'target_id',
    'page', 'confidence', 'note', 'created_by', 'created_at',
  ],
  media: [
    'id', 'family_id', 'file_key', 'original_name', 'mime', 'size_bytes',
    'media_type', 'caption', 'visibility', 'uploaded_by', 'created_at',
  ],
  media_link: ['id', 'media_id', 'target_type', 'target_id', 'created_at'],
  parent_child: ['id', 'parent_id', 'child_id', 'relation_type', 'certainty', 'note', 'created_at'],
  marriage: [
    'id', 'person_a_id', 'person_b_id', 'union_type', 'status',
    'start_date', 'start_precision', 'end_date', 'end_precision', 'place', 'note', 'created_at',
  ],
  event: [
    'id', 'person_id', 'event_type', 'title', 'description',
    'event_date', 'event_precision', 'event_date_end', 'place', 'visibility',
    'created_at', 'updated_at',
  ],
  users: [
    'id', 'username', 'password_hash', 'person_id', 'role', 'status',
    'two_factor_enabled', 'two_factor_secret', 'token_version',
    'failed_attempts', 'locked_until', 'totp_secret', 'totp_recovery', 'totp_enabled',
    'created_at', 'updated_at',
  ],
  user_family_role: ['id', 'user_id', 'family_id', 'role', 'scope_branch', 'created_at'],
};

/** JSONB 列需要显式序列化（只列真正的 JSONB 字段，切勿把表结构写进来） */
export const JSON_COLUMNS = {
  family: ['privacy_policy', 'settings'],
  person: ['former_names', 'contact', 'privacy_override', 'extra'],
  users: ['totp_recovery'],
  place: ['aliases'],
  association: [],
  story: [],
};

export function summarize(payload) {
  const counts = {};
  for (const t of TABLE_ORDER) counts[t] = payload?.data?.[t]?.length ?? 0;
  return counts;
}

/**
 * 校验备份结构 + 引用完整性。
 * @returns {{ok: boolean, errors: string[], counts: object}}
 */
export function validateBackup(payload) {
  const errors = [];
  if (!payload || typeof payload !== 'object') {
    return { ok: false, errors: ['备份内容不是对象'], counts: {} };
  }
  if (payload.version !== BACKUP_VERSION) {
    errors.push(`备份版本不支持：${payload.version}（期望 ${BACKUP_VERSION}）`);
  }
  if (payload.app !== 'family-tree') {
    errors.push('不是本系统的备份文件');
  }
  const data = payload.data;
  if (!data || typeof data !== 'object') {
    return { ok: false, errors: [...errors, '缺少 data 段'], counts: {} };
  }

  for (const t of TABLE_ORDER) {
    if (!Array.isArray(data[t])) errors.push(`表 ${t} 缺失或不是数组`);
  }
  if (errors.length) return { ok: false, errors, counts: {} };

  const ids = (rows) => new Set(rows.map((r) => r.id));
  const familyIds = ids(data.family);
  const personIds = ids(data.person);
  const userIds = ids(data.users);
  const mediaIds = ids(data.media);
  const sourceIds = ids(data.source);
  const eventIds = ids(data.event);

  if (!familyIds.size) errors.push('备份中没有家族记录');
  if (!personIds.size) errors.push('备份中没有成员记录');

  const badRef = (label, rows, field, refSet) => {
    let n = 0;
    for (const r of rows) {
      const v = r[field];
      if (v !== null && v !== undefined && !refSet.has(v)) n++;
    }
    if (n) errors.push(`${label}.${field} 有 ${n} 条引用了不存在的记录`);
  };

  badRef('person', data.person, 'family_id', familyIds);
  badRef('place', data.place, 'family_id', familyIds);
  badRef('story', data.story, 'family_id', familyIds);
  badRef('story_person', data.story_person, 'person_id', personIds);
  badRef('association', data.association, 'family_id', familyIds);
  badRef('association', data.association, 'person_a_id', personIds);
  badRef('association', data.association, 'person_b_id', personIds);
  badRef('repository', data.repository, 'family_id', familyIds);
  badRef('source', data.source, 'family_id', familyIds);
  if (Array.isArray(data.repository) && Array.isArray(data.source)) {
    const repoIds = new Set(data.repository.map((r) => r.id));
    let nRepo = 0;
    for (const srow of data.source) {
      const v = srow.repository_id;
      if (v !== null && v !== undefined && !repoIds.has(v)) nRepo++;
    }
    if (nRepo) errors.push(`source.repository_id 有 ${nRepo} 条引用了不存在的收藏地`);
  }
  badRef('citation', data.citation, 'family_id', familyIds);
  badRef('citation', data.citation, 'source_id', sourceIds);
  for (const c of data.citation) {
    const pool = c.target_type === 'event' ? eventIds : personIds;
    if (!pool.has(c.target_id)) {
      errors.push(`citation.target_id 引用了不存在的 ${c.target_type}`);
      break;
    }
  }
  badRef('media', data.media, 'family_id', familyIds);
  badRef('media_link', data.media_link, 'media_id', mediaIds);
  badRef('media_link', data.media_link, 'target_id', personIds);
  badRef('parent_child', data.parent_child, 'parent_id', personIds);
  badRef('parent_child', data.parent_child, 'child_id', personIds);
  badRef('marriage', data.marriage, 'person_a_id', personIds);
  badRef('marriage', data.marriage, 'person_b_id', personIds);
  badRef('event', data.event, 'person_id', personIds);
  badRef('users', data.users, 'person_id', personIds);
  badRef('user_family_role', data.user_family_role, 'user_id', userIds);
  badRef('user_family_role', data.user_family_role, 'family_id', familyIds);

  const roles = new Set(['admin', 'editor', 'member', 'guest']);
  const badRole = (label, rows) => {
    const n = rows.filter((r) => !roles.has(r.role)).length;
    if (n) errors.push(`${label}.role 有 ${n} 条非法角色`);
  };
  badRole('users', data.users);
  badRole('user_family_role', data.user_family_role);

  return { ok: errors.length === 0, errors, counts: summarize(payload) };
}

/** 按保留份数挑出应删除的备份（list 需按时间倒序） */
export function selectPrunable(list, keep) {
  const k = Math.max(1, Number(keep) || 1);
  return list.slice(k);
}

/** 构造插入语句（供恢复脚本使用） */
export function insertStatement(table, rowCount) {
  const cols = TABLE_COLUMNS[table];
  let idx = 1;
  const rows = Array.from({ length: rowCount }, () =>
    `(${cols.map(() => `$${idx++}`).join(',')})`).join(',');
  return `INSERT INTO ${table} (${cols.join(',')}) VALUES ${rows}`;
}
