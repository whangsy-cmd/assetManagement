// 브로커별(미래에셋/키움 국내·해외) 붙여넣기 텍스트 파서 모음
// ── 공통 전처리 ──────────────────────────────────────────────
export function cleanNumber(str) {
  return parseFloat(String(str).replace(/["',+%]/g, '').trim()) || 0
}
export function cleanAccount(str) {
  return String(str).replace(/^'/, '').trim()
}
export function cleanCode(str) {
  return String(str).replace(/^'/, '').trim()
}

// ── 포맷 1: 미래에셋 보유종목 ────────────────────────────────
// col: 계좌번호[0] · 구분[1] · 종목명[2] · 현재가[3] · 보유량[4]
//       매입금액[5] · 평가금액[6] · 평가손익[7] · 수익률[8]
export function parseMiraeHoldings(text) {
  const lines = text.trim().split('\n').slice(1) // 헤더 제거
  const result = []
  for (const line of lines) {
    const cols = line.split('\t')
    if (cols.length < 9) continue
    if (cols[1]?.trim() !== '현금') continue // 현금 행만
    result.push({
      accountId: cleanAccount(cols[0]),
      name: cols[2]?.trim(),
      qty: cleanNumber(cols[4]),
      purchaseAmt: cleanNumber(cols[5]),
      evalAmt: cleanNumber(cols[6]),
      gainLoss: cleanNumber(cols[7]),
      returnRate: cleanNumber(cols[8]),
    })
  }
  return result
}

// ── 포맷 2: 키움 국내 보유종목 ──────────────────────────────
// col: [0]공백 · 종목코드[1] · 종목명[2] · 등락률[3] · 평가손익[4]
//       수익률[5] · 평가금액[6] · 매입금액[7] · 보유비중[8] · 보유수량[9]
export function parseKiwoomKrHoldings(text) {
  const lines = text.trim().split('\n').slice(1)
  const result = []
  for (const line of lines) {
    const cols = line.split('\t')
    if (cols.length < 10) continue
    const code = cleanCode(cols[1])
    if (!code) continue
    result.push({
      code,
      name: cols[2]?.trim(),
      gainLoss: cleanNumber(cols[4]),
      returnRate: cleanNumber(cols[5]),
      evalAmt: cleanNumber(cols[6]),
      purchaseAmt: cleanNumber(cols[7]),
      qty: cleanNumber(cols[9]),
    })
  }
  return result
}

// ── 포맷 3: 키움 해외 보유종목 ──────────────────────────────
// col: 종목코드[0] · 종목명[1] · 등락률[2] · 평가수익률[3]
//       평가손익(원)[4] · 평가금액(원)[5] · 보유량[6] · 매입금액(원)[7]
export function parseKiwoomUsHoldings(text) {
  const lines = text.trim().split('\n').slice(1)
  const result = []
  for (const line of lines) {
    const cols = line.split('\t')
    if (cols.length < 8) continue
    const code = cleanCode(cols[0])
    if (!code) continue
    result.push({
      code,
      name: cols[1]?.trim(),
      returnRate: cleanNumber(cols[3]),
      gainLoss: cleanNumber(cols[4]),
      evalAmt: cleanNumber(cols[5]),
      qty: cleanNumber(cols[6]),
      purchaseAmt: cleanNumber(cols[7]),
    })
  }
  return result
}

// ── 포맷 4: 미래에셋 예수금 ─────────────────────────────────
// col: 계좌번호[0] · 예수금총액[1] · D+1[2] · D+2[3] · 출금가능[4]
export function parseMiraeCash(text) {
  const lines = text.trim().split('\n').slice(1)
  const result = []
  for (const line of lines) {
    const cols = line.split('\t')
    if (cols.length < 4) continue
    const accountId = cleanAccount(cols[0])
    if (!accountId) continue
    result.push({
      accountId,
      amount: cleanNumber(cols[3]),
    })
  }
  return result
}

// ── 포맷 5: 키움 국내 예수금 ────────────────────────────────
// 비정형: "D + 2" 라벨 행 → col[1] = D+2 예수금
export function parseKiwoomKrCash(text) {
  const lines = text.trim().split('\n')
  for (const line of lines) {
    const cols = line.split('\t')
    const label = cols[0]?.replace(/\s/g, '')
    if (label === 'D+2') {
      return cleanNumber(cols[1])
    }
  }
  return 0
}

// 거래번호 없는 수기 붙여넣기 포맷 공용 — 날짜+시간만으론 동시각 복수건이 충돌할 수 있어 적요/금액도 섞음
function makeTradeNo(dateRaw, time, memo, amount) {
  return `${dateRaw.replace(/\//g, '')}${time.replace(/:/g, '')}_${memo}_${amount}`
}

// 키움 입출금내역 계열 공용 파서 — 헤더 라벨로 컬럼 위치 찾아 레코드당 1줄씩 읽음
// 통화 컬럼이 KRW면 원화 금액/잔고 컬럼, 그 외(USD 등)면 외화 금액/잔고 컬럼이 실제 값 (세금 등 이미 반영된 순액 기준)
function parseKiwoomCashFlowLines(text, cfg) {
  const lines = text.trim().split('\n').map(l => l.split('\t'))
  const headerA = lines.findIndex(c => c[0]?.trim() === cfg.dateCol)
  if (headerA === -1) return []

  const norm = s => (s ?? '').replace(/^'/, '').trim()
  const idx = name => lines[headerA].findIndex(c => norm(c) === name)

  const cDate = idx(cfg.dateCol), cRmrk = idx(cfg.rmrkCol), cCrnc = idx(cfg.crncCol),
        cAmt = idx(cfg.amtCol), cFcAmt = idx(cfg.fcAmtCol),
        cBal = idx(cfg.balCol), cFcBal = idx(cfg.fcBalCol), cTime = idx(cfg.timeCol),
        cDealTp = cfg.dealTpCol ? idx(cfg.dealTpCol) : -1,
        cRate = cfg.rateCol ? idx(cfg.rateCol) : -1

  const result = []
  for (let i = headerA + 1; i < lines.length; i++) {
    const cols = lines[i]
    const dateRaw = cols[cDate]?.trim()
    if (!/^\d{4}\/\d{2}\/\d{2}$/.test(dateRaw || '')) continue
    if (cDealTp !== -1 && cols[cDealTp]?.trim() !== '입출금') continue // 매매/환전 등 입출금 아닌 거래 제외
    const rmrk = cols[cRmrk]?.trim()
    if (!rmrk) continue
    if (cfg.excludeRmrk?.some(s => rmrk.includes(s))) continue // 결제차금/수수료 등 실제 입출금 아닌 정산 항목 제외
    const crnc = cols[cCrnc]?.trim() || 'USD'
    const isKrw = crnc === 'KRW'
    const time = cols[cTime]?.trim() || ''
    const amount = cleanNumber(isKrw ? cols[cAmt] : cols[cFcAmt])
    if (!amount) continue
    const row = {
      date: dateRaw.replace(/\//g, '-'),
      tradeNo: makeTradeNo(dateRaw, time, rmrk, amount),
      memo: rmrk,
      ioType: rmrk.endsWith('출금') ? '출금' : '입금',
      amount,
      balance: cleanNumber(isKrw ? cols[cBal] : cols[cFcBal]),
      currency: crnc,
      time,
    }
    if (cRate !== -1) {
      const rate = cleanNumber(cols[cRate])
      if (rate) row.rate = rate // 거래 시점 원화환산 환율 (있을 때만 저장 — Firestore는 undefined 거부)
    }
    result.push(row)
  }
  return result
}

// ── 포맷 7: 키움 해외 입출금내역 (붙여넣기, 레코드당 1줄) ──
// 컬럼: 거래일자 · 적요명 · 통화 · 정산금액(원화) · 정산금액(외)(외화) · 예수금잔고 · 외화예수금잔고 · 처리시간 등
export const parseKiwoomUsCashFlows = text => parseKiwoomCashFlowLines(text, {
  dateCol: '거래일자', rmrkCol: '적요명', crncCol: '통화',
  amtCol: '정산금액', fcAmtCol: '정산금액(외)', balCol: '예수금잔고', fcBalCol: '외화예수금잔고', timeCol: '처리시간',
  dealTpCol: '거래종류',
})

// ── 포맷 8: 키움 국내 선물옵션 입출금내역 (붙여넣기, 레코드당 1줄) ──
// 컬럼: 일자 · 입금액(현금/수표/대용환전/대용매도) · 출금액 · 결제내역(선물차금/옵션차금/실물인수도결제대금/수수료) · 입금액대비차액
// 실제 입출금은 "현금"(입금액 첫 서브컬럼) · "출금액" 두 컬럼뿐 — 결제내역·차액은 참고용 정산 정보라 금액 판정에 안 씀
export function parseKiwoomKrFuturesCashFlows(text) {
  const lines = text.trim().split('\n').map(l => l.split('\t'))
  const headerA = lines.findIndex(c => c[0]?.trim() === '일자')
  if (headerA === -1 || headerA + 1 >= lines.length) return []
  const headerB = headerA + 1

  const norm = s => (s ?? '').replace(/^'/, '').trim()
  const idxA = name => lines[headerA].findIndex(c => norm(c) === name)
  const idxB = name => lines[headerB].findIndex(c => norm(c) === name)

  const cDate = idxA('일자'), cWithdraw = idxA('출금액'), cDeposit = idxB('현금')
  const infoCols = [
    ['수표', idxB('수표')], ['대용환전', idxB('대용환전')], ['대용매도', idxB('대용매도')],
    ['선물차금', idxB('선물차금')], ['옵션차금', idxB('옵션차금')], ['실물인수도결제대금', idxB('실물인수도결제대금')], ['수수료', idxB('수수료')],
  ]

  const result = []
  for (let i = headerB + 1; i < lines.length; i++) {
    const cols = lines[i]
    const dateRaw = cols[cDate]?.trim()
    if (!/^\d{4}\/\d{2}\/\d{2}$/.test(dateRaw || '')) continue

    const deposit = cleanNumber(cols[cDeposit])
    const withdraw = cleanNumber(cols[cWithdraw])
    if (!deposit && !withdraw) continue

    const info = infoCols.filter(([, idx]) => cleanNumber(cols[idx])).map(([label, idx]) => `${label} ${cols[idx].replace(/"/g, '')}`).join(', ')

    if (deposit) {
      result.push({
        date: dateRaw.replace(/\//g, '-'),
        tradeNo: makeTradeNo(dateRaw, '', `입금_${info}`, deposit),
        memo: info ? `입금 (${info})` : '입금',
        ioType: '입금',
        amount: deposit,
        currency: 'KRW',
      })
    }
    if (withdraw) {
      result.push({
        date: dateRaw.replace(/\//g, '-'),
        tradeNo: makeTradeNo(dateRaw, '', `출금_${info}`, withdraw),
        memo: info ? `출금 (${info})` : '출금',
        ioType: '출금',
        amount: withdraw,
        currency: 'KRW',
      })
    }
  }
  return result
}

// ── 포맷 9: 키움 해외 선물옵션 입출금내역 (선옵 거래내역 상세 화면 붙여넣기, 레코드당 1줄) ──
// 컬럼: 거래일자 · 거래종류 · 적요 · 통화코드 · 거래금액(원화) · 거래금액(외)(외화) · 원화잔액 · 외화잔액 · 처리시간 등
export const parseKiwoomUsFuturesCashFlows = text => parseKiwoomCashFlowLines(text, {
  dateCol: '거래일자', rmrkCol: '적요', crncCol: '통화코드',
  amtCol: '거래금액', fcAmtCol: '거래금액(외)', balCol: '원화잔액', fcBalCol: '외화잔액', timeCol: '처리시간',
  dealTpCol: '거래종류', excludeRmrk: ['결제차금', '수수료'], rateCol: '거래단가/환율',
})

// ── 포맷 10: 미래에셋 입출금내역 (이체내역 붙여넣기, 2줄=1건: 출금줄/입금줄) ──
// [출금줄] 거래일 · 출금 기관명 · 출금 계좌번호 · 내계좌 메모 · 거래금액 · 처리상태 · 처리시간 · 이체확인증
// [입금줄] (공백)  · 입금 기관명 · 입금 계좌번호 · 받는계좌 메모 · 수수료   · 처리상태 · 처리시간
// 입금 기관명이 "미래에셋증권"이면 이체입금, 출금 기관명이 "미래에셋증권"이면 이체출금
export function parseMiraeCashFlows(text) {
  const lines = text.trim().split('\n').map(l => l.split('\t'))
  const headerA = lines.findIndex(c => c[0]?.trim() === '거래일')
  if (headerA === -1 || headerA + 1 >= lines.length) return []
  const headerB = headerA + 1

  const norm = s => (s ?? '').replace(/^'/, '').trim()
  const idxA = name => lines[headerA].findIndex(c => norm(c) === name)
  const idxB = name => lines[headerB].findIndex(c => norm(c) === name)

  const cDate = idxA('거래일'), cOutOrg = idxA('출금 기관명'), cAmt = idxA('거래금액'), cTime = idxA('처리시간')
  const cInOrg = idxB('입금 기관명'), cTimeB = idxB('처리시간')

  const result = []
  for (let i = headerB + 1; i + 1 < lines.length; i += 2) {
    const lineA = lines[i], lineB = lines[i + 1]
    const dateRaw = lineA[cDate]?.trim()
    if (!/^\d{4}\/\d{2}\/\d{2}$/.test(dateRaw || '')) continue
    const time = norm(lineA[cTime])
    if (!time || !norm(lineB[cTimeB])) continue // 양쪽 처리시간 다 있어야 처리 완료된 건

    const outOrg = norm(lineA[cOutOrg])
    const inOrg = norm(lineB[cInOrg])
    const amount = cleanNumber(lineA[cAmt])
    if (!amount) continue

    let ioType, memo
    if (inOrg === '미래에셋증권') { ioType = '이체입금'; memo = `이체입금 (${outOrg})` }
    else if (outOrg === '미래에셋증권') { ioType = '이체출금'; memo = `이체출금 (${inOrg})` }
    else continue

    result.push({
      date: dateRaw.replace(/\//g, '-'),
      tradeNo: makeTradeNo(dateRaw, time, memo, amount),
      memo,
      ioType,
      amount,
      currency: 'KRW',
      time,
    })
  }
  return result
}

// ── 포맷 6: 키움 해외 예수금 ────────────────────────────────
// 비정형: "원화환산추정인출가능금" 행, 헤더에서 "D+2" 컬럼 위치 파악
export function parseKiwoomUsCash(text) {
  const lines = text.trim().split('\n')
  let d2ColIdx = -1

  for (const line of lines) {
    const cols = line.split('\t')

    // 헤더 행에서 D+2 컬럼 위치 파악
    if (d2ColIdx === -1) {
      const idx = cols.findIndex(c => c.trim() === 'D+2')
      if (idx !== -1) d2ColIdx = idx
    }

    const label = cols[0]?.trim().replace(/\s/g, '')
    if (label === '원화환산추정인출가능금' && d2ColIdx !== -1) {
      return cleanNumber(cols[d2ColIdx])
    }
  }
  return 0
}
