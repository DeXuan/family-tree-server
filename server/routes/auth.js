import express from 'express';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { query, withTransaction } from '../db/db.js';
import { config } from '../config/index.js';
import { auth } from '../middleware/auth.js';
import { hashPassword, verifyPassword } from '../middleware/password.js';
import { audit } from './audit.js';
import { logger } from '../modules/logger.js';
import { validateBody } from '../middleware/validateBody.js';
import {
  generateTotpSecret, verifyTotp, generateRecoveryCodes,
  hashRecoveryCode, consumeRecoveryCode,
} from '../modules/totp.js';

const router = express.Router();

const MIN_PASSWORD = 8;
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

function signToken(user) {
  return jwt.sign(
    { sub: user.id, role: user.role, ver: user.token_version || 0 },
    config.jwtSecret,
    { expiresIn: '7d' }
  );
}

// ---------- 登录（失败锁定 + 令牌版本） ----------
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: '用户名和密码必填' });

    const { rows } = await query('SELECT * FROM users WHERE username = $1', [username]);
    const user = rows[0];
    const fail = () => res.status(401).json({ error: '用户名或密码错误' });
    if (!user) return fail();

    if (user.locked_until && new Date(user.locked_until).getTime() > Date.now()) {
      return res.status(429).json({ error: '登录失败次数过多，账户已临时锁定，请稍后再试' });
    }
    if (user.status !== 'active') return res.status(403).json({ error: '账户已被停用' });

    const ok = await verifyPassword(password, user.password_hash);
    if (!ok) {
      const attempts = (user.failed_attempts || 0) + 1;
      const lockedUntil = attempts >= MAX_FAILED
        ? new Date(Date.now() + LOCK_MINUTES * 60 * 1000)
        : null;
      await query('UPDATE users SET failed_attempts = $1, locked_until = $2 WHERE id = $3',
        [attempts, lockedUntil, user.id]);
      if (lockedUntil) {
        return res.status(429).json({ error: `登录失败次数过多，账户已锁定 ${LOCK_MINUTES} 分钟` });
      }
      return fail();
    }

    await query('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = $1', [user.id]);

    // 已启用 2FA：密码正确后先返回挑战，要求第二步验证码/恢复码
    if (user.totp_enabled && user.totp_secret) {
      return res.json({
        twoFactorRequired: true,
        challengeToken: signChallenge(user.id),
        message: '请输入验证器中的 6 位验证码，或使用恢复码',
      });
    }

    await audit({
      actorUserId: user.id,
      actorLabel: user.username,
      action: 'login',
      entityType: 'user',
      entityId: user.id,
      ip: req.ip,
    });

    res.json({
      token: signToken(user),
      user: { id: user.id, username: user.username, role: user.role, personId: user.person_id },
    });
  } catch (err) {
    logger.error('[auth] login:', err);
    res.status(500).json({ error: '登录失败' });
  }
});

// ---------- 双因素认证 ----------
function signChallenge(userId) {
  return jwt.sign({ sub: userId, purpose: '2fa' }, config.jwtSecret, { expiresIn: '5m' });
}

function verifyChallenge(token) {
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    return payload.purpose === '2fa' ? payload.sub : null;
  } catch {
    return null;
  }
}

// 第二步：TOTP 或恢复码
router.post('/login/2fa', async (req, res) => {
  const { challengeToken, code } = req.body || {};
  if (!challengeToken || !code) return res.status(400).json({ error: '缺少验证信息' });

  const userId = verifyChallenge(challengeToken);
  if (!userId) return res.status(401).json({ error: '验证已过期，请重新登录' });

  try {
    const { rows } = await query('SELECT * FROM users WHERE id = $1', [userId]);
    const user = rows[0];
    if (!user || user.status !== 'active' || !user.totp_enabled) {
      return res.status(401).json({ error: '账户状态异常' });
    }

    const raw = String(code).trim();
    let ok = false;
    let remaining = null;

    if (/^\d{6}$/.test(raw)) {
      ok = verifyTotp(user.totp_secret, raw);
    } else {
      // 恢复码：格式 XXXX-XXXX-XXXX，消费一个
      const hashes = Array.isArray(user.totp_recovery) ? user.totp_recovery : [];
      remaining = consumeRecoveryCode(hashes, raw);
      if (remaining) {
        await query('UPDATE users SET totp_recovery = $1 WHERE id = $2',
          [JSON.stringify(remaining), user.id]);
        ok = true;
      }
    }

    if (!ok) {
      return res.status(401).json({ error: '验证码或恢复码错误' });
    }

    await audit({
      actorUserId: user.id, actorLabel: user.username,
      action: 'login', entityType: 'user', entityId: user.id,
      after: { via: raw.includes('-') ? 'recovery' : 'totp' },
    });

    res.json({
      token: signToken(user),
      user: { id: user.id, username: user.username, role: user.role, personId: user.person_id },
      recoveryRemaining: remaining ? remaining.length : undefined,
    });
  } catch (err) {
    logger.error('[auth] 2fa:', err);
    res.status(500).json({ error: '验证失败' });
  }
});

// 开启 2FA 第一步：生成密钥与二维码 URI（需已登录）
router.post('/2fa/setup', auth, async (req, res) => {
  const { rows } = await query('SELECT id, username, totp_enabled FROM users WHERE id = $1', [req.user.id]);
  const user = rows[0];
  const { secret, uri } = generateTotpSecret(user.username);
  await query('UPDATE users SET totp_secret = $1 WHERE id = $2', [secret, user.id]);
  res.json({ secret, uri, enabled: !!user.totp_enabled });
});

// 开启 2FA 第二步：验证一次性验证码后启用，并返回恢复码
router.post('/2fa/enable', auth, async (req, res) => {
  const { code } = req.body || {};
  if (!/^\d{6}$/.test(String(code || ''))) {
    return res.status(400).json({ error: '请输入 6 位验证码' });
  }
  const { rows } = await query('SELECT id, username, totp_secret FROM users WHERE id = $1', [req.user.id]);
  const user = rows[0];
  if (!user?.totp_secret) return res.status(400).json({ error: '请先获取密钥' });
  if (!verifyTotp(user.totp_secret, code)) {
    return res.status(400).json({ error: '验证码错误或已过期' });
  }

  const codes = generateRecoveryCodes(10);
  const hashes = codes.map(hashRecoveryCode);
  await query(
    `UPDATE users SET totp_enabled = true, totp_recovery = $1,
       token_version = token_version + 1, updated_at = now()
     WHERE id = $2`,
    [JSON.stringify(hashes), user.id]
  );
  await audit({
    familyId: null,
    actorUserId: user.id, actorLabel: user.username,
    action: 'update', entityType: 'user', entityId: user.id,
    after: { twoFactorEnabled: true },
  });

  res.json({ ok: true, recoveryCodes: codes, tokenVersionBumped: true });
});

// 关闭 2FA（需密码确认）
router.post('/2fa/disable', auth, async (req, res) => {
  const v = validateBody(req, { password: { type: 'string', required: true, label: '密码', trim: false } });
  if (v.error) return res.status(400).json({ error: v.error });
  const { password } = v.value;
  const { rows } = await query('SELECT * FROM users WHERE id = $1', [req.user.id]);
  const user = rows[0];
  if (!(await verifyPassword(password || '', user.password_hash))) {
    return res.status(401).json({ error: '密码错误' });
  }
  await query(
    `UPDATE users SET totp_enabled = false, totp_secret = NULL,
       totp_recovery = '[]'::jsonb, updated_at = now() WHERE id = $1`,
    [user.id]
  );
  await audit({
    actorUserId: user.id, actorLabel: user.username,
    action: 'update', entityType: 'user', entityId: user.id,
    after: { twoFactorEnabled: false },
  });
  res.json({ ok: true });
});

// 重新生成恢复码
router.post('/2fa/recovery', auth, async (req, res) => {
  const v = validateBody(req, { password: { type: 'string', required: true, label: '密码', trim: false } });
  if (v.error) return res.status(400).json({ error: v.error });
  const { password } = v.value;
  const { rows } = await query('SELECT * FROM users WHERE id = $1', [req.user.id]);
  const user = rows[0];
  if (!user.totp_enabled) return res.status(400).json({ error: '尚未启用双因素认证' });
  if (!(await verifyPassword(password || '', user.password_hash))) {
    return res.status(401).json({ error: '密码错误' });
  }
  const codes = generateRecoveryCodes(10);
  await query('UPDATE users SET totp_recovery = $1 WHERE id = $2',
    [JSON.stringify(codes.map(hashRecoveryCode)), user.id]);
  res.json({ recoveryCodes: codes });
});

// 我的 2FA 状态
router.get('/2fa/status', auth, async (req, res) => {
  const { rows } = await query(
    'SELECT totp_enabled AS enabled, jsonb_array_length(totp_recovery) AS recovery_count FROM users WHERE id = $1',
    [req.user.id]
  );
  res.json({ enabled: !!rows[0]?.enabled, recoveryCount: rows[0]?.recovery_count || 0 });
});

// ---------- 邀请制注册 ----------
router.post('/register', async (req, res) => {
  const { token, username, password } = req.body || {};
  if (!token || !username || !password) return res.status(400).json({ error: '邀请码、用户名和密码必填' });
  if (String(password).length < MIN_PASSWORD) {
    return res.status(400).json({ error: `密码至少 ${MIN_PASSWORD} 位` });
  }
  if (!/^[\w.@-]{3,32}$/.test(username)) {
    return res.status(400).json({ error: '用户名需为 3–32 位字母、数字或 . _ @ -' });
  }

  try {
    const result = await withTransaction(async (client) => {
      const { rows: invRows } = await client.query(
        'SELECT * FROM invitation WHERE token = $1 FOR UPDATE', [token]
      );
      const inv = invRows[0];
      if (!inv) return { error: '邀请链接无效', status: 404 };
      if (inv.status === 'revoked') return { error: '邀请已被撤销', status: 410 };
      if (inv.status === 'exhausted' || inv.used_count >= inv.max_uses) {
        return { error: '邀请使用次数已用完', status: 410 };
      }
      if (inv.expires_at && new Date(inv.expires_at).getTime() < Date.now()) {
        return { error: '邀请已过期', status: 410 };
      }

      let personId = null;
      if (inv.target_person_id) {
        const { rows: persons } = await client.query(
          "SELECT id FROM person WHERE id = $1 AND status = 'active'", [inv.target_person_id]
        );
        if (!persons.length) return { error: '邀请绑定的成员不存在或已归档', status: 410 };
        const { rows: taken } = await client.query(
          'SELECT id FROM users WHERE person_id = $1', [inv.target_person_id]
        );
        if (taken.length) return { error: '该成员已绑定其他账户，请联系管理员', status: 409 };
        personId = inv.target_person_id;
      }

      const hash = await hashPassword(password);
      const { rows: created } = await client.query(
        `INSERT INTO users (id, username, password_hash, role, person_id, status)
         VALUES ($1,$2,$3,$4,$5,'active')
         RETURNING id, username, role, person_id`,
        [randomUUID(), username, hash, inv.role, personId]
      );

      const nextCount = inv.used_count + 1;
      const nextStatus = nextCount >= inv.max_uses ? 'exhausted' : 'active';
      await client.query(
        'UPDATE invitation SET used_count = $1, status = $2 WHERE id = $3',
        [nextCount, nextStatus, inv.id]
      );

      return { user: created[0], familyId: inv.family_id, role: inv.role };
    });

    if (result.error) return res.status(result.status || 400).json({ error: result.error });

    await audit({
      familyId: result.familyId,
      actorUserId: result.user.id,
      actorLabel: result.user.username,
      action: 'create',
      entityType: 'user',
      entityId: result.user.id,
      after: { username: result.user.username, role: result.role, via: 'invitation' },
      ip: req.ip,
    });

    res.status(201).json({
      token: signToken({ ...result.user, token_version: 0 }),
      user: {
        id: result.user.id,
        username: result.user.username,
        role: result.user.role,
        personId: result.user.person_id,
      },
    });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: '用户名已被占用' });
    logger.error('[auth] register:', err);
    res.status(500).json({ error: '注册失败' });
  }
});

// ---------- 当前用户信息 ----------
router.get('/me', auth, async (req, res) => {
  res.json({ user: req.user });
});

// ---------- 修改密码（自增 token_version，旧令牌立即失效） ----------
router.post('/change-password', auth, async (req, res) => {
  try {
    const v = validateBody(req, {
      oldPassword: { type: 'string', required: true, label: '旧密码' },
      newPassword: { type: 'string', required: true, min: MIN_PASSWORD, label: '新密码', trim: false },
    });
    if (v.error) return res.status(400).json({ error: v.error });
    const { oldPassword, newPassword } = v.value;

    const { rows } = await query('SELECT * FROM users WHERE id = $1', [req.user.id]);
    const user = rows[0];
    const ok = await verifyPassword(oldPassword, user.password_hash);
    if (!ok) return res.status(401).json({ error: '旧密码错误' });

    const hash = await hashPassword(newPassword);
    const { rows: updated } = await query(
      `UPDATE users SET password_hash = $1, token_version = token_version + 1, updated_at = now()
       WHERE id = $2 RETURNING id, username, role, person_id, token_version`,
      [hash, user.id]
    );

    await audit({
      actorUserId: user.id, actorLabel: user.username,
      action: 'update', entityType: 'user', entityId: user.id,
      before: { password: '***' }, after: { password: '***', tokenVersion: updated[0].token_version },
    });

    // 返回新令牌，当前会话继续可用；其他设备上的旧令牌立即失效
    res.json({
      ok: true,
      token: signToken(updated[0]),
      user: {
        id: updated[0].id,
        username: updated[0].username,
        role: updated[0].role,
        personId: updated[0].person_id,
      },
    });
  } catch (err) {
    logger.error('[auth] change-password:', err);
    res.status(500).json({ error: '修改失败' });
  }
});

// ---------- 退出（JWT 无状态，客户端丢弃即可；留接口便于审计） ----------
router.post('/logout', auth, async (req, res) => {
  await audit({
    actorUserId: req.user.id, actorLabel: req.user.username,
    action: 'logout', entityType: 'user', entityId: req.user.id,
  });
  res.json({ ok: true });
});

export default router;
