import test from 'node:test';
import assert from 'node:assert/strict';
import {
  effectiveLevel, redactPerson, FIELD_LEVEL,
} from '../server/modules/privacy.js';

const basePerson = {
  id: 'p1',
  family_name: '王',
  given_name: '德昌',
  courtesy_name: '伯元',
  birth_date: new Date('1905-01-08'),
  birth_precision: 'exact',
  birth_place: '河北保定',
  death_date: new Date('1978-09-30'),
  death_precision: 'exact',
  death_place: '北京',
  burial_place: '',
  occupation: '工程师',
  education: '北洋大学',
  bio: '生平',
  is_deceased: true,
  contact: { phone: '13800000000', email: '', address: '' },
  privacy_override: {},
};

const ctx = (role, extra = {}) => ({ role, isAdmin: role === 'admin', isSelf: false, ...extra });

test('默认级别：姓名 L0、日期 L1、联系方式 L2', () => {
  assert.equal(FIELD_LEVEL.family_name, 'L0');
  assert.equal(FIELD_LEVEL.birth_date, 'L1');
  assert.equal(FIELD_LEVEL.contact, 'L2');
});

test('访客：仅 L0，日期与联系方式脱敏，但保留年份', () => {
  const out = redactPerson(basePerson, ctx('guest'));
  assert.equal(out.family_name, '王');
  assert.equal(out.birth_date, null);
  assert.equal(out.birth_year, 1905);
  assert.equal(out.contact, null);
  assert.ok(out.restricted.includes('birth_date'));
  assert.ok(out.restricted.includes('contact'));
});

test('族人：可见 L1，不可见 L2', () => {
  const out = redactPerson(basePerson, ctx('member'));
  assert.ok(out.birth_date, 'L1 出生日期应可见');
  assert.ok(!out.restricted.includes('birth_date'));
  assert.equal(out.contact, null);
  assert.ok(out.restricted.includes('contact'));
  assert.deepEqual(out.privacy_override, {}, '他人隐私设置不应下发');
});

test('本人：全部可见，含联系方式与隐私设置', () => {
  const out = redactPerson(basePerson, ctx('member', { isSelf: true }));
  assert.equal(out.contact.phone, '13800000000');
  assert.deepEqual(out.restricted, []);
  assert.equal(out.canEditPrivacy, true);
});

test('管理员：全部可见', () => {
  const out = redactPerson(basePerson, ctx('admin'));
  assert.ok(out.birth_date);
  assert.equal(out.contact.phone, '13800000000');
});

test('本人 override 设为 L2 后，族人/编辑不可见该字段', () => {
  const p = { ...basePerson, privacy_override: { birth_place: 'L2', bio: 'L2' } };
  const memberView = redactPerson(p, ctx('member'));
  assert.equal(memberView.birth_place, null);
  assert.equal(memberView.bio, null);
  assert.ok(memberView.restricted.includes('birth_place'));

  const selfView = redactPerson(p, ctx('member', { isSelf: true }));
  assert.equal(selfView.birth_place, '河北保定');
});

test('已故满 100 年：L1 自动放宽为 L0', () => {
  const old = {
    ...basePerson,
    death_date: new Date('1900-01-01'),
    birth_date: new Date('1860-01-01'),
  };
  assert.equal(effectiveLevel(old, 'birth_date'), 'L0');
  const guestView = redactPerson(old, ctx('guest'));
  assert.ok(guestView.birth_date, '百年以上成员的日期应对访客可见');
  assert.ok(!guestView.restricted.includes('birth_date'));
});

test('未满 100 年不放宽', () => {
  const recent = { ...basePerson, death_date: new Date('1990-01-01') };
  assert.equal(effectiveLevel(recent, 'birth_date'), 'L1');
});
