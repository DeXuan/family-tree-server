/**
 * 并发一致性测试：验证乐观锁在真正并发时只允许一个写入成功。
 * 直接对运行中的服务发并行请求（非顺序 await）。
 *
 * 用法：node scripts/concurrency-test.mjs [baseUrl]
 */
import assert from 'node:assert/strict';

const BASE = process.argv[2] || 'http://localhost:3000';
let pass = 0, fail = 0;
const lines = [];

function check(name, cond, detail = '') {
  if (cond) { pass++; lines.push(`  PASS  ${name}`); }
  else { fail++; lines.push(`  FAIL  ${name}${detail ? ' :: ' + detail : ''}`); }
}

async function api(path, { method = 'GET', token, body } = {}) {
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

const login = await api('/api/auth/login', {
  method: 'POST', body: { username: 'admin', password: 'admin123' },
});
if (!login.data.token) {
  console.error('登录失败：', login.data.error || login.status);
  process.exit(1);
}
const token = login.data.token;
const tag = String(Date.now()).slice(-6);

try {
  // ---------- 1. 成员编辑：10 个并发请求，只有一个能基于同一版本成功 ----------
  const p = await api('/api/persons', {
    method: 'POST', token,
    body: { family_name: '并', given_name: `发${tag}`, birth_date: '1990-01-01' },
  });
  const pid = p.data.id;
  const snapshot = await api(`/api/persons/${pid}`, { token });
  const expectedUpdatedAt = snapshot.data.updated_at;

  const results = await Promise.all(Array.from({ length: 10 }, (_, i) =>
    api(`/api/persons/${pid}`, {
      method: 'PUT', token,
      body: { occupation: `并发写入 ${i}`, expectedUpdatedAt },
    })
  ));
  const ok = results.filter((r) => r.status === 200).length;
  const conflict = results.filter((r) => r.status === 409).length;
  check('并发编辑：恰好 1 个成功、9 个 409',
    ok === 1 && conflict === 9, `ok=${ok} conflict=${conflict}`);

  // ---------- 2. 并发创建同名成员：允许（无唯一约束，但不应报 500） ----------
  const createResults = await Promise.all(Array.from({ length: 5 }, () =>
    api('/api/persons', {
      method: 'POST', token,
      body: { family_name: '并', given_name: `建${tag}`, birth_date: '1991-01-01' },
    })
  ));
  check('并发创建：全部成功且无 500',
    createResults.every((r) => r.status === 201),
    JSON.stringify(createResults.map((r) => r.status)));
  for (const r of createResults) {
    if (r.data.id) await api(`/api/persons/${r.data.id}`, { method: 'DELETE', token });
  }

  // ---------- 3. 并发添加同一亲子关系：只应产生一条 ----------
  const a = await api('/api/persons', {
    method: 'POST', token,
    body: { family_name: '并', given_name: `父${tag}`, birth_date: '1960-01-01' },
  });
  const b = await api('/api/persons', {
    method: 'POST', token,
    body: { family_name: '并', given_name: `子${tag}`, birth_date: '1990-01-01' },
  });
  const relResults = await Promise.all(Array.from({ length: 5 }, () =>
    api(`/api/relations/${b.data.id}/parents`, {
      method: 'POST', token, body: { parentId: a.data.id },
    })
  ));
  const relOk = relResults.filter((r) => r.status === 201).length;
  const relBad = relResults.filter((r) => r.status >= 500).length;
  const relList = await api(`/api/relations/${b.data.id}/relations`, { token });
  check('并发添加同一亲子关系：无 500，库中只有 1 条',
    relBad === 0 && relList.data.parents.length === 1,
    `statuses=${JSON.stringify(relResults.map((r) => r.status))} parents=${relList.data.parents.length}`);
  void relOk;

  // ---------- 4. 并发婚姻：唯一索引兜底，不应出现重复 ----------
  const m1 = await api('/api/persons', {
    method: 'POST', token,
    body: { family_name: '并', given_name: `夫${tag}`, birth_date: '1985-01-01' },
  });
  const m2 = await api('/api/persons', {
    method: 'POST', token,
    body: { family_name: '并', given_name: `妻${tag}`, birth_date: '1986-01-01' },
  });
  const marrResults = await Promise.all(Array.from({ length: 5 }, () =>
    api(`/api/relations/${m1.data.id}/spouses`, {
      method: 'POST', token, body: { spouseId: m2.data.id },
    })
  ));
  const marrBad = marrResults.filter((r) => r.status >= 500).length;
  const marrList = await api(`/api/relations/${m1.data.id}/relations`, { token });
  check('并发婚姻：无 500，库中只有 1 条',
    marrBad === 0 && marrList.data.unions.length === 1,
    `statuses=${JSON.stringify(marrResults.map((r) => r.status))} unions=${marrList.data.unions.length}`);

  // ---------- 5. 并发故事编辑：乐观锁同样只放行一个 ----------
  const story = await api('/api/stories', {
    method: 'POST', token, body: { title: `并发${tag}`, body: 'v0', visibility: 'L1' },
  });
  const s0 = await api(`/api/stories/${story.data.id}/versions`, { token });
  const storyResults = await Promise.all(Array.from({ length: 6 }, (_, i) =>
    api(`/api/stories/${story.data.id}`, {
      method: 'PUT', token, body: { body: `并发写 ${i}` },
    })
  ));
  const storyBad = storyResults.filter((r) => r.status >= 500).length;
  const versionsAfter = await api(`/api/stories/${story.data.id}/versions`, { token });
  void s0;
  check('并发编辑故事：无 500 且版本快照数等于成功次数',
    storyBad === 0
    && versionsAfter.data.length === storyResults.filter((r) => r.status === 200).length,
    `statuses=${JSON.stringify(storyResults.map((r) => r.status))} versions=${versionsAfter.data.length}`);

  // ---------- 清理 ----------
  await api(`/api/stories/${story.data.id}`, { method: 'DELETE', token });
  for (const id of [pid, a.data.id, b.data.id, m1.data.id, m2.data.id]) {
    await api(`/api/persons/${id}`, { method: 'DELETE', token });
  }
  await api('/api/admin/purge-archived', { method: 'POST', token });
} catch (err) {
  fail++;
  lines.push(`  FAIL  测试执行异常 :: ${err.message}`);
}

console.log(lines.join('\n'));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);