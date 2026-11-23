import express from 'express';
import { query } from '../db/db.js';
import { logger } from '../modules/logger.js';

const router = express.Router();

/** 计算邀请状态（数据库 status 之外还要看有效期/次数） */
export function invitationState(inv, now = new Date()) {
  if (inv.status === 'revoked') return 'revoked';
  if (inv.status === 'exhausted' || inv.used_count >= inv.max_uses) return 'exhausted';
  if (inv.expires_at && new Date(inv.expires_at).getTime() < now.getTime()) return 'expired';
  return 'active';
}

const STATE_MESSAGE = {
  revoked: '邀请已被撤销',
  exhausted: '邀请使用次数已用完',
  expired: '邀请已过期',
};

// 公开：校验邀请链接（注册页展示目标成员与角色用）
router.get('/:token', async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT i.*, p.family_name, p.given_name
       FROM invitation i LEFT JOIN person p ON p.id = i.target_person_id
       WHERE i.token = $1`,
      [req.params.token]
    );
    if (!rows.length) return res.status(404).json({ error: '邀请链接无效', state: 'notfound' });

    const inv = rows[0];
    const state = invitationState(inv);
    if (state !== 'active') return res.status(410).json({ error: STATE_MESSAGE[state], state });

    res.json({
      valid: true,
      role: inv.role,
      targetName: inv.family_name ? `${inv.family_name}${inv.given_name}` : null,
      expiresAt: inv.expires_at,
      remainingUses: inv.max_uses - inv.used_count,
    });
  } catch (err) {
    logger.error('[invitations] get:', err);
    res.status(500).json({ error: '邀请校验失败' });
  }
});

export default router;
