-- =====================================================================
-- 家族族谱管理系统 · 数据库 Schema（阶段1 核心表）
-- 设计要点：Person 与 User 分离；亲子/婚姻用关系实体；日期带精度
-- PostgreSQL 12+
-- =====================================================================

-- ---------- 家族 ----------
CREATE TABLE IF NOT EXISTS family (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL,                 -- 家族名称
  surname      TEXT NOT NULL,                 -- 主姓氏
  privacy_policy JSONB NOT NULL DEFAULT '{}'::jsonb,  -- 默认隐私策略
  settings     JSONB NOT NULL DEFAULT '{}'::jsonb,    -- 世系图模板/自定义字段
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- 成员（与 User 分离） ----------
CREATE TABLE IF NOT EXISTS person (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id       UUID NOT NULL REFERENCES family(id),
  family_name     TEXT NOT NULL DEFAULT '',   -- 姓
  given_name      TEXT NOT NULL DEFAULT '',   -- 名
  former_names    JSONB NOT NULL DEFAULT '[]'::jsonb,   -- 曾用名数组
  courtesy_name   TEXT NOT NULL DEFAULT '',   -- 字/号
  generation_name TEXT NOT NULL DEFAULT '',   -- 字辈
  generation_no   INTEGER,                    -- 世代数
  branch          TEXT NOT NULL DEFAULT '',   -- 支系（长房/二房…）
  gender          TEXT NOT NULL DEFAULT 'unknown'
                  CHECK (gender IN ('male','female','unknown')),
  -- 日期三元组：date + precision + date_end
  birth_date      DATE,
  birth_precision TEXT NOT NULL DEFAULT 'unknown'
                  CHECK (birth_precision IN ('exact','year','about','range','unknown')),
  birth_date_end  DATE,                        -- precision=range 时的终点
  birth_place     TEXT NOT NULL DEFAULT '',
  death_date      DATE,
  death_precision TEXT NOT NULL DEFAULT 'unknown'
                  CHECK (death_precision IN ('exact','year','about','range','unknown')),
  death_date_end  DATE,
  death_place     TEXT NOT NULL DEFAULT '',
  burial_place    TEXT NOT NULL DEFAULT '',
  is_deceased     BOOLEAN NOT NULL DEFAULT false,
  deceased_assumed BOOLEAN NOT NULL DEFAULT false,  -- 推定已故（出生超 N 年无卒记录）
  occupation      TEXT NOT NULL DEFAULT '',
  education       TEXT NOT NULL DEFAULT '',
  bio             TEXT NOT NULL DEFAULT '',
  avatar_media_id UUID,                        -- 媒体表就位后回填 FK
  contact         JSONB NOT NULL DEFAULT '{}'::jsonb,   -- L2 私密：phone/email/address
  privacy_override JSONB NOT NULL DEFAULT '{}'::jsonb,  -- 字段级可见覆盖
  extra           JSONB NOT NULL DEFAULT '{}'::jsonb,   -- 自定义字段（家族定义 key）
  status          TEXT NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active','archived')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_person_family ON person(family_id);
CREATE INDEX IF NOT EXISTS idx_person_gen    ON person(family_id, generation_no);
CREATE INDEX IF NOT EXISTS idx_person_name   ON person(family_id, generation_name);

-- ---------- 亲子关系（关系实体，支持生/养/继/抚/认 + 确信度） ----------
CREATE TABLE IF NOT EXISTS parent_child (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id      UUID NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  child_id       UUID NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  relation_type  TEXT NOT NULL DEFAULT 'biological'
                 CHECK (relation_type IN ('biological','adopted','step','foster','acknowledged')),
  certainty      TEXT NOT NULL DEFAULT 'confirmed'
                 CHECK (certainty IN ('confirmed','probable','disputed')),
  note           TEXT NOT NULL DEFAULT '',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (parent_id, child_id, relation_type),
  CHECK (parent_id <> child_id)
);
CREATE INDEX IF NOT EXISTS idx_pc_child  ON parent_child(child_id);
CREATE INDEX IF NOT EXISTS idx_pc_parent ON parent_child(parent_id);

-- ---------- 婚姻/伴侣实体 ----------
CREATE TABLE IF NOT EXISTS marriage (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  person_a_id  UUID NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  person_b_id  UUID NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  union_type   TEXT NOT NULL DEFAULT 'married'
               CHECK (union_type IN ('married','partner','concubine')),
  status       TEXT NOT NULL DEFAULT 'ongoing'
               CHECK (status IN ('ongoing','divorced','widowed','annulled','separated')),
  start_date   DATE,
  start_precision TEXT NOT NULL DEFAULT 'unknown'
               CHECK (start_precision IN ('exact','year','about','range','unknown')),
  end_date     DATE,
  end_precision TEXT NOT NULL DEFAULT 'unknown'
               CHECK (end_precision IN ('exact','year','about','range','unknown')),
  place        TEXT NOT NULL DEFAULT '',
  note         TEXT NOT NULL DEFAULT '',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (person_a_id <> person_b_id)
);
CREATE INDEX IF NOT EXISTS idx_marriage_a ON marriage(person_a_id);
CREATE INDEX IF NOT EXISTS idx_marriage_b ON marriage(person_b_id);

-- ---------- 登录账户（一人一账户，仅绑定"本人"） ----------
CREATE TABLE IF NOT EXISTS users (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username          TEXT NOT NULL UNIQUE,
  password_hash     TEXT NOT NULL,
  person_id         UUID REFERENCES person(id),  -- 本人绑定
  role              TEXT NOT NULL DEFAULT 'member'
                    CHECK (role IN ('admin','editor','member','guest')),
  status            TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('pending','active','disabled')),
  two_factor_enabled BOOLEAN NOT NULL DEFAULT false,
  two_factor_secret TEXT,                        -- TOTP 密钥（阶段2 强制启用）
  token_version     INTEGER NOT NULL DEFAULT 0,  -- 改密后自增，使旧令牌失效
  failed_attempts   INTEGER NOT NULL DEFAULT 0,  -- 连续登录失败次数
  locked_until      TIMESTAMPTZ,                 -- 锁定截止时间
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- 角色授权（含支系 scope） ----------
CREATE TABLE IF NOT EXISTS user_family_role (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  family_id   UUID NOT NULL REFERENCES family(id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK (role IN ('admin','editor','member','guest')),
  scope_branch TEXT NOT NULL DEFAULT '',         -- 编辑限本支系时填写
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, family_id)
);

-- ---------- 审计日志（只追加，记 before/after） ----------
CREATE TABLE IF NOT EXISTS audit_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id   UUID REFERENCES family(id),
  actor_user_id UUID,
  actor_label TEXT NOT NULL DEFAULT '',          -- 操作者名快照（用户删除后仍可读）
  action      TEXT NOT NULL,                     -- create/update/delete/login/export…
  entity_type TEXT NOT NULL,
  entity_id   UUID,
  before      JSONB,
  after       JSONB,
  ip          TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_family ON audit_log(family_id, created_at DESC);

-- ---------- 生平事件（时间线） ----------
CREATE TABLE IF NOT EXISTS event (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id       UUID NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  event_type      TEXT NOT NULL DEFAULT 'custom'
                  CHECK (event_type IN ('birth','adoption','marriage','divorce','education',
                    'career','migration','military','award','residence','death','burial','custom')),
  title           TEXT NOT NULL DEFAULT '',
  description     TEXT NOT NULL DEFAULT '',
  event_date      DATE,
  event_precision TEXT NOT NULL DEFAULT 'unknown'
                  CHECK (event_precision IN ('exact','year','about','range','unknown')),
  event_date_end  DATE,
  place           TEXT NOT NULL DEFAULT '',
  visibility      TEXT NOT NULL DEFAULT 'L1'
                  CHECK (visibility IN ('L0','L1','L2')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_event_person ON event(person_id, event_date DESC);

-- ---------- 邀请制注册 ----------
CREATE TABLE IF NOT EXISTS invitation (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id        UUID NOT NULL REFERENCES family(id) ON DELETE CASCADE,
  token            TEXT NOT NULL UNIQUE,
  role             TEXT NOT NULL DEFAULT 'member'
                   CHECK (role IN ('admin','editor','member','guest')),
  target_person_id UUID REFERENCES person(id) ON DELETE SET NULL,
  max_uses         INTEGER NOT NULL DEFAULT 1 CHECK (max_uses > 0),
  used_count       INTEGER NOT NULL DEFAULT 0 CHECK (used_count >= 0),
  expires_at       TIMESTAMPTZ,
  status           TEXT NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active','revoked','exhausted')),
  created_by       UUID,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_invitation_status ON invitation(status, expires_at);

-- ---------- 媒体库（照片/音频/视频/文档） ----------
CREATE TABLE IF NOT EXISTS media (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id     UUID NOT NULL REFERENCES family(id) ON DELETE CASCADE,
  file_key      TEXT NOT NULL,                 -- 相对 uploads 的路径
  original_name TEXT NOT NULL DEFAULT '',
  mime          TEXT NOT NULL,
  size_bytes    BIGINT NOT NULL DEFAULT 0,
  media_type    TEXT NOT NULL DEFAULT 'image'
                CHECK (media_type IN ('image','audio','video','document')),
  caption       TEXT NOT NULL DEFAULT '',
  visibility    TEXT NOT NULL DEFAULT 'L1' CHECK (visibility IN ('L0','L1','L2')),
  uploaded_by   UUID,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_media_family ON media(family_id, created_at DESC);

CREATE TABLE IF NOT EXISTS media_link (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  media_id    UUID NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL DEFAULT 'person' CHECK (target_type IN ('person')),
  target_id   UUID NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (media_id, target_type, target_id)
);
CREATE INDEX IF NOT EXISTS idx_media_link_target ON media_link(target_type, target_id);

-- ---------- 变更提案（族人建议修改，管理员审核） ----------
CREATE TABLE IF NOT EXISTS change_request (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id         UUID NOT NULL REFERENCES family(id) ON DELETE CASCADE,
  person_id         UUID NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  requester_user_id UUID NOT NULL,
  payload           JSONB NOT NULL DEFAULT '{}'::jsonb,
  note              TEXT NOT NULL DEFAULT '',
  status            TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','approved','rejected')),
  reviewer_user_id  UUID,
  review_note       TEXT NOT NULL DEFAULT '',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at       TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_change_request_status
  ON change_request(family_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_change_request_person
  ON change_request(person_id, status);

-- ---------- 来源与引文（谱牒考证） ----------
CREATE TABLE IF NOT EXISTS source (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id   UUID NOT NULL REFERENCES family(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  author      TEXT NOT NULL DEFAULT '',
  publication TEXT NOT NULL DEFAULT '',   -- 出版/形成信息
  repository  TEXT NOT NULL DEFAULT '',   -- 收藏地/档案馆
  note        TEXT NOT NULL DEFAULT '',
  created_by  UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_source_family ON source(family_id, title);

CREATE TABLE IF NOT EXISTS citation (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id   UUID NOT NULL REFERENCES family(id) ON DELETE CASCADE,
  source_id   UUID NOT NULL REFERENCES source(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('person','event')),
  target_id   UUID NOT NULL,
  page        TEXT NOT NULL DEFAULT '',   -- 卷/页/条目
  confidence  TEXT NOT NULL DEFAULT 'medium'
              CHECK (confidence IN ('high','medium','low')),
  note        TEXT NOT NULL DEFAULT '',
  created_by  UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source_id, target_type, target_id)
);
CREATE INDEX IF NOT EXISTS idx_citation_target ON citation(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_citation_source ON citation(source_id);

-- 成员检索常用组合
CREATE INDEX IF NOT EXISTS idx_person_family_status_gen
  ON person(family_id, status, generation_no);

-- ---------- 地点库（地域分布与迁徙） ----------
CREATE TABLE IF NOT EXISTS place (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id   UUID NOT NULL REFERENCES family(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,                 -- 规范地名
  province    TEXT NOT NULL DEFAULT '',      -- 省/直辖市
  city        TEXT NOT NULL DEFAULT '',      -- 市/县
  lat         DOUBLE PRECISION,              -- 可选坐标
  lng         DOUBLE PRECISION,
  aliases     JSONB NOT NULL DEFAULT '[]'::jsonb,  -- 旧称/别称
  note        TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (family_id, name)
);
CREATE INDEX IF NOT EXISTS idx_place_family ON place(family_id, province, city);

-- ---------- 人物关联（非家庭关系，GEDCOM 7 ASSO/ROLE 思路） ----------
CREATE TABLE IF NOT EXISTS association (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id   UUID NOT NULL REFERENCES family(id) ON DELETE CASCADE,
  person_a_id UUID NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  person_b_id UUID NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  role        TEXT NOT NULL DEFAULT 'other'
              CHECK (role IN ('godparent','godchild','witness','employer','employee',
                     'neighbor','friend','teacher','student','successor','other')),
  note        TEXT NOT NULL DEFAULT '',
  created_by  UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (person_a_id <> person_b_id),
  UNIQUE (person_a_id, person_b_id, role)
);
CREATE INDEX IF NOT EXISTS idx_assoc_a ON association(person_a_id);
CREATE INDEX IF NOT EXISTS idx_assoc_b ON association(person_b_id);

-- ---------- 地点层级（Gramps enclosed_by 思路） ----------
ALTER TABLE place ADD COLUMN IF NOT EXISTS parent_id UUID;
CREATE INDEX IF NOT EXISTS idx_place_parent ON place(parent_id);

-- ---------- 乐观锁：成员更新时间戳已在 updated_at，无需新增列 ----------

-- ---------- 故事与回忆录 ----------
CREATE TABLE IF NOT EXISTS story (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id   UUID NOT NULL REFERENCES family(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  body        TEXT NOT NULL DEFAULT '',        -- 轻量 Markdown（渲染时转义后处理）
  author_name TEXT NOT NULL DEFAULT '',        -- 口述者/作者署名
  story_date  DATE,                            -- 事件或成文时间
  date_precision TEXT NOT NULL DEFAULT 'unknown'
              CHECK (date_precision IN ('exact','year','about','range','unknown')),
  visibility  TEXT NOT NULL DEFAULT 'L1' CHECK (visibility IN ('L0','L1','L2')),
  created_by  UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_story_family ON story(family_id, created_at DESC);

CREATE TABLE IF NOT EXISTS story_person (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  story_id   UUID NOT NULL REFERENCES story(id) ON DELETE CASCADE,
  person_id  UUID NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'subject'
             CHECK (role IN ('subject','mentioned')),
  UNIQUE (story_id, person_id, role)
);
CREATE INDEX IF NOT EXISTS idx_story_person ON story_person(person_id);

-- ---------- 双因素认证（TOTP） ----------
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_recovery JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN NOT NULL DEFAULT false;
-- pending_secret 由 setup 接口暂存，启用后清空

-- ---------- 故事版本历史 ----------
CREATE TABLE IF NOT EXISTS story_version (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  story_id    UUID NOT NULL REFERENCES story(id) ON DELETE CASCADE,
  version_no  INTEGER NOT NULL,
  title       TEXT NOT NULL,
  body        TEXT NOT NULL DEFAULT '',
  author_name TEXT NOT NULL DEFAULT '',
  story_date  DATE,
  date_precision TEXT NOT NULL DEFAULT 'unknown',
  visibility  TEXT NOT NULL DEFAULT 'L1',
  person_ids  JSONB NOT NULL DEFAULT '[]'::jsonb,
  saved_by    UUID,
  saved_label TEXT NOT NULL DEFAULT '',
  note        TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (story_id, version_no)
);
CREATE INDEX IF NOT EXISTS idx_story_version ON story_version(story_id, version_no DESC);

ALTER TABLE media ADD COLUMN IF NOT EXISTS width INTEGER;
ALTER TABLE media ADD COLUMN IF NOT EXISTS height INTEGER;
ALTER TABLE parent_child ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE marriage ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
-- 兼容已存在的库：补充阶段2 新增列（幂等）
ALTER TABLE person ADD COLUMN IF NOT EXISTS contact JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ;

-- 婚姻唯一性：同一对成员只允许一条"未离异"婚姻（应用层查重之外的兜底）
DELETE FROM marriage a USING marriage b
 WHERE a.id > b.id
   AND a.person_a_id = b.person_a_id
   AND a.person_b_id = b.person_b_id
   AND a.status <> 'divorced'
   AND b.status <> 'divorced';
CREATE UNIQUE INDEX IF NOT EXISTS uq_marriage_pair_active
  ON marriage(person_a_id, person_b_id) WHERE status <> 'divorced';

-- =====================================================================
-- 以下为阶段2/3 预留表（邀请制/事件/媒体等）
-- =====================================================================
-- story / story_person（故事回忆录，后续）
-- place / map（地点库与地图，后续）
-- access_request（隐私查看申请）
-- custom_field_def（自定义字段定义）
-- change_request（编辑提议审核流）

-- =====================================================================
-- 档案收藏地（Repository）：可复用的档案馆/藏书楼实体
-- source.repository 文本字段保留作为冗余快照（导入/简单场景）
-- =====================================================================
CREATE TABLE IF NOT EXISTS repository (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id   UUID NOT NULL REFERENCES family(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  address     TEXT NOT NULL DEFAULT '',
  contact     TEXT NOT NULL DEFAULT '',
  note        TEXT NOT NULL DEFAULT '',
  created_by  UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_repository_family ON repository(family_id, name);
ALTER TABLE source ADD COLUMN IF NOT EXISTS repository_id UUID
  REFERENCES repository(id) ON DELETE SET NULL;   
CREATE INDEX IF NOT EXISTS idx_source_repository ON source(repository_id);
