// 실제파일/ 에 쇼핑몰 원본 3개 + 어머니가 만든 합본 발주서(2026-09-28)가 있고
// 비밀번호 환경변수(PW_SMARTSTORE, PW_OHOU)가 있을 때만 도는 테스트:
// 원본 → 자동 발주서가 어머니 발주서와 같게 나오는지
const test = require('node:test');
const assert = require('node:assert');
const O = require('../order.js');
const DEFAULT_MAP = require('../order-map.js');

const compact = s => String(s ?? '').replace(/\s+/g, '');
const TYPO = s => String(s).replace(/^\s*1오브제/, '오브제'); // 어머니 발주서의 오타
const LABEL = s => String(s).replace(/색상\s*선택\s*:/g, '색상:'); // 이제 '색상 선택:'은 '색상:'으로 통일해서 적음

test('실제 파일 — 원본 3개가 어머니 발주서 67줄과 같게 나옴', async t => {
  let data = null;
  try { data = await require('../tools/load-real.js').loadRealOrderFiles(); } catch (e) { /* xlsx 미설치 등 */ }
  if (!data) return t.skip('실제파일 또는 비밀번호(PW_SMARTSTORE, PW_OHOU) 없음');

  const lines = data.stores.flatMap(s => O.parseOrderFile(s.rows, s.firstRow).lines);
  const r = O.convert(lines, O.buildMap(DEFAULT_MAP));
  assert.deepStrictEqual(r.unknown, [], '기본 제품명 기준시트로 전부 바뀌어야 함');
  assert.deepStrictEqual(r.skipped, []);

  const [header, ...body] = data.order.rows;
  const mom = body.filter(row => String(row[header.indexOf('상품명')]).trim())
    .map(row => Object.fromEntries(header.map((h, i) => [h, row[i]])));
  const ours = r.out.map(o => Object.fromEntries(O.COLUMNS.map((c, i) => [c, O.toSheetRow(o)[i]])));
  assert.strictEqual(ours.length, mom.length);

  // 박은희(오늘의집): 어머니는 바퀴 2개를 장마다 하나씩 붙였고, 새 규칙은 2_1·2_2 로 나눔 → 줄 묶음으로 비교
  const special = row => row['쇼핑몰명'] === '오늘의집' && row['수취인명'] === '박은희';
  const bag = rows => rows.filter(special).map(x => compact(LABEL(x['상품명']))).sort();
  assert.deepStrictEqual(bag(ours), bag(mom));
  assert.deepStrictEqual(ours.filter(special).map(x => String(x['수량'])), ['1', '1', '2_1', '2_2']);

  const cols = ['쇼핑몰명', '수량', '주문자명', '수취인명', '수취인연락처1', '수취인 주소'];
  ours.forEach((o, i) => {
    const m = mom[i];
    if (special(o)) return;
    const where = `${i + 2}행 ${m['수취인명']}`;
    assert.strictEqual(compact(o['상품명']), compact(LABEL(TYPO(m['상품명']))), `${where} 상품명`);
    for (const c of cols) assert.strictEqual(compact(o[c]), compact(m[c]), `${where} ${c}`);
    assert.strictEqual(O.zipText(o['수취인우편번호']), O.zipText(m['수취인우편번호']), `${where} 우편번호`);
    // 오늘의집 연락처2는 어머니가 가끔 연락처1을 한 번 더 적음 → 스마트스토어만 비교 (050 안심번호 규칙 포함)
    if (o['쇼핑몰명'] !== '오늘의집') assert.strictEqual(compact(o['수취인연락처2']), compact(m['수취인연락처2']), `${where} 연락처2`);
  });
});
