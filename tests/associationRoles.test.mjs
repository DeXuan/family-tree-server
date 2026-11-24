import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BUILTIN_ROLES, BUILTIN_LABELS, CUSTOM_PREFIX, MAX_LABEL_LEN, MAX_CUSTOM_ROLES,
  normalizeCustomRoles, resolveRoles, isKnownRole, roleLabel, validateNewRole, removeRole,
} from '../server/modules/associationRoles.js';

test('内置角色清单完整（11 种）', () => {
  assert.equal(BUILTIN_ROLES.length, 11);
  assert.ok(BUILTIN_ROLES.includes('friend'));
  assert.ok(BUILTIN_ROLES.includes('other'));
  assert.ok(Object.keys(BUILTIN_LABELS).length === 11);
});

test('normalizeCustomRoles 过滤非对象与空标签', () => {
  const out = normalizeCustomRoles([null, 'str', { label: '' }, { label: '  ' }, { label: '族老' }]);
  assert.equal(out.length, 1);
  assert.equal(out[0].label, '族老');
});

test('自定义 key 自动加 custom_ 前缀', () => {
  const out = normalizeCustomRoles([{ key: 'elder', label: '族老' }]);
  assert.equal(out[0].key, 'custom_elder');
});

test('已带前缀不重复添加', () => {
  const out = normalizeCustomRoles([{ key: 'custom_elder', label: '族老' }]);
  assert.equal(out[0].key, 'custom_elder');
});

test('非法 key 字符被拒绝', () => {
  const out = normalizeCustomRoles([{ key: 'BAD-KEY!', label: '坏' }]);
  assert.equal(out.length, 0);
});

test('重复 key 被去重', () => {
  const out = normalizeCustomRoles([
    { key: 'custom_a', label: '甲' },
    { key: 'custom_a', label: '乙' },
  ]);
  assert.equal(out.length, 1);
});

test('标签超长被截断到 12 字', () => {
  const out = normalizeCustomRoles([{ label: 'X'.repeat(40) }]);
  assert.equal(out[0].label.length, MAX_LABEL_LEN);
});

test('自定义角色数量上限', () => {
  const many = Array.from({ length: 50 }, (_, i) => ({ key: `custom_r${i}`, label: `角${i}` }));
  assert.equal(normalizeCustomRoles(many).length, MAX_CUSTOM_ROLES);
});

test('无 key 时用序号兜底', () => {
  const out = normalizeCustomRoles([{ label: '甲' }, { label: '乙' }]);
  assert.equal(out[0].key, `${CUSTOM_PREFIX}1`);
  assert.equal(out[1].key, `${CUSTOM_PREFIX}2`);
});

test('note 被截断到 100 字', () => {
  const out = normalizeCustomRoles([{ label: '甲', note: 'N'.repeat(300) }]);
  assert.equal(out[0].note.length, 100);
});

test('resolveRoles 合并内置与自定义', () => {
  const r = resolveRoles([{ key: 'custom_elder', label: '族老' }]);
  assert.equal(r.all.length, 12);
  assert.equal(r.labels.custom_elder, '族老');
  assert.equal(r.labels.friend, '好友');
  assert.equal(r.custom.length, 1);
});

test('resolveRoles 空输入只返回内置', () => {
  const r = resolveRoles();
  assert.equal(r.all.length, 11);
  assert.equal(r.custom.length, 0);
});

test('自定义角色可覆盖内置同 key 显示名（防御性）', () => {
  const r = resolveRoles([{ key: 'friend', label: '老友' }]);
  // key 会被加前缀，因此不会真的覆盖 friend
  assert.equal(r.labels.friend, '好友');
  assert.ok(r.labels.custom_friend === '老友');
});

test('isKnownRole 认可内置与自定义', () => {
  const custom = [{ key: 'custom_elder', label: '族老' }];
  assert.equal(isKnownRole('friend', custom), true);
  assert.equal(isKnownRole('custom_elder', custom), true);
  assert.equal(isKnownRole('nope', custom), false);
  assert.equal(isKnownRole('', custom), false);
});

test('roleLabel 未知角色原样返回', () => {
  assert.equal(roleLabel('friend'), '好友');
  assert.equal(roleLabel('custom_elder', [{ key: 'custom_elder', label: '族老' }]), '族老');
  assert.equal(roleLabel('weird'), 'weird');
});

test('validateNewRole 正常新增', () => {
  const r = validateNewRole({ label: '族老', note: '主持事务' }, []);
  assert.equal(r.ok, true);
  assert.equal(r.role.label, '族老');
  assert.ok(r.role.key.startsWith(CUSTOM_PREFIX));
  assert.equal(r.role.note, '主持事务');
});

test('validateNewRole 拒绝空名', () => {
  assert.equal(validateNewRole({ label: '  ' }).ok, false);
  assert.equal(validateNewRole({}).ok, false);
});

test('validateNewRole 拒绝超长', () => {
  const r = validateNewRole({ label: 'X'.repeat(MAX_LABEL_LEN + 1) });
  assert.equal(r.ok, false);
  assert.match(r.error, /不能超过/);
});

test('validateNewRole 拒绝与内置标签重名', () => {
  for (const label of Object.values(BUILTIN_LABELS)) {
    const r = validateNewRole({ label });
    assert.equal(r.ok, false, label);
  }
});

test('validateNewRole 拒绝重复自定义标签', () => {
  const existing = [{ key: 'custom_a', label: '族老' }];
  const r = validateNewRole({ label: '族老' }, existing);
  assert.equal(r.ok, false);
  assert.match(r.error, /已存在/);
});

test('validateNewRole 达上限时拒绝', () => {
  const existing = Array.from({ length: MAX_CUSTOM_ROLES }, (_, i) => ({ key: `custom_r${i}`, label: `角${i}` }));
  const r = validateNewRole({ label: '新角色' }, existing);
  assert.equal(r.ok, false);
  assert.match(r.error, /最多/);
});

test('removeRole 可删自定义', () => {
  const existing = [{ key: 'custom_a', label: '甲' }, { key: 'custom_b', label: '乙' }];
  const r = removeRole(existing, 'custom_a');
  assert.equal(r.ok, true);
  assert.equal(r.roles.length, 1);
  assert.equal(r.roles[0].key, 'custom_b');
});

test('removeRole 拒绝删内置', () => {
  const r = removeRole([], 'friend');
  assert.equal(r.ok, false);
  assert.match(r.error, /内置/);
});

test('removeRole 角色不存在时报错', () => {
  const r = removeRole([{ key: 'custom_a', label: '甲' }], 'custom_missing');
  assert.equal(r.ok, false);
  assert.match(r.error, /不存在/);
});

test('新增的 key 唯一性（同批多次调用）', async () => {
  const keys = new Set();
  for (let i = 0; i < 5; i++) {
    const r = validateNewRole({ label: `角色${i}` }, []);
    keys.add(r.role.key);
    await new Promise((res) => setTimeout(res, 2));
  }
  assert.equal(keys.size, 5);
});