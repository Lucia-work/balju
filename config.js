// 화면에 보이는 이름과 분류 — 문구를 바꾸고 싶으면 이 파일만 고치면 됩니다.
// (파일 칸 위치·날짜 허용 일수 같은 규칙은 settle.js 맨 위 LAYOUT / OPTIONS 에 있어요)
window.CONFIG = {
  title: '해피아이 정산 점검',
  files: {
    order: { label: '발주서', hint: '내가 보낸 발주 내역 (.xlsx)' },
    settle: { label: '해피아이 정산서', hint: '거래처가 보낸 정산 내역 (.xls)' },
    prices: { label: '단가 기준시트', hint: '처음 한 번만 올리면 기억해요' },
  },

  // 분류: 이름, 색 묶음(red 문제 / yellow 확인 / blue 참고 / green 정상), 설명
  statuses: {
    no_order:         { group: 'red', label: '주문 없는데 청구', help: '발주서에서 같은 주문을 찾지 못했어요' },
    dup_charge:       { group: 'red', label: '중복 청구', help: '같은 주문이 정산서에 두 번 들어 있어요' },
    canceled_charged: { group: 'red', label: '취소했는데 청구', help: '발주서에서 취소한 주문인데 청구됐고, 차감 줄도 없어요' },
    price_wrong:      { group: 'red', label: '금액 틀림', help: '발주서 금액과 청구 금액이 달라요' },
    sum_error:        { group: 'red', label: '누계 계산 틀림', help: '적힌 누계가 더한 값과 달라요' },

    price_vs_ref:     { group: 'yellow', label: '기준 단가와 다름', help: '발주서와는 같지만 기준시트 단가와 달라요' },
    order_price_diff: { group: 'yellow', label: '발주서 금액 다름', help: '청구 금액은 기준시트와 같고, 발주서에 적힌 금액이 달라요' },
    product_diff:     { group: 'yellow', label: '상품명 다름', help: '같은 사람 주문인데 상품이 다르게 적혀 있어요' },
    name_diff:        { group: 'yellow', label: '이름 다름', help: '같은 상품인데 받는 분 이름이나 연락처가 달라요' },
    cancel_mismatch:  { group: 'yellow', label: '정산서만 취소', help: '정산서엔 취소로 적혔는데 발주서엔 취소가 아니에요' },
    no_ref:           { group: 'yellow', label: '기준시트에 없음', help: '기준시트에 없는 상품이에요 — 단가를 추가해 주세요' },

    not_billed:       { group: 'blue', label: '발주했는데 청구 안 됨', help: '점검 기간 안의 발주인데 정산서에 없어요' },
    missing_payment:  { group: 'blue', label: '입금 줄 없이 누계 감소', help: '입금 줄이 빠진 것 같아요' },
    cancel_offset:    { group: 'blue', label: '취소 차감 확인됨', help: '청구 후 조정 줄로 뺀 것을 확인했어요' },
    adjust:           { group: 'blue', label: '조정 내역', help: '취소·반품·차감 등 손으로 적은 줄 — 한 번 훑어보세요' },
    sum_note:         { group: 'blue', label: '참고', help: '' },

    ok:               { group: 'green', label: '정상', help: '발주서·기준시트와 모두 같아요' },
  },
  groupOrder: ['red', 'yellow', 'blue', 'green'],

  // ---------- 발주서 제품명 통일 화면 ----------
  order: {
    title: '미니미니멀 발주서 제품명 통일',
    vendor: '해피아이',
    fileName: date => `미니미니멀_해피아이_발주서_${date}.xlsx`,
    // 발주서에 쇼핑몰을 적는 순서 (여기 없는 쇼핑몰은 맨 뒤)
    mallOrder: ['미니미니멀', '깔꾸미', '오늘의집'],
  },
};
