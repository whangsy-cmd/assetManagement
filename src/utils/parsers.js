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

// 토/일 건너뛰고 n영업일 전 날짜 계산 — UTC 고정(로컬 타임존 의존 시 날짜 밀림 방지)
function businessDaysBack(dateIso, n) {
  const [y, m, d] = dateIso.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  let remaining = n
  while (remaining > 0) {
    date.setUTCDate(date.getUTCDate() - 1)
    const day = date.getUTCDay()
    if (day !== 0 && day !== 6) remaining--
  }
  return date.toISOString().slice(0, 10)
}

// 거래내역의 매수/매도 체결 행은 거래일자 컬럼이 결제일(T+2)로 찍혀 있어 실제 체결일로 환산 — 2영업일 전
function toTradeDate(dateIso, type) {
  return /매수|매도/.test(type) ? businessDaysBack(dateIso, 2) : dateIso
}

// 선물옵션 매수/매도는 결제일(T+1)로 찍혀 있어 실제 체결일로 환산 — 1영업일 전
function toFuturesTradeDate(dateIso, type) {
  return /매수|매도/.test(type) ? businessDaysBack(dateIso, 1) : dateIso
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

// ── 포맷 11: 실현손익 — 신용/현금 매매 (계좌 3058-4099) ─────
// 종목별: 일자 · 구분 · 종목코드 · 종목명 · 수량 · 매입가 · 매도체결가 · 실현손익 · 수익률 · 수수료 · 세금 ...
// 계좌단위(종목 없음): 매매일 · 매수금액 · 매도금액 · 실현손익 · 수익률 · 수수료 · 세금
export function parseRealizedProfitCredit(text) {
  const lines = text.trim().split('\n').map(l => l.split('\t'))
  const norm = s => (s ?? '').replace(/^'/, '').trim()

  const headerA = lines.findIndex(c => c[0]?.trim() === '일자' && c.some(v => v?.trim() === '종목코드'))
  if (headerA !== -1) {
    const idx = name => lines[headerA].findIndex(c => norm(c) === name)
    const cDate = idx('일자'), cCode = idx('종목코드'), cName = idx('종목명'),
          cProfit = idx('실현손익'), cFee = idx('수수료'), cTax = idx('세금')

    const result = []
    for (let i = headerA + 1; i < lines.length; i++) {
      const cols = lines[i]
      const dateRaw = cols[cDate]?.trim()
      if (!/^\d{4}\/\d{2}\/\d{2}$/.test(dateRaw || '')) continue
      result.push({
        date: dateRaw.replace(/\//g, '-'),
        code: cleanCode(cols[cCode]),
        name: cols[cName]?.trim() || '',
        realizedProfit: cleanNumber(cols[cProfit]),
        fee: cleanNumber(cols[cFee]) + cleanNumber(cols[cTax]),
      })
    }
    return result
  }

  const headerB = lines.findIndex(c => c[0]?.trim() === '매매일')
  if (headerB !== -1) {
    const idx = name => lines[headerB].findIndex(c => norm(c) === name)
    const cDate = idx('매매일'), cProfit = idx('실현손익'), cFee = idx('수수료'), cTax = idx('세금')

    const result = []
    for (let i = headerB + 1; i < lines.length; i++) {
      const cols = lines[i]
      const dateRaw = cols[cDate]?.trim()
      if (!/^\d{4}\/\d{2}\/\d{2}$/.test(dateRaw || '')) continue
      result.push({
        date: dateRaw.replace(/\//g, '-'),
        code: '',
        name: '',
        realizedProfit: cleanNumber(cols[cProfit]),
        fee: cleanNumber(cols[cFee]) + cleanNumber(cols[cTax]),
      })
    }
    return result
  }

  return []
}

// ── 포맷 12: 실현손익 — 해외 종목매매 (계좌 5124-4860) ──────
// 헤더: 매도일자 · 종목코드 · 종목명 · ... · 수수료+제세금(원) · 손익금액(원) · ... · 환실현손익(원)
export function parseRealizedProfitOverseas(text) {
  const lines = text.trim().split('\n').map(l => l.split('\t'))
  const headerA = lines.findIndex(c => c[0]?.trim() === '매도일자')
  if (headerA === -1) return []
  const norm = s => (s ?? '').replace(/^'/, '').trim()
  const idx = name => lines[headerA].findIndex(c => norm(c) === name)
  const cDate = idx('매도일자'), cCode = idx('종목코드'), cName = idx('종목명'),
        cFee = idx('수수료+제세금(원)'), cProfit = idx('환실현손익(원)')

  const result = []
  for (let i = headerA + 1; i < lines.length; i++) {
    const cols = lines[i]
    const dateRaw = cols[cDate]?.trim()
    if (!/^\d{4}\/\d{2}\/\d{2}$/.test(dateRaw || '')) continue
    result.push({
      date: dateRaw.replace(/\//g, '-'),
      code: cleanCode(cols[cCode]),
      name: cols[cName]?.trim() || '',
      realizedProfit: cleanNumber(cols[cProfit]),
      fee: cleanNumber(cols[cFee]),
    })
  }
  return result
}

// ── 포맷 13: 실현손익 — 국내 옵션 계좌손익 (계좌 1611-0027, 2줄=1건) ──
// [1줄] 일자 · 예탁자산 · 입금 · 출금 · 선물매매금 · 선물매매손익 · 옵션미결제평가손익 · 수수료 · 총손익 · 매매수익률 · 누적총손익
// [2줄] (공백) · (공백) · (공백) · (공백) · 옵션매매금 · 옵션매매손익 · (공백...)
// 종목 없는 계좌단위 손익 — 실현손익은 옵션매매손익(2줄 값), 수수료는 1줄 값
export function parseRealizedProfitKrOptionAccount(text) {
  const lines = text.trim().split('\n').map(l => l.split('\t'))
  const headerA = lines.findIndex(c => c[0]?.trim() === '일자' && c.some(v => v?.trim() === '예탁자산'))
  if (headerA === -1 || headerA + 1 >= lines.length) return []
  const headerB = headerA + 1
  const norm = s => (s ?? '').replace(/^'/, '').trim()
  const idxA = name => lines[headerA].findIndex(c => norm(c) === name)
  const idxB = name => lines[headerB].findIndex(c => norm(c) === name)
  const cDate = idxA('일자'), cFee = idxA('수수료'), cOptProfit = idxB('옵션매매손익')

  const result = []
  for (let i = headerB + 1; i + 1 < lines.length; i += 2) {
    const lineA = lines[i], lineB = lines[i + 1]
    const dateRaw = lineA[cDate]?.trim()
    if (!/^\d{4}\/\d{2}\/\d{2}$/.test(dateRaw || '')) continue
    result.push({
      date: dateRaw.replace(/\//g, '-'),
      code: '',
      name: '',
      realizedProfit: cleanNumber(lineB[cOptProfit]),
      fee: cleanNumber(lineA[cFee]),
    })
  }
  return result
}

// ── 포맷 14: 실현손익 — 옵션 계좌손익 (계좌 5767-2099, 1줄=1건) ──
// 헤더: 일자 · 예수금 · 원화대용금 · 옵션평가차금(전일) · 청산손익 · 수수료 · 일별손익 · 누적손익 · 수익률
// 종목 없는 계좌단위 손익 — 실현손익은 청산손익
export function parseRealizedProfitKrOptionAccount2(text) {
  const lines = text.trim().split('\n').map(l => l.split('\t'))
  const headerA = lines.findIndex(c => c[0]?.trim() === '일자' && c.some(v => v?.trim() === '청산손익'))
  if (headerA === -1) return []
  const norm = s => (s ?? '').trim()
  const idx = name => lines[headerA].findIndex(c => norm(c) === name)
  const cDate = idx('일자'), cProfit = idx('청산손익'), cFee = idx('수수료')

  const result = []
  for (let i = headerA + 1; i < lines.length; i++) {
    const cols = lines[i]
    const dateRaw = cols[cDate]?.trim()
    if (!/^\d{4}\/\d{2}\/\d{2}$/.test(dateRaw || '')) continue
    result.push({
      date: dateRaw.replace(/\//g, '-'),
      code: '',
      name: '',
      realizedProfit: cleanNumber(cols[cProfit]),
      fee: cleanNumber(cols[cFee]),
    })
  }
  return result
}

// ── 포맷 15: 실현손익 — 미래에셋 (종목 없음, 계좌 선택형) ────
// 헤더: 조회일자 · 전일자산총액 · 당일자산총액 · 당일매매비용 · 전일대비 평가손익 · 실현손익 · 총손익
export function parseRealizedProfitMirae(text) {
  const lines = text.trim().split('\n').map(l => l.split('\t'))
  const headerA = lines.findIndex(c => c[0]?.trim() === '조회일자')
  if (headerA === -1) return []
  const norm = s => (s ?? '').trim()
  const idx = name => lines[headerA].findIndex(c => norm(c) === name)
  const cDate = idx('조회일자'), cProfit = idx('실현손익')

  const result = []
  for (let i = headerA + 1; i < lines.length; i++) {
    const cols = lines[i]
    const dateRaw = cols[cDate]?.trim()
    if (!/^\d{4}\/\d{2}\/\d{2}$/.test(dateRaw || '')) continue
    result.push({
      date: dateRaw.replace(/\//g, '-'),
      code: '',
      name: '',
      realizedProfit: cleanNumber(cols[cProfit]),
      fee: 0,
    })
  }
  return result
}

// ── 포맷 16: 미래에셋 계좌평가 (일별자산현황, 계좌 선택형) ───
// 헤더: 조회일자 · 전일자산총액 · 당일자산총액 · 당일매매비용 · 전일대비 평가손익 · 실현손익 · 총손익
export function parseMiraeAccountEval(text) {
  const lines = text.trim().split('\n').map(l => l.split('\t'))
  const headerA = lines.findIndex(c => c[0]?.trim() === '조회일자')
  if (headerA === -1) return []
  const norm = s => (s ?? '').trim()
  const idx = name => lines[headerA].findIndex(c => norm(c) === name)
  const cDate = idx('조회일자'), cTotal = idx('당일자산총액')

  const result = []
  for (let i = headerA + 1; i < lines.length; i++) {
    const cols = lines[i]
    const dateRaw = cols[cDate]?.trim()
    if (!/^\d{4}\/\d{2}\/\d{2}$/.test(dateRaw || '')) continue
    result.push({
      date: dateRaw.replace(/\//g, '-'),
      totalAmt: cleanNumber(cols[cTotal]),
    })
  }
  return result
}

// ── 포맷 17: 미래에셋 계좌평가 (계좌별 일괄, 계좌번호 포함) ───
// 헤더: 일자 · 계좌번호 · 계좌유형 · D+2원화예수금 · 순자산총액 · 평가금액
// 계좌번호가 행마다 포함돼 있어 계좌 선택과 무관하게 데이터의 계좌로 등록
export function parseMiraeAccountEvalMulti(text) {
  const lines = text.trim().split('\n').map(l => l.split('\t'))
  const headerA = lines.findIndex(c => c[0]?.trim() === '일자' && c.some(v => v?.trim() === '계좌번호'))
  if (headerA === -1) return []
  const norm = s => (s ?? '').trim()
  const idx = name => lines[headerA].findIndex(c => norm(c) === name)
  const cDate = idx('일자'), cAcc = idx('계좌번호'),
        cCash = idx('D+2원화예수금'), cTotal = idx('순자산총액'), cEval = idx('평가금액')

  const result = []
  for (let i = headerA + 1; i < lines.length; i++) {
    const cols = lines[i]
    const dateRaw = cols[cDate]?.trim()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateRaw || '')) continue
    const accountId = cleanAccount(cols[cAcc])
    if (!accountId) continue
    result.push({
      date: dateRaw,
      accountId,
      cashAmt: cleanNumber(cols[cCash]),
      totalAmt: cleanNumber(cols[cTotal]),
      evalAmt: cleanNumber(cols[cEval]),
    })
  }
  return result
}

// ── 포맷 18: 키움 국내 거래내역 (매매+입출금 등 전체, 2줄=1건) ──
// [1줄] 거래일자 · 적요명 · 수량/좌수 · 거래금액 · 수수료 · 거래세/농특세 · 정산금액 · 소득세/주민세 · 예수금잔고 · 미수금 · 미수변제 · 연체변제 · 처리시간
// [2줄] 통화 · 거래소 · 종목명 · 단가/환율 · 거래금액(외) · 수수료(외) · 거래세(외) · 정산금액(외) · 외국납부세액(외) · 예수금잔고(외) · 미수금(외) · 미수변제(외) · 연체변제(외) · 매체구분
// 거래금액/수수료/세금은 원화·외화 컬럼 중 값 있는 쪽 하나로 통합 (국내계좌라 대부분 원화만 사용)
export function parseKiwoomKrTransactions(text) {
  const lines = text.trim().split('\n').map(l => l.split('\t'))
  const headerA = lines.findIndex(c => c[0]?.trim() === '거래일자')
  if (headerA === -1 || headerA + 1 >= lines.length) return []
  const headerB = headerA + 1

  const norm = s => (s ?? '').replace(/^'/, '').trim()
  const idxA = name => lines[headerA].findIndex(c => norm(c) === name)
  const idxB = name => lines[headerB].findIndex(c => norm(c) === name)

  const cDate = idxA('거래일자'), cType = idxA('적요명'), cQty = idxA('수량/좌수'),
        cAmt = idxA('거래금액'), cFee = idxA('수수료'), cTax = idxA('거래세/농특세'), cTax2 = idxA('소득세/주민세'), cTime = idxA('처리시간')
  const cCrnc = idxB('통화'), cName = idxB('종목명'), cPrice = idxB('단가/환율'),
        cAmtFc = idxB('거래금액(외)'), cFeeFc = idxB('수수료(외)'), cTaxFc = idxB('거래세(외)'), cTax2Fc = idxB('외국납부세액(외)')

  const result = []
  for (let i = headerB + 1; i + 1 < lines.length; i += 2) {
    const lineA = lines[i], lineB = lines[i + 1]
    const dateRaw = lineA[cDate]?.trim()
    if (!/^\d{4}\/\d{2}\/\d{2}$/.test(dateRaw || '')) continue
    const type = lineA[cType]?.trim()
    if (!type) continue
    result.push({
      date: toTradeDate(dateRaw.replace(/\//g, '-'), type),
      type,
      name: lineB[cName]?.trim() || '',
      code: '',
      currency: lineB[cCrnc]?.trim() || 'KRW',
      qty: cleanNumber(lineA[cQty]),
      price: cleanNumber(lineB[cPrice]),
      amount: cleanNumber(lineA[cAmt]) || cleanNumber(lineB[cAmtFc]),
      fee: cleanNumber(lineA[cFee]) || cleanNumber(lineB[cFeeFc]),
      tax: cleanNumber(lineA[cTax]) + cleanNumber(lineA[cTax2]) + cleanNumber(lineB[cTaxFc]) + cleanNumber(lineB[cTax2Fc]),
      time: lineA[cTime]?.trim() || '',
    })
  }
  return result
}

// ── 포맷 19: 키움 해외 거래내역 (매매+입출금 등 전체, 1줄=1건) ──
// 컬럼: 거래일자 · 종목코드 · 거래소 · 거래종류 · 적요명 · 종목명 · 통화 · 거래수량 · 단가/환율 · 거래금액 · 거래금액(외) · 세금합 · 수수료(외) · 외국납부세액 · 처리시간 등
// 적요명(매수/매도/입출금 등)을 거래종류로 사용 — 거래금액/세금은 원화·외화 컬럼 중 값 있는 쪽으로 통합
export function parseKiwoomUsTransactions(text) {
  const lines = text.trim().split('\n').map(l => l.split('\t'))
  const headerA = lines.findIndex(c => c[0]?.trim() === '거래일자' && c.some(v => v?.trim() === '종목코드'))
  if (headerA === -1) return []
  const norm = s => (s ?? '').replace(/^'/, '').trim()
  const idx = name => lines[headerA].findIndex(c => norm(c) === name)

  const cDate = idx('거래일자'), cCode = idx('종목코드'), cType = idx('적요명'), cName = idx('종목명'),
        cCrnc = idx('통화'), cQty = idx('거래수량'), cPrice = idx('단가/환율'),
        cAmt = idx('거래금액'), cAmtFc = idx('거래금액(외)'),
        cTax = idx('세금합'), cFeeFc = idx('수수료(외)'), cTax2 = idx('외국납부세액')

  const result = []
  for (let i = headerA + 1; i < lines.length; i++) {
    const cols = lines[i]
    const dateRaw = cols[cDate]?.trim()
    if (!/^\d{4}\/\d{2}\/\d{2}$/.test(dateRaw || '')) continue
    const type = cols[cType]?.trim()
    if (!type) continue
    result.push({
      date: toTradeDate(dateRaw.replace(/\//g, '-'), type),
      type,
      name: cols[cName]?.trim() || '',
      code: cleanCode(cols[cCode]) || '',
      currency: cols[cCrnc]?.trim() || 'USD',
      qty: cleanNumber(cols[cQty]),
      price: cleanNumber(cols[cPrice]),
      amount: cleanNumber(cols[cAmt]) || cleanNumber(cols[cAmtFc]),
      fee: cleanNumber(cols[cFeeFc]),
      tax: cleanNumber(cols[cTax]) + cleanNumber(cols[cTax2]),
    })
  }
  return result
}

// ── 포맷 20: 미래에셋 거래내역 (매매+입출금+분배금 등 전체, 1줄=1건) ──
// 컬럼: 거래일자 · 거래번호 · 원번호 · 거래종류 · 종목명 · 수량 · 단가 · 거래금액 · 입출금액 · 예수금 · 수수료 · 제세금합 · 외화거래금액 · 통화코드 등
// 주식매수출금/주식매도입금 행은 짝을 이루는 주식매수입고/주식매도출금 행과 중복이라 제외
export function parseMiraeTransactions(text) {
  const lines = text.trim().split('\n').map(l => l.split('\t'))
  const headerA = lines.findIndex(c => c[0]?.trim() === '거래일자' && c.some(v => v?.trim() === '거래종류'))
  if (headerA === -1) return []
  const norm = s => (s ?? '').trim()
  const idx = name => lines[headerA].findIndex(c => norm(c) === name)

  const cDate = idx('거래일자'), cType = idx('거래종류'), cName = idx('종목명'),
        cQty = idx('수량'), cPrice = idx('단가'), cAmt = idx('거래금액'), cAmtFc = idx('외화거래금액'),
        cFee = idx('수수료'), cTax = idx('제세금합'), cCrnc = idx('통화코드')

  const SKIP_TYPES = ['주식매수출금', '주식매도입금']

  const result = []
  for (let i = headerA + 1; i < lines.length; i++) {
    const cols = lines[i]
    const dateRaw = cols[cDate]?.trim()
    if (!/^\d{4}\/\d{2}\/\d{2}$/.test(dateRaw || '')) continue
    const type = cols[cType]?.trim()
    if (!type || SKIP_TYPES.includes(type)) continue
    result.push({
      date: toTradeDate(dateRaw.replace(/\//g, '-'), type),
      type,
      name: cols[cName]?.trim() || '',
      code: '',
      currency: cols[cCrnc]?.trim() || 'KRW',
      qty: cleanNumber(cols[cQty]),
      price: cleanNumber(cols[cPrice]),
      amount: cleanNumber(cols[cAmt]) || cleanNumber(cols[cAmtFc]),
      fee: cleanNumber(cols[cFee]),
      tax: cleanNumber(cols[cTax]),
    })
  }
  return result
}

// ── 포맷 21: 키움 국내 선물옵션 거래내역 (전체, 2줄=1건) ────
// [1줄] 거래일자 · 거래구분 · 종목명 · 수량 · 가격/환율 · 출납/약정금액 · (공란) · 미수금 · 거래금액(외) · 외화예수금잔고
// [2줄] (공란) · (공란) · 연체료 · 세금 · 수수료 · 손익 · 잔액 · 미수변제금 · 통화코드 · 처리일시
// 원문 매수/매도 행은 무시(옵션매수대금출금/옵션매도대금입금 행이 실제 결제금액) —
// 옵션매수대금출금→매수, 옵션매도대금입금→매도로 치환, 나머지(이자/대체출금/입금 등)는 거래구분을 그대로 거래종류로 사용.
// 매수/매도는 결제일(T+1) 기준이라 1영업일 전으로 보정(toFuturesTradeDate), 나머지는 보정 없음.
const FUTURES_TYPE_MAP = { 옵션매수대금출금: '매수', 옵션매도대금입금: '매도' }
export function parseKiwoomKrFuturesTransactions(text) {
  const lines = text.trim().split('\n').map(l => l.split('\t'))
  const norm = s => (s ?? '').replace(/^'/, '').trim()
  const headerA = lines.findIndex(c => c[0]?.trim() === '거래일자' && c.some(v => norm(v) === '출납/약정금액'))
  if (headerA === -1 || headerA + 1 >= lines.length) return []
  const headerB = headerA + 1

  const idxA = name => lines[headerA].findIndex(c => norm(c) === name)
  const idxB = name => lines[headerB].findIndex(c => norm(c) === name)

  const cDate = idxA('거래일자'), cType = idxA('거래구분'), cName = idxA('종목명'),
        cQty = idxA('수량'), cPrice = idxA('가격/환율'), cAmt = idxA('출납/약정금액')
  const cFee = idxB('수수료'), cTax = idxB('세금'), cLate = idxB('연체료'), cProfit = idxB('손익'), cTime = idxB('처리일시')

  const result = []
  for (let i = headerB + 1; i + 1 < lines.length; i += 2) {
    const lineA = lines[i], lineB = lines[i + 1]
    const dateRaw = lineA[cDate]?.trim()
    if (!/^\d{4}\/\d{2}\/\d{2}$/.test(dateRaw || '')) continue
    const rawType = lineA[cType]?.trim()
    if (!rawType || rawType === '매수' || rawType === '매도') continue
    const type = FUTURES_TYPE_MAP[rawType] || rawType
    result.push({
      date: toFuturesTradeDate(dateRaw.replace(/\//g, '-'), type),
      type,
      name: lineA[cName]?.trim() || '',
      code: '',
      currency: 'KRW',
      qty: cleanNumber(lineA[cQty]),
      price: cleanNumber(lineA[cPrice]),
      amount: Math.abs(cleanNumber(lineA[cAmt])),
      fee: cleanNumber(lineB[cFee]) + cleanNumber(lineB[cLate]),
      tax: cleanNumber(lineB[cTax]),
      profit: cleanNumber(lineB[cProfit]),
      time: lineB[cTime]?.trim() || '',
    })
  }
  return result
}

// ── 포맷 22: 키움 해외선물옵션 거래내역 (전체, 1줄=1건) ─────
// 컬럼: 거래일자 · 거래종류 · 적요 · 종목코드 · 종목 · 통화코드 · 소득/주민세 · 거래수량 · 거래단가/환율 · 거래금액 · 거래금액(외) · 외화수수료 · 청산손익 · 처리시간 등
// 해외거래수수료출금/해외옵션결제차금출금/해외옵션결제차금입금 행은 그날 매매(매수/매도) 행들의 합계라 무시 —
// 매매 행 자체에 종목코드·거래금액(외)·외화수수료가 이미 있어 개별 체결 그대로 저장.
const FUTURES_US_SKIP = ['해외거래수수료출금', '해외옵션결제차금출금', '해외옵션결제차금입금']
export function parseKiwoomUsFuturesTransactions(text) {
  const lines = text.trim().split('\n').map(l => l.split('\t'))
  const headerA = lines.findIndex(c => c[0]?.trim() === '거래일자' && c.some(v => v?.trim() === '청산손익'))
  if (headerA === -1) return []
  const norm = s => (s ?? '').replace(/^'/, '').trim()
  const idx = name => lines[headerA].findIndex(c => norm(c) === name)

  const cDate = idx('거래일자'), cType = idx('적요'), cCode = idx('종목코드'), cName = idx('종목'),
        cCrnc = idx('통화코드'), cQty = idx('거래수량'), cPrice = idx('거래단가/환율'),
        cAmt = idx('거래금액'), cAmtFc = idx('거래금액(외)'), cFeeFc = idx('외화수수료'), cTax = idx('소득/주민세'), cProfit = idx('청산손익'), cTime = idx('처리시간')

  const result = []
  for (let i = headerA + 1; i < lines.length; i++) {
    const cols = lines[i]
    const dateRaw = cols[cDate]?.trim()
    if (!/^\d{4}\/\d{2}\/\d{2}$/.test(dateRaw || '')) continue
    const type = cols[cType]?.trim()
    if (!type || FUTURES_US_SKIP.includes(type)) continue
    result.push({
      date: dateRaw.replace(/\//g, '-'),
      type,
      name: cols[cName]?.trim() || '',
      code: cleanCode(cols[cCode]) || '',
      currency: cols[cCrnc]?.trim() || 'USD',
      qty: cleanNumber(cols[cQty]),
      price: cleanNumber(cols[cPrice]),
      amount: cleanNumber(cols[cAmtFc]) || cleanNumber(cols[cAmt]),
      fee: cleanNumber(cols[cFeeFc]),
      // 예탁금이용료이자세금출금은 세금 컬럼값이 거래금액과 동일하게 찍혀나와 이중계상되므로 0 처리
      tax: type === '예탁금이용료이자세금출금' ? 0 : cleanNumber(cols[cTax]),
      profit: cleanNumber(cols[cProfit]),
      time: cols[cTime]?.trim() || '',
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
