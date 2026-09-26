// 실제파일/ 의 쇼핑몰 원본들 + 어머니가 만든 합본 발주서를 짝지어 기본 변환표(order-map.js)를 만듦
//   PW_SMARTSTORE=… PW_OHOU=… node tools/make-order-map.js
// 이미 있는 order-map.js 에서 손으로 넣은 항목(auto 아닌 것)은 남김.
const fs = require('fs');
const path = require('path');
const O = require('../order.js');
const { loadRealOrderFiles } = require('./load-real.js');

// 발주서에 있던 오타 — 배우기 전에 고침
const TYPOS = [[/^1오브제/, '오브제']];
const fixName = s => TYPOS.reduce((t, [a, b]) => t.replace(a, b), String(s).trim());

// 같은 모양으로 늘릴 때 바꿔 끼울 값들: [원본에 있는 말, 발주서 이름에 있는 말]
const SWAPS = [
  [130, 160, 200, 240, 300, 320].map(n => [String(n), String(n)]), // 틈새장 폭
  [600, 800].map(n => [String(n), String(n)]),                      // 침대 틈새장 폭
  [['좌형', '좌형'], ['우형', '우형']],
  [['낮은형', '낮은형'], ['높은형', '높은형']],
  [['640', '낮은형'], ['840', '높은형']],                           // 스마트스토어 침대: 높이(mm)로 적힘
];
const has = (s, w) => (/^\d+$/.test(w) ? new RegExp(`(?<!\\d)${w}(?!\\d)`).test(s) : s.includes(w));
const put = (s, a, b) => (/^\d+$/.test(a) ? s.replace(new RegExp(`(?<!\\d)${a}(?!\\d)`), b) : s.replace(a, b));

function expand(e) {
  if (/추가/.test(e.name)) return []; // 추가상품은 늘리지 않음
  let variants = [{ raw: e.raw, name: e.name }];
  for (const set of SWAPS) {
    const cur = set.filter(([r, n]) => has(e.raw, r) && has(e.name, n));
    if (cur.length !== 1) continue;
    const [r0, n0] = cur[0];
    variants = variants.flatMap(v => set.map(([r, n]) => ({ raw: put(v.raw, r0, r), name: put(v.name, n0, n) })));
  }
  return variants.map(v => ({ mall: e.mall, ...v, auto: true }));
}

(async () => {
  const data = await loadRealOrderFiles();
  if (!data) { console.error('실제파일/ 에 원본·합본 발주서가 없거나 PW_SMARTSTORE / PW_OHOU 가 없어요'); process.exit(1); }
  const lines = [];
  for (const s of data.stores) {
    const parsed = O.parseOrderFile(s.rows, s.firstRow);
    console.log(`${s.file}: ${parsed.mall} ${parsed.lines.length}줄`);
    lines.push(...parsed.lines);
  }
  const learned = O.learnFromPair(lines, data.order.rows, { fixName });

  const file = path.join(__dirname, '..', 'order-map.js');
  let old = [];
  try { old = require(file); } catch (e) { /* 처음 */ }
  const handOld = old.filter(e => !e.auto && !learned.entries.some(l => O.mapKey(l.mall, l.raw) === O.mapKey(e.mall, e.raw)));
  const sure = O.buildMap(learned.entries, handOld);
  const auto = O.buildMap(learned.entries.flatMap(expand));
  const merged = [
    ...[...sure.values()],
    ...[...auto].filter(([k]) => !sure.has(k)).map(([, e]) => ({ ...e, auto: true })),
  ].sort((a, b) => O.MALL_ORDER.indexOf(a.mall) - O.MALL_ORDER.indexOf(b.mall) || a.name.localeCompare(b.name, 'ko'));

  const body = merged.map(e => `  { mall: ${JSON.stringify(e.mall)}, raw: ${JSON.stringify(e.raw)}, name: ${JSON.stringify(e.name)}${e.auto ? ', auto: true' : ''} },`).join('\n');
  fs.writeFileSync(file, `// 기본 변환표: 쇼핑몰 옵션(색상 뺀 부분) → 발주서에 적는 이름
// tools/make-order-map.js 로 만들고, 손으로 고쳐도 됨. 개인정보·단가는 없음 (쇼핑몰에 보이는 옵션 이름뿐).
// auto: true = 실제 파일에서 본 것과 같은 모양으로 다른 폭·높이·방향을 미리 넣어 둔 것.
// 어머니가 화면에서 가르친 것은 브라우저에 따로 저장되고 이 목록보다 우선함.
(function (root) {
  const list = [
${body}
  ];
  if (typeof module !== 'undefined' && module.exports) module.exports = list;
  else root.ORDER_MAP_DEFAULT = list;
})(typeof window !== 'undefined' ? window : globalThis);
`);
  console.log(`변환표 ${merged.length}개 저장 (실제로 배움 ${sure.size}, 같은 모양으로 늘림 ${merged.length - sure.size}, 짝 못 지은 줄 ${learned.skipped.length})`);
  for (const c of learned.conflicts) console.log('확인 필요:', c.why, '|', c.raw, '→', c.names.join(' / '));
})();
