import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateBackup, insertStatement, summarize, BACKUP_VERSION, TABLE_COLUMNS, selectPrunable,
} from '../server/modules/backupFormat.js';

function samplePayload() {
  return {
    app: 'family-tree',
    version: BACKUP_VERSION,
    createdAt: new Date().toISOString(),
    data: {
      family: [{ id: 'f1' }],
      person: [{ id: 'p1', family_id: 'f1' }, { id: 'p2', family_id: 'f1' }],
      place: [],
      association: [],
      story: [],
      story_person: [],
      story_version: [],
      repository: [],
      source: [],
      citation: [],
      media: [],
      media_link: [],
      parent_child: [{ id: 'pc1', parent_id: 'p1', child_id: 'p2' }],
      marriage: [{ id: 'm1', person_a_id: 'p1', person_b_id: 'p2' }],
      event: [{ id: 'e1', person_id: 'p2' }],
      users: [
        { id: 'u1', role: 'admin', person_id: 'p1' },
        { id: 'u2', role: 'member', person_id: 'p2' },
      ],
      user_family_role: [{ id: 'r1', user_id: 'u1', family_id: 'f1', role: 'admin' }],
    },
  };
}

test('合法备份通过校验并给出各表行数', () => {
  const check = validateBackup(samplePayload());
  assert.equal(check.ok, true, check.errors.join(';'));
  assert.deepEqual(check.counts, {
    family: 1, person: 2, place: 0, association: 0, story: 0, story_person: 0, story_version: 0,
    repository: 0, source: 0, citation: 0, media: 0, media_link: 0,
    parent_child: 1, marriage: 1, event: 1, users: 2, user_family_role: 1,
  });
});

test('版本不匹配时拒绝', () => {
  const p = samplePayload();
  p.version = 99;
  const check = validateBackup(p);
  assert.equal(check.ok, false);
  assert.ok(check.errors.some((e) => e.includes('版本')));
});

test('缺少表时拒绝', () => {
  const p = samplePayload();
  delete p.data.event;
  const check = validateBackup(p);
  assert.equal(check.ok, false);
  assert.ok(check.errors.some((e) => e.includes('event')));
});

test('引用完整性：成员的 family_id 必须存在', () => {
  const p = samplePayload();
  p.data.person[1].family_id = 'missing';
  const check = validateBackup(p);
  assert.equal(check.ok, false);
  assert.ok(check.errors.some((e) => e.includes('person.family_id')));
});

test('引用完整性：亲子关系两端必须存在', () => {
  const p = samplePayload();
  p.data.parent_child[0].child_id = 'ghost';
  const check = validateBackup(p);
  assert.equal(check.ok, false);
  assert.ok(check.errors.some((e) => e.includes('parent_child.child_id')));
});

test('非法角色被拒绝', () => {
  const p = samplePayload();
  p.data.users[0].role = 'superuser';
  const check = validateBackup(p);
  assert.equal(check.ok, false);
  assert.ok(check.errors.some((e) => e.includes('role')));
});

test('插入语句的占位符按行连续编号', () => {
  const sql = insertStatement('parent_child', 2);
  assert.match(sql, /\(\$1,\$2,\$3,\$4,\$5,\$6,\$7\),\(\$8,\$9,\$10,\$11,\$12,\$13,\$14\)/);
});

test('列清单覆盖恢复所需的关键字段', () => {
  assert.ok(TABLE_COLUMNS.person.includes('contact'));
  assert.ok(TABLE_COLUMNS.person.includes('privacy_override'));
  assert.ok(TABLE_COLUMNS.users.includes('password_hash'));
  assert.ok(TABLE_COLUMNS.users.includes('token_version'));
  assert.equal(summarize(samplePayload()).users, 2);
});

test('保留策略：只保留最近 N 份', () => {
  const list = [{ file: 'newest' }, { file: 'middle' }, { file: 'oldest' }];
  assert.deepEqual(selectPrunable(list, 2), [{ file: 'oldest' }]);
  assert.deepEqual(selectPrunable(list, 1), [{ file: 'middle' }, { file: 'oldest' }]);
  assert.deepEqual(selectPrunable(list, 5), []);
  assert.deepEqual(selectPrunable(list, 0), [{ file: 'middle' }, { file: 'oldest' }]);
});

test('引文必须指向存在的来源与目标', () => {
  const p = samplePayload();
  p.data.source = [{ id: 's1', family_id: 'f1' }];
  p.data.citation = [
    { id: 'c1', family_id: 'f1', source_id: 's1', target_type: 'person', target_id: 'p1' },
  ];
  assert.equal(validateBackup(p).ok, true);
  p.data.citation[0].source_id = 'missing';
  const bad = validateBackup(p);
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some((e) => e.includes('citation.source_id')));
});

test('来源的 repository_id 必须指向存在的收藏地', () => {
  const p = samplePayload();
  p.data.repository = [{ id: 'r1', family_id: 'f1' }];
  p.data.source = [{ id: 's1', family_id: 'f1', repository_id: 'r1' }];
  assert.equal(validateBackup(p).ok, true);
  p.data.source[0].repository_id = 'missing';
  const bad = validateBackup(p);
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some((e) => e.includes('source.repository_id')));
});

test('repository 表列定义与 TABLE_ORDER 一致', () => {
  assert.ok(TABLE_COLUMNS.repository.includes('name'));
  assert.ok(TABLE_COLUMNS.source.includes('repository_id'));
});