import express from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { query } from '../db/db.js';
import { auth, editorUp } from '../middleware/auth.js';
import { audit } from './audit.js';
import { config } from '../config/index.js';
import { currentFamilyId } from '../middleware/tenant.js';
import { logger } from '../modules/logger.js';
import { imageSize } from '../modules/imageSize.js';
import { uuidParam } from '../middleware/params.js';

const router = express.Router();
router.param('personId', uuidParam);
router.param('id', uuidParam);

/** 允许的类型：mime → 扩展名 + 归类（排除 SVG，避免内联脚本风险） */
const ALLOWED = {
  'image/jpeg': { ext: '.jpg', type: 'image' },
  'image/png': { ext: '.png', type: 'image' },
  'image/webp': { ext: '.webp', type: 'image' },
  'image/gif': { ext: '.gif', type: 'image' },
  'audio/mpeg': { ext: '.mp3', type: 'audio' },
  'audio/wav': { ext: '.wav', type: 'audio' },
  'audio/ogg': { ext: '.ogg', type: 'audio' },
  'video/mp4': { ext: '.mp4', type: 'video' },
  'video/webm': { ext: '.webm', type: 'video' },
  'application/pdf': { ext: '.pdf', type: 'document' },
};

const storage = multer.diskStorage({
  destination(req, file, cb) {
    const now = new Date();
    const rel = path.join(String(now.getUTCFullYear()), String(now.getUTCMonth() + 1).padStart(2, '0'));
    const dir = path.join(config.uploadDir, rel);
    fs.mkdirSync(dir, { recursive: true });
    file._relDir = rel;
    cb(null, dir);
  },
  filename(req, file, cb) {
    const meta = ALLOWED[file.mimetype];
    cb(null, `${randomUUID()}${meta ? meta.ext : ''}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    if (!ALLOWED[file.mimetype]) {
      const err = new Error('仅支持 JPG/PNG/WebP/GIF、MP3/WAV/OGG、MP4/WebM、PDF');
      err.status = 400;   // 客户端错误，非服务端故障
      return cb(err);
    }
    cb(null, true);
  },
});

const RANK = { L0: 0, L1: 1, L2: 2 };

function viewerRank(req, person) {
  const isSelf = !!req.user.personId && req.user.personId === person.id;
  if (req.user.role === 'admin' || isSelf) return 2;
  return req.user.role === 'guest' ? 0 : 1;
}

async function getPerson(personId) {
  const { rows } = await query(
    'SELECT id, family_name, given_name, status FROM person WHERE id = $1 AND family_id = $2',
    [personId, currentFamilyId()]
  );
  return rows[0] || null;
}

async function getMediaWithTarget(mediaId) {
  const { rows } = await query(
    `SELECT m.*, ml.target_id AS person_id
     FROM media m JOIN media_link ml ON ml.media_id = m.id AND ml.target_type = 'person'
     WHERE m.id = $1 AND m.family_id = $2 LIMIT 1`,
    [mediaId, currentFamilyId()]
  );
  return rows[0] || null;
}

const absPath = (fileKey) => path.resolve(config.uploadDir, fileKey);

function serialize(m) {
  return {
    id: m.id,
    mime: m.mime,
    mediaType: m.media_type,
    caption: m.caption,
    visibility: m.visibility,
    sizeBytes: Number(m.size_bytes),
    originalName: m.original_name,
    createdAt: m.created_at,
    url: `/api/media/${m.id}/file`,
  };
}

// ---------- 上传（绑定到成员） ----------
router.post('/person/:personId', auth, editorUp, upload.single('file'), async (req, res) => {
  const person = await getPerson(req.params.personId);
  if (!person || person.status !== 'active') {
    if (req.file) fs.rmSync(req.file.path, { force: true });
    return res.status(404).json({ error: '成员不存在或已归档' });
  }
  if (!req.file) return res.status(400).json({ error: '请选择要上传的文件' });

  const visibility = req.body?.visibility || 'L1';
  if (!['L0', 'L1', 'L2'].includes(visibility)) {
    fs.rmSync(req.file.path, { force: true });
    return res.status(400).json({ error: '无效可见级别' });
  }
  if (visibility === 'L2' && req.user.role !== 'admin') {
    fs.rmSync(req.file.path, { force: true });
    return res.status(403).json({ error: '仅管理员可将媒体设为私密' });
  }
  const caption = String(req.body?.caption || '').slice(0, 200);
  const meta = ALLOWED[req.file.mimetype];
  const dims = meta.type === 'image' ? imageSize(req.file.path) : null;

  const mediaId = randomUUID();
  const fileKey = path.join(req.file._relDir || '', path.basename(req.file.path));

  try {
    await query(
      `INSERT INTO media (id, family_id, file_key, original_name, mime, size_bytes,
         media_type, caption, visibility, uploaded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [mediaId, currentFamilyId(), fileKey, req.file.originalname.slice(0, 200), req.file.mimetype,
        req.file.size, meta.type, caption, visibility, req.user.id]
    );
    await query(
      `INSERT INTO media_link (media_id, target_type, target_id) VALUES ($1,'person',$2)`,
      [mediaId, person.id]
    );
  } catch (err) {
    fs.rmSync(req.file.path, { force: true });
    logger.error('[media] insert:', err);
    return res.status(500).json({ error: '媒体入库失败' });
  }

  await audit({
    familyId: currentFamilyId(),
    actorUserId: req.user.id, actorLabel: req.user.username,
    action: 'create', entityType: 'media', entityId: mediaId,
    after: { personId: person.id, name: req.file.originalname, type: meta.type, visibility },
  });

  const { rows } = await query('SELECT * FROM media WHERE id = $1', [mediaId]);
  res.status(201).json(serialize(rows[0]));
});

// ---------- 全部图片列表（供故事正文插入） ----------
router.get('/', auth, async (req, res) => {
  const maxRank = req.user.role === 'admin' ? 2 : req.user.role === 'guest' ? 0 : 1;
  const { rows } = await query(
    `SELECT m.id, m.original_name, m.caption, m.media_type, m.visibility,
            p.id AS person_id, p.family_name, p.given_name
     FROM media m
     JOIN media_link ml ON ml.media_id = m.id AND ml.target_type = 'person'
     JOIN person p ON p.id = ml.target_id
     WHERE m.family_id = $1 AND m.media_type = 'image'
     ORDER BY m.created_at DESC LIMIT 200`,
    [currentFamilyId()]
  );
  res.json(rows
    .filter((m) => ({ L0: 0, L1: 1, L2: 2 }[m.visibility] ?? 1) <= maxRank)
    .map((m) => ({
      id: m.id,
      name: m.caption || m.original_name || '未命名',
      width: m.width || null,
      height: m.height || null,
      person: `${m.family_name || ''}${m.given_name || ''}`,
      visibility: m.visibility,
      url: `/api/media/${m.id}/file`,
    })));
});

// ---------- 成员媒体列表（按可见级别过滤） ----------
router.get('/person/:personId', auth, async (req, res) => {
  const person = await getPerson(req.params.personId);
  if (!person) return res.status(404).json({ error: '成员不存在' });

  const { rows } = await query(
    `SELECT m.* FROM media m
     JOIN media_link ml ON ml.media_id = m.id AND ml.target_type = 'person'
     WHERE ml.target_id = $1 AND m.family_id = $2
     ORDER BY m.created_at DESC`,
    [person.id, currentFamilyId()]
  );
  const maxRank = viewerRank(req, person);
  res.json(rows
    .filter((m) => RANK[m.visibility] <= maxRank)
    .map(serialize));
});

// ---------- 读取原文件（鉴权流式返回） ----------
router.get('/:id/file', auth, async (req, res) => {
  const media = await getMediaWithTarget(req.params.id);
  if (!media) return res.status(404).json({ error: '媒体不存在' });

  const person = await getPerson(media.person_id);
  if (!person) return res.status(404).json({ error: '关联成员不存在' });
  if (RANK[media.visibility] > viewerRank(req, person)) {
    return res.status(403).json({ error: '无权查看该文件' });
  }

  const full = absPath(media.file_key);
  if (!fs.existsSync(full)) return res.status(404).json({ error: '文件已丢失' });

  const inline = media.media_type !== 'document';
  res.setHeader('Content-Type', media.mime);
  res.setHeader('Content-Disposition',
    `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(media.original_name || 'file')}`);
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.sendFile(full);
});

// ---------- 删除 ----------
router.delete('/:id', auth, editorUp, async (req, res) => {
  const media = await getMediaWithTarget(req.params.id);
  if (!media) return res.status(404).json({ error: '媒体不存在' });

  await query('DELETE FROM media WHERE id = $1', [media.id]);
  fs.rmSync(absPath(media.file_key), { force: true });
  await audit({
    familyId: currentFamilyId(),
    actorUserId: req.user.id, actorLabel: req.user.username,
    action: 'delete', entityType: 'media', entityId: media.id,
    before: { personId: media.person_id, name: media.original_name },
  });
  res.json({ ok: true });
});

export default router;
