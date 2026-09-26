// 실행: npm test
const test = require('node:test');
const assert = require('node:assert');
const S = require('../settle.js');

// ---------- 값 정리 ----------

test('날짜 — 발주서/정산서에 나오는 표기들', () => {
  const d = S.parseDay('2026-09-01');
  for (const v of ['2026년09월01일', '2026년9월1일 ', 20260901, 46266, '2026.09.01']) assert.strictEqual(S.parseDay(v), d, String(v));
  assert.strictEqual(S.parseDay('9월1일 오후 발주', 2026), d);
  assert.strictEqual(S.parseDay('오후 추가발주서'), null);
});

test('상품키 — 색상·띄어쓰기·기호 무시', () => {
  const k = S.productKey('컨실 틈새장 200 높은형/  색상 선택: 화이트');
  assert.strictEqual(k, S.productKey('컨실 틈새장  200 높은형 / 색상: 그레이'));
  assert.strictEqual(k, S.productKey('컨실 틈새장 200 높은형'));
  assert.strictEqual(S.productKey('아일랜드 식탁 1200 서랍형 / 상판 컬러: 화이트 / 프레임컬러: 화이트'), '아일랜드식탁1200서랍형');
  assert.notStrictEqual(S.productKey('컬러: 오크 / 사이즈: 600'), ''); // 색상으로 시작하면 지우지 않음
  assert.strictEqual(S.productKey('비스포크 틈새장 (좌형) / 200 / ⏬'), S.productKey('비스포크 틈새장 좌형 200'));
});

// ---------- 발주서 읽기 ----------

const oHead = ['주문번호', '쇼핑몰명', '생산처', '상품명', '색상', '수량', '', '박스', '주문자명', '수취인명', '수취인연락처1'];
const oRow = (date, product, qty, price, name, tel, shifted) => shifted
  ? [date, '몰', '', product, '', qty, price, name, name, tel]        // 빈 칸 하나가 사라진 모양
  : [date, '몰', '', product, '', qty, '', price, name, name, tel];

test('발주서 — 날짜 이어짐, 칸 당겨짐, 취소, 메모 줄 제외', () => {
  const rows = [
    oHead,
    ['2026년09월01일', '몰', '', '침대 틈새장 800 낮은형 / 색상: 화이트', '', '1', '', 43000, '가나', '가나', '010-1111-2222'],
    oRow('', '바퀴추가: 바퀴추가(1ea)', '2_1', 1500, '다라', '010-3333-4444'),
    ['오후 추가발주서'],
    oRow(20260902, '컨실 틈새장 200 높은형', '취소', 55000, '마바', '010-5555-6666', true),
    ['', '', '', '홍길동', '', '홍길동', '', '', ''],                  // 메모 줄
    ['', '', '', '48000', 60000],                                     // 계산 줄
  ];
  const o = S.parseOrders(rows, 1);
  assert.strictEqual(o.length, 3);
  assert.deepStrictEqual(o.map(x => S.dayToString(x.day)), ['2026-09-01', '2026-09-01', '2026-09-02']);
  assert.deepStrictEqual(o.map(x => x.price), [43000, 1500, 55000]);
  assert.strictEqual(o[2].receiver, '마바');
  assert.strictEqual(o[2].tel, '010-5555-6666');
  assert.ok(o[2].canceled && !o[0].canceled);
  assert.strictEqual(o[0].row, 2);
});

test('날짜 오타(몇 년 튀는 값)는 무시', () => {
  const rows = [oHead, oRow(20260901, '가 상품', '1', 1000, '가', '010-1-1'), oRow(20230324, '나 상품', '1', 1000, '나', '010-1111-2222')];
  const o = S.parseOrders(rows, 1);
  assert.strictEqual(S.dayToString(o[1].day), '2026-09-01');
});

// ---------- 정산서 읽기·누계 ----------

// 정산서 한 줄: [날짜, 상품, 메모, 수량, '', 주문자, 수취인, 연락처, '', '', '', 표시, 금액]
const sRow = (date, product, price, name, tel, label) => [date ?? '', product ?? '', '', product ? '1' : '', '', name ?? '', name ?? '', tel ?? '', '', '', '', label ?? '', price ?? ''];

test('정산서 — 줄 종류 구분 (입금 +표기, 누계를 표시 칸에 적은 경우, 잔액)', () => {
  const rows = [
    sRow(null, null, -1000000, null, null, '입금'),
    sRow(null, null, 5000),
    sRow(46266, '가 상품', 3000, '가', '010-1111-2222'),
    sRow(null, null, 8000, null, null, '8000'),
    sRow(null, null, -3000, null, null, '가 취소'),
    sRow(null, null, 5000, null, null, '잔액'),
    sRow(null, null, 500000, null, null, '입금 '),
  ];
  const items = S.parseSettlement(rows, 2);
  assert.deepStrictEqual(items.map(i => i.type), ['payment', 'subtotal', 'product', 'subtotal', 'adjust', 'subtotal', 'payment']);
  assert.strictEqual(items[6].amount, -500000);
  assert.strictEqual(items[2].row, 4);
});

test('누계 검산 — 계산 실수와 입금 줄 누락 구분', () => {
  const items = S.parseSettlement([
    sRow(null, null, 10000),
    sRow(46266, '가', 3000, '가', '010-1111-2222'),
    sRow(null, null, 13700),                          // 13,000이어야 함 → +700
    sRow(null, null, -5000, null, null, '나 취소'),
    sRow(null, null, 8700),                           // 맞음
    sRow(null, null, 700),                            // 입금 줄 없이 -8,000? (100만 단위 아님 → 계산 실수)
    sRow(null, null, 20000000),
    sRow(null, null, 2000000),                        // -18,000,000 → 입금 줄 누락으로 봄
  ], 1);
  const r = S.checkSubtotals(items);
  assert.deepStrictEqual(r.map(x => [x.row, x.kind, x.diff]), [[3, 'sum_error', 700], [6, 'sum_error', -8000], [7, 'sum_error', 19999300], [8, 'missing_payment', -18000000]]);
});

// ---------- 점검 ----------

function scenario() {
  const orders = S.parseOrders([
    oHead,
    oRow(20260831, '컨실 틈새장 200 높은형 / 색상: 화이트', '1', 55000, '지난', '010-0000-0001'), // 지난 정산 몫
    oRow(20260901, '컨실 틈새장 200 높은형 / 색상: 화이트', '1', 55000, '정상', '010-0000-0002'),
    oRow('', '침대 틈새장 600 높은형', '1', 37000, '오타', '010-0000-0003'),
    oRow('', '바퀴추가: 바퀴추가(1ea)', '취소', 1500, '취소', '010-0000-0004'),
    oRow('', '컨실 틈새장 240 높은형', '취소', 65000, '차감', '010-0000-0005'),
    oRow('', '바퀴추가: 바퀴추가(1ea)', '취소', 1500, '차감', '010-0000-0005'),
    oRow(20260902, '비스포크 틈새장 (좌형) 200', '1', 67000, '끝', '010-0000-0006'),
    oRow('', '컨실 틈새장 160 높은형', '1', 53000, '빠짐', '010-0000-0007'),       // 청구 안 됨
    oRow(20260903, '컨실 틈새장 130 높은형', '1', 48000, '다음', '010-0000-0008'), // 다음 정산 몫
  ], 1);
  const items = S.parseSettlement([
    sRow(46265, '컨실 틈새장 200 높은형 / 색상: 화이트', 55000, '지난', '010-0000-0001'),
    sRow(null, null, 55000),
    sRow(null, null, -55000, null, null, '입금'),
    sRow(null, null, 0),
    sRow(46266, '컨실 틈새장  200 높은형/ 색상 선택: 화이트', 55000, '정상', '010-0000-0002'),
    sRow(null, '침대 틈새장 600 높은형', 3700, '오타', '010-0000-0003'),              // 금액 오타
    sRow(null, '바퀴추가: 바퀴추가(1ea)', 1500, '취소', '010-0000-0004'),            // 취소했는데 청구
    sRow(null, '컨실 틈새장 240 높은형', 65000, '차감', '010-0000-0005'),
    sRow(null, '바퀴추가: 바퀴추가(1ea)', 1500, '차감', '010-0000-0005'),
    sRow(null, '침대 틈새장 800 높은형', 47000, '유령', '010-9999-9999'),            // 주문 없음
    sRow(null, '컨실 틈새장 200 높은형', 55000, '정상', '010-0000-0002'),             // 중복 청구
    sRow(46267, '비스포크 틈새장 (좌형) 200', 67000, '끝', '010-0000-0006'),
    sRow(null, null, 295700),
    sRow(null, null, -66500, null, null, '차감 취소'),                               // 두 줄 합계로 차감
    sRow(null, null, 229200),
  ], 1);
  const prices = S.parsePriceTable([
    ['상품명', '단가', '적용 시작일(참고)', '이전 단가(참고)'],
    ['컨실 틈새장 200 높은형', 55000, '2026-06-15', 52000],
    ['침대 틈새장 600 높은형', 37000],
    ['비스포크 틈새장 (좌형) 200', 67000],
    ['컨실 틈새장 240 높은형', 65000],
    ['바퀴추가: 바퀴추가(1ea)', 1500],
  ]);
  return { orders, items, prices };
}

test('점검 — 이번 정산(마지막 입금 이후)의 문제를 분류', () => {
  const { orders, items, prices } = scenario();
  const r = S.check(orders, items, prices);
  const by = st => r.findings.filter(f => f.status === st).map(f => (f.s || f.o).receiver);
  assert.deepStrictEqual(by('price_wrong'), ['오타']);
  assert.deepStrictEqual(by('canceled_charged'), ['취소']);
  assert.deepStrictEqual(by('cancel_offset'), ['차감', '차감']);
  assert.deepStrictEqual(by('no_order'), ['유령']);
  assert.deepStrictEqual(by('dup_charge'), ['정상']);
  assert.deepStrictEqual(by('not_billed'), ['빠짐']);
  assert.ok(!r.findings.some(f => f.status === 'no_ref'));
  assert.deepStrictEqual(r.okLines.map(s => s.receiver), ['정상', '끝']);
  // 누계는 맞게 적혀 있음 → 금액: 청구 과다 = 1,500 + 47,000 + 55,000 + (3,700 - 37,000)
  assert.strictEqual(r.money.written, 229200);
  assert.strictEqual(r.money.recomputed, 229200);
  assert.strictEqual(r.money.overcharge, 1500 + 47000 + 55000 + (3700 - 37000));
});

test('점검 — 시작 행·끝 행', () => {
  const { orders, items, prices } = scenario();
  const b = S.check(orders, items, prices).boundary;
  assert.strictEqual(b.first.o.receiver, '정상');
  assert.ok(b.first.prev.inPrev, '바로 앞 발주는 지난 정산에 있어야 함');
  assert.ok(b.first.ok);
  assert.strictEqual(b.last.o.receiver, '끝');
  assert.deepStrictEqual(b.last.missing.map(o => o.receiver), ['빠짐']); // 같은 날 발주가 빠짐
  assert.strictEqual(b.last.next.receiver, '다음');
  assert.ok(!b.last.ok);
});

test('기준 단가 — 적용 시작일 전이면 이전 단가', () => {
  const { prices } = scenario();
  const e = prices.get(S.productKey('컨실 틈새장 200 높은형'));
  assert.strictEqual(S.refPriceOn(e, S.parseDay('2026-06-14')), 52000);
  assert.strictEqual(S.refPriceOn(e, S.parseDay('2026-06-15')), 55000);
  assert.strictEqual(S.refPriceOn(prices.get(S.productKey('침대 틈새장 600 높은형')), S.parseDay('2020-01-01')), 37000);
});

test('기준시트 초안 — 최신 단가와 바뀐 날', () => {
  const mk = (day, price) => ({ type: 'product', key: 'k', product: '바퀴추가: 바퀴추가(1ea)', day: S.parseDay(day), price });
  const items = [mk('2026-07-01', 3000), mk('2026-07-05', 3000), mk('2026-07-13', 1500), mk('2026-07-20', 1500), mk('2026-08-01', 1500)];
  const [d] = S.makePriceDraft([], items);
  assert.strictEqual(d.price, 1500);
  assert.strictEqual(d.prevPrice, 3000);
  assert.strictEqual(S.dayToString(d.since), '2026-07-13');
});
