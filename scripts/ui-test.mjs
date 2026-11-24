/**
 * 浏览器 UI 回归：使用本机 Chrome（playwright-core channel=chrome）
 * 覆盖：登录、概览、世系树、成员名录、成员详情、关系弹窗、管理后台
 * 产出：screenshots/*.png + 控制台错误报告
 * 用法：node scripts/ui-test.mjs [baseUrl]
 */
import { chromium } from 'playwright-core';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.argv[2] || 'http://localhost:3000';
const SHOTS = path.join(__dirname, '../screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
let failed = 0;
const pass = (name) => { results.push(`  PASS  ${name}`); };
const fail = (name, detail = '') => { failed++; results.push(`  FAIL  ${name}${detail ? ' :: ' + detail : ''}`); };

// 准备一个族人账户（绑定到王小红），用于验证脱敏视角
const apiJson = async (path, { method = 'GET', token, body } = {}) => {
  const res = await fetch(BASE + path, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
};
const adminLogin = await apiJson('/api/auth/login', { method: 'POST', body: { username: 'admin', password: 'admin123' } });
const adminToken = adminLogin.data.token;
const peopleAll = await apiJson('/api/persons?pageSize=100', { token: adminToken });
const xiaohong = peopleAll.data.items.find((p) => p.family_name + p.given_name === '王小红');
const xiaoming = peopleAll.data.items.find((p) => p.family_name + p.given_name === '王小明');
const dechang = peopleAll.data.items.find((p) => p.family_name + p.given_name === '王德昌');
const regUser = `ui_reg_${String(Date.now()).slice(-6)}`;
const collabTag = String(Date.now()).slice(-6);
const eventTitle = `测试事件UI_${String(Date.now()).slice(-6)}`;
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=',
  'base64'
);
let regInviteId = null;
const memberTag = String(Date.now()).slice(-6);
const memberUser = await apiJson('/api/admin/users', {
  method: 'POST', token: adminToken,
  body: { username: `ui_member_${memberTag}`, password: 'member123', role: 'member' },
});
const memberUserId = memberUser.data.id;
await apiJson(`/api/admin/users/${memberUserId}/person`, {
  method: 'PUT', token: adminToken, body: { personId: xiaohong?.id },
});

// 允许用环境变量切换浏览器：本机默认 Chrome；CI 用 Playwright 自带 chromium
const launchOpts = { headless: true };
if (process.env.UI_TEST_CHANNEL && process.env.UI_TEST_CHANNEL !== 'chromium') {
  launchOpts.channel = process.env.UI_TEST_CHANNEL;
}
const browser = await chromium.launch(launchOpts);
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
const page = await context.newPage();

const consoleErrors = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text());
});
page.on('pageerror', (err) => consoleErrors.push('PAGEERROR: ' + err.message));

const shot = async (name) => page.screenshot({ path: path.join(SHOTS, name + '.png'), fullPage: true });
const shotViewport = async (name) => page.screenshot({ path: path.join(SHOTS, name + '.png') });

try {
  // 1. 登录页
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('#login-form', { timeout: 10000 });
  await shot('01-login');
  pass('登录页渲染');

  await page.fill('#username', 'admin');
  await page.fill('#password', 'admin123');
  await page.click('#login-submit');

  // 2. 概览
  await page.waitForSelector('.stat-value', { timeout: 10000 });
  const totalStat = await page.textContent('.stat-value');
  totalStat.trim() === '20' ? pass('概览统计显示 20 位成员') : fail('概览统计数值', totalStat);
  const fiveBadge = await page.locator('.page-head .badge').filter({ hasText: '五世同堂' }).count();
  fiveBadge >= 1 ? pass('概览显示“五世同堂”标识') : fail('概览缺少五世同堂标识');
  const hasMiniTree = await page.locator('#mini-tree .person-card').count();
  hasMiniTree > 0 ? pass(`概览世系缩略图渲染 ${hasMiniTree} 张卡片`) : fail('概览世系缩略图');
  await shot('02-dashboard');
  pass('概览页截图');

  // 3. 世系树
  await page.click('a[href="#/tree"]');
  await page.waitForURL(/#\/tree/);
  await page.waitForSelector('#tree-canvas .person-card', { timeout: 10000 });
  const treeCards = await page.locator('.person-card').count();
  treeCards >= 20 ? pass(`世系树渲染 ${treeCards} 张成员卡`) : fail('世系树卡片数量', String(treeCards));
  const rootName = (await page.locator('.tree > li .pc-name').first().innerText()).replace(/\s+/g, '');
  rootName.includes('王守仁') ? pass('树根为始祖 王守仁') : fail('树根节点', rootName);
  const spouseShown = await page.locator('.person-card.is-spouse').count();
  spouseShown > 0 ? pass(`配偶合并展示 ${spouseShown} 位`) : fail('配偶合并展示');
  const treeSummary = await page.textContent('#tree-summary');
  treeSummary.includes('五世同堂') ? pass('世系树标注五世同堂') : fail('世系树缺少五世同堂标注', treeSummary.slice(0, 80));
  const collapsedOnLoad = await page.locator('.tree-children.collapsed').count();
  collapsedOnLoad === 0 ? pass('世系树默认展开全部五代') : fail('默认仍有折叠世代', String(collapsedOnLoad));
  const genFiveCards = await page.locator('.pc-gen').filter({ hasText: '5世' }).count();
  genFiveCards > 0 ? pass('树中包含第五代成员') : fail('树中缺少第五代');
  const treeExport = await page.locator('#export-svg').count();
  treeExport === 1 ? pass('世系树提供 SVG 导出') : fail('缺少 SVG 导出按钮');
  const legendText = await page.locator('.legend-row').innerText();
  (legendText.includes('凡例') && legendText.includes('男性') && legendText.includes('已故'))
    ? pass('世系树带凡例图例')
    : fail('凡例缺失', legendText.slice(0, 60));
  const copySummaryBtn = await page.locator('#copy-summary').count();
  copySummaryBtn === 1 ? pass('世系树提供复制摘要') : fail('缺少复制摘要');
  await shot('03-tree');
  pass('世系树截图');

  // 展开全部
  await page.click('#expand-all');
  const expanded = await page.locator('.tree-children.collapsed').count();
  expanded === 0 ? pass('全部展开生效') : fail('全部展开', `仍有 ${expanded} 折叠`);

  // 4. 点击成员进详情
  await page.locator('.tree .person-card').filter({ hasText: '王德昌' }).first().click();
  await page.waitForSelector('.detail-head h1', { timeout: 10000 });
  const detailName = (await page.textContent('.detail-head h1')).trim();
  detailName.includes('王德昌') ? pass('点击卡片进入成员详情') : fail('成员详情姓名', detailName);
  const relGroups = await page.locator('.relation-group').count();
  relGroups === 3 ? pass('亲属关系分父母/配偶/子女三组') : fail('亲属关系分组', String(relGroups));
  const infoItems = await page.locator('.info-item').count();
  infoItems >= 8 ? pass(`基本信息 ${infoItems} 项`) : fail('基本信息字段数', String(infoItems));
  await shot('04-person');
  pass('成员详情截图');

  // 5. 添加父母弹窗（打开即关闭，验证交互）
  await page.locator('[data-add="parent"]').click();
  await page.waitForSelector('.picker-item', { timeout: 8000 });
  const pickerItems = await page.locator('.picker-item').count();
  pickerItems > 0 ? pass(`成员选择器载入 ${pickerItems} 条候选`) : fail('成员选择器');
  await shot('05-relation-picker');
  await page.keyboard.press('Escape');
  await page.waitForSelector('.modal', { state: 'detached' });
  pass('Esc 关闭弹窗');

  // 6. 成员名录 + 筛选
  await page.click('a[href="#/people"]');
  await page.waitForSelector('tbody tr.clickable', { timeout: 10000 });
  const rows = await page.locator('tbody tr.clickable').count();
  rows === 20 ? pass('成员名录每页 20 行') : fail('成员名录行数', String(rows));
  await page.fill('#f-keyword', '王德');
  await page.click('#people-filters button[type="submit"]');
  await page.waitForTimeout(400);
  await page.waitForFunction(() => {
    const el = document.querySelector('#people-count');
    return el && el.textContent.includes('关键词');
  }, null, { timeout: 8000 });
  const filtered = await page.locator('tbody tr.clickable').count();
  filtered === 2 ? pass('关键词筛选「王德」命中 2 人') : fail('关键词筛选结果', String(filtered));
  await shot('06-people');
  pass('成员名录截图');

  // 7. 录入成员表单
  await page.click('a[href="#/new"]');
  await page.waitForSelector('#person-form', { timeout: 10000 });
  const formFields = await page.locator('#person-form input, #person-form select, #person-form textarea').count();
  formFields >= 18 ? pass(`录入表单 ${formFields} 个字段`) : fail('录入表单字段数', String(formFields));
  const formerField = await page.locator('#former_names').count();
  formerField === 1 ? pass('录入表单包含曾用名字段') : fail('曾用名字段缺失');
  await shot('07-person-form');
  pass('录入表单截图');

  // 8. 管理后台：审计日志
  await page.click('a[href="#/admin"]');
  await page.waitForSelector('.tabs', { timeout: 10000 });
  await page.click('[data-tab="audit"]');
  await page.waitForSelector('#audit-body tr', { timeout: 8000 });
  const auditRows = await page.locator('#audit-body tr').count();
  auditRows > 0 ? pass(`审计日志 ${auditRows} 条`) : fail('审计日志为空');
  await shot('08-admin-audit');
  pass('管理后台截图');

  // 9. 数据导入导出页
  await page.click('[data-tab="data"]');
  await page.waitForSelector('[data-export="gedcom"]', { timeout: 8000 });
  pass('导入导出面板渲染');
  await shot('09-admin-data');

  // 9a2. 备份面板：生成 + 删除（先清空历史备份，保证断言确定）
  const existingBackups = await apiJson('/api/admin/backups', { token: adminToken });
  for (const b of existingBackups.data) {
    await apiJson(`/api/admin/backups/${encodeURIComponent(b.file)}`, { method: 'DELETE', token: adminToken });
  }
  await page.click('[data-tab="data"]');
  await page.waitForSelector('#do-backup', { timeout: 8000 });
  await page.click('#do-backup');
  await page.waitForFunction(
    () => document.querySelector('#backup-list')?.textContent.includes('family-tree-'),
    null, { timeout: 20000 },
  );
  pass('管理后台可生成备份并出现在列表');
  await shot('17-admin-backup');

  await page.click('#backup-list [data-backup-rm]');
  await page.waitForSelector('.modal', { timeout: 8000 });
  await page.click('.modal [data-act="ok"]');
  await page.waitForFunction(
    () => !document.querySelector('#backup-list')?.textContent.includes('family-tree-'),
    null, { timeout: 15000 },
  );
  pass('备份可删除（确认弹窗生效）');

  const archText = await page.textContent('#archived-count');
  const purgeDisabled = await page.locator('#purge-archived').isDisabled();
  if (archText.includes('0 位')) {
    purgeDisabled ? pass('归档为 0 时清理按钮禁用') : fail('归档为 0 时清理按钮应禁用');
  } else {
    !purgeDisabled ? pass('存在归档成员时清理按钮可用') : fail('存在归档成员时清理按钮被禁用');
  }

  // 9a3. 口述建谱：预览 → 确认导入
  const narText = '我叫测甲，1980年出生在保定。我父亲是测乙，1955年生。我母亲叫测丙。我妻子是测丁。我儿子叫测戊，2010年出生。';
  await page.fill('#nar-text', narText);
  await page.click('#nar-preview');
  await page.waitForSelector('#nar-commit', { timeout: 12000 });
  const narPreviewText = await page.textContent('#nar-result');
  (narPreviewText.includes('测甲') && narPreviewText.includes('新增'))
    ? pass('口述建谱预览列出成员')
    : fail('口述预览内容', narPreviewText.slice(0, 80));
  await page.click('#nar-commit');
  await page.waitForFunction(
    () => document.querySelector('#nar-result')?.textContent.includes('导入完成'),
    null, { timeout: 20000 },
  );
  pass('口述建谱确认后导入成功');
  for (const name of ['测甲', '测乙', '测丙', '测丁', '测戊']) {
    const found = await apiJson('/api/persons?keyword=' + encodeURIComponent(name), { token: adminToken });
    for (const p of found.data.items || []) {
      await apiJson(`/api/persons/${p.id}`, { method: 'DELETE', token: adminToken });
    }
  }

  // 9b. 生平事件时间线（先清理历史测试事件，标题用唯一后缀）
  const oldEvents = await apiJson(`/api/events/${dechang.id}`, { token: adminToken });
  for (const e of oldEvents.data.filter((x) => x.title.startsWith('测试事件UI'))) {
    await apiJson(`/api/events/${e.id}`, { method: 'DELETE', token: adminToken });
  }
  await page.goto(`${BASE}/#/person/${dechang.id}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#events-body', { timeout: 10000 });
  await page.click('#add-event');
  await page.waitForSelector('#ev-title', { timeout: 8000 });
  await page.fill('#ev-title', eventTitle);
  await page.fill('#ev-date', '1970-01-01');
  await page.fill('#ev-place', '测试地点');
  await page.click('.modal [data-act="ok"]');
  await page.waitForFunction(
    (title) => document.querySelector('#events-body')?.textContent.includes(title),
    eventTitle, { timeout: 8000 },
  );
  pass('添加生平事件并显示在时间线');
  await shot('13-person-events');

  await page.locator('.timeline-item').filter({ hasText: eventTitle })
    .locator('[data-del-event]').click();
  await page.waitForSelector('.modal', { timeout: 8000 });
  await page.click('.modal [data-act="ok"]');
  await page.waitForFunction(
    (title) => !document.querySelector('#events-body')?.textContent.includes(title),
    eventTitle, { timeout: 8000 },
  );
  pass('删除生平事件');

  // 9b2. 照片与附件：上传 → 缩略图 → 删除
  await page.goto(`${BASE}/#/person/${dechang.id}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#media-input', { timeout: 10000 });
  await page.setInputFiles('#media-input', {
    name: 'ui-photo.png', mimeType: 'image/png', buffer: PNG_1PX,
  });
  await page.click('#media-upload');
  await page.waitForFunction(
    () => document.querySelectorAll('#media-body .media-thumb img').length > 0,
    null, { timeout: 15000 },
  );
  pass('上传照片并渲染缩略图');
  await page.locator('#media-body').scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await shotViewport('18-person-media');

  await page.click('#media-body [data-media-del]');
  await page.waitForSelector('.modal', { timeout: 8000 });
  await page.click('.modal [data-act="ok"]');
  await page.waitForFunction(
    () => document.querySelector('#media-body')?.textContent.includes('还没有上传'),
    null, { timeout: 10000 },
  );
  pass('删除照片并清空相册');

  // 9b3. 来源与考证：新建来源 + 挂引文
  const sourceTitle = `UI来源${collabTag}`;
  await page.click('#add-citation');
  await page.waitForSelector('#cit-title', { timeout: 8000 });
  await page.fill('#cit-title', sourceTitle);
  await page.fill('#cit-author', 'UI 测试编纂');
  await page.fill('#cit-page', '卷一');
  await page.click('.modal [data-act="ok"]');
  await page.waitForFunction(
    (title) => document.querySelector('#citations-body')?.textContent.includes(title),
    sourceTitle, { timeout: 10000 },
  );
  pass('添加来源并挂到人物');
  await page.locator('#citations-body').scrollIntoViewIfNeeded();
  await page.evaluate(() => {
    const host = document.getElementById('toast-host');
    if (host) host.innerHTML = '';
  });
  await page.waitForTimeout(300);
  await shotViewport('20-person-sources');

  await page.click('[data-citation-del]');
  await page.waitForSelector('.modal', { timeout: 8000 });
  await page.click('.modal [data-act="ok"]');
  await page.waitForFunction(
    (title) => !document.querySelector('#citations-body')?.textContent.includes(title),
    sourceTitle, { timeout: 10000 },
  );
  pass('移除人物引文');

  // 9b4. 其他关联
  await page.goto(`${BASE}/#/person/${dechang.id}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#add-assoc', { timeout: 10000 });
  await page.click('#add-assoc');
  await page.waitForSelector('#pick-q', { timeout: 8000 });
  await page.fill('#pick-q', '王小明');
  await page.waitForTimeout(500);
  await page.locator('.picker-item').filter({ hasText: '王小明' }).first().click();
  await page.waitForSelector('#as-role', { timeout: 8000 });
  await page.selectOption('#as-role', 'witness');
  await page.fill('#as-note', 'UI 见证测试');
  await page.click('.modal [data-act="ok"]');
  await page.waitForFunction(
    () => document.querySelector('#assoc-body')?.textContent.includes('UI 见证测试'),
    null, { timeout: 10000 },
  );
  pass('人物页可添加其他关联');
  const assocDel = await page.locator('#assoc-body [data-assoc-del]').first();
  await assocDel.click();
  await page.waitForSelector('.modal', { timeout: 8000 });
  await page.click('.modal [data-act="ok"]');
  await page.waitForFunction(
    () => !document.querySelector('#assoc-body')?.textContent.includes('UI 见证测试'),
    null, { timeout: 10000 },
  );
  pass('关联可删除');

  // 9c. 关系路径
  await page.click('#rel-path');
  await page.waitForSelector('#pick-q', { timeout: 8000 });
  await page.fill('#pick-q', '王守仁');
  await page.waitForTimeout(500);
  await page.locator('.picker-item').filter({ hasText: '王守仁' }).first().click();
  await page.waitForSelector('.modal', { timeout: 8000 });
  const pathText = await page.textContent('.modal');
  pathText.includes('祖先') || pathText.includes('高祖')
    ? pass('关系路径显示直系祖先关系')
    : fail('关系路径结果', pathText.slice(0, 80));
  const kinWord = await page.locator('.kin-term-word').count();
  kinWord === 1 ? pass('关系弹窗给出中文称谓') : fail('缺少称谓词');
  const kinValue = await page.locator('.kin-term-word').innerText();
  kinValue.length >= 1 ? pass(`称谓推导结果为「${kinValue}」`) : fail('称谓为空');
  await shot('14-relation-path');
  await page.click('.modal [data-act="ok"]');
  await page.waitForSelector('.modal', { state: 'detached' });

  // 9c1. 家族洞察页
  await page.click('a[href="#/insights"]');
  await page.waitForSelector('.ins-gen', { timeout: 10000 });
  const insText = await page.textContent('.content');
  insText.includes('人丁结构') && insText.includes('字辈图谱') && insText.includes('地域分布')
    ? pass('洞察页展示六类维度')
    : fail('洞察维度缺失');
  const insGens = await page.locator('.ins-gen').count();
  insGens >= 5 ? pass(`人丁结构 ${insGens} 个世代条`) : fail('人丁结构条数', String(insGens));
  const insZb = await page.locator('.ins-zb-ch').count();
  insZb >= 5 ? pass(`字辈图谱 ${insZb} 格`) : fail('字辈格数', String(insZb));
  await shotViewport('21-insights');
  pass('家族洞察截图');

  // 9c2. 沙漏世系
  const yinuo = peopleAll.data.items.find((p) => p.family_name + p.given_name === '王一诺');
  await page.goto(`${BASE}/#/hourglass/${yinuo.id}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.hg-row', { timeout: 10000 });
  const hgText = await page.textContent('.content');
  (hgText.includes('曾祖父母') && hgText.includes('王守仁'))
    ? pass('沙漏世系展示四代祖先并包含始祖')
    : fail('沙漏祖先内容', hgText.slice(0, 120));
  await shotViewport('19-hourglass');
  pass('沙漏世系截图');

  const [svgDownload] = await Promise.all([
    page.waitForEvent('download', { timeout: 15000 }),
    page.click('#hg-export'),
  ]);
  svgDownload.suggestedFilename() === 'hourglass.svg'
    ? pass('沙漏页可导出 SVG')
    : fail('SVG 下载文件名', svgDownload.suggestedFilename());

  // 9c3. 待审核：族人建议 → 管理员通过
  const crPerson = await apiJson('/api/persons', {
    method: 'POST', token: adminToken,
    body: { family_name: '测', given_name: `审${collabTag}`, birth_date: '1990-01-01' },
  });
  const crPersonId = crPerson.data.id;
  await apiJson('/api/change-requests', {
    method: 'POST', token: adminToken,
    body: { personId: crPersonId, payload: { bio: 'UI 审核后的生平' }, note: 'UI 自动化' },
  });

  await page.click('a[href="#/admin"]');
  await page.waitForSelector('.tabs', { timeout: 10000 });
  // 管理后台：用户与角色 / 邀请管理 两个页签渲染
  await page.click('[data-tab="users"]');
  await page.waitForTimeout(900);
  const usersText = await page.textContent('#admin-panel');
  usersText.includes('admin') ? pass('用户与角色页签列出账户') : fail('用户列表为空');
  await page.click('[data-tab="invitations"]');
  await page.waitForTimeout(900);
  const invText = await page.textContent('#admin-panel');
  invText.length > 40 ? pass('邀请管理页签渲染') : fail('邀请页签渲染异常');
  await page.click('[data-tab="pending"]');
  await page.waitForSelector('[data-approve]', { timeout: 10000 });
  const pendingText = await page.textContent('#admin-panel');
  pendingText.includes('UI 审核后的生平') ? pass('待审核列表展示建议内容') : fail('待审核内容缺失');
  await page.click('[data-approve]');

  let approved = false;
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(300);
    const p = await apiJson(`/api/persons/${crPersonId}`, { token: adminToken });
    if (p.data.bio === 'UI 审核后的生平') { approved = true; break; }
  }
  approved ? pass('管理员点“通过”后写入档案') : fail('审核通过未生效');
  await apiJson(`/api/persons/${crPersonId}`, { method: 'DELETE', token: adminToken });

  // 9c4. 成员维护：重复检测 → 合并
  const dup1 = await apiJson('/api/persons', {
    method: 'POST', token: adminToken,
    body: { family_name: '测', given_name: `并${collabTag}`, birth_date: '1991-01-01', generation_no: 6 },
  });
  const dup2 = await apiJson('/api/persons', {
    method: 'POST', token: adminToken,
    body: { family_name: '测', given_name: `并${collabTag}`, birth_date: '1991-01-01', generation_no: 6 },
  });
  await page.click('[data-tab="maintenance"]');
  await page.waitForSelector('[data-merge-pair]', { timeout: 10000 });
  const maintText = await page.textContent('#admin-panel');
  maintText.includes(`测并${collabTag}`) ? pass('成员维护列出疑似重复成员') : fail('重复列表缺失');
  await page.click('[data-merge-pair]');
  await page.waitForSelector('[data-target]', { timeout: 8000 });
  const choiceCount = await page.locator('[data-choice]').count();
  choiceCount >= 8 ? pass('合并弹窗提供逐字段取值选择') : fail('缺少逐字段选择控件', choiceCount);
  // 显式把「世代」取被合并方，验证选择会提交到后端
  const genSel = page.locator('[data-choice="generation_no"]');
  if (await genSel.count()) await genSel.selectOption('source');
  await page.click('[data-target]');

  let mergedGone = false;
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(300);
    const a = await apiJson(`/api/persons/${dup1.data.id}`, { token: adminToken });
    const b = await apiJson(`/api/persons/${dup2.data.id}`, { token: adminToken });
    if (a.status === 404 || b.status === 404) { mergedGone = true; break; }
  }
  mergedGone ? pass('界面合并后源成员被删除') : fail('界面合并未生效');
  for (const id of [dup1.data.id, dup2.data.id]) {
    await apiJson(`/api/persons/${id}`, { method: 'DELETE', token: adminToken }).catch(() => {});
  }

  // 9c5. 审计日志变更详情
  await page.click('[data-tab="audit"]');
  await page.waitForSelector('[data-audit-detail]', { timeout: 10000 });
  await page.click('[data-audit-detail]');
  await page.waitForSelector('.json-pre', { timeout: 8000 });
  const diffText = await page.textContent('.modal');
  (diffText.includes('修改前') && diffText.includes('修改后'))
    ? pass('审计日志可查看 before/after 详情')
    : fail('审计详情缺失');
  await page.click('.modal [data-act="ok"]');
  await page.waitForSelector('.modal', { state: 'detached' });

  // 9c5a. 资料完整度页
  await page.goto(`${BASE}/#/quality`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.ql-row', { timeout: 12000 });
  const qualityText = await page.textContent('.content');
  (qualityText.includes('资料完整度') && qualityText.includes('缺来源考证'))
    ? pass('完整度页展示待补项')
    : fail('完整度页内容缺失');
  const qlRows = await page.locator('.ql-row').count();
  qlRows === 8 ? pass(`完整度 8 项核查`) : fail('完整度项数', String(qlRows));

  await page.locator('.ql-row').first().click();
  await page.waitForSelector('#q-result table', { timeout: 12000 });
  const qResultText = await page.textContent('#q-result');
  qResultText.includes('%') ? pass('点击待补项列出名单') : fail('待补名单未列出');
  await page.evaluate(() => {
    const host = document.getElementById('toast-host');
    if (host) host.innerHTML = '';
  });
  await shotViewport('23-quality');

  // 批量编辑
  const pickAll = await page.locator('#q-all').count();
  if (pickAll) {
    await page.check('#q-all');
    await page.click('#q-bulk');
    await page.waitForSelector('#bk-branch', { timeout: 8000 });
    await page.fill('#bk-branch', '长房');
    await page.click('.modal [data-act="ok"]');
    await page.waitForFunction(
      () => document.querySelector('#toast-host')?.textContent.includes('已更新'),
      null, { timeout: 12000 },
    );
    pass('批量设置支系成功');
    // 还原支系，避免污染后续断言
    const all = await apiJson('/api/persons?pageSize=100', { token: adminToken });
    for (const p of all.data.items) {
      if (['王德明', '王志强', '王志刚', '赵敏', '王磊', '王婷'].includes(p.family_name + p.given_name)) {
        await apiJson(`/api/persons/${p.id}`, {
          method: 'PUT', token: adminToken, body: { branch: '二房' },
        });
      }
    }
  } else {
    fail('缺少批量编辑入口');
  }

  // 9c5a2. 打印宗谱页
  await page.goto(`${BASE}/#/print`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.print-table', { timeout: 12000 });
  const printRows = await page.locator('.print-table tbody tr').count();
  printRows >= 10 ? pass(`打印页列出 ${printRows} 行世系`) : fail('打印页行数', String(printRows));
  const printBtn = await page.locator('#btn-print').count();
  printBtn === 1 ? pass('打印页提供打印按钮') : fail('缺少打印按钮');
  await page.evaluate(() => {
    const host = document.getElementById('toast-host');
    if (host) host.innerHTML = '';
  });
  await shotViewport('26-print');

  // 9c5b. 地点与迁徙页（使用演示地点库，避免污染数据）
  await page.goto(`${BASE}/#/places`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.mig-list, #new-place', { timeout: 12000 });
  const placesText = await page.textContent('.content');
  (placesText.includes('地点与迁徙') && placesText.includes('保定')
    && placesText.includes('省份分布') && placesText.includes('地点库'))
    ? pass('地点页展示地点库与省份分布')
    : fail('地点页内容缺失');
  await page.evaluate(() => {
    const host = document.getElementById('toast-host');
    if (host) host.innerHTML = '';
  });
  await shotViewport('22-places');
  pass('地点页截图');

  const mergeBtns = await page.locator('[data-place-merge]').count();
  mergeBtns > 0 ? pass('地点提供合并入口') : fail('缺少地点合并入口');

  // 9c6. 来源库管理（先回到管理后台）
  await page.click('a[href="#/admin"]');
  await page.waitForSelector('.tabs', { timeout: 10000 });
  await page.click('[data-tab="sources"]');
  await page.waitForSelector('#new-source', { timeout: 10000 });
  const repoBlock = await page.locator('#new-repo').count();
  repoBlock >= 1 ? pass('来源库展示收藏地管理区块') : fail('缺少收藏地管理区块');
  await page.click('#new-repo');
  await page.waitForSelector('#repo-name', { timeout: 8000 });
  await page.fill('#repo-name', `UI收藏地${collabTag}`);
  await page.click('.modal [data-act="ok"]');
  await page.waitForFunction(
    (n) => document.querySelector('#admin-panel')?.textContent.includes(n),
    `UI收藏地${collabTag}`, { timeout: 10000 },
  );
  pass('可从界面新建收藏地');
  const repoDel = page.locator('tr', { hasText: `UI收藏地${collabTag}` }).locator('[data-repo-del]');
  await repoDel.click();
  await page.waitForSelector('.modal', { timeout: 8000 });
  await page.click('.modal [data-act="ok"]');
  await page.waitForFunction(
    (n) => !document.querySelector('#admin-panel')?.textContent.includes(n),
    `UI收藏地${collabTag}`, { timeout: 10000 },
  );
  pass('收藏地可删除');
  // 收藏地增删会触发整页刷新，等来源行出现再断言
  await page.waitForFunction(
    (t) => document.querySelector('#admin-panel')?.textContent.includes(t),
    sourceTitle, { timeout: 12000 },
  );
  const sourcesText = await page.textContent('#admin-panel');
  sourcesText.includes(sourceTitle) ? pass('来源库展示已创建来源') : fail('来源库缺少测试来源');
  const sourceDel = page.locator('tr', { hasText: sourceTitle }).locator('[data-source-del]');
  await sourceDel.click();
  await page.waitForSelector('.modal', { timeout: 8000 });
  await page.click('.modal [data-act="ok"]');
  await page.waitForFunction(
    (title) => !document.querySelector('#admin-panel')?.textContent.includes(title),
    sourceTitle, { timeout: 10000 },
  );
  pass('来源可删除');

  // 9c7. 故事与回忆录：写故事 → 详情渲染 → 关联人物
  await page.goto(`${BASE}/#/stories`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#new-story', { timeout: 12000 });
  await page.click('#new-story');
  await page.waitForSelector('#st-title', { timeout: 8000 });
  const insertImg = await page.locator('#st-insert-img').count();
  insertImg === 1 ? pass('故事编辑器提供插入照片') : fail('缺少插入照片按钮');

  await page.fill('#st-title', `UI 故事${collabTag}`);
  await page.fill('#st-author', 'UI 记录人');
  await page.fill('#st-body', '## 缘起\n\n**祖父**携家迁居。\n\n> 只带了两只木箱。\n\n- 1937 年动身');
  await page.click('#st-pick');
  await page.waitForSelector('#pick-q', { timeout: 8000 });
  await page.fill('#pick-q', '王守仁');
  await page.waitForTimeout(500);
  await page.locator('.picker-item').filter({ hasText: '王守仁' }).first().click();
  await page.waitForFunction(
    () => document.querySelector('#st-picked-count')?.textContent.trim() === '1 人',
    null, { timeout: 8000 },
  );
  await page.click('.modal [data-act="ok"]');

  await page.waitForFunction(
    () => location.hash.startsWith('#/story/'),
    null, { timeout: 15000 },
  );
  await page.waitForSelector('.story-body h2', { timeout: 12000 });
  const storyText = await page.textContent('.story-body');
  (storyText.includes('缘起') && storyText.includes('木箱'))
    ? pass('故事详情渲染 Markdown 标题与引用')
    : fail('故事渲染结果', storyText.slice(0, 80));
  const versionBtn = await page.locator('#view-versions').count();
  versionBtn === 1 ? pass('故事详情提供版本历史') : fail('缺少版本历史入口');
  const linkedBadge = await page.locator('.story-head .badge').filter({ hasText: '王守仁' }).count();
  linkedBadge >= 1 ? pass('故事详情显示关联人物') : fail('关联人物未显示');
  await page.evaluate(() => {
    const host = document.getElementById('toast-host');
    if (host) host.innerHTML = '';
  });
  await shotViewport('24-story');
  pass('故事详情截图');

  // 人物页反查
  const shouren = peopleAll.data.items.find((p) => p.family_name + p.given_name === '王守仁');
  await page.goto(`${BASE}/#/person/${shouren.id}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#person-stories', { timeout: 12000 });
  const personStoryText = await page.textContent('#person-stories');
  personStoryText.includes(`UI 故事${collabTag}`)
    ? pass('人物页反查参与的故事')
    : fail('人物页未显示故事');

  // 清理该故事
  const storyId = page.url().split('/').pop();
  const found = await apiJson('/api/stories?keyword=' + encodeURIComponent(`UI 故事${collabTag}`), { token: adminToken });
  for (const st of found.data) {
    await apiJson(`/api/stories/${st.id}`, { method: 'DELETE', token: adminToken });
  }

  // 9d. 邀请管理
  const inv = await apiJson('/api/admin/invitations', {
    method: 'POST', token: adminToken,
    body: { role: 'member', expiresDays: 3, maxUses: 1 },
  });
  regInviteId = inv.data.id;
  await page.click('a[href="#/admin"]');
  await page.waitForSelector('.tabs', { timeout: 10000 });
  await page.click('[data-tab="invitations"]');
  await page.waitForSelector('#new-invite', { timeout: 8000 });
  const inviteTable = await page.textContent('.tabs + #admin-panel, #admin-panel');
  inviteTable.includes('有效') ? pass('邀请管理展示有效邀请') : fail('邀请列表', inviteTable.slice(0, 80));
  await shot('15-admin-invitations');
  pass('邀请管理截图');

  // 9e. 凭邀请注册
  await page.evaluate(() => localStorage.clear());
  await page.goto(`${BASE}/#/register?token=${inv.data.token}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#register-form', { timeout: 10000 });
  const inviteNotice = await page.textContent('#register-body');
  inviteNotice.includes('邀请有效') ? pass('注册页展示邀请信息') : fail('注册页邀请提示');
  await shot('16-register');
  pass('邀请注册页截图');

  await page.fill('#reg-username', regUser);
  await page.fill('#reg-password', 'invite12345');
  await page.fill('#reg-password2', 'invite12345');
  await page.click('#reg-submit');
  await page.waitForSelector('.stat-value', { timeout: 10000 });
  pass('凭邀请注册后自动登录进入概览');

  // 10. 族人视角：脱敏与个人中心
  await page.evaluate(() => localStorage.clear());
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('#login-form', { timeout: 10000 });
  await page.fill('#username', `ui_member_${memberTag}`);
  await page.fill('#password', 'member123');
  await page.click('#login-submit');
  await page.waitForSelector('.stat-value', { timeout: 10000 });
  const navText = await page.textContent('.nav');
  !navText.includes('管理后台') ? pass('族人导航中不出现管理后台') : fail('族人不应看到管理后台入口');

  await page.click('a[href="#/me"]');
  await page.waitForSelector('#save-privacy', { timeout: 10000 });
  const twofaToggle = await page.locator('#me-2fa-toggle').count();
  twofaToggle === 1 ? pass('个人中心提供 2FA 开关') : fail('缺少 2FA 开关');

  const privacyRows = await page.locator('[data-pv-field]').count();
  privacyRows === 10 ? pass(`个人中心隐私设置 ${privacyRows} 项`) : fail('隐私设置项数量', String(privacyRows));
  const hasContactForm = await page.locator('#contact-form').count();
  hasContactForm === 1 ? pass('个人中心可维护本人联系方式') : fail('个人中心联系方式表单');
  await shot('11-member-me');
  pass('个人中心截图');

  await page.goto(`${BASE}/#/person/${xiaoming.id}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.detail-head h1', { timeout: 10000 });
  const suggestBtn = await page.locator('#suggest-edit').count();
  suggestBtn === 1 ? pass('族人档案提供“建议修改”入口') : fail('族人缺少建议修改入口');
  const maskText = await page.textContent('.card-body');
  maskText.includes('仅本人与管理员可见') ? pass('族人查看他人档案时联系方式显示为私密占位') : fail('族人视角隐私遮罩', maskText.slice(0, 80));
  const privacyBadge = await page.locator('.detail-title .badge').filter({ hasText: '部分信息私密' }).count();
  privacyBadge >= 1 ? pass('档案头部显示“部分信息私密”标记') : fail('隐私标记缺失');
  await shot('12-member-person');
  pass('族人视角档案截图');

  // 10. 移动端视口
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(BASE + '/#/', { waitUntil: 'networkidle' });
  await page.waitForSelector('.stat-value', { timeout: 10000 });
  await shot('10-mobile-dashboard');
  const sidebarDisplay = await page.locator('.sidebar').evaluate((el) => getComputedStyle(el).position);
  sidebarDisplay === 'static' ? pass('移动端侧栏转为顶部导航') : fail('移动端响应式', sidebarDisplay);

  // 11. 控制台错误检查
  const severe = consoleErrors.filter((e) => !/favicon/i.test(e));
  if (severe.length) {
    fail('浏览器控制台无错误', severe.slice(0, 4).join(' | '));
  } else {
    pass('浏览器控制台无错误（CSP/JS 均正常）');
  }
} catch (err) {
  fail('UI 测试执行异常', err.message);
  await shot('99-error').catch(() => {});
} finally {
  await browser.close();
  if (memberUserId) {
    await apiJson(`/api/admin/users/${memberUserId}/person`, { method: 'PUT', token: adminToken, body: { personId: null } }).catch(() => {});
    await apiJson(`/api/admin/users/${memberUserId}`, { method: 'DELETE', token: adminToken }).catch(() => {});
  }
  // 邀请注册测试留下的账户/邀请
  try {
    const users = await apiJson('/api/admin/users', { token: adminToken });
    for (const u of users.data.filter((x) => x.username === regUser)) {
      await apiJson(`/api/admin/users/${u.id}`, { method: 'DELETE', token: adminToken });
    }
  } catch { /* 忽略清理失败 */ }
  if (regInviteId) {
    await apiJson(`/api/admin/invitations/${regInviteId}`, { method: 'DELETE', token: adminToken }).catch(() => {});
  }
  await apiJson('/api/admin/purge-archived', { method: 'POST', token: adminToken }).catch(() => {});
  // 兜底：清掉本次测试可能残留的备份
  try {
    const left = await apiJson('/api/admin/backups', { token: adminToken });
    for (const b of left.data) {
      await apiJson(`/api/admin/backups/${encodeURIComponent(b.file)}`, { method: 'DELETE', token: adminToken });
    }
  } catch { /* 忽略清理失败 */ }
}

console.log(results.join('\n'));
console.log(`\n${results.filter((r) => r.includes('PASS')).length} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
