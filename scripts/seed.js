/**
 * 演示数据播种：1 个家族 + 5 代 18 人 + 婚姻/亲子关系 + 管理员账户
 * 可独立运行：npm run seed
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { query } from '../server/db/db.js';
import { hashPassword } from '../server/middleware/password.js';
import { config } from '../server/config/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FAMILY_ID = config.familyId;

import { PEOPLE, FAMILIES } from './demo-data.mjs';

const key = (p) => `${p.family_name}${p.given_name}`;

export async function seedDatabase() {
  const { rows: famRows } = await query('SELECT id FROM family WHERE id = $1', [FAMILY_ID]);
  if (!famRows.length) {
    await query(
      `INSERT INTO family (id, name, surname, privacy_policy, settings)
       VALUES ($1, $2, $3, $4, $5)`,
      [FAMILY_ID, '王氏族谱', '王',
       JSON.stringify({ hundredYearRule: 100, defaultAliveLevel: 'L1', defaultDeceasedLevel: 'L0' }),
       JSON.stringify({ treeLayout: 'vertical', branches: ['长房', '二房'], generationPoem: ['守','德','建','明','一'] })]
    );
  }

  const { rows: existing } = await query('SELECT COUNT(*)::int AS c FROM person WHERE family_id = $1', [FAMILY_ID]);
  if (existing[0].c > 0) {
    console.log('[seed] person data already exists, skip');
    return;
  }

  const idByName = new Map();
  for (const p of PEOPLE) {
    const { rows } = await query(
      `INSERT INTO person (family_id, family_name, given_name, courtesy_name, generation_name,
         generation_no, branch, gender, birth_date, birth_precision, birth_place,
         death_date, death_precision, death_place, is_deceased, occupation, education, bio)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       RETURNING id`,
      [FAMILY_ID, p.family_name, p.given_name, p.courtesy_name || '', p.generation_name || '',
       p.generation_no ?? null, p.branch || '', p.gender || 'unknown',
       p.birth_date || null, p.birth_precision || 'unknown', p.birth_place || '',
       p.death_date || null, p.death_precision || 'unknown', p.death_place || '',
       !!p.is_deceased, p.occupation || '', p.education || '', p.bio || '']
    );
    idByName.set(key(p), rows[0].id);
  }

  for (const [father, mother, kids] of FAMILIES) {
    const fid = idByName.get(father);
    const mid = idByName.get(mother);
    if (fid && mid) {
      const [a, b] = [fid, mid].sort();
      await query(
        `INSERT INTO marriage (person_a_id, person_b_id, union_type, status)
         VALUES ($1,$2,'married','ongoing')`,
        [a, b]
      );
    }
    for (const k of kids) {
      const cid = idByName.get(k);
      for (const pid of [fid, mid].filter(Boolean)) {
        await query(
          `INSERT INTO parent_child (parent_id, child_id, relation_type, certainty)
           VALUES ($1,$2,'biological','confirmed')`,
          [pid, cid]
        );
      }
    }
  }

  // 地点库：与演示成员出生地对应，便于地域分布/迁徙视图开箱可见
  const PLACES = [
    { name: '保定', province: '河北', city: '保定', aliases: ['保定府', '河北保定'], lat: 38.874, lng: 115.464 },
    { name: '北京', province: '北京', city: '北京', aliases: [], lat: 39.904, lng: 116.407 },
    { name: '石家庄', province: '河北', city: '石家庄', aliases: [], lat: 38.043, lng: 114.515 },
    { name: '正定', province: '河北', city: '正定', aliases: ['河北正定'], lat: 38.148, lng: 114.574 },
  ];
  for (const pl of PLACES) {
    await query(
      `INSERT INTO place (family_id, name, province, city, aliases, lat, lng)
       VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (family_id, name) DO NOTHING`,
      [FAMILY_ID, pl.name, pl.province, pl.city, JSON.stringify(pl.aliases), pl.lat, pl.lng]
    );
  }

  // 账户：admin / admin123（首次登录后请立即修改）
  const adminHash = await hashPassword('admin123');
  const editorHash = await hashPassword('editor123');
  const { rows: adminUser } = await query(
    `INSERT INTO users (username, password_hash, role, status)
     VALUES ('admin', $1, 'admin', 'active') RETURNING id`, [adminHash]
  );
  await query(
    `INSERT INTO users (username, password_hash, role, status)
     VALUES ('editor', $1, 'editor', 'active')`, [editorHash]
  );
  await query(
    `INSERT INTO user_family_role (user_id, family_id, role) VALUES ($1,$2,'admin')`,
    [adminUser[0].id, FAMILY_ID]
  );

  await query(
    `INSERT INTO audit_log (family_id, actor_label, action, entity_type, entity_id, after)
     VALUES ($1, '系统', 'create', 'family', $1, $2)`,
    [FAMILY_ID, JSON.stringify({ event: '初始化族谱', members: PEOPLE.length, generations: 5 })]
  );

  console.log(`[seed] done: ${PEOPLE.length} persons, ${FAMILIES.length} families, 2 users`);
  console.log('[seed] login: admin / admin123   (editor / editor123)');
}

// 独立运行
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const sql = fs.readFileSync(path.join(__dirname, '../server/db/schema.sql'), 'utf8');
  await query(sql);
  await seedDatabase();
  const { closeDb } = await import('../server/db/db.js');
  await closeDb();
  process.exit(0);
}
