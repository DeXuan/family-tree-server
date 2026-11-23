import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGraph, kinship, fiveFuSet } from '../server/modules/kinship.js';

/**
 * 测试夹具（关系必须与断言严格对应）：
 *
 *   王守仁 gf ─ 李淑贞 gm          陈家有 mgf ─ 刘氏 mgm
 *     ├ 王德昌 u1 ─ 张桂芳 a1         └ 陈玉兰 m
 *     │    └ 王建国 c1                        │
 *     ├ 王德明 f ──────────────── 陈玉兰 m ───┘
 *     │    ├ 王小明 me ─ 周静 w
 *     │    │    └ 王一诺 s1
 *     │    └ 王小红 sis
 *     └ 王秀英 u2
 */
const persons = [
  { id: 'gf', family_name: '王', given_name: '守仁', gender: 'male', birth_year: 1926 },
  { id: 'gm', family_name: '李', given_name: '淑贞', gender: 'female', birth_year: 1928 },
  { id: 'mgf', family_name: '陈', given_name: '家有', gender: 'male', birth_year: 1929 },
  { id: 'mgm', family_name: '刘', given_name: '氏', gender: 'female', birth_year: 1931 },
  { id: 'u1', family_name: '王', given_name: '德昌', gender: 'male', birth_year: 1949 },
  { id: 'a1', family_name: '张', given_name: '桂芳', gender: 'female', birth_year: 1951 },
  { id: 'f', family_name: '王', given_name: '德明', gender: 'male', birth_year: 1952 },
  { id: 'm', family_name: '陈', given_name: '玉兰', gender: 'female', birth_year: 1954 },
  { id: 'u2', family_name: '王', given_name: '秀英', gender: 'female', birth_year: 1956 },
  { id: 'c1', family_name: '王', given_name: '建国', gender: 'male', birth_year: 1972 },
  { id: 'me', family_name: '王', given_name: '小明', gender: 'male', birth_year: 1997 },
  { id: 'w', family_name: '周', given_name: '静', gender: 'female', birth_year: 1999 },
  { id: 'sis', family_name: '王', given_name: '小红', gender: 'female', birth_year: 2000 },
  { id: 's1', family_name: '王', given_name: '一诺', gender: 'male', birth_year: 2021 },
  { id: 'wgf', family_name: '周', given_name: '外祖', gender: 'male', birth_year: 1970 },
  { id: 'wgm', family_name: '吴', given_name: '外祖母', gender: 'female', birth_year: 1972 },
];

const edges = [
  // 祖父母 → 伯父 / 父亲 / 姑母
  ['gf', 'u1'], ['gm', 'u1'],
  ['gf', 'f'], ['gm', 'f'],
  ['gf', 'u2'], ['gm', 'u2'],
  // 外祖父母 → 母亲
  ['mgf', 'm'], ['mgm', 'm'],
  // 伯父母 → 堂兄（a1 是 u1 的配偶，不是 u1 的孩子）
  ['u1', 'c1'], ['a1', 'c1'],
  // 父母 → 我 / 妹妹
  ['f', 'me'], ['m', 'me'],
  ['f', 'sis'], ['m', 'sis'],
  // 我与妻 → 儿子
  ['me', 's1'], ['w', 's1'],
  // 妻的父母
  ['wgf', 'w'], ['wgm', 'w'],
].map(([parent_id, child_id]) => ({ parent_id, child_id }));

const marriages = [
  { person_a_id: 'gf', person_b_id: 'gm' },
  { person_a_id: 'mgf', person_b_id: 'mgm' },
  { person_a_id: 'u1', person_b_id: 'a1' },
  { person_a_id: 'f', person_b_id: 'm' },
  { person_a_id: 'me', person_b_id: 'w' },
  { person_a_id: 'wgf', person_b_id: 'wgm' },
];

const graph = buildGraph(persons, edges, marriages);
const term = (a, b) => kinship(a, b, graph).term;

test('本人与配偶', () => {
  assert.equal(term('me', 'me'), '本人');
  assert.equal(term('me', 'w'), '妻');
  assert.equal(term('w', 'me'), '夫');
});

test('直系长辈：父母', () => {
  assert.equal(term('me', 'f'), '父亲');
  assert.equal(term('me', 'm'), '母亲');
});

test('直系长辈：祖父母（父系）与外祖父母（母系）', () => {
  assert.equal(term('me', 'gf'), '祖父');
  assert.equal(term('me', 'gm'), '祖母');
  assert.equal(term('me', 'mgf'), '外祖父');
  assert.equal(term('me', 'mgm'), '外祖母');
});

test('直系晚辈：儿子、孙子、曾孙', () => {
  assert.equal(term('me', 's1'), '儿子');
  assert.equal(term('f', 's1'), '孙子');
  assert.equal(term('gf', 's1'), '曾孙');
  assert.equal(term('s1', 'me'), '父亲');
});

test('旁系长辈：伯父/伯母/姑母（父系），舅父/姨母（母系）', () => {
  assert.equal(term('me', 'u1'), '伯父');
  assert.equal(term('me', 'a1'), '伯母');
  assert.equal(term('me', 'u2'), '姑母');
  assert.equal(term('c1', 'me'), '堂弟');
});

test('同辈旁系：堂兄/堂弟按生年定长幼', () => {
  assert.equal(term('me', 'c1'), '堂兄');
  assert.equal(term('c1', 'me'), '堂弟');
});

test('兄弟姐妹：按生年定长幼', () => {
  assert.equal(term('me', 'sis'), '妹妹');
  assert.equal(term('sis', 'me'), '哥哥');
});

test('姻亲：儿媳 / 弟媳 / 岳父岳母 / 公公婆婆', () => {
  assert.equal(term('f', 'w'), '儿媳');       // 父亲看我的妻子
  assert.equal(term('m', 'w'), '儿媳');
  assert.equal(term('u1', 'm'), '弟媳');       // 伯父看弟弟的妻子
  assert.equal(term('me', 'wgf'), '岳父');
  assert.equal(term('me', 'wgm'), '岳母');
  assert.equal(term('w', 'f'), '公公');
  assert.equal(term('w', 'm'), '婆婆');
});

test('侄甥：伯父视角看我的儿子', () => {
  const res = kinship('u1', 's1', graph);
  assert.ok(['侄孙', '堂表侄', '侄孙辈'].includes(res.term), `实际得到 ${res.term}`);
  const direct = kinship('me', 'c1', graph);
  assert.equal(direct.term, '堂兄');
});

test('无共同祖先时给出说明而非空串', () => {
  const isolated = buildGraph(
    [{ id: 'x', family_name: '甲', given_name: '一', gender: 'male', birth_year: 1990 },
     { id: 'y', family_name: '乙', given_name: '二', gender: 'male', birth_year: 1991 }],
    [], []
  );
  const res = kinship('x', 'y', isolated);
  assert.equal(res.term, '');
  assert.ok(res.note.includes('未找到共同祖先'));
});

test('返回五服与代数距离', () => {
  const res = kinship('me', 'c1', graph);
  assert.equal(res.inFiveFu, true);
  assert.equal(res.distance, 4);
  assert.equal(kinship('me', 'mgf', graph).kind, 'ancestor');
});

test('五服集合包含中心、上下与配偶', () => {
  const { ids } = fiveFuSet('me', graph);
  for (const id of ['me', 'f', 'm', 'gf', 'gm', 's1', 'w', 'u1', 'c1']) {
    assert.ok(ids.includes(id), `应包含 ${id}`);
  }
});

test('性别未知时不崩溃', () => {
  const g = buildGraph(
    [{ id: 'a', gender: 'unknown', birth_year: 1990 },
     { id: 'b', gender: 'unknown', birth_year: 1995 }],
    [{ parent_id: 'a', child_id: 'b' }],
    []
  );
  assert.equal(kinship('b', 'a', g).term, '父亲');
  assert.equal(kinship('a', 'b', g).term, '子女');
});