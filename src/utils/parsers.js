// 브로커별(미래에셋/키움 국내·해외) 붙여넣기 텍스트 파서 모음
import { getUsdKrwRate } from './exchangeRate'
import { getKrMarketHolidays } from './krHolidays'

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

// 미국 결제일→체결일 환산용 휴장일 계산(토/일 겹치면 평일로 대체) — 결제는 증시(NYSE)가 아니라 Fed/DTCC(은행) 휴무 기준이라
// 콜럼버스의날·재향군인의날도 포함되고 굿프라이데이는 빠짐(증시는 열지만 은행·예탁결제원은 쉬어서 결제만 밀림, 2025-10-13 실사례로 확인)
const fmtDate = (y, m, d) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
const nthWeekday = (year, month, weekday, n) => { // month 0-idx, weekday 0=일 ~ 6=토
  const d = new Date(Date.UTC(year, month, 1))
  let count = 0
  while (true) {
    if (d.getUTCDay() === weekday) { count++; if (count === n) return d.getUTCDate() }
    d.setUTCDate(d.getUTCDate() + 1)
  }
}
const lastWeekday = (year, month, weekday) => {
  const d = new Date(Date.UTC(year, month + 1, 0))
  while (d.getUTCDay() !== weekday) d.setUTCDate(d.getUTCDate() - 1)
  return d.getUTCDate()
}
// 토요일이면 전 금요일, 일요일이면 다음 월요일로 대체휴일 처리
const observedIso = (year, month, day) => {
  const d = new Date(Date.UTC(year, month, day))
  const dow = d.getUTCDay()
  if (dow === 6) d.setUTCDate(d.getUTCDate() - 1)
  else if (dow === 0) d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}
const usHolidayCache = new Map()
function getUsBankHolidays(year) {
  if (usHolidayCache.has(year)) return usHolidayCache.get(year)
  const set = new Set([
    observedIso(year, 0, 1),                                  // 신정
    fmtDate(year, 0, nthWeekday(year, 0, 1, 3)),                // MLK Day (1월 3번째 월)
    fmtDate(year, 1, nthWeekday(year, 1, 1, 3)),                // Presidents Day (2월 3번째 월)
    fmtDate(year, 4, lastWeekday(year, 4, 1)),                  // Memorial Day (5월 마지막 월)
    observedIso(year, 5, 19),                                  // Juneteenth
    observedIso(year, 6, 4),                                   // 독립기념일
    fmtDate(year, 8, nthWeekday(year, 8, 1, 1)),                // Labor Day (9월 첫 월)
    fmtDate(year, 9, nthWeekday(year, 9, 1, 2)),                // Columbus Day (10월 2번째 월)
    observedIso(year, 10, 11),                                 // Veterans Day
    fmtDate(year, 10, nthWeekday(year, 10, 4, 4)),              // Thanksgiving (11월 4번째 목)
    observedIso(year, 11, 25),                                 // 크리스마스
  ])
  usHolidayCache.set(year, set)
  return set
}

// 토/일 + 시장 휴장일(market='us'면 NYSE, market='kr'면 공공데이터포털 공휴일+근로자의날)도 건너뛰고 n영업일 전 날짜 계산
// UTC 고정(로컬 타임존 의존 시 날짜 밀림 방지). kr은 공공데이터포털 API 조회라 비동기.
async function businessDaysBack(dateIso, n, market = 'kr') {
  const [y, m, d] = dateIso.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  let remaining = n
  while (remaining > 0) {
    date.setUTCDate(date.getUTCDate() - 1)
    const day = date.getUTCDay()
    const iso = date.toISOString().slice(0, 10)
    let isHoliday = false
    if (market === 'us') isHoliday = getUsBankHolidays(date.getUTCFullYear()).has(iso)
    else if (market === 'kr') isHoliday = (await getKrMarketHolidays(date.getUTCFullYear())).has(iso)
    if (day !== 0 && day !== 6 && !isHoliday) remaining--
  }
  return date.toISOString().slice(0, 10)
}

// 거래내역의 매수/매도 체결 행은 거래일자 컬럼이 결제일(T+2)로 찍혀 있어 실제 체결일로 환산 — 2영업일 전. 시장 휴장일 감안(비동기)
async function toTradeDate(dateIso, type, market = 'kr') {
  return /매수|매도/.test(type) ? await businessDaysBack(dateIso, 2, market) : dateIso
}

// 선물옵션 매수/매도는 결제일(T+1)로 찍혀 있어 실제 체결일로 환산 — 1영업일 전
async function toFuturesTradeDate(dateIso, type) {
  return /매수|매도/.test(type) ? await businessDaysBack(dateIso, 1) : dateIso
}

// 실현손익 리포트의 매도일자는 보통 체결일 그대로지만, 결제 휴장일(주말·공휴일)에 걸리면 브로커가 다음 처리일로 찍는 경우가 있어
// 해당일이 휴장일이면 하루씩 전날로 당겨서 실제 체결일을 찾는다 (거래내역의 T+n 결제일 환산과 달리 걸렸을 때만 보정).
export async function alignToBusinessDay(dateIso, market = 'kr') {
  const [y, m, d] = dateIso.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  while (true) {
    const day = date.getUTCDay()
    const iso = date.toISOString().slice(0, 10)
    let isHoliday = false
    if (market === 'us') isHoliday = getUsBankHolidays(date.getUTCFullYear()).has(iso)
    else if (market === 'kr') isHoliday = (await getKrMarketHolidays(date.getUTCFullYear())).has(iso)
    if (day !== 0 && day !== 6 && !isHoliday) return iso
    date.setUTCDate(date.getUTCDate() - 1)
  }
}

// businessDaysBack의 반대 방향(체결일→결제일 등 미래 방향 계산) — 정합성 검사에서 "아직 결제 안 된 최근 거래" 판별용으로 재사용
export async function addBusinessDays(dateIso, n, market = 'kr') {
  const [y, m, d] = dateIso.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  let remaining = n
  while (remaining > 0) {
    date.setUTCDate(date.getUTCDate() + 1)
    const day = date.getUTCDay()
    const iso = date.toISOString().slice(0, 10)
    let isHoliday = false
    if (market === 'us') isHoliday = getUsBankHolidays(date.getUTCFullYear()).has(iso)
    else if (market === 'kr') isHoliday = (await getKrMarketHolidays(date.getUTCFullYear())).has(iso)
    if (day !== 0 && day !== 6 && !isHoliday) remaining--
  }
  return date.toISOString().slice(0, 10)
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

// ── 포맷 11: 실현손익 — 신용/현금 매매 (계좌 3058-4099) ─────
// 종목별(헤더A) 실제 컬럼(2025-09 샘플 확인): 일자 · 구분 · 종목코드 · 종목명 · 수량 · 매입가 · 매도체결가 · 실현손익 · 수익률
//                                        · 수수료 · 세금 · 신용이자 · 대출일 · 신용구분 · 매입금액 · 매도금액
// 계좌단위(헤더B, 종목 없음): 매매일 · 매수금액 · 매도금액 · 실현손익 · 수익률 · 수수료 · 세금
// 수수료/세금은 매도 기준이라 매수수수료는 포함 안 됨
export async function parseRealizedProfitCredit(text) {
  const lines = text.trim().split('\n').map(l => l.split('\t'))
  const norm = s => (s ?? '').replace(/^'/, '').trim()

  const headerA = lines.findIndex(c => c[0]?.trim() === '일자' && c.some(v => v?.trim() === '종목코드'))
  if (headerA !== -1) {
    const idx = name => lines[headerA].findIndex(c => norm(c) === name)
    const cDate = idx('일자'), cCode = idx('종목코드'), cName = idx('종목명'),
          cQty = idx('수량'), cSellPrice = idx('매도체결가'), cSellAmt = idx('매도금액'),
          cProfit = idx('실현손익'), cFee = idx('수수료'), cTax = idx('세금')

    const result = []
    for (let i = headerA + 1; i < lines.length; i++) {
      const cols = lines[i]
      const dateRaw = cols[cDate]?.trim()
      if (!/^\d{4}\/\d{2}\/\d{2}$/.test(dateRaw || '')) continue
      result.push({
        date: await alignToBusinessDay(dateRaw.replace(/\//g, '-'), 'kr'),
        code: cleanCode(cols[cCode]),
        name: cols[cName]?.trim() || '',
        sellAmount: cSellAmt !== -1 ? cleanNumber(cols[cSellAmt]) : cleanNumber(cols[cQty]) * cleanNumber(cols[cSellPrice]),
        realizedProfit: cleanNumber(cols[cProfit]),
        fee: cleanNumber(cols[cFee]),
        tax: cleanNumber(cols[cTax]),
        qty: cleanNumber(cols[cQty]),
      })
    }
    return result
  }

  const headerB = lines.findIndex(c => c[0]?.trim() === '매매일')
  if (headerB !== -1) {
    const idx = name => lines[headerB].findIndex(c => norm(c) === name)
    const cDate = idx('매매일'), cSellAmt = idx('매도금액'), cProfit = idx('실현손익'), cFee = idx('수수료'), cTax = idx('세금')

    const result = []
    for (let i = headerB + 1; i < lines.length; i++) {
      const cols = lines[i]
      const dateRaw = cols[cDate]?.trim()
      if (!/^\d{4}\/\d{2}\/\d{2}$/.test(dateRaw || '')) continue
      result.push({
        date: await alignToBusinessDay(dateRaw.replace(/\//g, '-'), 'kr'),
        code: '',
        name: '',
        sellAmount: cleanNumber(cols[cSellAmt]),
        realizedProfit: cleanNumber(cols[cProfit]),
        fee: cleanNumber(cols[cFee]),
        tax: cleanNumber(cols[cTax]),
      })
    }
    return result
  }

  return []
}

// ── 포맷 12: 실현손익 — 해외 종목매매 (계좌 5124-4860) ──────
// 실제 컬럼(2026-08 샘플 확인): 매도일자 · 종목코드 · 종목명 · 청산수량 · 매입평균가 · 매입금액 · 매도평균가 · 매도금액(외화)
//                             · 수수료+제세금 · 손익금액 · 수익률(%) · 매입환율 · 매도환율 · 환차손익(원) · 환실현손익(원) · 국가 · 거래소
// 매도금액/손익금액/수수료+제세금 등은 전부 외화(USD 등), 환실현손익(원)만 원화 — 거래금액(sellAmount)·청산손익(liquidationProfit)·수수료(fee)는 전부 외화 그대로 유지(원화 미환산).
// 실현손익만 환실현손익(원) 컬럼을 쓰지 않고 매도환율×손익금액으로 직접 계산(환차손익 제외한 순수 매매손익만 원화 반영).
// 수수료+제세금이 합산 컬럼이라 세금 별도 분리는 불가. 수수료는 매도 기준이라 매수수수료는 포함 안 됨
// 매도일자가 미국 결제 휴장일(Fed/DTCC 은행 휴일)에 걸리면 브로커가 다음 처리일로 찍는 경우가 있어 전날로 당겨 실제 체결일 보정(alignToBusinessDay)
export async function parseRealizedProfitOverseas(text) {
  const lines = text.trim().split('\n').map(l => l.split('\t'))
  const headerA = lines.findIndex(c => c[0]?.trim() === '매도일자')
  if (headerA === -1) return []
  const norm = s => (s ?? '').replace(/^'/, '').trim()
  const idx = name => lines[headerA].findIndex(c => norm(c) === name)
  const cDate = idx('매도일자'), cCode = idx('종목코드'), cName = idx('종목명'), cSellAmt = idx('매도금액'),
        cFee = idx('수수료+제세금'), cSellExrt = idx('매도환율'), cPlAmt = idx('손익금액'), cQty = idx('청산수량')

  const result = []
  for (let i = headerA + 1; i < lines.length; i++) {
    const cols = lines[i]
    const dateRaw = cols[cDate]?.trim()
    if (!/^\d{4}\/\d{2}\/\d{2}$/.test(dateRaw || '')) continue
    const sellExrt = cleanNumber(cols[cSellExrt])
    const plAmount = cleanNumber(cols[cPlAmt])
    result.push({
      date: await alignToBusinessDay(dateRaw.replace(/\//g, '-'), 'us'),
      code: cleanCode(cols[cCode]),
      name: cols[cName]?.trim() || '',
      sellAmount: cleanNumber(cols[cSellAmt]),
      liquidationProfit: plAmount,
      realizedProfit: Math.round(plAmount * sellExrt),
      fee: cleanNumber(cols[cFee]),
      exrt: sellExrt,
      qty: cleanNumber(cols[cQty]),
    })
  }
  return result
}

// ── 포맷 13: 실현손익 — 국내 옵션 계좌손익 (계좌 1611-0027, 2줄=1건, 포맷 21 거래내역과 동일 원본) ──
// [1줄] 거래일자 · 거래구분 · 종목명 · 수량 · 가격/환율 · 출납/약정금액 · (공란) · 미수금 · 거래금액(외) · 외화예수금잔고
// [2줄] (공란) · (공란) · 연체료 · 세금 · 수수료 · 손익 · 잔액 · 미수변제금 · 통화코드 · 처리일시
// 매수/매도 행 중 2줄의 손익에 값이 있는 행이 청산거래=실현손익(매수도 숏 청산이면 손익 찍힘, 매도만 보면 안 됨). 거래금액은 1줄의 출납/약정금액.
// 수수료는 이 행엔 없고 별도 옵션매수대금출금/옵션매도대금입금 결제행에 합산돼 있어 여기선 반영 안 함(fee:0).
// 종목코드 컬럼이 없어 거래내역 파서와 동일하게 종목명을 코드로 사용.
// 거래일자도 거래내역 파서(parseKiwoomKrFuturesTransactions)와 동일하게 결제일(T+1)이라 체결일로 환산(toFuturesTradeDate) — 안 하면 거래내역과 날짜 어긋나 정합성 매칭 안 됨.
export async function parseRealizedProfitKrOptionAccount(text) {
  const lines = text.trim().split('\n').map(l => l.split('\t'))
  const norm = s => (s ?? '').replace(/^'/, '').trim()
  const headerA = lines.findIndex(c => c[0]?.trim() === '거래일자' && c.some(v => norm(v) === '출납/약정금액'))
  if (headerA === -1 || headerA + 1 >= lines.length) return []
  const headerB = headerA + 1
  const idxA = name => lines[headerA].findIndex(c => norm(c) === name)
  const idxB = name => lines[headerB].findIndex(c => norm(c) === name)
  const cDate = idxA('거래일자'), cType = idxA('거래구분'), cName = idxA('종목명'), cAmt = idxA('출납/약정금액')
  const cProfit = idxB('손익')

  const result = []
  for (let i = headerB + 1; i + 1 < lines.length; i += 2) {
    const lineA = lines[i], lineB = lines[i + 1]
    const dateRaw = lineA[cDate]?.trim()
    if (!/^\d{4}\/\d{2}\/\d{2}$/.test(dateRaw || '')) continue
    const rawType = lineA[cType]?.trim()
    if (rawType !== '매수' && rawType !== '매도') continue
    const profit = cleanNumber(lineB[cProfit])
    if (!profit) continue
    const name = lineA[cName]?.trim() || ''
    result.push({
      date: await toFuturesTradeDate(dateRaw.replace(/\//g, '-'), rawType),
      code: name,
      name,
      sellAmount: Math.abs(cleanNumber(lineA[cAmt])),
      realizedProfit: profit,
      fee: 0,
    })
  }
  return result
}

// ── 포맷 14: 실현손익 — 해외 옵션 계좌손익 (계좌 5767-2099, 거래별 1줄=1건) ──
// 실제 컬럼(2025-02 샘플 확인): 거래일자 · 거래종류 · 적요 · 종목코드 · 종목 · 통화코드 · 소득/주민세 · 거래수량 · 거래단가/환율
//                             · 청산수량 · 체결가격표시 · 거래금액 · 거래금액(외) · 외화수수료 · 청산손익 · 원화미수금 · 외화미수금
//                             · 원화변제금 · 외화변제금 · 원화연체료 · 외화연체료 · 원화잔액 · 외화잔액 · 처리자 · 매체구분 · 처리시간
// 거래금액은 항상 0이고 실제 값은 거래금액(외)(외화)에 있음. 매수/매도 상관없이 청산손익에 값이 있는 행이 청산거래(매수도 숏 청산이면 값 찍힘).
// 거래금액(외)은 외화 그대로 유지(원화 미환산). 실현손익만 청산손익(외화)에 거래일자 기준 USD/KRW 환율(frankfurter.app, getUsdKrwRate) 곱해 원화로 환산 — 적용 환율은 exrt 필드로 같이 저장.
export async function parseRealizedProfitKrOptionAccount2(text) {
  const lines = text.trim().split('\n').map(l => l.split('\t'))
  const headerA = lines.findIndex(c => c[0]?.trim() === '거래일자' && c.some(v => v?.trim() === '청산손익'))
  if (headerA === -1) return []
  const norm = s => (s ?? '').replace(/^'/, '').trim()
  const idx = name => lines[headerA].findIndex(c => norm(c) === name)
  const cDate = idx('거래일자'), cType = idx('거래종류'),
        cCode = idx('종목코드'), cName = idx('종목'), cSellAmt = idx('거래금액(외)'), cProfit = idx('청산손익')

  const raw = []
  for (let i = headerA + 1; i < lines.length; i++) {
    const cols = lines[i]
    const dateRaw = cols[cDate]?.trim()
    if (!/^\d{4}\/\d{2}\/\d{2}$/.test(dateRaw || '')) continue
    if (norm(cols[cType]) !== '매매') continue
    const profit = cleanNumber(cols[cProfit])
    if (!profit) continue
    raw.push({
      date: dateRaw.replace(/\//g, '-'),
      code: cleanCode(cols[cCode]),
      name: norm(cols[cName]),
      sellAmountFc: cleanNumber(cols[cSellAmt]),
      profitFc: profit,
    })
  }

  const dates = [...new Set(raw.map(r => r.date))]
  const rateByDate = new Map(await Promise.all(dates.map(async d => [d, await getUsdKrwRate(d)])))

  return raw.map(r => {
    const rate = rateByDate.get(r.date)
    return {
      date: r.date,
      code: r.code,
      name: r.name,
      sellAmount: r.sellAmountFc,
      liquidationProfit: r.profitFc,
      realizedProfit: Math.round(r.profitFc * rate),
      fee: 0,
      exrt: rate,
    }
  })
}

// ── 포맷 15: 실현손익 — 미래에셋 (종목 없음, 계좌 선택형) ────
// 헤더: 조회일자 · 전일자산총액 · 당일자산총액 · 당일매매비용 · 전일대비 평가손익 · 실현손익 · 총손익
// 헤더 2줄(병합셀) — [1줄] 일자·종목명·기간 중 매수(3칸)·기간 중 매도(3칸)·매매비용·손익금액·수익률
//                   [2줄] (공백)·(공백)·수량·평균단가·매수금액·수량·평균단가·매도금액·(공백...)
// 일자/종목명/매매비용/손익금액은 1줄 헤더에서 찾을 수 있지만, 매도금액은 2줄 헤더(수량·평균단가·매수금액·수량·평균단가·매도금액)에만 있어 2줄 헤더도 같이 참조해야 함.
// 매도 수량도 2줄 헤더에 있는데 "수량" 라벨이 매수/매도 양쪽에 똑같이 찍혀 findIndex로는 매수 쪽(첫 번째)이 잡히므로, 매도금액 바로 2칸 앞(수량·평균단가·매도금액 순서)으로 위치 계산.
// 매매비용은 매도 발생 행에만 찍힘(매수만 있는 행은 0) — 매수수수료는 포함 안 됨. 매도금액은 원화 그대로 사용
export async function parseRealizedProfitMirae(text) {
  const lines = text.trim().split('\n').map(l => l.split('\t'))
  const headerA = lines.findIndex(c => c[0]?.trim() === '일자' && c.some(v => v?.trim() === '종목명'))
  if (headerA === -1 || headerA + 1 >= lines.length) return []
  const norm = s => (s ?? '').trim()
  const idx = name => lines[headerA].findIndex(c => norm(c) === name)
  const idxB = name => lines[headerA + 1].findIndex(c => norm(c) === name)
  const cDate = idx('일자'), cName = idx('종목명'), cSellAmt = idxB('매도금액'), cFee = idx('매매비용'), cProfit = idx('손익금액')
  const cSellQty = cSellAmt - 2

  const result = []
  for (let i = headerA + 2; i < lines.length; i++) {
    const cols = lines[i]
    const dateRaw = cols[cDate]?.trim()
    if (!/^\d{4}\/\d{2}\/\d{2}$/.test(dateRaw || '')) continue
    result.push({
      date: await alignToBusinessDay(dateRaw.replace(/\//g, '-'), 'kr'),
      code: '',
      name: cols[cName]?.trim() || '',
      sellAmount: cleanNumber(cols[cSellAmt]),
      realizedProfit: cleanNumber(cols[cProfit]),
      fee: cleanNumber(cols[cFee]),
      qty: cleanNumber(cols[cSellQty]),
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
export async function parseKiwoomKrTransactions(text) {
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
      date: await toTradeDate(dateRaw.replace(/\//g, '-'), type),
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
export async function parseKiwoomUsTransactions(text) {
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
      date: await toTradeDate(dateRaw.replace(/\//g, '-'), type, 'us'),
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
export async function parseMiraeTransactions(text) {
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
      date: await toTradeDate(dateRaw.replace(/\//g, '-'), type),
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
export async function parseKiwoomKrFuturesTransactions(text) {
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

  // 체결별 실제 손익은 무시되는 원문 매수/매도 행에만 찍혀있음(결제행은 항상 0) — 동일 일자·종목명·매매구분으로 합산해 결제행에 붙임
  const profitByGroup = new Map()
  for (let i = headerB + 1; i + 1 < lines.length; i += 2) {
    const lineA = lines[i], lineB = lines[i + 1]
    const dateRaw = lineA[cDate]?.trim()
    if (!/^\d{4}\/\d{2}\/\d{2}$/.test(dateRaw || '')) continue
    const rawType = lineA[cType]?.trim()
    if (rawType !== '매수' && rawType !== '매도') continue
    const key = `${dateRaw}_${lineA[cName]?.trim()}_${rawType}`
    profitByGroup.set(key, (profitByGroup.get(key) || 0) + cleanNumber(lineB[cProfit]))
  }

  const result = []
  for (let i = headerB + 1; i + 1 < lines.length; i += 2) {
    const lineA = lines[i], lineB = lines[i + 1]
    const dateRaw = lineA[cDate]?.trim()
    if (!/^\d{4}\/\d{2}\/\d{2}$/.test(dateRaw || '')) continue
    const rawType = lineA[cType]?.trim()
    if (!rawType || rawType === '매수' || rawType === '매도') continue
    const type = FUTURES_TYPE_MAP[rawType] || rawType
    const name = lineA[cName]?.trim() || ''
    result.push({
      date: await toFuturesTradeDate(dateRaw.replace(/\//g, '-'), type),
      type,
      name,
      code: name, // 국내 선물옵션은 별도 종목코드가 없어 종목명을 코드로 사용 — 종목별 손익/성과분석에서 집계 가능하도록
      currency: 'KRW',
      qty: cleanNumber(lineA[cQty]),
      price: cleanNumber(lineA[cPrice]),
      amount: Math.abs(cleanNumber(lineA[cAmt])),
      fee: cleanNumber(lineB[cFee]) + cleanNumber(lineB[cLate]),
      tax: cleanNumber(lineB[cTax]),
      // 매수/매도 상관없이 청산손익 있으면(옵션 조기청산 등) 반영 — Firestore가 undefined 필드를 거부하므로 항상 숫자로 채움
      profit: profitByGroup.get(`${dateRaw}_${name}_${type}`) || 0,
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
