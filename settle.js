// 해피아이 정산 점검 규칙 — 화면과 무관한 순수 함수들 (Node 테스트에서도 사용)
(function (root) {
  const DAY_MS = 86400000;

  // 파일 칸 위치 (0부터 셈: A=0, B=1, ...)
  const LAYOUT = {
    order: { date: 0, product: 3, color: 4, qty: 5 },            // 금액·이름·연락처는 수량 뒤에서 내용으로 찾음
    settle: { date: 0, product: 1, memo: 2, qty: 3, orderer: 5, receiver: 6, tel: 7, label: 11, amount: 12 },
  };
  const OPTIONS = {
    nearDays: 3,      // 상품명/이름이 달라도 같은 주문으로 볼 날짜 차이
    matchDays: 30,    // 완전히 같은 주문을 찾을 때 허용하는 날짜 차이
    typoDays: 60,     // 앞 날짜보다 이만큼 넘게 튀는 날짜는 오타로 보고 무시
  };
  const SUBTOTAL_LABELS = /^(잔액|잔고|누계|합계|소계)$/;

  // ---------- 값 정리 ----------

  const str = v => (v == null ? '' : String(v).trim());

  function parseAmount(v) {
    if (typeof v === 'number') return isFinite(v) ? v : null;
    let s = str(v);
    if (!s) return null;
    let negative = false;
    if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1); }
    s = s.replace(/[,\s원₩\\]/g, '');
    if (s.startsWith('-')) { negative = !negative; s = s.slice(1); }
    if (!/^\d+(\.\d+)?$/.test(s)) return null;
    return negative ? -Number(s) : Number(s);
  }

  const ymd = (y, m, d) => (m >= 1 && m <= 12 && d >= 1 && d <= 31 ? Math.floor(Date.UTC(y, m - 1, d) / DAY_MS) : null);

  // 날짜 → "1970-01-01부터 며칠째" 정수. yearHint는 '9월21일'처럼 연도 없는 표기용
  function parseDay(v, yearHint) {
    if (v == null || v === '') return null;
    if (v instanceof Date) return isNaN(v) ? null : ymd(v.getFullYear(), v.getMonth() + 1, v.getDate());
    if (typeof v === 'number') {
      if (v >= 19000101 && v <= 29991231) return parseDay(String(v));
      if (v > 20000 && v < 80000) return Math.floor(v) - 25569; // 엑셀 날짜 숫자
      return null;
    }
    const s = str(v);
    let m = s.match(/^(\d{4})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})/) || s.match(/^(\d{4})(\d{2})(\d{2})(?!\d)/);
    if (m) return ymd(+m[1], +m[2], +m[3]);
    m = s.match(/^(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
    if (m && yearHint) return ymd(yearHint, +m[1], +m[2]);
    return null;
  }

  const dayToString = d => (d == null ? '' : new Date(d * DAY_MS).toISOString().slice(0, 10));
  const yearOf = d => (d == null ? null : new Date(d * DAY_MS).getUTCFullYear());

  // 날짜 칸을 읽어 '지금 날짜'를 갱신. 앞 날짜와 너무 동떨어진 값(예: 2023년 오타)은 무시
  function nextDay(cell, current) {
    const d = parseDay(cell, yearOf(current));
    if (d == null) return current;
    if (current != null && Math.abs(d - current) > OPTIONS.typoDays) return current;
    return d;
  }

  const normName = v => str(v).replace(/\s/g, '').toLowerCase();
  const telDigits = v => str(v).replace(/\D/g, '');
  const isTel = v => /^0\d{1,3}-?\d{3,4}-?\d{4}$/.test(str(v));
  const isQty = v => /^\d+(_\d+)?$/.test(str(v));
  const isCancelText = v => /취소/.test(str(v));

  // 상품명 → 비교용 키: 색상 뒷부분, 띄어쓰기, 기호를 지움
  // 색상 표기부터 끝까지 떼기 — 단, 이름이 색상으로 시작하면(예: '컬러: 오크 / 사이즈: 600') 그대로 둠
  const COLOR_RE = /\s*\/?\s*(색상\s*선택|색상|상판\s*컬러|프레임\s*컬러|컬러|색)\s*[:：]/;
  function cutColor(s) {
    const m = s.match(COLOR_RE);
    return m && m.index > 0 ? s.slice(0, m.index) : s;
  }

  function productKey(name) {
    let s = cutColor(str(name));
    s = s.replace(/추가상품/g, '');
    return s.toLowerCase().replace(/[\s()（）[\]{}/\\:：·,.\-_~!?=+*'"`⏬⏫▶►•]/g, '');
  }

  // 사람이 보기 좋은 상품 이름 (색상 뒷부분만 뗌)
  function productLabel(name) {
    return cutColor(str(name)).replace(/\s+/g, ' ').trim();
  }

  // ---------- 발주서 읽기 ----------
  // 날짜: '2026년02월23일' 구분 줄 / 20260401 숫자 / '9월21일 오후 발주' 등. 한 번 나온 날짜는 다음 날짜까지 이어짐.
  // 수량 칸 뒤: 첫 숫자 = 금액, 다음 글자 두 개 = 주문자/수취인, 전화번호 모양 = 연락처 (칸이 당겨져도 읽히게)
  function parseOrders(rows, firstRow) {
    const L = LAYOUT.order;
    const lines = [];
    let day = null;
    rows.forEach((r, i) => {
      if (!r) return;
      day = nextDay(r[L.date], day);
      const product = str(r[L.product]);
      if (!product || product === '상품명' || !/[가-힣a-zA-Z]/.test(product)) return;
      const qty = str(r[L.qty]);
      let j = L.qty + 1;
      while (j < r.length && str(r[j]) === '') j++;
      const priceCell = r[j];
      const price = parseAmount(priceCell);
      const rest = r.slice(j + 1).map(str);
      const texts = rest.filter(v => v && !isTel(v) && parseAmount(v) == null);
      const tel = rest.find(isTel) || '';
      // 수량도 전화번호도 없는 줄은 주문이 아니라 메모·계산 줄
      if (!isQty(qty) && !isCancelText(qty) && !tel) return;
      lines.push({
        row: firstRow + i, day, product, key: productKey(product), qty,
        canceled: isCancelText(qty) || isCancelText(priceCell) || isCancelText(r[L.color]),
        price, orderer: texts[0] || '', receiver: texts[1] || '', tel,
      });
    });
    return lines;
  }

  // ---------- 정산서 읽기 ----------
  // 줄 종류: product(상품) / payment(입금) / subtotal(누계) / adjust(취소·반품·차감 등 조정)
  function parseSettlement(rows, firstRow) {
    const L = LAYOUT.settle;
    const items = [];
    let day = null;
    rows.forEach((r, i) => {
      if (!r) return;
      day = nextDay(r[L.date], day);
      const row = firstRow + i;
      const product = str(r[L.product]);
      const label = str(r[L.label]);
      const amountCell = r[L.amount];
      const amount = parseAmount(amountCell);
      if (product) {
        items.push({
          type: 'product', row, day, product, key: productKey(product), qty: str(r[L.qty]),
          price: amount, canceled: amount == null && isCancelText(amountCell), priceText: str(amountCell),
          orderer: str(r[L.orderer]), receiver: str(r[L.receiver]), tel: str(r[L.tel]), memo: str(r[L.memo]),
        });
      } else if (/입금/.test(label) && amount != null) {
        items.push({ type: 'payment', row, day, label, amount: -Math.abs(amount), writtenAmount: amount });
      } else if (amount != null) {
        const isSubtotal = !label || parseAmount(label) != null || SUBTOTAL_LABELS.test(label.replace(/\s/g, ''));
        items.push(isSubtotal ? { type: 'subtotal', row, day, value: amount } : { type: 'adjust', row, day, label, amount });
      }
    });
    return items;
  }

  // ---------- 누계 검산 ----------
  // 누계 줄마다: 직전 누계 + 사이에 있는 상품 금액·조정·입금 = 적힌 누계 인지
  function checkSubtotals(items) {
    const out = [];
    let prev = null, acc = 0, notes = [];
    for (const it of items) {
      if (it.type === 'product') { if (it.price != null) acc += it.price; }
      else if (it.type === 'adjust' || it.type === 'payment') {
        acc += it.amount;
        if (it.type === 'payment' && it.writtenAmount > 0) notes.push(`${it.row}행 입금액이 +로 적혀 있어 -로 계산했어요`);
      } else if (it.type === 'subtotal') {
        if (prev != null) {
          const expected = prev + acc, diff = it.value - expected;
          if (diff !== 0) {
            const looksPayment = diff <= -1000000 && diff % 100000 === 0;
            out.push({ row: it.row, day: it.day, written: it.value, expected, diff, kind: looksPayment ? 'missing_payment' : 'sum_error' });
          } else if (notes.length) {
            out.push({ row: it.row, day: it.day, written: it.value, expected, diff: 0, kind: 'note', note: notes.join(', ') });
          }
        }
        prev = it.value; acc = 0; notes = [];
      }
    }
    return out;
  }

  // ---------- 단가 기준표 ----------

  function parsePriceTable(rows) {
    let h = rows.findIndex(r => r && r.some(c => /상품/.test(str(c))) && r.some(c => /단가/.test(str(c))));
    if (h < 0) return null;
    const head = rows[h].map(str);
    const nameCol = head.findIndex(c => /상품/.test(c));
    const priceCol = head.findIndex(c => /단가/.test(c) && !/이전|예전/.test(c));
    const sinceCol = head.findIndex(c => /적용|시작일/.test(c));
    const prevCol = head.findIndex(c => /이전|예전/.test(c) && /단가/.test(c));
    const table = new Map();
    for (const r of rows.slice(h + 1)) {
      const name = str(r && r[nameCol]), price = parseAmount(r && r[priceCol]);
      if (!name || price == null) continue;
      table.set(productKey(name), {
        name, price,
        since: sinceCol >= 0 ? parseDay(r[sinceCol]) : null,
        prevPrice: prevCol >= 0 ? parseAmount(r[prevCol]) : null,
      });
    }
    return table;
  }

  // 그 날짜에 맞는 기준 단가: 적용 시작일 전이면 이전 단가 (이전 단가가 없으면 비교 안 함)
  function refPriceOn(entry, day) {
    if (!entry) return null;
    if (entry.since != null && day != null && day < entry.since) return entry.prevPrice ?? null;
    return entry.price;
  }

  // 지난 데이터로 기준표 초안 만들기: 상품별 가장 최근에 쓰인 단가
  function makePriceDraft(orders, settleItems) {
    const groups = new Map();
    const add = (key, name, day, price) => {
      if (!key || price == null || price <= 0 || day == null) return;
      if (!groups.has(key)) groups.set(key, { names: new Map(), hits: [] });
      const g = groups.get(key);
      const label = productLabel(name);
      g.names.set(label, (g.names.get(label) || 0) + 1);
      g.hits.push({ day, price });
    };
    orders.forEach(o => { if (!o.canceled) add(o.key, o.product, o.day, o.price); });
    settleItems.forEach(s => { if (s.type === 'product') add(s.key, s.product, s.day, s.price); });

    const mode = list => {
      const m = new Map();
      list.forEach(p => m.set(p, (m.get(p) || 0) + 1));
      return [...m].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0];
    };
    const draft = [];
    for (const [key, g] of groups) {
      g.hits.sort((a, b) => a.day - b.day);
      const recent = g.hits.slice(-15).map(h => h.price);
      const [latest, latestCount] = mode(recent);
      // 최신 단가가 쓰이기 시작한 날: 마지막으로 다른 단가(한 번뿐인 예외 제외)가 쓰인 다음
      const others = g.hits.filter(h => h.price !== latest);
      const otherMode = others.length ? mode(others.map(h => h.price)) : null;
      const lastOther = otherMode && otherMode[1] >= 2 ? [...g.hits].reverse().find(h => h.price === otherMode[0]) : null;
      const since = g.hits.find(h => h.price === latest && (!lastOther || h.day > lastOther.day));
      const name = [...g.names].sort((a, b) => b[1] - a[1])[0][0];
      const warn = [];
      if (g.hits.length < 3) warn.push('건수 적음');
      if (latestCount / recent.length < 0.8) warn.push('최근 단가 여러 개');
      draft.push({
        key, name, price: latest, since: since ? since.day : null,
        prevPrice: lastOther ? otherMode[0] : null, count: g.hits.length, warn: warn.join(', '),
      });
    }
    return draft.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  }

  // ---------- 점검 ----------

  const gap = (a, b) => (a.day == null || b.day == null ? 0 : Math.abs(a.day - b.day));

  // 정산서 상품 줄 ↔ 발주서 줄 1:1 연결
  function matchLines(sLines, orders) {
    const usedO = new Set();
    const link = new Map(); // 정산서 줄 → { o, how }
    const index = keyFn => {
      const m = new Map();
      orders.forEach((o, i) => { const k = keyFn(o); if (!k) return; if (!m.has(k)) m.set(k, []); m.get(k).push(i); });
      return m;
    };
    const pass = (how, keyFn, maxGap, extraOk) => {
      const idx = index(keyFn);
      for (const s of sLines) {
        if (link.has(s)) continue;
        const cands = idx.get(keyFn(s)) || [];
        let best = -1, bestGap = Infinity;
        for (const i of cands) {
          if (usedO.has(i)) continue;
          const o = orders[i], g = gap(s, o);
          if (g > maxGap || (extraOk && !extraOk(s, o))) continue;
          if (g < bestGap) { best = i; bestGap = g; }
        }
        if (best >= 0) { usedO.add(best); link.set(s, { o: orders[best], oi: best, how }); }
      }
    };
    const person = x => normName(x.receiver) + '|' + telDigits(x.tel);
    pass('same', x => x.key + '|' + person(x), OPTIONS.matchDays);
    pass('product_diff', x => (telDigits(x.tel) ? person(x) : ''), OPTIONS.nearDays);
    pass('name_diff', x => x.key, OPTIONS.nearDays, (s, o) =>
      (telDigits(s.tel) && telDigits(s.tel) === telDigits(o.tel)) ||
      (normName(s.receiver) && normName(s.receiver) === normName(o.receiver)) ||
      (normName(s.orderer) && normName(s.orderer) === normName(o.orderer)));
    return { link, usedO };
  }

  function findPayments(items) {
    return items.filter(it => it.type === 'payment');
  }

  // 점검 구간: opts.fromPaymentRow 입금 줄 다음 ~ 그다음 입금 줄 전 (= 한 번의 정산분)
  // fromPaymentRow가 없으면 마지막 입금 이후. opts.toRow로 끝을 직접 정할 수도 있음(Infinity = 파일 끝까지)
  function check(orders, items, prices, opts) {
    opts = opts || {};
    const payments = findPayments(items);
    const fromRow = opts.fromPaymentRow != null ? opts.fromPaymentRow
      : (payments.length ? payments[payments.length - 1].row : -Infinity);
    const next = payments.find(p => p.row > fromRow);
    const toRow = opts.toRow != null ? opts.toRow : (next ? next.row : Infinity);
    const inScope = it => it.row > fromRow && it.row < toRow;

    const sLines = items.filter(it => it.type === 'product');
    const { link } = matchLines(sLines, orders);
    const scopeLines = sLines.filter(inScope);
    const scopeItems = items.filter(inScope);
    const adjusts = scopeItems.filter(it => it.type === 'adjust');
    const usedAdjust = new Set();
    const findings = [];
    const add = (status, s, o, extra) => findings.push({ status, s, o, ...extra });

    // 같은 주문(키)이 정산서에 몇 번 연결됐는지 — 남는 줄은 중복 청구
    const matchedKeys = new Set([...link.keys()].map(s => s.key + '|' + normName(s.receiver) + '|' + telDigits(s.tel)));
    const orderDays = orders.map(o => o.day).filter(d => d != null).sort((a, b) => a - b);
    const firstOrderDay = orderDays[Math.floor(orderDays.length * 0.01)];
    const laterAdjusts = items.filter(it => it.type === 'adjust');
    const canceledCharged = [];

    const okLines = [];
    for (const s of scopeLines) {
      const m = link.get(s);
      const entry = prices && prices.get(s.key);
      const refPrice = refPriceOn(entry, s.day);
      const ref = refPrice != null ? { price: refPrice } : null;
      const before = findings.length;
      if (!m) {
        if (s.day != null && s.day < firstOrderDay) { add('out_of_range', s, null); continue; } // 발주서에 없는 기간
        const k = s.key + '|' + normName(s.receiver) + '|' + telDigits(s.tel);
        add(matchedKeys.has(k) ? 'dup_charge' : 'no_order', s, null, { ref: ref && ref.price });
        continue;
      }
      const o = m.o;
      if (m.how !== 'same') add(m.how, s, o);

      if (o.canceled) {
        if (s.canceled || !s.price) { okLines.push(s); continue; }
        canceledCharged.push({ s, o }); // 아래에서 '○○ 취소 -금액' 조정 줄로 뺐는지 확인
        continue;
      }
      if (s.canceled) { add('cancel_mismatch', s, o); continue; }

      if (s.price != null) {
        const oPrice = o.price;
        if (oPrice != null && s.price !== oPrice) {
          if (ref && ref.price === s.price) add('order_price_diff', s, o, { ref: ref.price });
          else add('price_wrong', s, o, { ref: ref && ref.price, correct: oPrice });
        } else if (ref && s.price !== ref.price) {
          add('price_vs_ref', s, o, { ref: ref.price });
        } else if (!entry && prices) {
          add('no_ref', s, o);
        }
      }
      if (findings.length === before) okLines.push(s);
    }

    // 취소된 주문이 청구됐으면, 뒤쪽 조정 줄에서 이름이 들어간 '취소 -금액'을 찾음
    // 같은 사람 여러 줄을 한 번에 뺀 경우(예: 67,000 + 1,500 = -68,500)도 인정
    const byPerson = new Map();
    for (const c of canceledCharged) {
      const k = normName(c.o.receiver) + '|' + telDigits(c.o.tel) + '|' + c.o.day;
      if (!byPerson.has(k)) byPerson.set(k, []);
      byPerson.get(k).push(c);
    }
    for (const group of byPerson.values()) {
      const names = [...new Set(group.flatMap(c => [c.s.receiver, c.s.orderer, c.o.receiver, c.o.orderer]).map(normName).filter(n => n.length >= 2))];
      const firstRow = group[0].s.row;
      const total = group.reduce((t, c) => t + c.s.price, 0);
      const hasName = a => names.some(n => normName(a.label).includes(n));
      const whole = laterAdjusts.find(a => !usedAdjust.has(a) && a.row > firstRow && a.amount === -total && hasName(a));
      if (whole) {
        usedAdjust.add(whole);
        group.forEach(c => add('cancel_offset', c.s, c.o, { adjRow: whole.row }));
        continue;
      }
      for (const c of group) {
        const one = laterAdjusts.find(a => !usedAdjust.has(a) && a.row > c.s.row && a.amount === -c.s.price && hasName(a));
        if (one) { usedAdjust.add(one); add('cancel_offset', c.s, c.o, { adjRow: one.row }); }
        else add('canceled_charged', c.s, c.o);
      }
    }

    // 점검 기간 안에서 발주했는데 청구 안 된 주문
    const billed = new Set([...link.values()].map(v => v.oi));
    const days = scopeLines.map(s => s.day).filter(d => d != null);
    const startDay = days.length ? Math.min(...days) : null, endDay = days.length ? Math.max(...days) : null;
    orders.forEach((o, i) => {
      // 금액이 비어 있는 줄은 다른 공장(히트가구 등) 상품이라 제외
      if (billed.has(i) || o.canceled || o.day == null || startDay == null || !(o.price > 0)) return;
      if (o.day >= startDay && o.day <= endDay) add('not_billed', null, o);
    });

    const subtotalIssues = checkSubtotals(items).filter(inScope);
    subtotalIssues.forEach(x => findings.push({ status: x.kind === 'sum_error' ? 'sum_error' : x.kind === 'missing_payment' ? 'missing_payment' : 'sum_note', sub: x }));
    adjusts.filter(a => !usedAdjust.has(a)).forEach(a => findings.push({ status: 'adjust', adj: a }));

    return {
      fromRow, toRow, payments, scopeLines, okLines, findings, startDay, endDay,
      boundary: checkBoundary(scopeLines, orders, link, fromRow),
      money: summarizeMoney(items, fromRow, toRow, findings),
    };
  }

  // 시작 행·끝 행이 발주서와 같은 내용으로 맞물리는지
  function checkBoundary(scopeLines, orders, link, fromRow) {
    if (!scopeLines.length) return null;
    const billedWhere = new Map(); // 발주서 순번 → 정산서 줄
    for (const [s, m] of link) billedWhere.set(m.oi, s);
    const describe = (s, which) => {
      const m = link.get(s);
      if (!m) return { which, ok: false, s, text: `정산서 ${which} 줄(${s.row}행)을 발주서에서 찾지 못했어요.` };
      const res = { which, ok: m.how === 'same', s, o: m.o, missing: [] };
      if (which === '첫') {
        // 바로 앞 발주 줄들이 지난 정산에 들어갔는지 — 사이에 빠진 줄은 없는지
        for (let i = m.oi - 1; i >= 0; i--) {
          const o = orders[i], sb = billedWhere.get(i);
          if (o.canceled) continue;
          if (sb) { res.prev = { o, s: sb, inPrev: sb.row <= fromRow }; break; }
          res.missing.unshift(o);
          if (res.missing.length >= 20) break;
        }
        if (res.prev && !res.prev.inPrev) res.ok = false;
      } else {
        // 마지막 줄 뒤로, 같은 날(또는 그 전) 발주인데 청구 안 된 줄
        for (let i = m.oi + 1; i < orders.length; i++) {
          const o = orders[i];
          if (o.canceled) continue;
          if (o.day != null && s.day != null && o.day > s.day) { res.next = o; break; } // 다음 날 발주부터는 다음 정산 몫
          if (billedWhere.has(i)) continue;
          res.missing.push(o);
          if (res.missing.length >= 20) break;
        }
      }
      if (res.missing.length) res.ok = false;
      return res;
    };
    return { first: describe(scopeLines[0], '첫'), last: describe(scopeLines[scopeLines.length - 1], '마지막') };
  }

  function summarizeMoney(items, fromRow, toRow, findings) {
    const subs = items.filter(it => it.type === 'subtotal' && it.row < toRow);
    const last = subs[subs.length - 1];
    const trailing = last ? items.filter(it => it.row > last.row && it.row < toRow && it.type !== 'subtotal') : [];
    const written = last ? last.value : null;
    // 누계 계산 실수를 바로잡은 금액 (틀린 누계 뒤로는 틀린 값이 이어지므로 차이만큼 빼면 됨)
    // 입금 줄이 빠진 것으로 보이는 곳은 입금으로 인정
    let recomputed = written;
    for (const f of findings) if (f.status === 'sum_error') recomputed -= f.sub.diff;
    // 누계 줄 없이 끝에 붙은 줄이 있으면 더함
    for (const it of trailing) {
      if (it.type === 'product' && it.price != null) recomputed += it.price;
      if (it.type === 'adjust' || it.type === 'payment') recomputed += it.amount;
    }
    // 문제 건을 바로잡으면 달라지는 금액 (청구가 많으면 +)
    let overcharge = 0;
    for (const f of findings) {
      if (f.status === 'no_order' || f.status === 'dup_charge' || f.status === 'canceled_charged') overcharge += f.s.price || 0;
      if (f.status === 'price_wrong') overcharge += f.s.price - f.correct;
    }
    return { written, writtenRow: last && last.row, trailingLines: trailing.length, recomputed, overcharge, suggested: recomputed - overcharge };
  }

  const api = {
    LAYOUT, OPTIONS, parseAmount, parseDay, dayToString, normName, telDigits, isTel, productKey, productLabel,
    parseOrders, parseSettlement, checkSubtotals, parsePriceTable, refPriceOn, makePriceDraft, matchLines, findPayments, check,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Settle = api;
})(typeof window !== 'undefined' ? window : globalThis);
