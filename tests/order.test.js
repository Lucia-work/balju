// 발주서 만들기 규칙 테스트 (가짜 데이터)
const test = require('node:test');
const assert = require('node:assert');
const O = require('../order.js');

const SS_HEAD = ['상품주문번호', '주문번호', '구매자명', '수취인명', '옵션정보', '상품종류', '상품명', '수량',
  '수취인연락처1', '수취인연락처2', '통합배송지', '구매자연락처', '우편번호', '배송메세지', '주문상태', '주문세부상태'];
const ss = (orderNo, option, kind, qty, receiver, extra = {}) => {
  const v = {
    상품주문번호: orderNo + '1', 주문번호: orderNo, 구매자명: receiver, 수취인명: receiver, 옵션정보: option, 상품종류: kind,
    상품명: '틈새수납장 슬림 긴 제목 160', 수량: qty, 수취인연락처1: '010-1111-2222', 수취인연락처2: '', 통합배송지: '서울시 어딘가 1',
    구매자연락처: '010-1111-2222', 우편번호: 1234, 배송메세지: '', 주문상태: '발송대기', 주문세부상태: '신규주문', ...extra,
  };
  return SS_HEAD.map(h => v[h]);
};
const smartstore = rows => [['안내문 줄'], SS_HEAD, ...rows];

const OH_HEAD = ['주문번호', '주문옵션번호', '상품명', '옵션명', '수량', '주문자명', '주문자 연락처', '수취인명', '수취인 연락처',
  '수취인 우편번호', '수취인 주소', '수취인 주소상세', '배송메모', '주문상태'];
const oh = (orderNo, option, qty, receiver, extra = {}) => {
  const v = {
    주문번호: orderNo, 주문옵션번호: 1, 상품명: '틈새수납장 긴 제목', 옵션명: option, 수량: qty, 주문자명: receiver,
    '주문자 연락처': '010-3333-4444', 수취인명: receiver, '수취인 연락처': '010-3333-4444', '수취인 우편번호': '05813',
    '수취인 주소': '서울 송파구 송파대로 10', '수취인 주소상세': '101동 202호', 배송메모: '부재시 문앞', 주문상태: '결제완료', ...extra,
  };
  return OH_HEAD.map(h => v[h]);
};

const MAP = O.buildMap([
  { mall: '미니미니멀', raw: '미니미니멀 틈새장: 1. 컨실 틈새장 (양방향) / 가로폭 선택: 200', name: '컨실 틈새장 200 높은형' },
  { mall: '미니미니멀', raw: '바퀴추가: 바퀴추가(1ea)', name: '바퀴추가: 바퀴추가(1ea)' },
  { mall: '오늘의집', raw: '사이즈 (가로폭+높이): 240 비스포크 타입 (우형)', name: '비스포크 틈새장 (우형) 240' },
  { mall: '오늘의집', raw: '추가상품 - 바퀴 추가(1EA)', name: '추가상품 - 바퀴 추가(1EA)' },
]);

test('글자 정리 — 이모지 빼고 띄어쓰기·/·: 모양 통일', () => {
  assert.strictEqual(O.clean('🛏️ 미니미니멀 침대  틈새 선반:800 x 840 x 180 /🛏️ 색상 : 오크'), '미니미니멀 침대 틈새 선반: 800 x 840 x 180 / 색상: 오크');
  assert.strictEqual(O.clean('⬇️바퀴추가: 바퀴추가(1ea)'), '바퀴추가: 바퀴추가(1ea)');
});

test('색상 분리 — 색상·컬러 라벨은 뒤로, 첫 부분은 절대 색상 아님', () => {
  assert.deepStrictEqual(O.splitColor('🔽 틈새장: 1. 컨실 / ⏬ 가로폭 선택: 200 / ⏬ 색상 선택: 화이트'),
    { base: '틈새장: 1. 컨실 / 가로폭 선택: 200', color: '색상 선택: 화이트' });
  assert.deepStrictEqual(O.splitColor('아일랜드 식탁 1000 서랍형 / 상판컬러: 마블 / 프레임컬러: 화이트'),
    { base: '아일랜드 식탁 1000 서랍형', color: '상판컬러: 마블 / 프레임컬러: 화이트' });
  assert.deepStrictEqual(O.splitColor('추가상품 - 바퀴 추가(1EA)'), { base: '추가상품 - 바퀴 추가(1EA)', color: '' });
});

test('스마트스토어 — 변환표로 이름 바꾸고 색상 붙임, 수량 2는 2_1·2_2', () => {
  const p = O.parseOrderFile(smartstore([
    ss('A', '🔽 미니미니멀 틈새장: 1. 컨실 틈새장 (양방향) / ⏬ 가로폭 선택: 200 / ⏬ 색상 선택: 화이트', '조합형옵션상품', 1, '김하나'),
    ss('A', '⬇️바퀴추가: 바퀴추가(1ea)', '추가구성상품', 2, '김하나'),
  ]));
  assert.strictEqual(p.mall, '미니미니멀');
  const r = O.convert(p.lines, MAP);
  assert.deepStrictEqual(r.unknown, []);
  assert.deepStrictEqual(r.out.map(o => [o.name, o.qty]), [
    ['컨실 틈새장 200 높은형 / 색상 선택: 화이트', 1],
    ['바퀴추가: 바퀴추가(1ea)', '2_1'],
    ['바퀴추가: 바퀴추가(1ea)', '2_2'],
  ]);
  const row = O.toSheetRow(r.out[0]);
  assert.strictEqual(row.length, O.COLUMNS.length);
  assert.strictEqual(row[O.COLUMNS.indexOf('쇼핑몰명')], '미니미니멀');
  assert.strictEqual(row[O.COLUMNS.indexOf('수취인우편번호')], '01234'); // 앞자리 0 살림
});

test('스마트스토어 — 옵션에 깔꾸미가 있으면 깔꾸미 가게', () => {
  const p = O.parseOrderFile(smartstore([ss('A', '🔽 깔꾸미 주방틈새장: 1. 컨실틈새장 (양방향) / ⏬ 틈새 사이즈: 160', '조합형옵션상품', 1, '가')]));
  assert.strictEqual(p.mall, '깔꾸미');
});

test('안심번호(050)면 연락처2에 구매자 번호, 메시지는 그대로', () => {
  const p = O.parseOrderFile(smartstore([
    ss('A', '바퀴추가: 바퀴추가(1ea)', '추가구성상품', 1, '가', { 수취인연락처1: '0502-1234-5678', 구매자연락처: '010-9999-8888', 배송메세지: '빠른 배송 부탁드려요' }),
  ]));
  const o = O.convert(p.lines, MAP).out[0];
  assert.strictEqual(o.values['수취인연락처2'], '010-9999-8888');
  assert.strictEqual(o.values['메세지'], '빠른 배송 부탁드려요');
});

test('처음 보는 옵션은 unknown 으로 모아서 알려줌 (색상만 다른 건 하나로)', () => {
  const p = O.parseOrderFile(smartstore([
    ss('A', '🔽 새 상품: 999 / 색상: 화이트', '조합형옵션상품', 1, '가'),
    ss('B', '🔽 새 상품: 999 / 색상: 오크', '조합형옵션상품', 2, '나'),
  ]));
  const r = O.convert(p.lines, MAP);
  assert.strictEqual(r.unknown.length, 1);
  assert.strictEqual(r.unknown[0].raw, '새 상품: 999');
  assert.strictEqual(r.unknown[0].count, 3);
  assert.deepStrictEqual(r.unknown[0].colors, ['색상: 화이트', '색상: 오크']);
  assert.ok(r.out.every(o => !o.known));
});

test('취소 상태 줄은 발주서에서 뺌', () => {
  const p = O.parseOrderFile(smartstore([
    ss('A', '바퀴추가: 바퀴추가(1ea)', '추가구성상품', 1, '가', { 주문세부상태: '취소요청' }),
    ss('B', '바퀴추가: 바퀴추가(1ea)', '추가구성상품', 1, '나'),
  ]));
  const r = O.convert(p.lines, MAP);
  assert.strictEqual(r.out.length, 1);
  assert.strictEqual(r.skipped.length, 1);
});

test('오늘의집 — 옵션명으로 바꾸고, 주소+상세 합치고, 한 주문 안에서 본품 먼저', () => {
  const p = O.parseOrderFile([OH_HEAD,
    oh(1, '추가상품 - 바퀴 추가(1EA)', 2, '박'),
    oh(1, '사이즈 (가로폭+높이): 240 비스포크 타입 (우형) / 색상: 새틴베이지', 1, '박'),
    oh(2, '사이즈 (가로폭+높이): 240 비스포크 타입 (우형) / 색상: 코타화이트', 1, '최'),
  ]);
  assert.strictEqual(p.mall, '오늘의집');
  const r = O.convert(p.lines, MAP);
  assert.deepStrictEqual(r.out.map(o => [o.values['수취인명'], o.name, o.qty]), [
    ['박', '비스포크 틈새장 (우형) 240 / 색상: 새틴베이지', 1],
    ['박', '추가상품 - 바퀴 추가(1EA)', '2_1'],
    ['박', '추가상품 - 바퀴 추가(1EA)', '2_2'],
    ['최', '비스포크 틈새장 (우형) 240 / 색상: 코타화이트', 1],
  ]);
  assert.strictEqual(r.out[0].values['수취인 주소'], '서울 송파구 송파대로 10 101동 202호');
  assert.strictEqual(r.out[0].values['메세지'], '부재시 문앞');
});

test('여러 쇼핑몰 — 미니미니멀 → 깔꾸미 → 오늘의집 순서', () => {
  const o = O.parseOrderFile([OH_HEAD, oh(1, '추가상품 - 바퀴 추가(1EA)', 1, '오')]).lines;
  const g = O.parseOrderFile(smartstore([ss('G', '🔽 깔꾸미 주방틈새장: 1. 컨실 / 틈새 사이즈: 160', '조합형옵션상품', 1, '깔')])).lines;
  const m = O.parseOrderFile(smartstore([ss('M', '바퀴추가: 바퀴추가(1ea)', '추가구성상품', 1, '미')])).lines;
  const r = O.convert([...o, ...g, ...m], MAP);
  assert.deepStrictEqual(r.out.map(x => x.values['쇼핑몰명']), ['미니미니멀', '깔꾸미', '오늘의집']);
});

test('변환표 — 나중 것이 이김, 이름이 비면 지움, 띄어쓰기 무시하고 찾음', () => {
  const map = O.buildMap(
    [{ mall: '미니미니멀', raw: 'A 옵션: 1', name: '옛 이름' }, { mall: '미니미니멀', raw: 'B 옵션', name: 'B' }],
    [{ mall: '미니미니멀', raw: 'A  옵션:1', name: '새 이름' }, { mall: '미니미니멀', raw: 'B 옵션', name: '' }],
  );
  assert.strictEqual(map.get(O.mapKey('미니미니멀', 'A 옵션: 1')).name, '새 이름');
  assert.strictEqual(map.has(O.mapKey('미니미니멀', 'B 옵션')), false);
});

test('짝지어 배우기 — 한 주문 안에서 순서가 달라도 이름이 비슷한 줄끼리', () => {
  const lines = O.parseOrderFile([OH_HEAD,
    oh(1, '사이즈 (가로폭+높이): 240 비스포크 타입 (우형) / 색상: 새틴베이지', 1, '박'),
    oh(1, '사이즈 (가로폭+높이): 160 비스포크 타입 (우형) / 색상: 새틴베이지', 1, '박'),
    oh(1, '추가상품 - 바퀴 추가(1EA)', 1, '박'),
  ]).lines;
  const H = ['쇼핑몰명', '상품명', '수취인명'];
  const orderRows = [H,
    ['오늘의집', '비스포크 틈새장 (우형) 240 / 색상: 새틴베이지', '박'],
    ['오늘의집', '추가상품 - 바퀴 추가(1EA)', '박'],
    ['오늘의집', '비스포크 틈새장  (우형) 160/ 색상: 새틴베이지', '박'],
  ];
  const r = O.learnFromPair(lines, orderRows);
  assert.deepStrictEqual(r.conflicts, []);
  const names = Object.fromEntries(r.entries.map(e => [e.raw, e.name]));
  assert.deepStrictEqual(names, {
    '사이즈 (가로폭+높이): 240 비스포크 타입 (우형)': '비스포크 틈새장 (우형) 240',
    '사이즈 (가로폭+높이): 160 비스포크 타입 (우형)': '비스포크 틈새장 (우형) 160',
    '추가상품 - 바퀴 추가(1EA)': '추가상품 - 바퀴 추가(1EA)',
  });
});
