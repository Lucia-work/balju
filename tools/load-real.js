// 실제파일/ 의 발주서·정산서를 읽어 Settle 형식으로 돌려줌 (개발·테스트용)
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const Settle = require('../settle.js');

const DIR = path.join(__dirname, '..', '실제파일');

function readSheet(file) {
  const wb = XLSX.readFile(file);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const firstRow = XLSX.utils.decode_range(ws['!ref']).s.r + 1;
  return { rows: XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' }), firstRow };
}

function loadReal() {
  const orderFile = path.join(DIR, '발주서.xlsx'), settleFile = path.join(DIR, '정산서.xls');
  if (!fs.existsSync(orderFile) || !fs.existsSync(settleFile)) return null;
  const o = readSheet(orderFile), s = readSheet(settleFile);
  return {
    orders: Settle.parseOrders(o.rows, o.firstRow),
    items: Settle.parseSettlement(s.rows, s.firstRow),
    settleRows: s,
    orderRows: o,
  };
}

// 비밀번호가 걸린 엑셀도 열기 (쇼핑몰 다운로드 파일). 비밀번호는 환경변수로만 받음 — 여러 개를 차례로 시도.
async function readSheetMaybeLocked(file, passwords) {
  try { return readSheet(file); } catch (e) {
    if (!/password|encrypt/i.test(e.message)) throw e;
  }
  const XP = require('xlsx-populate');
  for (const password of passwords.filter(Boolean)) {
    let wbp;
    try { wbp = await XP.fromDataAsync(fs.readFileSync(file), { password }); } catch (e) { continue; }
    const wb = XLSX.read(await wbp.outputAsync(), { type: 'buffer' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const firstRow = XLSX.utils.decode_range(ws['!ref']).s.r + 1;
    return { rows: XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' }), firstRow };
  }
  return null;
}

// 실제파일/ 의 쇼핑몰 원본들 + 어머니가 만든 합본 발주서 (2026-09-28)
const ORDER_SOURCES = ['스마트스토어_미니미니멀.xlsx', '스마트스토어_깔꾸미.xlsx', '오늘의집.xlsx'];
async function loadRealOrderFiles(passwords = [process.env.PW_SMARTSTORE, process.env.PW_OHOU]) {
  const orderFile = path.join(DIR, '발주서_합본.xlsx');
  const files = ORDER_SOURCES.map(f => path.join(DIR, f));
  if (!fs.existsSync(orderFile) || !files.every(f => fs.existsSync(f))) return null;
  const stores = [];
  for (const f of files) {
    const sheet = await readSheetMaybeLocked(f, passwords);
    if (!sheet) return null; // 비밀번호 없음
    stores.push({ file: path.basename(f), ...sheet });
  }
  return { stores, order: readSheet(orderFile) };
}

module.exports = { loadReal, readSheet, readSheetMaybeLocked, loadRealOrderFiles, DIR };
