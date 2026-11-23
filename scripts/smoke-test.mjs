/**
 * 端到端冒烟测试：对运行中的服务打真实 HTTP 请求。
 * 用法：node scripts/smoke-test.mjs [baseUrl]
 */
import ExcelJS from 'exceljs';
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { totpForTest } from '../server/modules/totp.js';

const BASE = process.argv[2] || 'http://localhost:3000';

let pass = 0, fail = 0;
const results = [];

function check(name, cond, detail = '') {
  if (cond) { pass++; results.push(`  PASS  ${name}`); }
  else { fail++; results.push(`  FAIL  ${name}${detail ? ' :: ' + detail : ''}`); }
}

async function api(path, { method = 'GET', token, body, raw } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body && !raw ? { 'Content-Type': 'application/json' } : {}),
    },
    body: raw ? body : body ? JSON.stringify(body) : undefined,
  });
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('json') ? await res.json() : await res.text();
  return { status: res.status, data, headers: res.headers };
}

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=',
  'base64'
);

/** 上传媒体（multipart） */
async function uploadMedia(token, personId, { buffer, name, type, visibility = 'L1' }) {
  const fd = new FormData();
  fd.append('file', new Blob([buffer], { type }), name);
  fd.append('visibility', visibility);
  const res = await fetch(BASE + `/api/media/person/${personId}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: fd,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

const run = async () => {
  // 1. 健康 + 登录
  const health = await api('/api/healthz');
  check('healthz 200', health.status === 200 && health.data.ok === true);

  const login = await api('/api/auth/login', {
    method: 'POST', body: { username: 'admin', password: 'admin123' },
  });
  check('登录成功并返回 token', login.status === 200 && !!login.data.token);
  let token = login.data.token;

  const badLogin = await api('/api/auth/login', {
    method: 'POST', body: { username: 'admin', password: 'wrong' },
  });
  check('错误密码返回 401', badLogin.status === 401);

  // 2. 统计
  const stats = await api('/api/stats', { token });
  check('统计接口返回成员总数', stats.status === 200 && stats.data.total >= 20, JSON.stringify(stats.data).slice(0, 120));
  check('演示数据为五世同堂（5 代在世）',
    stats.data.aliveGenerations === 5 && stats.data.alive === stats.data.total,
    JSON.stringify({ alive: stats.data.alive, total: stats.data.total, aliveGenerations: stats.data.aliveGenerations }));

  // 3. 成员列表 + 筛选
  const list = await api('/api/persons?pageSize=100', { token });
  check('成员列表返回 20+ 条', list.status === 200 && list.data.items.length >= 20, `got ${list.data?.items?.length}`);
  const byGen = await api('/api/persons?gen=1', { token });
  check('按世代筛选 gen=1 命中', byGen.status === 200 && byGen.data.total >= 2, `total=${byGen.data?.total}`);
  const byBranch = await api('/api/persons?branch=' + encodeURIComponent('二房'), { token });
  check('按支系筛选 二房 命中', byBranch.status === 200 && byBranch.data.total > 0);
  const byFullName = await api('/api/persons?keyword=' + encodeURIComponent('王德'), { token });
  check('全名片段搜索「王德」命中 2 人', byFullName.status === 200 && byFullName.data.total === 2, `total=${byFullName.data?.total}`);

  // 4. 族谱树
  const tree = await api('/api/tree', { token });
  check('族谱树有根节点', tree.status === 200 && tree.data.roots.length > 0, `roots=${tree.data?.roots?.length}`);
  const rootChildren = tree.data.roots[0]?.children?.length || 0;
  check('根节点展开子代', rootChildren > 0, `children=${rootChildren}`);
  const collectGens = (nodes, set = new Set()) => {
    for (const n of nodes) {
      if (n.gen) set.add(n.gen);
      collectGens(n.children || [], set);
    }
    return set;
  };
  const gens = collectGens(tree.data.roots);
  check('世系树包含完整 1–5 世', [1, 2, 3, 4, 5].every((g) => gens.has(g)),
    `generations=${[...gens].sort().join(',')}`);

  // 5. 某成员关系
  const personOne = tree.data.roots[0];
  const relations = await api(`/api/relations/${personOne.id}/relations`, { token });
  check('关系接口返回父母/配偶/子女结构', relations.status === 200
    && Array.isArray(relations.data.parents) && Array.isArray(relations.data.unions) && Array.isArray(relations.data.children));

  // 6. 新建成员
  const created = await api('/api/persons', {
    method: 'POST', token,
    body: {
      family_name: '测', given_name: '试甲', generation_no: 6, branch: '长房', gender: 'male',
      birth_date: '2020-01-01', birth_precision: 'exact',
    },
  });
  check('新建成员返回 201 + id', created.status === 201 && !!created.data.id, JSON.stringify(created.data).slice(0, 100));
  const testId = created.data.id;

  const created2 = await api('/api/persons', {
    method: 'POST', token,
    body: { family_name: '测', given_name: '试乙', generation_no: 7, branch: '长房', gender: 'female', birth_date: '2045-01-01' },
  });
  const testId2 = created2.data?.id;

  // 7. 关系：把 试乙 设为 试甲 的子女，再把 试甲 设为 试乙 的父母 → 应触发环路拦截
  const addParent = await api(`/api/relations/${testId2}/parents`, {
    method: 'POST', token, body: { parentId: testId, relationType: 'biological' },
  });
  check('添加亲子关系成功', addParent.status === 201, JSON.stringify(addParent.data));
  const cycle = await api(`/api/relations/${testId}/parents`, {
    method: 'POST', token, body: { parentId: testId2 },
  });
  check('环路被拦截（409）', cycle.status === 409 && /环路/.test(cycle.data.error || ''), JSON.stringify(cycle.data));

  // 8. 日期逻辑校验：2045 年出生的孩子 + 父母 2020 年生
  const created3 = await api('/api/persons', {
    method: 'POST', token, body: { family_name: '测', given_name: '试丙', birth_date: '2021-01-01' },
  });
  const ageCheck = await api(`/api/relations/${created3.data.id}/parents`, {
    method: 'POST', token, body: { parentId: testId },
  });
  check('父母年龄差 < 12 岁被拦截（409）', ageCheck.status === 409 && /12/.test(ageCheck.data.error || ''), JSON.stringify(ageCheck.data));

  // 8b. 婚姻：添加 + 重复拦截
  const spouse1 = await api(`/api/relations/${testId}/spouses`, {
    method: 'POST', token, body: { spouseId: created3.data.id, unionType: 'married' },
  });
  check('添加配偶成功', spouse1.status === 201, JSON.stringify(spouse1.data));
  const spouse2 = await api(`/api/relations/${testId}/spouses`, {
    method: 'POST', token, body: { spouseId: created3.data.id, unionType: 'married' },
  });
  check('重复婚姻被拦截（409）', spouse2.status === 409, JSON.stringify(spouse2.data));

  // 9. 审计日志
  const auditLog = await api('/api/admin/audit?pageSize=20', { token });
  check('审计日志记录了 create/update/login', auditLog.status === 200
    && auditLog.data.some((r) => ['create', 'login'].includes(r.action)));

  // 10. 导出 GEDCOM
  const ged = await api('/api/export/gedcom', { token });
  const gedText2 = String(ged.data);
  const indiCount = (gedText2.match(/ INDI/g) || []).length;
  const famCount = (gedText2.match(/ FAM/g) || []).length;
  check('GEDCOM 导出含 HEAD/INDI/FAM 且人数一致',
    ged.status === 200 && gedText2.includes('HEAD') && indiCount >= 20 && famCount >= 6,
    `INDI=${indiCount} FAM=${famCount}`);

  // 11. 导出 JSON
  const jsonExp = await api('/api/export/json', { token });
  check('JSON 导出含 persons 与 marriages', jsonExp.status === 200
    && Array.isArray(jsonExp.data.persons) && Array.isArray(jsonExp.data.marriages || jsonExp.data.unions));

  // 12. 导出 Excel（二进制）+ 解析往返
  const xlsRes = await fetch(BASE + '/api/export/excel', { headers: { Authorization: `Bearer ${token}` } });
  check('Excel 导出 content-type 正确',
    xlsRes.status === 200 && String(xlsRes.headers.get('content-type')).includes('spreadsheetml'));
  const xlsBuffer = Buffer.from(await xlsRes.arrayBuffer());
  const xlsWb = new ExcelJS.Workbook();
  await xlsWb.xlsx.load(xlsBuffer);
  const xlsRows = (xlsWb.worksheets[0]?.actualRowCount || 1) - 1;
  check('Excel 导出可被解析且行数一致', xlsRows >= 20, `rows=${xlsRows}`);

  // 12b. 用导出的 Excel 反向走导入预览（验证写-读闭环）
  const xlsForm = new FormData();
  xlsForm.append('file', new Blob([xlsBuffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }), 'roundtrip.xlsx');
  const xlsPreviewRes = await fetch(BASE + '/api/import/preview', {
    method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: xlsForm,
  });
  const xlsPreview = await xlsPreviewRes.json();
  check('Excel 导出→导入预览人数一致',
    xlsPreviewRes.status === 200 && xlsPreview.counts?.persons === xlsRows,
    JSON.stringify(xlsPreview).slice(0, 160));

  // 13. GEDCOM 导入：预览 + 提交（用时间戳保证可重复运行）
  const tag = String(Date.now()).slice(-6);
  const gedText = `0 HEAD\n1 GEDC\n2 VERS 5.5.1\n1 CHAR UTF-8\n0 @I1@ INDI\n1 NAME 导入/甲${tag}\n1 SEX M\n1 BIRT\n2 DATE 1970\n0 @I2@ INDI\n1 NAME 导入/乙${tag}\n1 SEX F\n1 BIRT\n2 DATE 1972\n0 @F1@ FAM\n1 HUSB @I1@\n1 WIFE @I2@\n1 CHIL @I3@\n0 @I3@ INDI\n1 NAME 导入/丙${tag}\n1 SEX M\n1 BIRT\n2 DATE 1995\n0 TRLR`;
  const form = new FormData();
  form.append('file', new Blob([gedText], { type: 'application/x-gedcom' }), 'test.ged');
  const previewRes = await fetch(BASE + '/api/import/preview', {
    method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form,
  });
  const preview = await previewRes.json();
  check('GEDCOM 预览解析出 3 人', previewRes.status === 200 && preview.counts?.persons === 3, JSON.stringify(preview).slice(0, 160));

  const commit = await api('/api/import/commit', {
    method: 'POST', token,
    body: { previewId: preview.previewId },
  });
  check('导入提交成功并建立关系', commit.status === 200 && commit.data.inserted >= 3
    && commit.data.edgesCreated >= 2, JSON.stringify(commit.data));

  // 14. 权限：无 token 访问应 401
  const noAuth = await api('/api/persons');
  check('未登录访问成员列表返回 401', noAuth.status === 401);

  // 16. 隐私分级与本人绑定
  const privTag = String(Date.now()).slice(-6);
  const privPerson = await api('/api/persons', {
    method: 'POST', token,
    body: {
      family_name: '隐', given_name: `私${privTag}`, gender: 'female',
      birth_date: '1980-05-05', birth_precision: 'exact', birth_place: '测试出生地',
      occupation: '测试职业', bio: '测试生平',
    },
  });
  const privId = privPerson.data.id;
  await api(`/api/persons/${privId}`, {
    method: 'PUT', token,
    body: { contact: { phone: '13800000000', email: 'priv@example.com', address: '测试住址' } },
  });

  // 建一个族人账户并绑定到该成员
  const memberName = `member_${privTag}`;
  const memberUser = await api('/api/admin/users', {
    method: 'POST', token, body: { username: memberName, password: 'member123', role: 'member' },
  });
  const memberId = memberUser.data.id;
  const bind = await api(`/api/admin/users/${memberId}/person`, {
    method: 'PUT', token, body: { personId: privId },
  });
  check('管理员可绑定账户与成员节点', bind.status === 200);

  const memberLogin = await api('/api/auth/login', {
    method: 'POST', body: { username: memberName, password: 'member123' },
  });
  const mToken = memberLogin.data.token;
  check('族人账户登录成功', memberLogin.status === 200 && !!mToken);

  // 本人视角：可见自己的联系方式
  const selfView = await api(`/api/persons/${privId}`, { token: mToken });
  check('本人可见自己的 L2 联系方式', selfView.status === 200
    && selfView.data.contact?.phone === '13800000000'
    && !selfView.data.restricted.includes('contact'));

  // 另建一位"他人"成员，验证他人视角（不依赖演示数据）
  const otherPerson = await api('/api/persons', {
    method: 'POST', token,
    body: {
      family_name: '隐', given_name: `他${privTag}`, gender: 'male',
      birth_date: '1975-03-03', birth_precision: 'exact', birth_place: '他人出生地',
    },
  });
  const otherId = otherPerson.data.id;
  await api(`/api/persons/${otherId}`, {
    method: 'PUT', token, body: { contact: { phone: '13900000000' } },
  });
  const memberSeeSeed = await api(`/api/persons/${otherId}`, { token: mToken });
  check('族人看他人的联系方式为 null 且标记 restricted',
    memberSeeSeed.data.contact === null && memberSeeSeed.data.restricted.includes('contact'));
  check('族人仍可见他人 L1 字段（出生日期）',
    !!memberSeeSeed.data.birth_date && !memberSeeSeed.data.restricted.includes('birth_date'),
    JSON.stringify({ birth: memberSeeSeed.data.birth_date, restricted: memberSeeSeed.data.restricted, id: otherId }));
  check('族人看不到他人隐私设置内容',
    JSON.stringify(memberSeeSeed.data.privacy_override || {}) === '{}');

  const editorLogin = await api('/api/auth/login', {
    method: 'POST', body: { username: 'editor', password: 'editor123' },
  });
  const eToken = editorLogin.data.token;
  const editorSeeSeed = await api(`/api/persons/${otherId}`, { token: eToken });
  check('谱系编辑同样看不到 L2 联系方式', editorSeeSeed.data.contact === null);

  const adminSeeSeed = await api(`/api/persons/${otherId}`, { token });
  check('管理员可见 L2 联系方式', adminSeeSeed.data.contact?.phone === '13900000000');

  // 本人自助修改联系方式与隐私
  const profile = await api('/api/me/profile', {
    method: 'PUT', token: mToken,
    body: { phone: '13700000000', email: 'me@example.com', address: '我的住址' },
  });
  check('本人可自助更新联系方式', profile.status === 200 && profile.data.contact.phone === '13700000000');

  const privacy = await api('/api/me/privacy', {
    method: 'PUT', token: mToken,
    body: { overrides: { birth_place: 'L2', bio: 'L2' } },
  });
  check('本人可自助把字段调为私密（L2）',
    privacy.status === 200 && privacy.data.levels.birth_place === 'L2' && privacy.data.levels.bio === 'L2');

  const editorSeePriv = await api(`/api/persons/${privId}`, { token: eToken });
  check('设为 L2 后编辑视角被脱敏',
    editorSeePriv.data.birth_place === null && editorSeePriv.data.restricted.includes('birth_place')
    && editorSeePriv.data.bio === null);

  const memberSeeSelf = await api(`/api/persons/${privId}`, { token: mToken });
  check('本人自己始终可见完整信息', memberSeeSelf.data.birth_place === '测试出生地');

  // 越权：族人不能删成员、不能导出
  const memberDelete = await api(`/api/persons/${privId}`, { method: 'DELETE', token: mToken });
  check('族人无删除成员权限（403）', memberDelete.status === 403);
  const memberExport = await api('/api/export/gedcom', { token: mToken });
  check('族人无导出权限（403）', memberExport.status === 403);
  const editorExport = await api('/api/export/json', { token: eToken });
  check('谱系编辑无全量导出权限（403）', editorExport.status === 403);

  // 树接口只返回年份，不泄露精确生日
  const treePrivacy = await api('/api/tree?depth=2', { token: mToken });
  const firstNode = treePrivacy.data.roots?.[0];
  check('树接口仅返回出生年份', !!firstNode && firstNode.birth_year !== undefined
    && firstNode.birth_date === undefined, JSON.stringify(firstNode || {}).slice(0, 120));

  // 17. 邀请制注册
  const inviteTarget = await api('/api/persons', {
    method: 'POST', token,
    body: { family_name: '隐', given_name: `邀${tag}`, gender: 'male', birth_date: '1985-06-06' },
  });
  const inviteTargetId = inviteTarget.data.id;

  const inv = await api('/api/admin/invitations', {
    method: 'POST', token,
    body: { role: 'member', targetPersonId: inviteTargetId, expiresDays: 7, maxUses: 1 },
  });
  check('管理员可生成邀请', inv.status === 201 && !!inv.data.token);

  const invInfo = await api(`/api/invitations/${inv.data.token}`);
  check('邀请链接可公开校验并显示目标成员',
    invInfo.status === 200 && invInfo.data.valid === true && invInfo.data.targetName === `隐邀${tag}`);

  const regName = `invitee_${tag}`;
  const reg = await api('/api/auth/register', {
    method: 'POST',
    body: { token: inv.data.token, username: regName, password: 'invite12345' },
  });
  check('凭邀请注册成功并自动绑定成员',
    reg.status === 201 && reg.data.user.personId === inviteTargetId && reg.data.user.role === 'member',
    JSON.stringify(reg.data).slice(0, 160));
  let iToken = reg.data.token;

  const inviteMe = await api('/api/me', { token: iToken });
  check('注册后 /api/me 显示绑定成员', inviteMe.data.person?.id === inviteTargetId);

  const invAfter = await api(`/api/invitations/${inv.data.token}`);
  check('一次性邀请用完后失效（410）', invAfter.status === 410);
  const regAgain = await api('/api/auth/register', {
    method: 'POST', body: { token: inv.data.token, username: `x_${tag}`, password: 'invite12345' },
  });
  check('已用完的邀请无法再次注册（410）', regAgain.status === 410);

  const badInvite = await api('/api/invitations/not-a-real-token');
  check('无效邀请返回 404', badInvite.status === 404);

  const inv2 = await api('/api/admin/invitations', {
    method: 'POST', token, body: { role: 'member', expiresDays: 1, maxUses: 2 },
  });
  await api(`/api/admin/invitations/${inv2.data.id}/revoke`, { method: 'POST', token });
  const inv2Info = await api(`/api/invitations/${inv2.data.token}`);
  check('撤销后的邀请失效（410）', inv2Info.status === 410);

  // 18. 改密后旧令牌失效
  const cp = await api('/api/auth/change-password', {
    method: 'POST', token: iToken,
    body: { oldPassword: 'invite12345', newPassword: 'invite67890' },
  });
  check('改密成功并返回新令牌', cp.status === 200 && !!cp.data.token);

  const oldTokenUse = await api('/api/auth/me', { token: iToken });
  check('改密后旧令牌立即失效（401）', oldTokenUse.status === 401);
  iToken = cp.data.token;
  const newTokenUse = await api('/api/auth/me', { token: iToken });
  check('改密返回的新令牌可用', newTokenUse.status === 200);

  const relogin = await api('/api/auth/login', {
    method: 'POST', body: { username: regName, password: 'invite67890' },
  });
  check('改密后可用新密码登录', relogin.status === 200);

  // 19. 连续失败锁定
  const lockName = `lock_${tag}`;
  const lockUser = await api('/api/admin/users', {
    method: 'POST', token, body: { username: lockName, password: 'lock12345', role: 'member' },
  });
  let lockStatuses = [];
  for (let i = 0; i < 5; i++) {
    const r = await api('/api/auth/login', {
      method: 'POST', body: { username: lockName, password: 'wrong-pass' },
    });
    lockStatuses.push(r.status);
  }
  check('连续失败 5 次后账户锁定（429）',
    lockStatuses.slice(0, 4).every((x) => x === 401) && lockStatuses[4] === 429,
    JSON.stringify(lockStatuses));
  const lockedCorrect = await api('/api/auth/login', {
    method: 'POST', body: { username: lockName, password: 'lock12345' },
  });
  check('锁定期间正确密码也无法登录（429）', lockedCorrect.status === 429);

  // 20. 生平事件 + 可见级别
  const eventPerson = await api('/api/persons', {
    method: 'POST', token,
    body: { family_name: '隐', given_name: `事${tag}`, gender: 'female', birth_date: '1960-01-01' },
  });
  const eventPersonId = eventPerson.data.id;

  const ev1 = await api(`/api/events/${eventPersonId}`, {
    method: 'POST', token,
    body: { eventType: 'migration', title: `迁居${tag}`, eventDate: '1980-03-01', eventPrecision: 'exact', place: '武汉', visibility: 'L1' },
  });
  const ev2 = await api(`/api/events/${eventPersonId}`, {
    method: 'POST', token,
    body: { eventType: 'award', title: `私密荣誉${tag}`, eventDate: '1990-01-01', eventPrecision: 'year', visibility: 'L2' },
  });
  check('可新增 L1/L2 事件', ev1.status === 201 && ev2.status === 201);

  const adminEvents = await api(`/api/events/${eventPersonId}`, { token });
  check('管理员可见全部事件', adminEvents.status === 200 && adminEvents.data.length === 2);

  const memberEvents = await api(`/api/events/${eventPersonId}`, { token: iToken });
  check('族人看不到他人的 L2 事件',
    memberEvents.status === 200 && memberEvents.data.length === 1
    && memberEvents.data[0].title === `迁居${tag}`,
    JSON.stringify(memberEvents.data).slice(0, 160));

  const evUpdate = await api(`/api/events/${ev1.data.id}`, {
    method: 'PUT', token, body: { title: `迁居武汉${tag}`, place: '武汉' },
  });
  check('事件可修改', evUpdate.status === 200 && evUpdate.data.title === `迁居武汉${tag}`);

  const evDel = await api(`/api/events/${ev1.data.id}`, { method: 'DELETE', token });
  const eventsAfterDel = await api(`/api/events/${eventPersonId}`, { token });
  check('事件可删除', evDel.status === 200 && eventsAfterDel.data.length === 1);

  // 21. 关系路径
  const shouren = list.data.items.find((x) => x.family_name + x.given_name === '王守仁');
  const yinuo = list.data.items.find((x) => x.family_name + x.given_name === '王一诺');
  const pathRes = await api(`/api/tree/path?a=${shouren.id}&b=${yinuo.id}`, { token });
  check('关系路径返回共同祖先与代数',
    pathRes.status === 200 && pathRes.data.related === true
    && pathRes.data.aDistance === 0 && pathRes.data.bDistance === 4,
    JSON.stringify(pathRes.data));

  // 22. 归档配偶不再出现在关系面板
  const spouseA = await api('/api/persons', {
    method: 'POST', token, body: { family_name: '隐', given_name: `偶甲${tag}` },
  });
  const spouseB = await api('/api/persons', {
    method: 'POST', token, body: { family_name: '隐', given_name: `偶乙${tag}` },
  });
  await api(`/api/relations/${spouseA.data.id}/spouses`, {
    method: 'POST', token, body: { spouseId: spouseB.data.id },
  });
  await api(`/api/persons/${spouseB.data.id}`, { method: 'DELETE', token });
  const relAfterArchive = await api(`/api/relations/${spouseA.data.id}/relations`, { token });
  check('归档配偶从关系面板消失',
    relAfterArchive.status === 200 && relAfterArchive.data.unions.length === 0);

  // 23. 健康检查真实探活数据库
  const healthDb = await api('/api/healthz');
  check('healthz 报告数据库状态', healthDb.status === 200 && healthDb.data.db === 'up');

  // 非法 UUID 不应打挂服务
  const badPersonRes = await fetch(BASE + '/api/persons/not-a-uuid',
    { headers: { Authorization: `Bearer ${token}` } });
  const badMediaRes = await fetch(BASE + '/api/media/person/20',
    { headers: { Authorization: `Bearer ${token}` } });
  const healthAfterBad = await api('/api/healthz');
  check('非法 UUID 返回 400 且服务存活',
    badPersonRes.status === 400 && badMediaRes.status === 400 && healthAfterBad.status === 200,
    `person=${badPersonRes.status} media=${badMediaRes.status} health=${healthAfterBad.status}`);

  // 24. 备份 / 恢复 / 静态加密 / 输入校验
  const encPerson = await api('/api/persons', {
    method: 'POST', token,
    body: { family_name: '隐', given_name: `密${tag}`, birth_date: '1980-01-01', birth_precision: 'exact' },
  });
  const encPersonId = encPerson.data.id;
  await api(`/api/persons/${encPersonId}`, {
    method: 'PUT', token,
    body: { contact: { phone: '13600000000', email: 'enc@example.com', address: '加密测试地址' } },
  });

  const encView = await api(`/api/persons/${encPersonId}`, { token });
  check('接口按权限返回解密后的联系方式', encView.data.contact?.phone === '13600000000');

  const backup = await api('/api/admin/backup', { method: 'POST', token });
  check('管理员可生成备份', backup.status === 201 && !!backup.data.file, JSON.stringify(backup.data).slice(0, 160));
  const backupFile = backup.data.file;
  const backupPath = path.resolve('backups', backupFile);

  const backups = await api('/api/admin/backups', { token });
  check('备份列表包含刚生成的文件', backups.status === 200
    && backups.data.some((b) => b.file === backupFile));

  const downloadRes = await fetch(BASE + `/api/admin/backups/${encodeURIComponent(backupFile)}`,
    { headers: { Authorization: `Bearer ${token}` } });
  const backupText = await downloadRes.text();
  let backupJson = {};
  try { backupJson = JSON.parse(backupText); } catch { /* 下面断言会失败 */ }
  const encRow = backupJson.data?.person?.find((x) => x.id === encPersonId);
  check('备份文件可下载且为合法 JSON', downloadRes.status === 200 && backupJson.version === 1);
  check('备份中联系方式是密文（静态加密生效）',
    encRow && encRow.contact?.__enc === 1 && !JSON.stringify(encRow.contact).includes('13600000000'));
  check('备份包含全部成员与用户', (backupJson.counts?.person ?? 0) >= 20
    && (backupJson.counts?.users ?? 0) >= 2);

  // 在隔离数据目录恢复，验证备份可真正还原
  const restoreDir = 'data/restore-test';
  fs.rmSync(restoreDir, { recursive: true, force: true });
  fs.rmSync(restoreDir + '.lock', { force: true });
  const restoreEnv = { ...process.env, DATABASE_URL: 'pglite:./' + restoreDir };

  let dryOut = '';
  try {
    dryOut = execFileSync(process.execPath, ['scripts/restore.js', backupPath, '--dry-run'], {
      cwd: process.cwd(), env: restoreEnv, encoding: 'utf8', timeout: 120000,
    });
  } catch (err) {
    dryOut = String(err.stdout || '') + String(err.stderr || '');
  }
  check('恢复脚本 dry-run 校验通过', dryOut.includes('DRY-RUN OK')
    && dryOut.includes(`persons=${backupJson.counts.person}`), dryOut.slice(-200));

  let restoreOut = '';
  try {
    restoreOut = execFileSync(process.execPath, ['scripts/restore.js', backupPath, '--yes'], {
      cwd: process.cwd(), env: restoreEnv, encoding: 'utf8', timeout: 120000,
    });
  } catch (err) {
    restoreOut = String(err.stdout || '') + String(err.stderr || '');
  }
  check('隔离目录恢复完成且行数一致',
    restoreOut.includes(`RESTORED persons=${backupJson.counts.person}`)
    && restoreOut.includes(`users=${backupJson.counts.users}`)
    && restoreOut.includes(`story=${backupJson.counts.story ?? 0}`), restoreOut.slice(-300));

  // 服务运行中恢复必须被单写者锁拒绝
  let lockErr = '';
  try {
    execFileSync(process.execPath, ['scripts/restore.js', backupPath, '--dry-run'], {
      cwd: process.cwd(), env: { ...process.env, DATABASE_URL: 'pglite:./data/pgdata' },
      encoding: 'utf8', timeout: 60000,
    });
  } catch (err) {
    lockErr = String(err.stdout || '') + String(err.stderr || '');
  }
  check('服务运行中恢复被拒绝（PGlite 单写者）', lockErr.includes('正被进程') || lockErr.includes('单写者'), lockErr.slice(-160));

  fs.rmSync(restoreDir, { recursive: true, force: true });
  fs.rmSync(restoreDir + '.lock', { force: true });

  // 输入校验
  const longBio = await api('/api/persons', {
    method: 'POST', token, body: { family_name: '测', given_name: '长简介', bio: 'x'.repeat(6000) },
  });
  check('超长简介被拒绝（400）', longBio.status === 400);
  const badGender = await api('/api/persons', {
    method: 'POST', token, body: { family_name: '测', given_name: '性别', gender: 'other' },
  });
  check('非法性别被拒绝（400）', badGender.status === 400);
  const longEvent = await api(`/api/events/${encPersonId}`, {
    method: 'POST', token,
    body: { eventType: 'custom', title: 'x'.repeat(130), visibility: 'L1' },
  });
  check('超长事件标题被拒绝（400）', longEvent.status === 400);

  // 25. 备份保留策略
  await api('/api/admin/backup', { method: 'POST', token });
  await api('/api/admin/backup', { method: 'POST', token });
  const prune = await api('/api/admin/backups/prune', { method: 'POST', token, body: { keep: 1 } });
  check('备份保留策略生效（只保留最近 1 份）',
    prune.status === 200 && prune.data.kept === 1 && prune.data.deleted >= 1,
    JSON.stringify(prune.data));
  const afterPrune = await api('/api/admin/backups', { token });
  check('清理后备份列表只剩 1 份', afterPrune.status === 200 && afterPrune.data.length === 1);

  // 26. 媒体库：上传 / 可见级别 / 鉴权读取 / 删除
  const mediaPerson = await api('/api/persons', {
    method: 'POST', token,
    body: { family_name: '隐', given_name: `媒${tag}`, gender: 'female' },
  });
  const mediaPersonId = mediaPerson.data.id;

  const up1 = await uploadMedia(token, mediaPersonId, {
    buffer: PNG_1PX, name: 'photo.png', type: 'image/png', visibility: 'L1',
  });
  const up2 = await uploadMedia(token, mediaPersonId, {
    buffer: PNG_1PX, name: 'secret.png', type: 'image/png', visibility: 'L2',
  });
  check('图片上传成功（L1/L2）', up1.status === 201 && up2.status === 201,
    JSON.stringify(up1.data).slice(0, 120));

  const editorL2 = await uploadMedia(eToken, mediaPersonId, {
    buffer: PNG_1PX, name: 'editor.png', type: 'image/png', visibility: 'L2',
  });
  check('谱系编辑不能把媒体设为私密（403）', editorL2.status === 403);

  const badType = await uploadMedia(token, mediaPersonId, {
    buffer: Buffer.from('not-an-image'), name: 'bad.exe', type: 'application/x-msdownload',
  });
  check('不支持的文件类型被拒绝（400）', badType.status === 400);

  const adminMedia = await api(`/api/media/person/${mediaPersonId}`, { token });
  const memberMedia = await api(`/api/media/person/${mediaPersonId}`, { token: iToken });
  check('管理员可见全部媒体（2 项）', adminMedia.status === 200 && adminMedia.data.length === 2);
  check('族人只看到 L1 媒体（1 项）',
    memberMedia.status === 200 && memberMedia.data.length === 1 && memberMedia.data[0].id === up1.data.id);

  const l1File = await fetch(BASE + up1.data.url, { headers: { Authorization: `Bearer ${iToken}` } });
  const l1Bytes = Buffer.from(await l1File.arrayBuffer());
  check('族人可读取 L1 原文件', l1File.status === 200
    && l1File.headers.get('content-type') === 'image/png' && l1Bytes.length === PNG_1PX.length);

  const l2File = await fetch(BASE + up2.data.url, { headers: { Authorization: `Bearer ${iToken}` } });
  check('族人读取 L2 文件被拒（403）', l2File.status === 403);

  const noAuthFile = await fetch(BASE + up1.data.url);
  check('未登录读取媒体返回 401', noAuthFile.status === 401);

  const delMedia1 = await api(`/api/media/${up1.data.id}`, { method: 'DELETE', token });
  const delMedia2 = await api(`/api/media/${up2.data.id}`, { method: 'DELETE', token });
  const mediaAfterDel = await api(`/api/media/person/${mediaPersonId}`, { token });
  const fileAfterDel = await fetch(BASE + up2.data.url, { headers: { Authorization: `Bearer ${token}` } });
  check('媒体可删除且原文件失效',
    delMedia1.status === 200 && delMedia2.status === 200
    && mediaAfterDel.data.length === 0 && fileAfterDel.status === 404);

  // 26b. 祖先链（沙漏视图数据）
  const anc = await api(`/api/tree/ancestors/${yinuo.id}`, { token });
  const ancDistances = [...new Set((anc.data.ancestors || []).map((x) => x.distance))].sort();
  check('祖先链接口返回 1–4 代祖先',
    anc.status === 200 && anc.data.ancestors.length === 8
    && [1, 2, 3, 4].every((d) => ancDistances.includes(d)),
    JSON.stringify({ n: anc.data.ancestors?.length, distances: ancDistances }));

  // 26c. 曾用名读写与检索
  const formerPerson = await api('/api/persons', {
    method: 'POST', token,
    body: {
      family_name: '隐', given_name: `名${tag}`, birth_date: '1970-02-02',
      former_names: [`旧名${tag}甲`, `旧名${tag}乙`],
    },
  });
  const formerId = formerPerson.data.id;
  const formerView = await api(`/api/persons/${formerId}`, { token });
  const formerSearch = await api('/api/persons?keyword=' + encodeURIComponent(`旧名${tag}甲`), { token });
  check('曾用名可保存并参与检索',
    formerView.data.former_names?.length === 2 && formerSearch.data.total >= 1,
    JSON.stringify({ names: formerView.data.former_names, total: formerSearch.data.total }));

  // 26d. 重复检测 + 合并（关系重挂）
  const dupA = await api('/api/persons', {
    method: 'POST', token,
    body: { family_name: '测', given_name: `重${tag}`, birth_date: '1985-01-01', generation_no: 6 },
  });
  const dupB = await api('/api/persons', {
    method: 'POST', token,
    body: { family_name: '测', given_name: `重${tag}`, birth_date: '1985-01-01', generation_no: 6 },
  });
  const dupChild = await api('/api/persons', {
    method: 'POST', token,
    body: { family_name: '测', given_name: `孩${tag}`, birth_date: '2010-01-01', generation_no: 7 },
  });
  await api(`/api/relations/${dupChild.data.id}/parents`, {
    method: 'POST', token, body: { parentId: dupA.data.id },
  });

  const dupList = await api('/api/admin/duplicates', { token });
  const dupPair = dupList.data.find((x) =>
    (x.a.id === dupA.data.id && x.b.id === dupB.data.id)
    || (x.a.id === dupB.data.id && x.b.id === dupA.data.id));
  check('重复检测识别同名同年成员', dupPair && dupPair.score >= 90, JSON.stringify(dupPair || {}).slice(0, 160));

  const merge = await api('/api/admin/merge', {
    method: 'POST', token, body: { sourceId: dupA.data.id, targetId: dupB.data.id },
  });
  const mergedGone = await api(`/api/persons/${dupA.data.id}`, { token });
  const childAfter = await api(`/api/relations/${dupChild.data.id}/relations`, { token });
  check('合并后关系转移到保留方且源成员消失',
    merge.status === 200 && mergedGone.status === 404
    && childAfter.data.parents.some((p) => p.id === dupB.data.id),
    JSON.stringify(merge.data));

  // 26e. 变更提案：提交 / 冲突 / 审批 / 驳回
  const crPerson = await api('/api/persons', {
    method: 'POST', token,
    body: { family_name: '测', given_name: `提${tag}`, birth_date: '1988-08-08', bio: '旧生平' },
  });
  const crIdPerson = crPerson.data.id;

  const cr = await api('/api/change-requests', {
    method: 'POST', token: iToken,
    body: {
      personId: crIdPerson,
      payload: { bio: '新生平（据家信）', courtesy_name: '新字' },
      note: '依据家中书信',
    },
  });
  check('族人可提交修改建议', cr.status === 201 && cr.data.status === 'pending');

  const crDup = await api('/api/change-requests', {
    method: 'POST', token: iToken,
    body: { personId: crIdPerson, payload: { bio: '重复提交' } },
  });
  check('同一成员重复提交被拒（409）', crDup.status === 409);

  const mine = await api('/api/change-requests/mine', { token: iToken });
  check('我的建议列表包含提交记录', mine.status === 200
    && mine.data.some((x) => x.id === cr.data.id && x.status === 'pending'));

  const pendingList = await api('/api/change-requests?status=pending', { token });
  check('管理员待审核列表包含该建议',
    pendingList.status === 200 && pendingList.data.some((x) => x.id === cr.data.id),
    JSON.stringify(pendingList.data).slice(0, 160));

  const approve = await api(`/api/change-requests/${cr.data.id}/approve`, { method: 'POST', token });
  const crAfter = await api(`/api/persons/${crIdPerson}`, { token });
  check('审核通过后写入成员档案',
    approve.status === 200 && crAfter.data.bio === '新生平（据家信）' && crAfter.data.courtesy_name === '新字');

  const cr2 = await api('/api/change-requests', {
    method: 'POST', token: iToken,
    body: { personId: crIdPerson, payload: { bio: '再次修改' }, note: '补充' },
  });
  const reject = await api(`/api/change-requests/${cr2.data.id}/reject`, {
    method: 'POST', token, body: { note: '需核对族中长辈口述' },
  });
  const afterReject = await api(`/api/persons/${crIdPerson}`, { token });
  const mineAfter = await api('/api/change-requests/mine', { token: iToken });
  check('驳回后成员不变且建议状态为 rejected',
    reject.status === 200 && afterReject.data.bio === '新生平（据家信）'
    && mineAfter.data.find((x) => x.id === cr2.data.id)?.status === 'rejected');

  // 清理本节测试成员（后续统一 purge）
  for (const id of [formerId, dupB.data.id, dupChild.data.id, crIdPerson]) {
    await api(`/api/persons/${id}`, { method: 'DELETE', token });
  }

  // 26f. 来源与引文 + SVG 导出
  const src = await api('/api/sources', {
    method: 'POST', token,
    body: { title: `来源${tag}`, author: '编纂者', publication: '2026 年整理', repository: '家族档案' },
  });
  check('可创建来源', src.status === 201 && !!src.data.id);
  const memberSource = await api('/api/sources', {
    method: 'POST', token: iToken, body: { title: '族人不能建来源' },
  }).catch((e) => e);
  check('族人不能创建来源（403）', memberSource.status === 403);

  const citTarget = await api('/api/persons', {
    method: 'POST', token,
    body: { family_name: '测', given_name: `源${tag}`, birth_date: '1992-02-02' },
  });
  const citTargetId = citTarget.data.id;
  const citation = await api('/api/citations', {
    method: 'POST', token,
    body: {
      sourceId: src.data.id, targetType: 'person', targetId: citTargetId,
      page: '卷一 · 第十二页', confidence: 'high', note: '生年据此',
    },
  });
  check('可为人物挂引文', citation.status === 201);
  const dupCit = await api('/api/citations', {
    method: 'POST', token,
    body: { sourceId: src.data.id, targetType: 'person', targetId: citTargetId },
  }).catch((e) => e);
  check('同一来源重复挂载被拒（409）', dupCit.status === 409);

  const personCits = await api(`/api/citations?targetType=person&targetId=${citTargetId}`, { token });
  check('人物引文列表返回来源与可信度',
    personCits.status === 200 && personCits.data.length === 1
    && personCits.data[0].title === `来源${tag}` && personCits.data[0].confidence === 'high');

  const memberCit = await api('/api/citations', {
    method: 'POST', token: iToken,
    body: { sourceId: src.data.id, targetType: 'person', targetId: citTargetId, page: 'x' },
  }).catch((e) => e);
  check('族人不能添加引文（403）', memberCit.status === 403);

  const citEvent = await api(`/api/events/${citTargetId}`, {
    method: 'POST', token,
    body: { eventType: 'birth', title: '出生', eventDate: '1992-02-02', visibility: 'L1' },
  });
  await api('/api/citations', {
    method: 'POST', token,
    body: { sourceId: src.data.id, targetType: 'event', targetId: citEvent.data.id, page: '附录' },
  });
  const eventsWithCit = await api(`/api/events/${citTargetId}`, { token });
  check('事件返回引文数量',
    eventsWithCit.data.find((e) => e.id === citEvent.data.id)?.citation_count === 1);

  // 合并时人物引文随成员转移
  const citMergeTarget = await api('/api/persons', {
    method: 'POST', token,
    body: { family_name: '测', given_name: `源并${tag}`, birth_date: '1993-03-03' },
  });
  const citMergeId = citMergeTarget.data.id;
  await api('/api/admin/merge', {
    method: 'POST', token, body: { sourceId: citTargetId, targetId: citMergeId },
  });
  const mergedCits = await api(`/api/citations?targetType=person&targetId=${citMergeId}`, { token });
  check('合并成员后引文转移到保留方', mergedCits.data.length === 1
    && mergedCits.data[0].source_id === src.data.id);

  const sources = await api('/api/sources', { token });
  check('来源库统计引用次数',
    sources.data.find((x) => x.id === src.data.id)?.citationCount === 2);

  const svgRes = await fetch(BASE + '/api/tree/export.svg', {
    headers: { Authorization: `Bearer ${token}` },
  });
  const svgText = await svgRes.text();
  check('SVG 世系图可导出且包含五代成员',
    svgRes.status === 200 && svgText.includes('<svg') && svgText.includes('王守仁')
    && svgText.includes('5世'),
    svgText.slice(0, 80));
  const badSvg = await api('/api/tree/export.svg?root=20', { token }).catch((e) => e);
  check('SVG 导出非法 root 返回 400', badSvg.status === 400);

  const delSrc = await api(`/api/sources/${src.data.id}`, { method: 'DELETE', token });
  const citsAfterDel = await api(`/api/citations?targetType=person&targetId=${citMergeId}`, { token });
  check('删除来源级联清理引文',
    delSrc.status === 200 && citsAfterDel.data.length === 0);

  await api(`/api/persons/${citMergeId}`, { method: 'DELETE', token });

  // 27. 称谓推导 / 五服 / 家族洞察
  const kinList = list.data.items;
  const kinYinuo = kinList.find((x) => x.family_name + x.given_name === '王一诺');
  const kinShouren = kinList.find((x) => x.family_name + x.given_name === '王守仁');
  const kinXiaoming = kinList.find((x) => x.family_name + x.given_name === '王小明');
  const kinYifan = kinList.find((x) => x.family_name + x.given_name === '王一凡');
  const kinDeming = kinList.find((x) => x.family_name + x.given_name === '王德明');

  const kin1 = await api(`/api/tree/kinship?a=${kinYinuo.id}&b=${kinShouren.id}`, { token });
  check('称谓：五代孙对始祖为高祖父',
    kin1.status === 200 && kin1.data.term === '高祖父' && kin1.data.kind === 'ancestor',
    JSON.stringify(kin1.data));
  check('称谓：反向为玄孙', kin1.data.reverse?.term === '玄孙', JSON.stringify(kin1.data.reverse));

  const kin2 = await api(`/api/tree/kinship?a=${kinYinuo.id}&b=${kinXiaoming.id}`, { token });
  check('称谓：直系父女/父子', kin2.data.term === '父亲' && kin2.data.reverse?.term === '儿子');

  const kin3 = await api(`/api/tree/kinship?a=${kinYinuo.id}&b=${kinYifan.id}`, { token });
  check('称谓：同胞妹妹', kin3.data.term === '妹妹' && kin3.data.kind === 'sibling');

  const kin4 = await api(`/api/tree/kinship?a=${kinYinuo.id}&b=${kinDeming.id}`, { token });
  check('称谓：隔代旁系长辈为曾叔祖父',
    kin4.data.term.includes('曾') && kin4.data.term.includes('祖父'),
    JSON.stringify(kin4.data));

  const kinBad = await api('/api/tree/kinship?a=20&b=30', { token });
  check('称谓：非法 ID 返回 400', kinBad.status === 400);

  const ff = await api(`/api/tree/five-fu?center=${kinYinuo.id}`, { token });
  check('五服：返回中心与上下亲属',
    ff.status === 200 && ff.data.total >= 10
    && ff.data.persons.some((p) => p.id === kinShouren.id),
    JSON.stringify({ total: ff.data.total }));

  const ins = await api('/api/tree/insights', { token });
  // 注意：测试过程中会临时创建成员，世代数可能多于演示基线，因此用"至少"断言
  check('洞察：世代与在世代数（≥5 代同堂）',
    ins.status === 200 && ins.data.generations >= 5 && ins.data.livingGenerations >= 5,
    JSON.stringify({ g: ins.data.generations, l: ins.data.livingGenerations }));
  const zbSeq = ins.data.zibei.sequence || [];
  check('洞察：字辈含演示序列守德建明一',
    ['守', '德', '建', '明', '一'].every((z) => zbSeq.includes(z)),
    JSON.stringify(zbSeq));
  check('洞察：人丁结构从第一世起连续',
    ins.data.generationStructure.length >= 5
    && ins.data.generationStructure[0].orderLabel === '第一世'
    && ins.data.generationStructure[4].orderLabel === '第五世',
    JSON.stringify(ins.data.generationStructure.map((g) => g.orderLabel)));
  check('洞察：地域分布非空', ins.data.regions.length > 0,
    JSON.stringify(ins.data.regions.slice(0, 3)));
  check('洞察：年表含出生与卒', ins.data.timeline.length > 0
    && ins.data.timeline.some((e) => e.kind === 'birth'));

  // 28. 口述建谱 + 地点库
  const narText = '我叫测甲，1980年出生在保定。我父亲是测乙，1955年生。我母亲叫测丙。我妻子是测丁。我儿子叫测戊，2010年出生。';
  const narPreview = await api('/api/import/narrative/preview', {
    method: 'POST', token, body: { text: narText, mode: 'narrative' },
  });
  check('口述建谱：识别 5 人与 4 条关系',
    narPreview.status === 200 && narPreview.data.persons.length === 5
    && narPreview.data.relations.length === 4 && narPreview.data.stats.validRelations === 4,
    JSON.stringify(narPreview.data.stats));
  check('口述建谱：识别生年与出生地',
    narPreview.data.persons.find((p) => p.name === '测甲')?.birthYear === 1980
    && narPreview.data.persons.find((p) => p.name === '测甲')?.birthPlace === '保定',
    JSON.stringify(narPreview.data.persons[0]));

  const narCommit = await api('/api/import/narrative/commit', {
    method: 'POST', token,
    body: { persons: narPreview.data.persons, relations: narPreview.data.relations },
  });
  check('口述建谱：确认后写入成员与关系',
    narCommit.status === 200 && narCommit.data.created === 5
    && narCommit.data.parentEdges >= 3 && narCommit.data.spouseEdges === 1,
    JSON.stringify(narCommit.data));

  const narPerson = await api('/api/persons?keyword=' + encodeURIComponent('测甲'), { token });
  check('口述建谱：成员可在名录检索到', narPerson.data.total >= 1);

  // 地点库
  const place = await api('/api/places', {
    method: 'POST', token,
    body: { name: `测试地${tag}`, province: '测试省', city: '测试市', aliases: ['测地旧称'] },
  });
  check('地点库：可新增地点', place.status === 201 && !!place.data.id);

  const placePerson = await api('/api/persons', {
    method: 'POST', token,
    body: { family_name: '测', given_name: '地', birth_place: `测试地${tag}`, birth_date: '1990-01-01' },
  });
  const placePersonId = placePerson.data.id;

  const placeList = await api('/api/places', { token });
  const placeRow = placeList.data.places.find((p) => p.id === place.data.id);
  check('地点库：成员自动归类',
    placeRow && placeRow.memberCount >= 1,
    JSON.stringify(placeRow));
  const placeStats = await api('/api/places/stats', { token });
  check('地点库：省份聚合含测试省',
    placeStats.data.provinces.some((p) => p.province === '测试省'),
    JSON.stringify(placeStats.data.provinces));

  const migEvent = await api(`/api/events/${placePersonId}`, {
    method: 'POST', token,
    body: { eventType: 'migration', title: '迁居北京', place: '北京', eventDate: '2000-01-01', eventPrecision: 'exact', visibility: 'L1' },
  });
  const migrations = await api('/api/places/migrations', { token });
  check('地点库：迁徙记录来自迁徙事件',
    migrations.status === 200 && migrations.data.some((m) => m.personId === placePersonId && m.to === '北京'),
    JSON.stringify(migrations.data.slice(0, 2)));

  const memberPlace = await api('/api/places', {
    method: 'POST', token: iToken, body: { name: '族人不能建地点' },
  }).catch((e) => e);
  check('地点库：族人不能新增（403）', memberPlace.status === 403);

  // 清理本节数据
  for (const name of ['测甲', '测乙', '测丙', '测丁', '测戊']) {
    const found = await api('/api/persons?keyword=' + encodeURIComponent(name), { token });
    for (const p of found.data.items) await api(`/api/persons/${p.id}`, { method: 'DELETE', token });
  }
  await api(`/api/places/${place.data.id}`, { method: 'DELETE', token });
  await api(`/api/persons/${placePersonId}`, { method: 'DELETE', token });

  // 29. 人物关联 / 资料完整度 / 批量编辑 / 乐观锁 / 地点层级
  const relA = list.data.items.find((x) => x.family_name + x.given_name === '王小明');
  const relB = list.data.items.find((x) => x.family_name + x.given_name === '王志强');

  const assoc = await api('/api/associations', {
    method: 'POST', token,
    body: { personAId: relA.id, personBId: relB.id, role: 'friend', note: '同学' },
  });
  check('可建立人物关联（义亲/师承等）', assoc.status === 201 && assoc.data.roleLabel === '好友');
  const assocList = await api(`/api/associations/person/${relA.id}`, { token });
  check('关联列表双向可见',
    assocList.data.length === 1 && assocList.data[0].other.id === relB.id);
  const assocDup = await api('/api/associations', {
    method: 'POST', token, body: { personAId: relA.id, personBId: relB.id, role: 'friend' },
  }).catch((e) => e);
  check('同角色重复关联被拒（409）', assocDup.status === 409);
  const assocBad = await api('/api/associations', {
    method: 'POST', token, body: { personAId: relA.id, personBId: relA.id, role: 'friend' },
  }).catch((e) => e);
  check('不能与自己建立关联（400）', assocBad.status === 400);
  const assocMember = await api('/api/associations', {
    method: 'POST', token: iToken,
    body: { personAId: relA.id, personBId: relB.id, role: 'neighbor' },
  }).catch((e) => e);
  check('族人不能建立关联（403）', assocMember.status === 403);

  const completeness = await api('/api/quality/completeness', { token });
  check('完整度总览返回分数与待补项',
    completeness.status === 200 && completeness.data.overall > 0
    && completeness.data.items.length === 8 && completeness.data.weakest.length > 0,
    JSON.stringify({ overall: completeness.data.overall }));
  check('完整度：来源考证为最大待补项',
    completeness.data.items.some((i) => i.key === 'source' && i.missingCount > 0));

  const incomplete = await api('/api/quality/incomplete?missing=source', { token });
  check('待补清单按缺项筛选', incomplete.status === 200 && incomplete.data.total > 0);

  const qsearch = await api('/api/quality/search?incompleteBelow=60', { token });
  check('名录质量筛选（完整度低于 60）',
    qsearch.status === 200 && Array.isArray(qsearch.data.items)
    && qsearch.data.items.every((p) => p.completeness < 60),
    JSON.stringify(qsearch.data.items.slice(0, 2)));

  const bulk = await api('/api/quality/bulk-update', {
    method: 'POST', token,
    body: { personIds: [relA.id, relB.id], set: { branch: '二房' } },
  });
  check('批量修改支系', bulk.status === 200 && bulk.data.updated === 2);
  const bulkBack = await api(`/api/persons/${relA.id}`, { token });
  check('批量修改已生效', bulkBack.data.branch === '二房');

  const bulkBad = await api('/api/quality/bulk-update', {
    method: 'POST', token, body: { personIds: [relA.id], set: { bio: '不允许' } },
  }).catch((e) => e);
  check('批量编辑只允许支系/世代/字辈（400）', bulkBad.status === 400);

  // 乐观锁
  const snapshot = await api(`/api/persons/${relA.id}`, { token });
  const upd1 = await api(`/api/persons/${relA.id}`, {
    method: 'PUT', token,
    body: { occupation: '软件工程师', expectedUpdatedAt: snapshot.data.updated_at },
  });
  check('乐观锁：版本一致时更新成功', upd1.status === 200);
  const upd2 = await api(`/api/persons/${relA.id}`, {
    method: 'PUT', token,
    body: { occupation: '越权覆盖', expectedUpdatedAt: snapshot.data.updated_at },
  }).catch((e) => e);
  check('乐观锁：旧版本被拒（409）', upd2.status === 409, JSON.stringify(upd2.data));

  // 地点层级与合并
  const parentPlace = await api('/api/places', {
    method: 'POST', token, body: { name: `层省${tag}`, province: `层省${tag}`, city: '' },
  });
  const childPlace = await api('/api/places', {
    method: 'POST', token,
    body: { name: `层市${tag}`, province: `层省${tag}`, city: `层市${tag}`, parentId: parentPlace.data.id },
  });
  check('地点可设上级（层级）', childPlace.status === 201 && childPlace.data.parent_id === parentPlace.data.id);

  const placeTree = await api('/api/places', { token });
  const parentNode = placeTree.data.tree.find((t) => t.id === parentPlace.data.id);
  check('地点树包含子级',
    parentNode && parentNode.children.some((c) => c.id === childPlace.data.id),
    JSON.stringify(parentNode?.children?.map((c) => c.name)));

  const selfParent = await api(`/api/places/${parentPlace.data.id}`, {
    method: 'PUT', token, body: { parentId: childPlace.data.id },
  }).catch((e) => e);
  check('地点层级环路被拒（400）', selfParent.status === 400);

  const mergePlace = await api('/api/places/merge', {
    method: 'POST', token,
    body: { sourceId: childPlace.data.id, targetId: parentPlace.data.id },
  });
  check('地点可合并（别名并入）',
    mergePlace.status === 200 && mergePlace.data.aliases.includes(`层市${tag}`),
    JSON.stringify(mergePlace.data));

  // 清理
  await api(`/api/associations/${assoc.data.id}`, { method: 'DELETE', token });
  await api(`/api/places/${parentPlace.data.id}`, { method: 'DELETE', token });
  await api(`/api/persons/${relA.id}`, { method: 'PUT', token, body: { branch: '长房', occupation: '软件工程师' } });
  await api(`/api/persons/${relB.id}`, { method: 'PUT', token, body: { branch: '二房' } });

  // 29b. 双因素认证（TOTP）
  const fa = await api('/api/auth/2fa/status', { token });
  check('2FA：默认未开启', fa.status === 200 && fa.data.enabled === false);
  const setup = await api('/api/auth/2fa/setup', { method: 'POST', token });
  check('2FA：生成密钥与 otpauth URI',
    setup.status === 200 && setup.data.secret?.length === 32
    && setup.data.uri.startsWith('otpauth://totp/'));
  const badCode = await api('/api/auth/2fa/enable', {
    method: 'POST', token, body: { code: '000000' },
  }).catch((e) => e);
  check('2FA：错误验证码不能开启（400）', badCode.status === 400);

  const totpCode = totpForTest(setup.data.secret, Math.floor(Date.now() / 1000 / 30));
  const enabled = await api('/api/auth/2fa/enable', {
    method: 'POST', token, body: { code: totpCode },
  });
  check('2FA：正确验证码开启并生成 10 个恢复码',
    enabled.status === 200 && enabled.data.recoveryCodes?.length === 10);

  // 启用后旧 token 失效
  const staleToken = await api('/api/auth/me', { token });
  check('2FA：启用后旧令牌失效（401）', staleToken.status === 401);

  // 登录进入挑战
  const login2 = await api('/api/auth/login', {
    method: 'POST', body: { username: 'admin', password: 'admin123' },
  });
  check('2FA：密码正确后返回挑战而非令牌',
    login2.status === 200 && login2.data.twoFactorRequired === true
    && !!login2.data.challengeToken);
  const badChallenge = await api('/api/auth/login/2fa', {
    method: 'POST', body: { challengeToken: login2.data.challengeToken, code: '000000' },
  }).catch((e) => e);
  check('2FA：错误验证码被拒（401）', badChallenge.status === 401);

  const goodCode = totpForTest(setup.data.secret, Math.floor(Date.now() / 1000 / 30));
  const verified = await api('/api/auth/login/2fa', {
    method: 'POST', body: { challengeToken: login2.data.challengeToken, code: goodCode },
  });
  check('2FA：正确验证码登录后获得令牌', verified.status === 200 && !!verified.data.token);
  const adminToken2FA = verified.data.token;

  // 恢复码消费
  const login3 = await api('/api/auth/login', {
    method: 'POST', body: { username: 'admin', password: 'admin123' },
  });
  const recovered = await api('/api/auth/login/2fa', {
    method: 'POST', body: {
      challengeToken: login3.data.challengeToken,
      code: enabled.data.recoveryCodes[0],
    },
  });
  check('2FA：恢复码可登录并提示剩余数量',
    recovered.status === 200 && recovered.data.recoveryRemaining === 9);

  // 关闭 2FA
  const disabled = await api('/api/auth/2fa/disable', {
    method: 'POST', token: recovered.data.token, body: { password: 'admin123' },
  });
  check('2FA：可用密码关闭', disabled.status === 200);
  const loginAfter = await api('/api/auth/login', {
    method: 'POST', body: { username: 'admin', password: 'admin123' },
  });
  check('2FA：关闭后登录直接返回令牌', !!loginAfter.data.token && !loginAfter.data.twoFactorRequired);
  // 2FA 启用/关闭使 token_version 递增，更新后续测试使用的令牌
  token = loginAfter.data.token;
  void adminToken2FA;

  // 29c. 地图 / 打印数据 / 故事版本 / 事件乐观锁
  const mapData = await api('/api/places/map', { token });
  check('地图 API 返回坐标与边界',
    mapData.status === 200 && mapData.data.places.length >= 4
    && mapData.data.bounds && mapData.data.bounds.minLat < mapData.data.bounds.maxLat,
    JSON.stringify(mapData.data.bounds));

  const treeDataForPrint = await api('/api/tree?depth=10', { token });
  check('打印数据：世系树完整返回',
    treeDataForPrint.status === 200 && treeDataForPrint.data.roots.length > 0
    && typeof treeDataForPrint.data.renderedNodes === 'number',
    JSON.stringify({ rendered: treeDataForPrint.data.renderedNodes }));

  // 故事版本
  const versionStory = await api('/api/stories', {
    method: 'POST', token,
    body: { title: `版本${tag}`, body: '第一版正文', visibility: 'L1' },
  });
  const vsid = versionStory.data.id;
  await api(`/api/stories/${vsid}`, {
    method: 'PUT', token, body: { body: '第二版正文', versionNote: '补充' },
  });
  const versions = await api(`/api/stories/${vsid}/versions`, { token });
  const versionDetail = await api(`/api/stories/${vsid}/versions/1`, { token });
  check('编辑自动生成版本快照（列表+详情）',
    versions.status === 200 && versions.data.length === 1
    && versions.data[0].version_no === 1
    && versionDetail.data.body === '第一版正文'
    && versionDetail.data.saved_label === 'admin',
    JSON.stringify(versions.data).slice(0, 160));
  const rollback = await api(`/api/stories/${vsid}/versions/1/restore`, {
    method: 'POST', token,
  });
  const afterRollback = await api(`/api/stories/${vsid}`, { token });
  const versionsAfter = await api(`/api/stories/${vsid}/versions`, { token });
  check('回滚到旧版本并保留回滚前状态',
    rollback.status === 200 && afterRollback.data.body === '第一版正文'
    && versionsAfter.data.length === 2,
    JSON.stringify({ body: afterRollback.data.body, versions: versionsAfter.data.length }));
  await api(`/api/stories/${vsid}`, { method: 'DELETE', token });

  // 事件乐观锁
  const lockPerson = (await api('/api/persons?keyword=' + encodeURIComponent('王守仁'), { token })).data.items[0];
  const lockEvent = await api(`/api/events/${lockPerson.id}`, {
    method: 'POST', token,
    body: { eventType: 'custom', title: `锁测试${tag}`, visibility: 'L1' },
  });
  const evDetail = (await api(`/api/events/${lockPerson.id}`, { token })).data.find((e) => e.id === lockEvent.data.id);
  const evPut1 = await api(`/api/events/${lockEvent.data.id}`, {
    method: 'PUT', token,
    body: { title: `锁测试${tag}改`, expectedUpdatedAt: evDetail.updated_at },
  });
  const evNow = (await api(`/api/events/${lockPerson.id}`, { token })).data.find((e) => e.id === lockEvent.data.id);
  const evPut2 = await api(`/api/events/${lockEvent.data.id}`, {
    method: 'PUT', token,
    body: { title: '过期覆盖', expectedUpdatedAt: evDetail.updated_at },
  }).catch((e) => e);
  check('事件乐观锁：版本一致成功、旧版本 409',
    evPut1.status === 200 && evPut2.status === 409 && evNow.updated_at !== evDetail.updated_at);
  await api(`/api/events/${lockEvent.data.id}`, { method: 'DELETE', token });

  // 29d. 请求体校验：非对象/缺字段/类型错应返回 400（而非 500）
  const badBodies = [
    { path: '/api/places', method: 'POST', body: [1, 2, 3], label: '地点：数组请求体' },
    { path: '/api/places', method: 'POST', body: { name: '' }, label: '地点：空名称' },
    { path: '/api/persons', method: 'POST', body: 'not-json-object', label: '成员：字符串请求体' },
    { path: '/api/sources', method: 'POST', body: [], label: '来源：数组请求体' },
  ];
  for (const c of badBodies) {
    const r = await fetch(BASE + c.path, {
      method: c.method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(c.body),
    });
    check(`${c.label} 返回 400`, r.status === 400, `status=${r.status}`);
  }

  const longPlace = await api('/api/places', {
    method: 'POST', token, body: { name: 'x'.repeat(80) },
  });
  check('地点：超长名称返回 400', longPlace.status === 400, JSON.stringify(longPlace.data).slice(0, 80));

  const badCitation = await api('/api/citations', {
    method: 'POST', token,
    body: { sourceId: 'not-uuid', targetType: 'person', targetId: 'x' },
  });
  check('引文：非法参数返回 400', badCitation.status === 400);

  // 30. 故事与回忆录
  const storyPerson = await api('/api/persons', {
    method: 'POST', token,
    body: { family_name: '测', given_name: `故${tag}`, birth_date: '1970-01-01' },
  });
  const storyPersonId = storyPerson.data.id;

  const story = await api('/api/stories', {
    method: 'POST', token,
    body: {
      title: `口述往事${tag}`,
      body: '## 缘起\n\n**祖父**携家迁居。\n\n> 只带了两只木箱。\n\n- 1937 年动身\n- 1949 年定居',
      authorName: '记录人',
      date: '1949-01-01',
      precision: 'year',
      visibility: 'L1',
      personIds: [storyPersonId],
    },
  });
  check('可创建故事并关联人物', story.status === 201 && !!story.data.id);

  const storyDetail = await api(`/api/stories/${story.data.id}`, { token });
  check('故事详情渲染 Markdown（标题/引用/列表）',
    storyDetail.status === 200 && storyDetail.data.html.includes('<h2>')
    && storyDetail.data.html.includes('<blockquote>') && storyDetail.data.html.includes('<ul>'),
    storyDetail.data.html.slice(0, 120));
  check('故事详情返回关联人物',
    storyDetail.data.persons.length === 1 && storyDetail.data.persons[0].id === storyPersonId);

  const storyByPerson = await api(`/api/stories/person/${storyPersonId}`, { token });
  check('人物可反查参与的故事', storyByPerson.data.length === 1);

  const storyList = await api('/api/stories', { token });
  check('故事列表含摘要', storyList.data.some((x) => x.id === story.data.id && x.excerpt.length > 0));

  const storySearch = await api('/api/stories?keyword=' + encodeURIComponent(tag), { token });
  check('故事可搜索标题/正文', storySearch.data.some((x) => x.id === story.data.id));

  const storyEdit = await api(`/api/stories/${story.data.id}`, {
    method: 'PUT', token,
    body: { title: `口述往事${tag}（修订）`, personIds: [] },
  });
  const storyAfterEdit = await api(`/api/stories/${story.data.id}`, { token });
  check('故事可修改并调整关联人物',
    storyEdit.status === 200 && storyAfterEdit.data.title.includes('修订')
    && storyAfterEdit.data.persons.length === 0);

  // 私密故事：族人不可见
  const secretStory = await api('/api/stories', {
    method: 'POST', token,
    body: { title: `私密家事${tag}`, body: '仅管理员可见', visibility: 'L2' },
  });
  check('管理员可创建私密故事', secretStory.status === 201);
  const memberStories = await api('/api/stories', { token: iToken });
  check('族人列表中看不到 L2 故事',
    !memberStories.data.some((x) => x.id === secretStory.data.id));
  const memberSecret = await api(`/api/stories/${secretStory.data.id}`, { token: iToken }).catch((e) => e);
  check('族人直接访问 L2 故事被拒（403）', memberSecret.status === 403);
  const memberCreate = await api('/api/stories', {
    method: 'POST', token: iToken, body: { title: '族人不能写', body: 'x' },
  }).catch((e) => e);
  check('族人不能创建故事（403）', memberCreate.status === 403);
  const memberDeleteStory = await api(`/api/stories/${story.data.id}`, { method: 'DELETE', token: iToken }).catch((e) => e);
  check('族人不能删除故事（403）', memberDeleteStory.status === 403);

  // 合并成员时故事关联转移
  const storyMergeTarget = await api('/api/persons', {
    method: 'POST', token,
    body: { family_name: '测', given_name: `故并${tag}`, birth_date: '1971-01-01' },
  });
  const storyMergeId = storyMergeTarget.data.id;
  await api(`/api/stories/${story.data.id}`, {
    method: 'PUT', token, body: { personIds: [storyPersonId] },
  });
  await api('/api/admin/merge', {
    method: 'POST', token, body: { sourceId: storyPersonId, targetId: storyMergeId },
  });
  const afterMerge = await api(`/api/stories/${story.data.id}`, { token });
  check('合并成员后故事关联转移到保留方',
    afterMerge.data.persons.length === 1 && afterMerge.data.persons[0].id === storyMergeId);

  // 故事内嵌图片：渲染 + 可见性过滤
  const imgPerson = await api('/api/persons?keyword=' + encodeURIComponent('王小明'), { token });
  const imgTarget = imgPerson.data.items[0]?.id;
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=', 'base64');
  const mediaForStory = await uploadMedia(token, imgTarget, { buffer: png, name: 'story-photo.png', type: 'image/png', visibility: 'L1' });
  const secretMedia = await uploadMedia(token, imgTarget, { buffer: png, name: 'secret-photo.png', type: 'image/png', visibility: 'L2' });
  check('故事用图片与私密图片上传成功', mediaForStory.status === 201 && secretMedia.status === 201);

  const imgStory = await api('/api/stories', { method: 'POST', token, body: {
    title: `带图故事${tag}`,
    body: `![公开照片](media:${mediaForStory.data.id})

![私密照片](media:${secretMedia.data.id})`,
    visibility: 'L1',
  } });
  check('可创建含内嵌图片的故事', imgStory.status === 201);

  const adminImg = await api(`/api/stories/${imgStory.data.id}`, { token });
  check('管理员看到两张图片', (adminImg.data.html.match(/<figure/g) || []).length === 2);

  const testMember = await api('/api/admin/users', { method: 'POST', token, body: { username: `imgm_${tag}`, password: 'member123', role: 'member' } });
  const memberToken = (await api('/api/auth/login', { method: 'POST', body: { username: testMember.data.username, password: 'member123' } })).data.token;
  const memberImg = await api(`/api/stories/${imgStory.data.id}`, { token: memberToken });
  check('族人看到私密图片占位且看不到原图 ID',
    memberImg.data.html.includes('私密图片')
    && (memberImg.data.html.match(/<figure/g) || []).length === 1
    && !memberImg.data.html.includes(secretMedia.data.id));

  const mediaList = await api('/api/media', { token });
  check('媒体列表可用于故事插图', Array.isArray(mediaList.data) && mediaList.data.length >= 2);

  await api(`/api/stories/${imgStory.data.id}`, { method: 'DELETE', token });
  await api(`/api/media/${mediaForStory.data.id}`, { method: 'DELETE', token });
  await api(`/api/media/${secretMedia.data.id}`, { method: 'DELETE', token });
  await api(`/api/admin/users/${testMember.data.id}`, { method: 'DELETE', token });
  // 清理
  await api(`/api/stories/${story.data.id}`, { method: 'DELETE', token });
  await api(`/api/stories/${secretStory.data.id}`, { method: 'DELETE', token });
  await api(`/api/persons/${storyMergeId}`, { method: 'DELETE', token });

  // 清理：删除剩余备份、归档加密测试成员
  const remainingBackups = await api('/api/admin/backups', { token });
  let allDeleted = true;
  for (const b of remainingBackups.data) {
    const r = await api(`/api/admin/backups/${encodeURIComponent(b.file)}`, { method: 'DELETE', token });
    if (r.status !== 200) allDeleted = false;
  }
  check('备份文件可删除', remainingBackups.data.length >= 1 && allDeleted);
  await api(`/api/persons/${encPersonId}`, { method: 'DELETE', token });

  // 清理：删除邀请测试账户与锁定账户、邀请记录，归档测试成员
  await api(`/api/events/${ev2.data.id}`, { method: 'DELETE', token });
  await api(`/api/admin/invitations/${inv.data.id}`, { method: 'DELETE', token });
  await api(`/api/admin/invitations/${inv2.data.id}`, { method: 'DELETE', token });
  await api(`/api/admin/users/${reg.data.user.id}`, { method: 'DELETE', token });
  await api(`/api/admin/users/${lockUser.data.id}`, { method: 'DELETE', token });
  for (const pid of [inviteTargetId, eventPersonId, spouseA.data.id]) {
    await api(`/api/persons/${pid}`, { method: 'DELETE', token });
  }

  // 清理：恢复种子成员联系方式、解绑并停用测试账户、归档隐私测试成员
  await api(`/api/admin/users/${memberId}/person`, { method: 'PUT', token, body: { personId: null } });
  await api(`/api/admin/users/${memberId}`, { method: 'DELETE', token });

  // 15. 归档测试数据（含导入的测试成员，保证可重复运行）
  for (const id of [testId, testId2, created3.data?.id, privId, otherId, mediaPersonId].filter(Boolean)) {
    await api(`/api/persons/${id}`, { method: 'DELETE', token });
  }
  const imported = await api('/api/persons?keyword=' + encodeURIComponent(tag), { token });
  for (const p of imported.data.items || []) {
    await api(`/api/persons/${p.id}`, { method: 'DELETE', token });
  }

  // 27. 归档清理：硬删除归档成员及其媒体
  const purge = await api('/api/admin/purge-archived', { method: 'POST', token });
  check('归档清理删除归档成员', purge.status === 200 && purge.data.deletedPersons >= 5,
    JSON.stringify(purge.data));
  const purgedView = await api(`/api/persons/${testId}`, { token });
  check('被清理的成员彻底不存在（404）', purgedView.status === 404);
  const statsAfterPurge = await api('/api/stats', { token });
  check('清理后归档计数归零', statsAfterPurge.data.archived === 0);

  // 28. 收藏地实体：创建 / 关联来源 / 展示 / 删除保护
  const repoTag = String(Date.now()).slice(-6);
  const repoNew = await api('/api/repositories', {
    method: 'POST', token,
    body: { name: `冒烟档案馆${repoTag}`, address: '南京', contact: '025-0000' },
  });
  check('创建收藏地', repoNew.status === 201 && !!repoNew.data.id, JSON.stringify(repoNew.data));

  const srcWithRepo = await api('/api/sources', {
    method: 'POST', token,
    body: { title: `冒烟谱${repoTag}`, repositoryId: repoNew.data.id },
  });
  check('来源可关联收藏地并写快照',
    srcWithRepo.status === 201 && srcWithRepo.data.repository === repoNew.data.name
      && srcWithRepo.data.repository_id === repoNew.data.id);

  const repoList = await api('/api/repositories', { token });
  const repoRow = (repoList.data || []).find((r) => r.id === repoNew.data.id);
  check('收藏地列表带引用计数', !!repoRow && repoRow.sourceCount >= 1);

  const srcList = await api('/api/sources', { token });
  const srcRow = (srcList.data || []).find((r) => r.id === srcWithRepo.data.id);
  check('来源列表带收藏地名称', !!srcRow && srcRow.repository_name === repoNew.data.name);

  const repoDelBlocked = await api(`/api/repositories/${repoNew.data.id}`, { method: 'DELETE', token });
  check('被引用时删除收藏地返回 409', repoDelBlocked.status === 409);

  const repoDelForced = await api(`/api/repositories/${repoNew.data.id}?force=1`, { method: 'DELETE', token });
  check('force 删除收藏地并解除关联',
    repoDelForced.status === 200 && repoDelForced.data.unlinkedSources >= 1);

  const srcAfterRepo = await api('/api/sources', { token });
  const orphanSrc = (srcAfterRepo.data || []).find((r) => r.id === srcWithRepo.data.id);
  check('收藏地删除后来源保留且关联清空', !!orphanSrc && orphanSrc.repository_id === null);

  await api(`/api/sources/${srcWithRepo.data.id}`, { method: 'DELETE', token });

  // 29. 方言称谓：设置 / 推导 / 对照表
  const setDialect = await api('/api/admin/family-settings', {
    method: 'PUT', token, body: { dialect: 'yue' },
  });
  check('可设置方言称谓', setDialect.status === 200 && setDialect.data.settings?.dialect === 'yue');

  const glossary = await api('/api/tree/kinship/dialects?dialect=yue', { token });
  check('方言对照表可获取',
    glossary.status === 200 && Array.isArray(glossary.data.glossary) && glossary.data.glossary.length > 10
      && glossary.data.dialects.length >= 7);

  const badDialect = await api('/api/admin/family-settings', {
    method: 'PUT', token, body: { dialect: 'klingon' },
  });
  check('非法方言被拒绝', badDialect.status === 400);

  await api('/api/admin/family-settings', { method: 'PUT', token, body: { dialect: 'standard' } });

  // 30. 沙漏图 SVG 导出
  const hgRoot = (await api('/api/tree?depth=6', { token })).data.roots[0];
  const hgFocus = hgRoot.children?.[0]?.id || hgRoot.id;
  const hgRes = await fetch(`${BASE}/api/tree/hourglass.svg?focus=${hgFocus}&up=3&down=2`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const hgText = await hgRes.text();
  check('沙漏 SVG 导出成功',
    hgRes.status === 200 && hgText.includes('<svg xmlns') && hgText.includes('中心：'));
  check('沙漏 SVG 缺少 focus 时报 400',
    (await fetch(`${BASE}/api/tree/hourglass.svg`, { headers: { Authorization: `Bearer ${token}` } })).status === 400);

  console.log(results.join('\n'));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
};

run().catch((err) => {
  console.error('SMOKE TEST CRASHED:', err);
  process.exit(1);
});
