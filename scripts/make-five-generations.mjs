#!/usr/bin/env node
/**
 * 把演示家族调整为“五世同堂”：五代人全部在世。
 * 仅匹配演示数据中的姓名，找不到则跳过；不会改动其他成员。
 *
 * 用法：node scripts/make-five-generations.mjs [baseUrl]
 */
import { PEOPLE } from './demo-data.mjs';

const BASE = process.argv[2] || process.env.BASE_URL || 'http://localhost:3000';
const USERNAME = process.env.ADMIN_USERNAME || 'admin';
const PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

async function json(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

const login = await json('/api/auth/login', {
  method: 'POST', body: { username: USERNAME, password: PASSWORD },
});
if (!login.data.token) {
  console.error('登录失败：', login.data.error || login.status);
  process.exit(1);
}
const token = login.data.token;

const list = await json('/api/persons?pageSize=200', { token });
if (!Array.isArray(list.data.items)) {
  console.error('读取成员失败：', list.data.error || list.status);
  process.exit(1);
}

const byName = new Map(list.data.items.map((p) => [`${p.family_name}${p.given_name}`, p]));
let updated = 0;
const missing = [];

for (const p of PEOPLE) {
  const name = `${p.family_name}${p.given_name}`;
  const existing = byName.get(name);
  if (!existing) { missing.push(name); continue; }
  const res = await json(`/api/persons/${existing.id}`, {
    method: 'PUT',
    token,
    body: {
      birth_date: p.birth_date,
      birth_precision: 'exact',
      death_date: null,
      death_precision: 'unknown',
      death_place: '',
      is_deceased: false,
      occupation: p.occupation || '',
      bio: p.bio || '',
    },
  });
  if (res.status !== 200) {
    console.error(`更新 ${name} 失败：`, res.data.error || res.status);
    process.exit(1);
  }
  updated++;
}

console.log(`已更新 ${updated} 位成员为在世，五代同堂就绪`);
if (missing.length) console.log(`跳过未找到的演示成员：${missing.join('、')}`);
