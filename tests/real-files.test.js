// 실제파일/ 에 발주서.xlsx·정산서.xls가 있을 때만 도는 회귀 테스트
// (2026-09-22 정산서 기준으로 찾아낸 실수들이 계속 잡히는지 확인)
const test = require('node:test');
const assert = require('node:assert');
const S = require('../settle.js');

let data = null;
try { data = require('../tools/load-real.js').loadReal(); } catch (e) { /* xlsx 미설치 등 */ }
const opts = { skip: !data && '실제파일 없음' };

test('실제 파일 — 이번 정산(7587행 입금 이후)은 깨끗함', opts, () => {
  const { orders, items } = data;
  const prices = new Map(S.makePriceDraft(orders, items).map(d => [d.key, d]));
  const r = S.check(orders, items, prices);
  assert.strictEqual(r.fromRow, 7587);
  assert.strictEqual(r.scopeLines.length, 378);
  assert.strictEqual(r.money.written, 14774000);
  assert.strictEqual(r.money.recomputed, 14774000);
  const red = r.findings.filter(f => ['no_order', 'dup_charge', 'canceled_charged', 'price_wrong', 'sum_error'].includes(f.status));
  assert.deepStrictEqual(red, []);
  assert.ok(r.boundary.first.ok && r.boundary.last.ok);
});

test('실제 파일 — 알려진 실수들이 잡힘', opts, () => {
  const { orders, items } = data;
  const prices = new Map(S.makePriceDraft(orders, items).map(d => [d.key, d]));
  const all = S.check(orders, items, prices, { fromPaymentRow: 0, toRow: Infinity });
  const rowsOf = st => all.findings.filter(f => f.status === st).map(f => (f.s ? f.s.row : f.sub.row));
  // 금액 오타: 32,000→3,200 / 115,000→11,500
  assert.ok(rowsOf('price_wrong').includes(2045));
  assert.ok(rowsOf('price_wrong').includes(2068));
  // 누계 계산 실수: +6,600 / -700 / +215,000
  assert.deepStrictEqual(rowsOf('sum_error').sort((a, b) => a - b), [2222, 5677, 7145]);
  // 입금 줄 없이 누계가 줄어든 곳
  assert.deepStrictEqual(rowsOf('missing_payment'), [2136, 5750]);
});
