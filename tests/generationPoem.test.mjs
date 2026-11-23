import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseGenerationPoem, generationCharAt, checkGenerationName, auditGenerationNames,
} from '../server/modules/generationPoem.js';

test('parseGenerationPoem：字符串/数组/带分隔符', () => {
  assert.deepEqual(parseGenerationPoem('守德建明一'), ['守', '德', '建', '明', '一']);
  assert.deepEqual(parseGenerationPoem(['守', '德']), ['守', '德']);
  assert.deepEqual(parseGenerationPoem('守、德、建'), ['守', '德', '建']);
  assert.deepEqual(parseGenerationPoem(''), []);
  assert.deepEqual(parseGenerationPoem(null), []);
});

test('generationCharAt：世代从 1 起', () => {
  const poem = ['守', '德', '建', '明', '一'];
  assert.equal(generationCharAt(poem, 1), '守');
  assert.equal(generationCharAt(poem, 3), '建');
  assert.equal(generationCharAt(poem, 6), null);
  assert.equal(generationCharAt(poem, 0), null);
});

test('checkGenerationName：名中含派字 → ok', () => {
  const poem = ['守', '德', '建', '明', '一'];
  const r = checkGenerationName({ family_name: '王', given_name: '守仁', generation_no: 1 }, poem);
  assert.equal(r.status, 'ok');
  assert.equal(r.expected, '守');
});

test('checkGenerationName：名中不含派字 → mismatch', () => {
  const poem = ['守', '德', '建', '明', '一'];
  // 第四世应派"明"，但名为"建华"（用的是第三世的"建"）→ 偏离
  const r = checkGenerationName({ family_name: '王', given_name: '建华', generation_no: 4 }, poem);
  assert.equal(r.status, 'mismatch');
  assert.equal(r.expected, '明');
});

test('checkGenerationName：显式字辈字段优先', () => {
  const poem = ['守', '德'];
  const r = checkGenerationName(
    { family_name: '王', given_name: '阿昌', generation_name: '德', generation_no: 2 },
    poem
  );
  assert.equal(r.status, 'ok');
});

test('checkGenerationName：超过派语范围 → no-poem', () => {
  const poem = ['守', '德'];
  const r = checkGenerationName({ family_name: '王', given_name: '某某', generation_no: 9 }, poem);
  assert.equal(r.status, 'no-poem');
});

test('checkGenerationName：无派语', () => {
  const r = checkGenerationName({ generation_no: 1 }, []);
  assert.equal(r.status, 'no-poem');
});

test('auditGenerationNames：统计与偏离明细', () => {
  const poem = ['守', '德', '建'];
  const persons = [
    { id: 'a', family_name: '王', given_name: '守仁', generation_no: 1 },
    { id: 'b', family_name: '王', given_name: '德昌', generation_no: 2 },
    { id: 'c', family_name: '王', given_name: '阿强', generation_no: 3 },
    { id: 'd', family_name: '王', given_name: '', generation_no: 1 },
  ];
  const r = auditGenerationNames(persons, poem);
  assert.equal(r.hasPoem, true);
  assert.equal(r.ok, 2);
  assert.equal(r.mismatch, 1);
  assert.equal(r.rate, 67);
  assert.equal(r.mismatches[0].id, 'c');
  assert.equal(r.mismatches[0].expected, '建');
});

test('auditGenerationNames：无派语时 rate 为 null', () => {
  const r = auditGenerationNames([{ id: 'a', generation_no: 1 }], '');
  assert.equal(r.hasPoem, false);
  assert.equal(r.rate, null);
});
test('姻亲（异姓）排除在字辈校验之外', () => {
  const poem = ['守', '德'];
  const r = checkGenerationName(
    { family_name: '李', given_name: '淑贞', generation_no: 1 },
    poem,
    { surname: '王' }
  );
  assert.equal(r.status, 'excluded');
});

test('同姓仍正常校验', () => {
  const poem = ['守', '德'];
  const r = checkGenerationName(
    { family_name: '王', given_name: '守仁', generation_no: 1 },
    poem,
    { surname: '王' }
  );
  assert.equal(r.status, 'ok');
});

test('audit 排除姻亲后分母变小', () => {
  const poem = ['守', '德'];
  const persons = [
    { id: 'a', family_name: '王', given_name: '守仁', generation_no: 1 },
    { id: 'b', family_name: '李', given_name: '淑贞', generation_no: 1 },
  ];
  const r = auditGenerationNames(persons, poem, { surname: '王' });
  assert.equal(r.excluded, 1);
  assert.equal(r.checked, 1);
  assert.equal(r.rate, 100);
});
