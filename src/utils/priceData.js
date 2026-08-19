// 종목 과거 일별 시세 캐시(priceSeries) 조회/다운로드/CSV 입출력 (셰넌 시뮬레이션용)
import { doc, getDoc, getDocs, setDoc, collection, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase'
import { fetchKrDailyQuote, fetchUsDailyQuote } from './kiwoomApi'

// KRX 코드는 항상 6자리(숫자만이 아니라 워런트/ELW 등은 문자 포함, 예: 0018C0)
export const isKoreanCode = (code) => /^[0-9A-Za-z]{6}$/.test(code)

export function addDays(iso, n) {
  const d = new Date(iso + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export function fetchDailyPrices(code, fromISO, toISO) {
  return isKoreanCode(code) ? fetchKrDailyQuote(code, fromISO, toISO) : fetchUsDailyQuote(code, fromISO, toISO)
}

// ── Firestore: 저장된 종목 목록 ─────────────────────────────
export async function getSavedSymbols(uid) {
  const snap = await getDocs(collection(db, 'users', uid, 'priceSeries'))
  return snap.docs.map(d => {
    const data = d.data()
    return {
      code: data.code,
      name: data.name,
      market: data.market,
      minDate: data.minDate,
      maxDate: data.maxDate,
      count: Object.keys(data.prices || {}).length,
    }
  }).sort((a, b) => a.code.localeCompare(b.code))
}

export async function getPriceSeries(uid, code) {
  const snap = await getDoc(doc(db, 'users', uid, 'priceSeries', code))
  return snap.exists() ? snap.data() : null
}

// ── 없는 구간만 다운로드 후 병합 저장 ───────────────────────
export async function downloadMissingRange(uid, code, name, fromISO, toISO) {
  if (fromISO > toISO) throw new Error('시작일이 종료일보다 늦습니다.')
  const ref = doc(db, 'users', uid, 'priceSeries', code)
  const snap = await getDoc(ref)
  const existing = snap.exists() ? snap.data() : null

  // opens/highs/lows가 없거나(OHLC 추가 전 구버전 캐시) 음수값이 섞여있으면(등락기호가 값에 붙어와 파싱되던 구버전 버그)
  // 캔들차트 표시를 위해 기존 캐시 구간도 포함해서 통째로 다시 받아와 덮어씀
  const noNegatives = (m) => Object.values(m || {}).every(v => v >= 0)
  const hasOhlc = !!(existing?.opens && Object.keys(existing.opens).length)
    && noNegatives(existing.opens) && noNegatives(existing.highs) && noNegatives(existing.lows)

  const ranges = []
  if (!existing) {
    ranges.push([fromISO, toISO])
  } else if (!hasOhlc) {
    ranges.push([fromISO < existing.minDate ? fromISO : existing.minDate, toISO > existing.maxDate ? toISO : existing.maxDate])
  } else {
    if (fromISO < existing.minDate) ranges.push([fromISO, addDays(existing.minDate, -1)])
    if (toISO > existing.maxDate) ranges.push([addDays(existing.maxDate, 1), toISO])
  }

  const newPrices = {}, newOpens = {}, newHighs = {}, newLows = {}
  for (const [f, t] of ranges) {
    if (f > t) continue
    const rows = await fetchDailyPrices(code, f, t)
    for (const r of rows) {
      newPrices[r.date] = r.close
      if (r.open != null) newOpens[r.date] = r.open
      if (r.high != null) newHighs[r.date] = r.high
      if (r.low != null) newLows[r.date] = r.low
    }
  }

  if (!ranges.length || !Object.keys(newPrices).length) {
    return { added: 0, total: existing ? Object.keys(existing.prices || {}).length : 0 }
  }

  const merged = { ...(existing?.prices || {}), ...newPrices }
  const mergedOpens = { ...(existing?.opens || {}), ...newOpens }
  const mergedHighs = { ...(existing?.highs || {}), ...newHighs }
  const mergedLows = { ...(existing?.lows || {}), ...newLows }
  const dates = Object.keys(merged).sort()
  const minDate = dates[0]
  const maxDate = dates.at(-1)

  await setDoc(ref, {
    code,
    name: name || existing?.name || code,
    market: isKoreanCode(code) ? 'KR' : 'US',
    minDate,
    maxDate,
    prices: merged,
    opens: mergedOpens,
    highs: mergedHighs,
    lows: mergedLows,
    updatedAt: serverTimestamp(),
  })

  return { added: Object.keys(newPrices).length, total: Object.keys(merged).length }
}

// ── CSV(date,close) 파싱 — fetch_stock.py 출력 형식 ─────────
export function parseCsvPrices(text) {
  return text.trim().split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !/^date/i.test(line))
    .map(line => {
      const [date, close] = line.split(',').map(s => s.trim())
      return { date, close: Number(close) }
    })
    .filter(r => /^\d{4}-\d{2}-\d{2}$/.test(r.date) && Number.isFinite(r.close))
}

// ── CSV로 가져온 데이터 병합 저장 (외부에서 이미 받아온 데이터) ──
export async function saveCsvPrices(uid, code, name, rows) {
  if (!rows.length) throw new Error('가져올 데이터가 없습니다. date,close 형식인지 확인하세요.')
  const ref = doc(db, 'users', uid, 'priceSeries', code)
  const snap = await getDoc(ref)
  const existing = snap.exists() ? snap.data() : null

  const newPrices = Object.fromEntries(rows.map(r => [r.date, r.close]))
  const merged = { ...(existing?.prices || {}), ...newPrices }
  const dates = Object.keys(merged).sort()

  await setDoc(ref, {
    code,
    name: name || existing?.name || code,
    market: isKoreanCode(code) ? 'KR' : 'US',
    minDate: dates[0],
    maxDate: dates.at(-1),
    prices: merged,
    updatedAt: serverTimestamp(),
  })

  return { added: rows.length, total: dates.length }
}
