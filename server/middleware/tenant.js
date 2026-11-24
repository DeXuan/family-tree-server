/**
 * 多家族（租户）上下文。
 *
 * 设计：
 * - 用 AsyncLocalStorage 保存「当前请求属于哪个家族」，天然并发安全；
 * - 所有路由把 `FAMILY_ID` 常量替换为 `currentFamilyId()` 调用后，自动按请求隔离；
 * - 未登录/未指定时回退 `config.familyId`（保持单家族部署行为完全不变）；
 * - 用户切换家族前必须校验 `user_family_role` 里确实有该家族的角色，避免越权。
 *
 * 安全要点：familyId 只从「已验签的 JWT」或「服务端会话」取，绝不信任裸请求头。
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';
import { query } from '../db/db.js';
import { logger } from '../modules/logger.js';

const als = new AsyncLocalStorage();

/** 当前请求的家族 ID（无上下文时回退默认家族） */
export function currentFamilyId() {
  const store = als.getStore();
  return store?.familyId || config.familyId;
}

/** 在指定家族上下文里执行（主要供后台任务/脚本使用） */
export function runWithFamily(familyId, fn) {
  return als.run({ familyId: familyId || config.familyId }, fn);
}

/** 该用户可访问的家族列表（含角色） */
export async function familiesOfUser(userId) {
  if (!userId) return [];
  const { rows } = await query(
    `SELECT f.id, f.name, f.surname, ufr.role
     FROM user_family_role ufr
     JOIN family f ON f.id = ufr.family_id
     WHERE ufr.user_id = $1
     ORDER BY f.name`,
    [userId]
  );
  return rows;
}

/** 校验用户对某家族是否有权限；返回角色或 null */
export async function roleInFamily(userId, familyId) {
  if (!userId || !familyId) return null;
  const { rows } = await query(
    'SELECT role FROM user_family_role WHERE user_id = $1 AND family_id = $2',
    [userId, familyId]
  );
  return rows[0]?.role || null;
}

/**
 * 全局中间件：从 JWT 解析 user + 选定家族，写入 ALS。
 * 注意：这里只做「上下文准备」，真正的鉴权仍由各路由的 auth 中间件负责。
 */
export function tenantContext(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return als.run({ familyId: config.familyId }, next);

  let payload;
  try {
    payload = jwt.verify(token, config.jwtSecret);
  } catch {
    return als.run({ familyId: config.familyId }, next);
  }

  // 显式请求的家族（优先），否则用 token 里的默认家族
  const requested = String(req.headers['x-family-id'] || '') || payload.familyId || '';
  if (!requested) return als.run({ familyId: config.familyId }, next);

  // 异步校验权限后再进入下一步
  (async () => {
    try {
      const role = await roleInFamily(payload.sub, requested);
      if (role) {
        req.familyId = requested;
        req.familyRole = role;
        return als.run({ familyId: requested }, next);
      }
      // 无权限：回退默认家族（不报错，避免信息泄露）
      return als.run({ familyId: config.familyId }, next);
    } catch (err) {
      logger.error('[tenant] resolve failed:', err);
      return als.run({ familyId: config.familyId }, next);
    }
  })();
}

/** 该用户是否可访问多个家族（前端据此决定是否显示切换器） */
export async function isMultiFamilyUser(userId) {
  const list = await familiesOfUser(userId);
  return list.length > 1;
}