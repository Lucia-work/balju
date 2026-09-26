// 발주서 제품명 통일 규칙 — 화면과 무관한 순수 함수들 (Node 테스트에서도 사용)
// 쇼핑몰 주문 파일 → 미니미니멀 발주서 줄. 상품명은 제품명 기준시트(옵션 → 발주서 이름)로 바꿈.
(function (root) {
  // 발주서 양식 칸 (순서 그대로 엑셀에 씀)
  const COLUMNS = ['주문번호', '쇼핑몰명', '생산처', '상품명', '색상', '수량', '박스', '주문자명', '수취인명',
    '수취인연락처1', '수취인연락처2', '수취인우편번호', '수취인 주소', '메세지', '선불비', '착불비', '제품비', '고객 요구사항'];

  // 발주서에 쇼핑몰을 적는 순서
  const MALL_ORDER = ['미니미니멀', '깔꾸미', '오늘의집'];

  // 쇼핑몰별 주문 파일 읽는 법. 칸은 제목(첫 줄 이름)으로 찾음 — 칸 순서가 바뀌어도 괜찮음.
  // 새 쇼핑몰을 붙일 때는 여기에 하나 추가하면 됨.
  const SOURCES = {
    smartstore: {
      label: '스마트스토어',
      detect: h => h.includes('상품주문번호') && h.includes('옵션정보'),
      // 스마트스토어 계정이 둘: 옵션 이름에 '깔꾸미'가 들어 있으면 깔꾸미 가게 파일
      mall: lines => (lines.some(l => /깔꾸미/.test(l.option + l.product)) ? '깔꾸미' : '미니미니멀'),
      fields: {
        orderNo: '주문번호', kind: '상품종류', option: '옵션정보', product: '상품명', qty: '수량',
        orderer: '구매자명', receiver: '수취인명', tel1: '수취인연락처1', tel2: '수취인연락처2', buyerTel: '구매자연락처',
        zip: '우편번호', address: '통합배송지', message: '배송메세지', status: '주문상태', detail: '주문세부상태',
      },
      isAddon: l => l.kind === '추가구성상품',
    },
    ohou: {
      label: '오늘의집',
      detect: h => h.includes('주문옵션번호') && h.includes('옵션명'),
      mall: () => '오늘의집',
      fields: {
        orderNo: '주문번호', option: '옵션명', product: '상품명', qty: '수량',
        orderer: '주문자명', buyerTel: '주문자 연락처', receiver: '수취인명', tel1: '수취인 연락처',
        zip: '수취인 우편번호', address: '수취인 주소', address2: '수취인 주소상세', message: '배송메모', status: '주문상태',
      },
      isAddon: l => /^추가상품/.test(clean(l.option)),
    },
  };

  const COLOR_PART = /^[^:]*(색상|컬러|색깔)[^:]*:/; // '색상: 오크', '색상 선택: 화이트', '상판컬러: 마블'
  const SKIP_STATUS = /취소|반품|교환/;

  // ---------- 글자 정리 ----------

  const str = v => (v == null ? '' : String(v).trim());
  const compact = s => str(s).replace(/\s+/g, '');

  // 이모지·장식 기호를 빼고, 띄어쓰기와 ' / ', ': ' 모양을 통일
  function clean(s) {
    return str(s)
      .replace(/[\p{Extended_Pictographic}\u{1F000}-\u{1FAFF}️‍⃣]/gu, ' ')
      .replace(/\s+/g, ' ')
      .replace(/\s*\/\s*/g, ' / ')
      .replace(/\s*:\s*/g, ': ')
      .trim();
  }

  // 색상 라벨 통일: '색상 선택: 화이트', '컬러: 화이트' → '색상: 화이트' ('상판컬러'처럼 다른 뜻의 라벨은 그대로)
  const unifyColorLabel = p => p.replace(/^(색상\s*선택|색상|컬러|색깔)\s*:/, '색상:');

  // '... / 색상 선택: 화이트' → { base: '...', color: '색상: 화이트' }
  // 색상 부분은 제품명 기준시트에 넣지 않고 그대로 뒤에 붙임 → 색상만 다른 건 따로 가르칠 필요 없음
  function splitColor(text) {
    const parts = clean(text).split(' / ').filter(Boolean);
    const isColor = (p, k) => k > 0 && COLOR_PART.test(p);
    return {
      base: parts.filter((p, k) => !isColor(p, k)).join(' / '),
      color: parts.filter(isColor).map(unifyColorLabel).join(' / '),
    };
  }

  const mapKey = (mall, base) => `${compact(mall)}|${compact(base)}`;
  const joinName = (name, color) => (color ? `${clean(name)} / ${color}` : clean(name));

  function telDigits(v) { return str(v).replace(/\D/g, ''); }
  const isSafeNumber = v => /^050/.test(telDigits(v)); // 네이버 안심번호

  function zipText(v) {
    const s = str(v);
    return /^\d{1,5}$/.test(s) ? s.padStart(5, '0') : s;
  }

  // ---------- 제품명 기준시트 ----------

  // entries: [{ mall, raw, name }] 여러 묶음을 뒤에 오는 것이 이기도록 합침 (name 이 비면 지움)
  function buildMap(...lists) {
    const map = new Map();
    for (const list of lists) for (const e of list || []) {
      if (!e || !str(e.raw)) continue;
      if (!str(e.name)) { map.delete(mapKey(e.mall, e.raw)); continue; }
      map.set(mapKey(e.mall, e.raw), { mall: str(e.mall), raw: clean(e.raw), name: clean(e.name) });
    }
    return map;
  }

  // ---------- 주문 파일 읽기 ----------

  // rows: 시트의 줄 배열(header:1). 제목 줄을 찾아 쇼핑몰을 알아냄.
  function parseOrderFile(rows, firstRow = 1) {
    for (let h = 0; h < Math.min(rows.length, 15); h++) {
      const header = rows[h].map(str);
      for (const [id, src] of Object.entries(SOURCES)) {
        if (!src.detect(header)) continue;
        const col = {};
        for (const [k, title] of Object.entries(src.fields)) col[k] = header.indexOf(title);
        const lines = [];
        for (let i = h + 1; i < rows.length; i++) {
          const r = rows[i], get = k => (col[k] >= 0 ? str(r[col[k]]) : '');
          if (!get('option') && !get('product')) continue;
          const l = {
            row: firstRow + i, source: id, orderNo: get('orderNo'), kind: get('kind'),
            option: get('option') || get('product'), product: get('product'),
            qty: parseInt(get('qty'), 10) || 1,
            orderer: get('orderer'), receiver: get('receiver'),
            tel1: get('tel1'), tel2: get('tel2'), buyerTel: get('buyerTel'),
            zip: zipText(get('zip')), address: [get('address'), get('address2')].filter(Boolean).join(' '),
            message: get('message'),
            status: [get('status'), get('detail')].filter(Boolean).join(' / '),
          };
          l.isAddon = src.isAddon(l);
          lines.push(l);
        }
        const mall = src.mall(lines);
        lines.forEach(l => { l.mall = mall; });
        return { source: id, label: src.label, mall, lines };
      }
    }
    return null;
  }

  // ---------- 변환 ----------

  // 쇼핑몰 순서 → 올린 순서 → 같은 주문 안에서는 본품 먼저, 추가상품 뒤
  function sortLines(lines, mallOrder = MALL_ORDER) {
    const rank = m => { const i = mallOrder.indexOf(m); return i < 0 ? mallOrder.length : i; };
    const firstSeen = new Map();
    lines.forEach((l, i) => {
      const g = l.orderNo ? `${l.mall}|${l.orderNo}` : `#${i}`;
      if (!firstSeen.has(g)) firstSeen.set(g, i);
      l._group = g;
      l._i = i;
    });
    return [...lines].sort((a, b) => rank(a.mall) - rank(b.mall)
      || firstSeen.get(a._group) - firstSeen.get(b._group)
      || (a.isAddon - b.isAddon)
      || a._i - b._i);
  }

  // lines → 발주서 줄(수량 2 이상은 2_1, 2_2 로 나눔) + 처음 보는 옵션 목록 + 뺀 줄
  function convert(lines, map, opts = {}) {
    const out = [], skipped = [], unknown = new Map();
    for (const l of sortLines(lines, opts.mallOrder)) {
      if (SKIP_STATUS.test(l.status)) { skipped.push({ line: l, reason: l.status }); continue; }
      const { base, color } = splitColor(l.option);
      const key = mapKey(l.mall, base);
      const hit = map.get(key);
      if (!hit) {
        const u = unknown.get(key) || { key, mall: l.mall, raw: base, colors: new Set(), count: 0 };
        if (color) u.colors.add(color);
        u.count += l.qty;
        unknown.set(key, u);
      }
      const notes = [];
      let tel2 = l.tel2;
      if (!tel2 && isSafeNumber(l.tel1) && l.buyerTel && telDigits(l.buyerTel) !== telDigits(l.tel1)) {
        tel2 = l.buyerTel;
        notes.push('안심번호라 연락처2에 구매자 번호');
      }
      const common = {
        line: l, key, base, color, known: !!hit, name: hit ? joinName(hit.name, color) : '', notes,
        values: {
          '쇼핑몰명': l.mall, '주문자명': l.orderer, '수취인명': l.receiver, '수취인연락처1': l.tel1,
          '수취인연락처2': tel2, '수취인우편번호': l.zip, '수취인 주소': l.address, '메세지': l.message,
        },
      };
      if (l.qty > 1) for (let k = 1; k <= l.qty; k++) out.push({ ...common, qty: `${l.qty}_${k}` });
      else out.push({ ...common, qty: l.qty });
    }
    return {
      out, skipped,
      unknown: [...unknown.values()].map(u => ({ ...u, colors: [...u.colors] })),
    };
  }

  // 발주서 엑셀에 쓸 줄 (COLUMNS 순서)
  function toSheetRow(o) {
    const v = { ...o.values, '상품명': o.name || joinName(o.base, o.color), '수량': o.qty };
    return COLUMNS.map(c => v[c] ?? '');
  }

  // ---------- 처음 제품명 기준시트 만들기: 원본 주문 파일 ↔ 어머니가 고친 발주서 ----------

  // 두 글자씩 겹치는 정도 (0~1) — 한 주문 안에서 어느 줄끼리 짝인지 고를 때만 씀
  function similarity(a, b) {
    const grams = s => { const c = compact(s), g = []; for (let i = 0; i < c.length - 1; i++) g.push(c.slice(i, i + 2)); return g; };
    const ga = grams(a), gb = grams(b);
    if (!ga.length || !gb.length) return 0;
    const pool = new Map();
    gb.forEach(g => pool.set(g, (pool.get(g) || 0) + 1));
    let hit = 0;
    for (const g of ga) if (pool.get(g)) { hit++; pool.set(g, pool.get(g) - 1); }
    return (2 * hit) / (ga.length + gb.length);
  }

  // orderRows: 발주서 시트 줄(header:1, 첫 줄이 제목).
  // convert 와 같은 순서로 늘어놓은 뒤, 쇼핑몰별로 주문 단위로 짝지음. 한 주문 안에서는 이름이 가장 비슷한 줄끼리.
  function learnFromPair(lines, orderRows, opts = {}) {
    const header = orderRows[0].map(str);
    const iName = header.indexOf('상품명'), iRecv = header.indexOf('수취인명'), iMall = header.indexOf('쇼핑몰명');
    const body = orderRows.slice(1).filter(r => str(r[iName]));
    const fix = opts.fixName || (s => s);

    const planned = convert(lines, new Map(), opts).out;
    const cursor = new Map(); // 쇼핑몰별로 발주서에서 어디까지 썼는지
    const rowsOf = mall => body.filter(r => (iMall < 0 ? true : compact(r[iMall]) === compact(mall)));

    const found = new Map(), conflicts = [], skipped = [];
    const learn = (o, r) => {
      const target = splitColor(fix(r[iName]));
      let name = clean(fix(r[iName]));
      if (o.color && compact(target.color) === compact(o.color)) name = target.base;
      else if (o.color) { conflicts.push({ raw: o.base, names: [name], why: '색상이 원본과 다름' }); return; }
      const prev = found.get(o.key);
      if (prev && compact(prev.name) !== compact(name)) conflicts.push({ raw: o.base, names: [prev.name, name], why: '같은 옵션이 다른 이름으로 적힘' });
      else if (!prev) found.set(o.key, { mall: o.line.mall, raw: o.base, name });
    };

    for (let i = 0; i < planned.length;) {
      const g = planned[i].line._group;
      let j = i;
      while (j < planned.length && planned[j].line._group === g) j++;
      const group = planned.slice(i, j), mall = group[0].line.mall;
      const rows = rowsOf(mall), at = cursor.get(mall) || 0;
      const mine = rows.slice(at, at + group.length);
      cursor.set(mall, at + group.length);
      i = j;
      if (mine.length < group.length || mine.some(r => compact(r[iRecv]) !== compact(group[0].line.receiver))) {
        skipped.push(...group);
        continue;
      }
      // 한 주문 안: 이름이 가장 비슷한 것부터 짝지음
      const pairs = [];
      group.forEach((o, a) => mine.forEach((r, b) => pairs.push([similarity(o.base, r[iName]), a, b])));
      pairs.sort((x, y) => y[0] - x[0]);
      const usedA = new Set(), usedB = new Set();
      for (const [, a, b] of pairs) {
        if (usedA.has(a) || usedB.has(b)) continue;
        usedA.add(a); usedB.add(b);
        learn(group[a], mine[b]);
      }
    }
    return { entries: [...found.values()], conflicts, skipped };
  }

  const api = {
    COLUMNS, MALL_ORDER, SOURCES, clean, splitColor, mapKey, joinName, isSafeNumber, zipText,
    buildMap, parseOrderFile, sortLines, convert, toSheetRow, similarity, learnFromPair,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.OrderRules = api;
})(typeof window !== 'undefined' ? window : globalThis);
