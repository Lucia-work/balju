// 실제파일/의 발주서·정산서로 단가 기준시트 초안을 만든다.
// 실행: node tools/make-price-sheet.js  → 실제파일/단가기준시트_초안.xlsx
const path = require('path');
const XLSX = require('xlsx');
const Settle = require('../settle.js');
const { loadReal, DIR } = require('./load-real.js');

const data = loadReal();
if (!data) {
  console.error('실제파일/ 폴더에 발주서.xlsx 와 정산서.xls 를 넣어 주세요.');
  process.exit(1);
}
const draft = Settle.makePriceDraft(data.orders, data.items);
const rows = [
  ['상품명', '단가', '적용 시작일(참고)', '이전 단가(참고)', '건수(참고)', '확인 필요'],
  ...draft.map(d => [d.name, d.price, Settle.dayToString(d.since), d.prevPrice ?? '', d.count, d.warn]),
];
const ws = XLSX.utils.aoa_to_sheet(rows);
ws['!cols'] = [{ wch: 48 }, { wch: 10 }, { wch: 16 }, { wch: 14 }, { wch: 10 }, { wch: 18 }];
ws['!autofilter'] = { ref: `A1:F${rows.length}` };
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, '단가기준시트');
const out = path.join(DIR, '단가기준시트_초안.xlsx');
XLSX.writeFile(wb, out);
console.log(`${draft.length}개 상품 → ${out}`);
