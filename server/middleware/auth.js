import jwt from 'jsonwebtoken';
import { query } from '../db/db.js';
import { config, ROLE } from '../config/index.js';

export async function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: '缺少认证令牌' });

  try {
    const payload = jwt.verify(token, config.jwtSecret);
    const { rows } = await query(
      `SELECT u.id, u.username, u.role AS base_role, u.status, u.person_id, u.token_version
       FROM users u WHERE u.id = $1`,
      [payload.sub]
    );
    if (!rows.length) return res.status(401).json({ error: '账户不存在' });
    const user = rows[0];
    if (user.status !== 'active') return res.status(403).json({ error: '账户已被停用' });
    // 改密后 token_version 自增，旧令牌立即失效
    if ((payload.ver ?? 0) !== (user.token_version ?? 0)) {
      return res.status(401).json({ error: '登录状态已失效，请重新登录' });
    }
    req.user = {
      id: user.id,
      username: user.username,
      role: user.base_role,        // MVP 阶段用 users.role；阶段2 以 user_family_role 为准
      personId: user.person_id,
    };
    next();
  } catch (err) {
    return res.status(401).json({ error: '令牌无效或已过期' });
  }
}

/** 仅管理员可访问 */
export function adminOnly(req, res, next) {
  if (req.user.role !== ROLE.ADMIN) {
    return res.status(403).json({ error: '仅家族管理员可执行此操作' });
  }
  next();
}

/** 管理员或编辑可访问 */
export function editorUp(req, res, next) {
  if (![ROLE.ADMIN, ROLE.EDITOR].includes(req.user.role)) {
    return res.status(403).json({ error: '需要编辑权限' });
  }
  next();
}
