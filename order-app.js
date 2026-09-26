// 발주서 만들기 화면: 주문 파일 올리기(비밀번호) → 변환 → 처음 보는 옵션 가르치기 → 엑셀 저장
(function () {
  const C = window.CONFIG.order, O = window.OrderRules;
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const MAP_KEY = 'orderMap.v1', PW_KEY = 'orderPasswords.v1'; // 비밀번호는 쇼핑몰마다 달라서 여러 개 기억
  const state = { files: [], queue: [], result: null };

  function store(key, value) {
    try {
      if (value === undefined) return JSON.parse(localStorage.getItem(key));
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify(value));
    } catch (e) { return null; }
  }

  // ---------- 변환표: 기본(order-map.js) + 어머니가 가르친 것(브라우저) ----------

  const userEntries = () => store(MAP_KEY) || [];
  const currentMap = () => O.buildMap(window.ORDER_MAP_DEFAULT || [], userEntries());

  function teach(entries) {
    const byKey = O.buildMap(userEntries(), entries);
    store(MAP_KEY, [...byKey.values()]);
  }

  function renderMapInfo() {
    $('#mapInfo').textContent = `변환표 ${currentMap().size}개 (직접 가르친 것 ${userEntries().length}개)`;
  }

  // ---------- 1. 파일 올리기 ----------

  function showError(msg) { const el = $('#loadError'); el.textContent = msg; el.hidden = !msg; }

  function parseWorkbook(wb) {
    for (const name of wb.SheetNames) {
      const ws = wb.Sheets[name];
      if (!ws['!ref']) continue;
      const firstRow = XLSX.utils.decode_range(ws['!ref']).s.r + 1;
      const parsed = O.parseOrderFile(XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' }), firstRow);
      if (parsed) return parsed;
    }
    return null;
  }

  async function unlock(buf, password) {
    const wbp = await XlsxPopulate.fromDataAsync(buf, { password });
    return XLSX.read(await wbp.outputAsync('arraybuffer'), { type: 'array' });
  }

  function addParsed(file, parsed) {
    if (!parsed) throw new Error(`'${file.name}'은(는) 어느 쇼핑몰 파일인지 모르겠어요. 스마트스토어 발주발송관리 또는 오늘의집 주문배송 내역에서 받은 파일인지 확인해 주세요.`);
    if (!parsed.lines.length) throw new Error(`'${file.name}'에 주문이 없어요.`);
    state.files = state.files.filter(f => f.name !== file.name);
    state.files.push({ name: file.name, ...parsed });
    renderFiles();
    run();
  }

  // 파일을 차례로 처리. 비밀번호가 필요하면 멈추고 입력을 기다림.
  async function processQueue() {
    while (state.queue.length) {
      const file = state.queue[0];
      showError('');
      try {
        const buf = await file.arrayBuffer();
        let wb = null;
        try { wb = XLSX.read(buf, { type: 'array' }); } catch (e) {
          if (!/password|encrypt/i.test(e.message)) throw e;
        }
        if (!wb) setBusy(`'${file.name}' 여는 중… (비밀번호를 푸느라 몇 초 걸려요)`);
        for (const saved of wb ? [] : savedPasswords(file.name)) {
          try { wb = await unlock(buf, saved); } catch (e) { continue; /* 이 파일 비밀번호가 아님 */ }
          if (!savedList().some(x => x.prefix === prefixOf(file.name))) rememberPassword(saved, file.name);
          break;
        }
        if (!wb) { setBusy(''); askPassword(file, buf); return; }
        addParsed(file, parseWorkbook(wb));
      } catch (e) {
        showError(e.message || String(e));
      }
      state.queue.shift();
    }
    setBusy('');
  }

  function setBusy(msg) {
    $('#drop .drop-file').innerHTML = msg ? esc(msg) : '여기에 끌어다 놓거나 <u>눌러서 선택</u>';
  }

  // 비밀번호는 [{ pw, prefix }]로 기억: 파일 이름 앞부분(예: '스마트스토어', '주문배송')이 같은 것부터 시도
  const prefixOf = name => String(name).split(/[_\s(\d]/)[0];
  const savedList = () => { const v = store(PW_KEY); return Array.isArray(v) ? v.filter(x => x && x.pw) : []; };
  const savedPasswords = name => {
    const list = savedList();
    return [...list.filter(x => x.prefix === prefixOf(name)), ...list.filter(x => x.prefix !== prefixOf(name))].map(x => x.pw);
  };
  function rememberPassword(pw, name) {
    const prefix = prefixOf(name);
    store(PW_KEY, [{ pw, prefix }, ...savedList().filter(x => x.prefix !== prefix)].slice(0, 5));
  }

  function askPassword(file, buf) {
    state.pending = { file, buf };
    $('#pwFile').textContent = `'${file.name}' 파일에 비밀번호가 걸려 있어요 (쇼핑몰에서 받을 때 정한 번호)`;
    $('#pwBox').hidden = false;
    $('#pwInput').value = '';
    $('#pwRemember').checked = savedList().length > 0;
    $('#pwInput').focus();
  }

  $('#pwForm').addEventListener('submit', async e => {
    e.preventDefault();
    const { file, buf } = state.pending || {};
    const pw = $('#pwInput').value.trim();
    if (!file || !pw) return;
    const btn = $('#pwForm button[type=submit]');
    btn.disabled = true; btn.textContent = '여는 중…';
    try {
      const wb = await unlock(buf, pw);
      if ($('#pwRemember').checked) rememberPassword(pw, file.name);
      $('#pwBox').hidden = true;
      $('#pwInput').value = '';
      state.pending = null;
      state.queue.shift();
      try { addParsed(file, parseWorkbook(wb)); } catch (err) { showError(err.message); }
      processQueue();
    } catch (err) {
      showError('비밀번호가 맞지 않아요. 다시 넣어주세요.');
      $('#pwInput').select();
    } finally {
      btn.disabled = false; btn.textContent = '열기';
    }
  });

  $('#pwSkip').addEventListener('click', () => {
    $('#pwBox').hidden = true;
    state.pending = null;
    state.queue.shift();
    showError('');
    processQueue();
  });

  function addFiles(list) {
    const busy = state.queue.length > 0;
    state.queue.push(...[...list].filter(f => /\.xlsx?$/i.test(f.name)));
    if (!busy) processQueue();
  }

  const box = $('#drop'), input = box.querySelector('input');
  box.addEventListener('click', () => input.click());
  box.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') input.click(); });
  input.addEventListener('change', () => { addFiles(input.files); input.value = ''; });
  box.addEventListener('dragover', e => { e.preventDefault(); box.classList.add('over'); });
  box.addEventListener('dragleave', () => box.classList.remove('over'));
  box.addEventListener('drop', e => { e.preventDefault(); box.classList.remove('over'); addFiles(e.dataTransfer.files); });
  window.addEventListener('dragover', e => e.preventDefault());
  window.addEventListener('drop', e => e.preventDefault());

  function renderFiles() {
    $('#fileList').innerHTML = state.files.map((f, i) =>
      `<li><span>✅ <b>${esc(f.mall)}</b> (${esc(f.label)}) · ${esc(f.name)} · 주문 ${f.lines.length}줄</span><button data-i="${i}">빼기</button></li>`).join('');
    $('#fileList').querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
      state.files.splice(+b.dataset.i, 1);
      renderFiles();
      run();
    }));
  }

  // ---------- 2. 변환 & 결과 ----------

  function run() {
    renderMapInfo();
    if (!state.files.length) { $('#resultStep').hidden = true; state.result = null; return; }
    const lines = state.files.flatMap(f => f.lines);
    state.result = O.convert(lines, currentMap(), { mallOrder: C.mallOrder });
    render();
  }

  function render() {
    const r = state.result, map = currentMap();
    $('#resultStep').hidden = false;

    // 처음 보는 옵션 가르치기
    const names = [...new Set([...map.values()].map(e => e.name))].sort((a, b) => a.localeCompare(b, 'ko'));
    $('#teach').innerHTML = r.unknown.length ? `
      <div class="teach">
        <h3>처음 보는 옵션이 ${r.unknown.length}개 있어요</h3>
        <p>발주서에 적을 이름을 한 번만 알려주세요. 다음부터는 자동으로 바뀌어요. <b>색상은 적지 않아도</b> 뒤에 알아서 붙어요.</p>
        ${r.unknown.map((u, i) => `
          <div class="teach-item">
            <div class="raw"><b>${esc(u.mall)}</b> · ${esc(u.raw)} <small>· ${u.count}개${u.colors.length ? ' · 예: ' + esc(u.colors[0]) : ''}</small></div>
            <input data-i="${i}" list="nameList" placeholder="예: 컨실 틈새장 200 높은형">
          </div>`).join('')}
        <datalist id="nameList">${names.map(n => `<option value="${esc(n)}">`).join('')}</datalist>
        <button id="teachBtn" class="primary">이 이름으로 저장</button>
      </div>` : '';
    if (r.unknown.length) {
      $('#teachBtn').addEventListener('click', () => {
        const entries = [...$('#teach').querySelectorAll('input[data-i]')]
          .map(el => ({ u: r.unknown[+el.dataset.i], name: el.value.trim() }))
          .filter(x => x.name)
          .map(x => ({ mall: x.u.mall, raw: x.u.raw, name: O.splitColor(x.name).base }));
        if (!entries.length) { alert('이름을 하나 이상 적어주세요.'); return; }
        teach(entries);
        run();
      });
    }

    const lineCount = new Set(r.out.map(o => o.line)).size;
    $('#summary').innerHTML = `주문 <b>${lineCount + r.skipped.length}</b>줄 → 발주서 <b>${r.out.length}</b>줄` +
      (r.unknown.length ? ` · <span style="color:var(--yellow-ink)">노란 줄 ${r.out.filter(o => !o.known).length}개는 이름을 알려주셔야 해요</span>` : ' · 모두 변환됐어요 ✅');
    $('#notes').innerHTML = r.skipped.map(s =>
      `<li>❌ <b>${esc(s.line.receiver)}</b> ${esc(O.clean(s.line.option))} — '${esc(s.reason)}' 상태라 발주서에서 뺐어요</li>`).join('');

    const blocked = r.unknown.length > 0;
    $('#downloadBtn').disabled = blocked;
    $('#downloadHelp').textContent = blocked ? '처음 보는 옵션 이름을 먼저 알려주시면 저장할 수 있어요.' : '표에서 이름이 이상한 줄은 [고치기]를 눌러 바로잡을 수 있어요.';

    const head = ['쇼핑몰', '수량', '상품명 (발주서)', '쇼핑몰 옵션', '주문자', '받는 분', '연락처1', '연락처2', '메시지', '메모'];
    $('#resultTable').innerHTML = `<thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>` +
      r.out.map((o, i) => {
        const v = o.values;
        return `<tr class="${o.known ? '' : 'unknown'}">
          <td>${esc(v['쇼핑몰명'])}</td>
          <td>${esc(o.qty)}</td>
          <td class="prod">${o.known ? esc(o.name) : '❓ ' + esc(O.joinName(o.base, o.color))}<button class="fix" data-i="${i}">고치기</button></td>
          <td class="prod">${esc(O.clean(o.line.option))}</td>
          <td>${esc(v['주문자명'])}</td><td>${esc(v['수취인명'])}</td>
          <td>${esc(v['수취인연락처1'])}</td><td>${esc(v['수취인연락처2'])}</td>
          <td class="note">${esc(v['메세지'])}</td>
          <td class="note">${esc(o.notes.join(' · '))}</td>
        </tr>`;
      }).join('') + '</tbody>';
    $('#resultTable').querySelectorAll('.fix').forEach(b => b.addEventListener('click', () => {
      const o = r.out[+b.dataset.i], hit = map.get(o.key);
      const name = prompt(`쇼핑몰 옵션:\n${o.base}\n\n발주서에 뭐라고 적을까요? (색상은 빼고 적어주세요 — 뒤에 알아서 붙어요)`, hit ? hit.name : '');
      if (name == null || !name.trim()) return;
      teach([{ mall: o.line.mall, raw: o.base, name: O.splitColor(name).base }]);
      run();
    }));
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

  function today() {
    const d = new Date();
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  }

  $('#downloadBtn').addEventListener('click', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Sheet1');
    ws.addRow(O.COLUMNS).font = { bold: true };
    for (const o of state.result.out) ws.addRow(O.toSheetRow(o));
    const width = { '상품명': 48, '수취인 주소': 50, '메세지': 24, '수취인연락처1': 15, '수취인연락처2': 15, '수취인우편번호': 10 };
    ws.columns.forEach((col, i) => { col.width = width[O.COLUMNS[i]] || 10; });
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    await saveWorkbook(wb, C.fileName(today()));
  });

  // ---------- 변환표 백업 / 불러오기 ----------

  $('#mapExport').addEventListener('click', async () => {
    const mine = O.buildMap(userEntries());
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('변환표');
    ws.columns = [
      { header: '쇼핑몰', width: 12 }, { header: '쇼핑몰 옵션 (색상 뺀 부분)', width: 70 },
      { header: '발주서에 적는 이름', width: 40 }, { header: '출처', width: 10 },
    ];
    ws.getRow(1).font = { bold: true };
    for (const [k, e] of currentMap()) ws.addRow([e.mall, e.raw, e.name, mine.has(k) ? '직접' : '기본']);
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    await saveWorkbook(wb, `발주서_변환표_${today()}.xlsx`);
  });

  $('#mapImport').addEventListener('click', () => $('#mapFile').click());
  $('#mapFile').addEventListener('change', async () => {
    const file = $('#mapFile').files[0];
    $('#mapFile').value = '';
    if (!file) return;
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
      const h = rows[0].map(String);
      const iMall = h.indexOf('쇼핑몰'), iRaw = h.findIndex(x => x.startsWith('쇼핑몰 옵션')), iName = h.indexOf('발주서에 적는 이름');
      if (iRaw < 0 || iName < 0) throw new Error('변환표 파일이 아니에요 (이 화면의 [변환표 엑셀로 저장]으로 만든 파일을 올려주세요)');
      const entries = rows.slice(1).map(r => ({ mall: r[iMall] || '미니미니멀', raw: r[iRaw], name: r[iName] })).filter(e => String(e.raw).trim());
      if (!confirm(`변환표 ${entries.length}개를 불러올까요? 지금 브라우저에 기억된 것과 합쳐져요 (같은 옵션은 불러온 이름으로 바뀜).`)) return;
      teach(entries);
      run();
    } catch (e) {
      showError(e.message || String(e));
    }
  });

  renderMapInfo();
})();
