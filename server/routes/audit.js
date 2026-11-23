import { query } from '../db/db.js';
import { logger } from '../modules/logger.js';

/**
 * 写入审计日志（只追加）。
 * @param {object} opts
 * @param {string|null} opts.familyId  家族 id
 * @param {string|null} opts.actorUserId 操作者 user id
 * @param {string} opts.actorLabel  操作者名快照
 * @param {string} opts.action  动作：create/update/delete/login/export/privacy_change/grant…
 * @param {string} opts.entityType 实体类型
 * @param {string|null} opts.entityId 实体 id
 * @param {object|null} opts.before 改前值
 * @param {object|null} opts.after  改后值
 * @param {string|null} opts.ip
 */
export async function audit({
  familyId = null,
  actorUserId = null,
  actorLabel = '',
  action,
  entityType,
  entityId = null,
  before = null,
  after = null,
  ip = null,
}) {
  try {
    await query(
      `INSERT INTO audit_log (family_id, actor_user_id, actor_label, action, entity_type, entity_id, before, after, ip)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [familyId, actorUserId, actorLabel, action, entityType, entityId,
       before ? JSON.stringify(before) : null,
       after ? JSON.stringify(after) : null,
       ip]
    );
  } catch (err) {
    // 审计失败不阻断主流程，但必须可见
    logger.error('[audit] failed to write log:', err.message);
  }
}
