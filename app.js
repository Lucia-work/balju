// 화면 동작: 파일 읽기 → 구간 선택 → 점검 → 결과 표시 / 엑셀 저장
(function () {
  const C = window.CONFIG, ST = C.statuses;
  const $ = s => document.querySelector(s);
  const state = { order: null, settle: null, prices: null, result: null, view: null };

  const FILL = { red: 'FFFDE3E1', yellow: 'FFFFF1D6', blue: 'FFE0ECFD', green: 'FFE3F4E6' };
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const won = n => (n == null || n === '' ? '' : Math.round(n).toLocaleString('ko-KR'));
  const day = d => Settle.dayToString(d).slice(5).replace('-', '/');

  function store(key, value) {
    try {
      if (value === undefined) return JSON.parse(localStorage.getItem(key));
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) { return null; }
  }

  $('#title').textContent = C.title;
  document.title = C.title;

  // ---------- 1. 파일 올리기 ----------

  async function readSheet(file) {
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' }); // 날짜는 숫자 그대로 (하루 밀림 방지)
    const name = wb.SheetNames.find(n => wb.Sheets[n]['!ref']) || wb.SheetNames[0];
    const ws = wb.Sheets[name];
    const firstRow = XLSX.utils.decode_range(ws['!ref']).s.r + 1;
    return { rows: XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' }), firstRow };
  }

  function setupDrop(kind, onFile) {
    const box = $('#drop-' + kind), input = box.querySelector('input');
    box.insertAdjacentHTML('afterbegin',
      `<div class="drop-title">${esc(C.files[kind].label)}</div><div class="drop-hint">${esc(C.files[kind].hint)}</div><div class="drop-file">여기에 끌어다 놓거나 <u>눌러서 선택</u></div>`);
    box.addEventListener('click', e => { if (e.target.tagName !== 'BUTTON') input.click(); });
    box.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') input.click(); });
    input.addEventListener('change', () => { if (input.files[0]) onFile(input.files[0]); input.value = ''; });
    box.addEventListener('dragover', e => { e.preventDefault(); box.classList.add('over'); });
    box.addEventListener('dragleave', () => box.classList.remove('over'));
    box.addEventListener('drop', e => { e.preventDefault(); box.classList.remove('over'); if (e.dataTransfer.files[0]) onFile(e.dataTransfer.files[0]); });
  }
  window.addEventListener('dragover', e => e.preventDefault());
  window.addEventListener('drop', e => e.preventDefault());

  function markLoaded(kind, html) {
    const box = $('#drop-' + kind);
    box.classList.add('loaded');
    box.querySelector('.drop-file').innerHTML = html;
  }

  function showError(msg) { const el = $('#loadError'); el.textContent = msg; el.hidden = !msg; }

  async function loadData(kind, file) {
    showError('');
    try {
      const sheet = await readSheet(file);
      if (kind === 'order') {
        const orders = Settle.parseOrders(sheet.rows, sheet.firstRow);
        if (orders.length < 1) throw new Error('발주 줄이 없어요');
        state.order = { file: file.name, sheet, orders };
        markLoaded('order', `✔ ${esc(file.name)}<br>발주 ${orders.length.toLocaleString()}줄 · <u>바꾸기</u>`);
      } else {
        const items = Settle.parseSettlement(sheet.rows, sheet.firstRow);
        const n = items.filter(i => i.type === 'product').length;
        if (n < 1) throw new Error('정산 줄이 없어요');
        state.settle = { file: file.name, sheet, items };
        markLoaded('settle', `✔ ${esc(file.name)}<br>상품 ${n.toLocaleString()}줄 · <u>바꾸기</u>`);
      }
      state.result = null;
      $('#resultStep').hidden = true;
      renderScope();
    } catch (e) {
      console.error(e);
      showError(`"${file.name}" 파일을 읽지 못했어요. ${C.files[kind].label} 파일이 맞는지 확인해 주세요.`);
    }
  }

  // 기준시트는 [상품명, 단가] 목록으로 브라우저에 기억
  function usePrices(list, meta) {
    state.prices = new Map(list.map(([name, price, since, prevPrice]) =>
      [Settle.productKey(name), { name, price, since: since ?? null, prevPrice: prevPrice ?? null }]));
    markLoaded('prices', `✔ ${list.length}개 상품 (${esc(meta.file)}, ${esc(meta.date)} 저장)<br><u>새 기준시트로 바꾸기</u>`);
  }

  async function loadPrices(file) {
    showError('');
    try {
      const sheet = await readSheet(file);
      const table = Settle.parsePriceTable(sheet.rows);
      if (!table || !table.size) throw new Error('기준시트 형식 아님');
      const list = [...table.values()].map(v => [v.name, v.price, v.since, v.prevPrice]);
      const meta = { file: file.name, date: new Date().toLocaleDateString('ko-KR') };
      store('prices', { list, meta });
      usePrices(list, meta);
      renderScope();
    } catch (e) {
      console.error(e);
      showError(`"${file.name}"에서 '상품명'과 '단가' 칸을 찾지 못했어요. 단가 기준시트 파일이 맞는지 확인해 주세요.`);
    }
  }

  setupDrop('order', f => loadData('order', f));
  setupDrop('settle', f => loadData('settle', f));
  setupDrop('prices', loadPrices);
  const saved = store('prices');
  if (saved && saved.list && saved.list.length) usePrices(saved.list, saved.meta);

  // ---------- 2. 구간 ----------

  function renderScope() {
    $('#draftBtn').hidden = !(state.order && state.settle) || !!state.prices;
    if (!state.order || !state.settle) return;
    $('#scopeStep').hidden = false;
    const pays = Settle.findPayments(state.settle.items);
    const opts = pays.map((p, i) => {
      const next = pays[i + 1];
      const text = next
        ? `지난 정산 — ${p.row}행 입금 다음 ~ ${next.row}행 입금(${won(-next.amount)}원) 전`
        : `이번 정산 — 마지막 입금(${p.row}행, ${won(-p.amount)}원) 다음부터`;
      return `<option value="${p.row}|${next ? next.row : 'end'}">${text}</option>`;
    }).reverse();
    $('#paymentSelect').innerHTML = opts.join('') + '<option value="0|end">정산서 처음부터 끝까지 전부</option>';
    updateScopeInfo();
  }

  function selectedRange() {
    const [from, to] = $('#paymentSelect').value.split('|');
    return { fromPaymentRow: +from, toRow: to === 'end' ? Infinity : +to };
  }

  function updateScopeInfo() {
    const { fromPaymentRow: from, toRow: to } = selectedRange();
    const lines = state.settle.items.filter(i => i.type === 'product' && i.row > from && i.row < to);
    const days = lines.map(l => l.day).filter(d => d != null);
    $('#scopeInfo').textContent = lines.length
      ? `· ${day(Math.min(...days))} ~ ${day(Math.max(...days))} · 상품 ${lines.length.toLocaleString()}줄`
      : '· 이 구간에는 상품 줄이 없어요';
  }
  $('#paymentSelect').addEventListener('change', updateScopeInfo);

  // ---------- 3. 점검 ----------

  $('#runBtn').addEventListener('click', () => {
    if (!state.prices && !confirm('단가 기준시트가 없어서 발주서 금액하고만 비교해요. 그래도 점검할까요?')) return;
    const r = Settle.check(state.order.orders, state.settle.items, state.prices, selectedRange());
    r.findings.push(...r.okLines.map(s => ({ status: 'ok', s })));
    r.findings = r.findings.filter(f => ST[f.status]);
    state.result = r;
    const firstRed = C.groupOrder.flatMap(g => Object.keys(ST).filter(k => ST[k].group === g))
      .find(k => r.findings.some(f => f.status === k));
    state.view = firstRed || 'ok';
    renderResult();
    $('#resultStep').hidden = false;
    $('#resultStep').scrollIntoView({ behavior: 'smooth' });
  });

  const countBy = (list, g) => list.filter(f => ST[f.status].group === g).length;

  function renderResult() {
    const r = state.result, m = r.money;
    const reds = countBy(r.findings, 'red');
    const boundaryBad = r.boundary && (!r.boundary.first.ok || !r.boundary.last.ok);
    const v = $('#verdict');
    if (!reds && !boundaryBad) {
      v.className = 'verdict good';
      v.innerHTML = (r.toRow === Infinity
        ? `✅ 문제가 없어요. 정산서 금액 <b>${won(m.written)}원</b> 그대로 입금하셔도 됩니다.`
        : `✅ 이 정산 구간은 문제가 없어요. (정산서 누계 <b>${won(m.written)}원</b>)`)
        + (countBy(r.findings, 'yellow') ? `<small>노란색 ${countBy(r.findings, 'yellow')}건은 한 번 훑어봐 주세요.</small>` : '');
    } else {
      v.className = 'verdict bad';
      v.innerHTML = `⚠️ 입금 전에 확인하세요 — 문제 ${reds}건${boundaryBad ? ', 시작/끝 줄 확인 필요' : ''}`
        + (m.overcharge ? `<small>문제 건을 바로잡으면 <b>${won(Math.abs(m.overcharge))}원</b> ${m.overcharge > 0 ? '덜' : '더'} 내야 해요.</small>` : '');
    }

    const recomputeNote = m.recomputed !== m.written ? ` · <span class="warn">다시 더하면 ${won(m.recomputed)}원 (차이 ${won(m.written - m.recomputed)}원)</span>` : ' · 다시 더해도 같아요 ✔';
    $('#money').innerHTML = `정산서 최종 금액 <b>${won(m.written)}원</b> (${m.writtenRow}행)${recomputeNote}`
      + (m.overcharge ? ` · 바로잡은 금액(추정) <b>${won(m.suggested)}원</b>` : '');

    $('#boundary').innerHTML = r.boundary ? [r.boundary.first, r.boundary.last].map(boundaryText).join('') : '';

    const keys = Object.keys(ST).filter(k => r.findings.some(f => f.status === k));
    keys.sort((a, b) => C.groupOrder.indexOf(ST[a].group) - C.groupOrder.indexOf(ST[b].group));
    $('#cards').innerHTML = keys.map(k => {
      const list = r.findings.filter(f => f.status === k);
      return `<div class="card g-${ST[k].group}${state.view === k ? ' active' : ''}" data-k="${k}">
        <div class="n">${list.length.toLocaleString()}건</div><div class="t">${esc(ST[k].label)}</div></div>`;
    }).join('');
    $('#cards').querySelectorAll('.card').forEach(el => el.addEventListener('click', () => { state.view = el.dataset.k; renderResult(); }));

    const list = r.findings.filter(f => f.status === state.view);
    $('#listTitle').textContent = `${ST[state.view].label} (${list.length}건)`;
    $('#listHelp').textContent = ST[state.view].help;
    renderTable(list);
  }

  function boundaryText(b) {
    const name = b.which === '첫' ? '시작' : '끝';
    if (!b.o) return `<li class="bad">⚠️ ${name}: ${esc(b.text)}</li>`;
    let t = `정산서 ${b.which} 줄(${b.s.row}행, ${day(b.s.day)} ${esc(b.s.receiver)}) = 발주서 ${b.o.row}행`;
    if (b.which === '첫' && b.prev) t += b.prev.inPrev ? ` · 바로 앞 발주(${b.prev.o.row}행)는 지난 정산에 있음` : ` · 바로 앞 발주(${b.prev.o.row}행)도 이번 정산에 있음 — 순서 확인`;
    if (b.which === '마지막' && b.next) t += ` · 다음 발주(${b.next.row}행, ${day(b.next.day)})부터는 다음 정산`;
    if (b.missing.length) t += ` · <b>빠진 발주 ${b.missing.length}건: ${b.missing.map(o => o.row + '행').join(', ')}</b>`;
    return `<li class="${b.ok ? 'good' : 'bad'}">${b.ok ? '✅' : '⚠️'} ${name}: ${t}</li>`;
  }

  // 한 건을 표의 한 줄로
  function rowOf(f) {
    const s = f.s, o = f.o;
    if (f.sub) {
      return { 분류: ST[f.status].label, '정산서 행': f.sub.row, 날짜: day(f.sub.day), 상품: f.sub.note || `적힌 누계 ${won(f.sub.written)} / 더한 값 ${won(f.sub.expected)}`, '받는 분': '', 청구액: '', '발주서 행': '', '발주 금액': '', '기준 단가': '', 차액: f.sub.diff || '' };
    }
    if (f.adj) {
      return { 분류: ST[f.status].label, '정산서 행': f.adj.row, 날짜: day(f.adj.day), 상품: f.adj.label, '받는 분': '', 청구액: f.adj.amount, '발주서 행': '', '발주 금액': '', '기준 단가': '', 차액: '' };
    }
    const x = s || o;
    const ref = f.ref ?? (state.prices ? Settle.refPriceOn(state.prices.get(x.key), x.day) : null) ?? '';
    const charged = s ? (s.price ?? s.priceText) : '';
    const base = f.status === 'price_wrong' ? f.correct : ref; // 금액 틀림은 발주서 금액 기준
    return {
      분류: ST[f.status].label + (f.adjRow ? ` (${f.adjRow}행에서 차감)` : ''),
      '정산서 행': s ? s.row : '', 날짜: day(x.day), 상품: x.product, '받는 분': x.receiver,
      청구액: charged, '발주서 행': o ? o.row : '', '발주 금액': o ? (o.price ?? '') : '', '기준 단가': ref,
      차액: s && typeof s.price === 'number' && typeof base === 'number' && s.price !== base ? s.price - base : '',
    };
  }
  const COLS = ['분류', '정산서 행', '날짜', '상품', '받는 분', '청구액', '발주서 행', '발주 금액', '기준 단가', '차액'];
  const MONEY = new Set(['청구액', '발주 금액', '기준 단가', '차액']);

  function renderTable(list) {
    const shown = list.slice(0, 500);
    const body = shown.map(f => {
      const r = rowOf(f), g = ST[f.status].group;
      return `<tr class="g-${g}">${COLS.map(c => `<td class="${MONEY.has(c) ? 'amt' : ''}${c === '상품' ? ' prod' : ''}">${esc(MONEY.has(c) && typeof r[c] === 'number' ? won(r[c]) : r[c])}</td>`).join('')}</tr>`;
    }).join('');
    const more = list.length > shown.length ? `<tr><td colspan="${COLS.length}">… 나머지 ${list.length - shown.length}건은 엑셀로 저장해서 보세요.</td></tr>` : '';
    $('#resultTable').innerHTML = `<thead><tr>${COLS.map(c => `<th>${c}</th>`).join('')}</tr></thead><tbody>${body || `<tr><td colspan="${COLS.length}">해당하는 건이 없어요.</td></tr>`}${more}</tbody>`;
  }

  // ---------- 엑셀로 저장 ----------

  function saveWorkbook(wb, name) {
    return wb.xlsx.writeBuffer().then(buf => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    });
  }
  const fill = g => ({ type: 'pattern', pattern: 'solid', fgColor: { argb: FILL[g] } });

  $('#downloadBtn').addEventListener('click', async () => {
    const r = state.result, m = r.money;
    const wb = new ExcelJS.Workbook();

    const ws0 = wb.addWorksheet('요약');
    ws0.columns = [{ width: 30 }, { width: 18 }];
    ws0.addRow([C.title, new Date().toLocaleDateString('ko-KR')]).font = { bold: true, size: 14 };
    ws0.addRow(['발주서', state.order.file]);
    ws0.addRow(['정산서', state.settle.file]);
    ws0.addRow(['점검 구간', $('#scopeInfo').textContent.replace(/^·\s*/, '')]);
    ws0.addRow([]);
    ws0.addRow(['결론', $('#verdict').innerText.split('\n')[0]]).font = { bold: true };
    for (const [t, v] of [['정산서 최종 금액', m.written], ['다시 더한 금액', m.recomputed], ['문제 건 금액(+는 더 청구됨)', m.overcharge], ['바로잡은 금액(추정)', m.suggested]]) {
      ws0.addRow([t, v]).getCell(2).numFmt = '#,##0';
    }
    ws0.addRow([]);
    if (r.boundary) for (const b of [r.boundary.first, r.boundary.last]) ws0.addRow([b.which === '첫' ? '시작 줄' : '끝 줄', (b.ok ? '맞음 ' : '확인 필요 ') + boundaryText(b).replace(/<[^>]+>/g, '')]);
    ws0.addRow([]);
    ws0.addRow(['분류', '건수']).font = { bold: true };
    for (const k of Object.keys(ST)) {
      const n = r.findings.filter(f => f.status === k).length;
      if (n) ws0.addRow([ST[k].label, n]).getCell(1).fill = fill(ST[k].group);
    }

    const listSheet = (name, list) => {
      const ws = wb.addWorksheet(name);
      ws.addRow(COLS).font = { bold: true };
      ws.columns = [20, 10, 8, 44, 12, 11, 10, 11, 11, 10].map(width => ({ width }));
      for (const f of list) {
        const rr = rowOf(f);
        const row = ws.addRow(COLS.map(c => rr[c]));
        row.eachCell({ includeEmpty: true }, c => { c.fill = fill(ST[f.status].group); });
        [6, 8, 9, 10].forEach(i => { row.getCell(i).numFmt = '#,##0'; });
      }
      ws.views = [{ state: 'frozen', ySplit: 1 }];
      ws.autoFilter = { from: 'A1', to: 'J1' };
    };
    const order = f => C.groupOrder.indexOf(ST[f.status].group);
    listSheet('확인할 것', r.findings.filter(f => f.status !== 'ok').sort((a, b) => order(a) - order(b)));
    listSheet('정상', r.findings.filter(f => f.status === 'ok'));

    // 원본 모양 그대로 + 맨 앞에 결과 칸, 줄마다 색칠
    const originalSheet = (name, sheet, statusByRow) => {
      const ws = wb.addWorksheet(name);
      for (let k = 1; k < sheet.firstRow; k++) ws.addRow([]); // 원본과 줄 번호를 똑같이 맞춤
      sheet.rows.forEach((cells, i) => {
        const k = statusByRow.get(sheet.firstRow + i);
        const row = ws.addRow([k ? ST[k].label : '', ...cells]);
        if (k) row.eachCell({ includeEmpty: true }, c => { c.fill = fill(ST[k].group); });
      });
      ws.getColumn(1).width = 18;
      ws.views = [{ state: 'frozen', xSplit: 1 }];
    };
    const rank = k => C.groupOrder.indexOf(ST[k].group);
    const mark = (map, row, k) => { if (row && (!map.has(row) || rank(k) < rank(map.get(row)))) map.set(row, k); };
    const sMap = new Map(), oMap = new Map();
    for (const f of r.findings) {
      if (f.s) mark(sMap, f.s.row, f.status);
      if (f.o) mark(oMap, f.o.row, f.status);
      if (f.sub) mark(sMap, f.sub.row, f.status);
      if (f.adj) mark(sMap, f.adj.row, f.status);
    }
    originalSheet('정산서(원본)', state.settle.sheet, sMap);
    originalSheet('발주서(원본)', state.order.sheet, oMap);

    await saveWorkbook(wb, `정산점검결과_${new Date().toISOString().slice(0, 10)}.xlsx`);
  });

  // ---------- 기준시트 초안 만들기 ----------

  $('#draftBtn').addEventListener('click', async () => {
    const draft = Settle.makePriceDraft(state.order.orders, state.settle.items);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('단가기준시트');
    ws.columns = [
      { header: '상품명', width: 48 }, { header: '단가', width: 10 }, { header: '적용 시작일(참고)', width: 16 },
      { header: '이전 단가(참고)', width: 14 }, { header: '건수(참고)', width: 10 }, { header: '확인 필요', width: 18 },
    ];
    ws.getRow(1).font = { bold: true };
    for (const d of draft) {
      const row = ws.addRow([d.name, d.price, Settle.dayToString(d.since), d.prevPrice ?? '', d.count, d.warn]);
      row.getCell(2).numFmt = '#,##0'; row.getCell(4).numFmt = '#,##0';
      if (d.warn) row.getCell(6).fill = fill('yellow');
    }
    ws.autoFilter = { from: 'A1', to: 'F1' };
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    await saveWorkbook(wb, '단가기준시트_초안.xlsx');
    alert(`단가 기준시트 초안(${draft.length}개 상품)을 저장했어요.\n엑셀에서 단가를 확인·수정한 뒤, 위의 '단가 기준시트' 칸에 올려주세요.`);
  });
})();
