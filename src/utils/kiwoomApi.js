// 키움 REST API — 브라우저에서 api.kiwoom.com 직접 호출
// CORS가 차단되면 브라우저 콘솔에 CORS 오류가 표시됩니다
// appkey/secretkey는 빌드에 포함되면 배포된 정적 파일에서 그대로 추출 가능하므로
// Firestore(본인 uid 경로, 보안규칙으로 보호)에서 런타임에 읽어온다.

import { getKiwoomKeys } from './firestore'

const KIWOOM_BASE = 'https://api.kiwoom.com'

let _uid = null
let _keysCache = null

export function setKiwoomAuthUid(uid) {
  if (uid !== _uid) _keysCache = null
  _uid = uid
}

export function clearKiwoomKeysCache() {
  _keysCache = null
}

async function loadKeys() {
  if (_keysCache) return _keysCache
  if (!_uid) throw new Error('로그인이 필요합니다.')
  const data = await getKiwoomKeys(_uid)
  if (!data) throw new Error('키움 API 키가 설정되지 않았습니다. 계좌 관리에서 등록하세요.')
  _keysCache = data
  return _keysCache
}

const _tokens = { kr: null, us: null }
const _expiry = { kr: 0,    us: 0    }

async function getToken(kind) {
  if (_tokens[kind] && Date.now() < _expiry[kind]) return _tokens[kind]
  const keys = await loadKeys()
  const appkey = keys[`${kind}_appkey`]
  const secretkey = keys[`${kind}_secretkey`]
  if (!appkey || !secretkey) throw new Error(`키움 ${kind === 'kr' ? '국내' : '해외'} API 키가 설정되지 않았습니다.`)
  const res = await fetch(`${KIWOOM_BASE}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json;charset=UTF-8' },
    body: JSON.stringify({ grant_type: 'client_credentials', appkey, secretkey }),
  })
  const data = await res.json()
  if (!data.token) throw new Error('토큰 발급 실패: ' + JSON.stringify(data))
  _tokens[kind] = data.token
  _expiry[kind] = Date.now() + 23 * 3600 * 1000
  return _tokens[kind]
}

export async function kiwoomCall(kind, apiId, body, path = '/api/dostk/acnt') {
  const token = await getToken(kind)
  const res = await fetch(`${KIWOOM_BASE}${path}`, {
    method: 'POST',
    headers: {
      Authorization:  `Bearer ${token}`,
      'Content-Type': 'application/json;charset=UTF-8',
      'api-id':       apiId,
      'cont-yn':      'N',
      'next-key':     '',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`Kiwoom ${res.status} ${await res.text()}`)
  return res.json()
}

export const fetchKrHoldings = () => kiwoomCall('kr', 'kt00018', { qry_tp: '0', dmst_stex_tp: 'KRX' })
export const fetchKrCash     = () => kiwoomCall('kr', 'kt00001', { qry_tp: '0', dmst_stex_tp: 'KRX' })

export const fetchUsLedger = () => kiwoomCall('us', 'ust21070', { stex_tp: '', stk_cd: '' }, '/api/us/acnt')

export const fetchUsCashDetail = () => kiwoomCall('us', 'ust21160', {}, '/api/us/acnt')

// cont-yn/next-key 페이징하며 리스트 응답 전체 수집. 유량 초과(HTTP 429 또는 return_code 5) 시 대기 후 재시도
async function kiwoomListCall(kind, apiId, path, body, listKey) {
  const token = await getToken(kind)
  let contYn = 'N', nextKey = ''
  const rows = []
  for (let page = 0; page < 20; page++) {
    if (page > 0) await sleep(250)

    let res, data
    for (let retry = 0; retry < 4; retry++) {
      res = await fetch(`${KIWOOM_BASE}${path}`, {
        method: 'POST',
        headers: {
          Authorization:  `Bearer ${token}`,
          'Content-Type': 'application/json;charset=UTF-8',
          'api-id':       apiId,
          'cont-yn':      contYn,
          'next-key':     nextKey,
        },
        body: JSON.stringify(body),
      })
      if (res.status === 429) { await sleep(1200); continue }
      if (!res.ok) throw new Error(`Kiwoom ${res.status} ${await res.text()}`)
      data = await res.json()
      if (data.return_code === 5) { await sleep(1200); continue }
      break
    }
    if (!data) throw new Error('Kiwoom 429 — 유량 초과 재시도 실패. 잠시 후 다시 시도하세요.')
    if (data.return_code !== undefined && data.return_code !== 0)
      throw new Error(`[${data.return_code}] ${data.return_msg || '조회 실패'}`)
    rows.push(...(data[listKey] ?? []))
    const cy = res.headers.get('cont-yn') || 'N'
    const nk = res.headers.get('next-key') || ''
    if (cy !== 'Y' || !nk) break
    contYn = 'Y'; nextKey = nk
  }
  return rows
}

// 위탁종합거래내역요청(kt00015) — tp:'1'(입출금)만 조회
export const fetchKrCashFlows = (strtDt, endDt) => kiwoomListCall(
  'kr', 'kt00015', '/api/dostk/acnt',
  { strt_dt: strtDt, end_dt: endDt, tp: '1', stk_cd: '', crnc_cd: '', gds_tp: '0', frgn_stex_code: '', dmst_stex_tp: '%' },
  'trst_ovrl_trde_prps_array'
)

// ── 응답 → 앱 데이터 변환 ───────────────────────────────────────
function num(v) { return Number(String(v ?? 0).replace(/[,\s]/g, '')) || 0 }
function str(v) { return String(v ?? '').trim() }
const toIso = (yyyymmdd) => `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

// ── 차트(일봉) 조회 — cont-yn/next-key 페이징, dateField 기준일 이하면 조기 종료 ──
// 키움 차트 API는 TR당 초당 요청 수 제한이 있어(예: usa06012 유량=5) 페이지 사이 간격을 두고,
// 유량 초과(return_code 5) 시 잠시 대기 후 재시도한다.
async function kiwoomChartCall(kind, apiId, path, body, dateField, stopAtDt) {
  const token = await getToken(kind)
  let contYn = 'N', nextKey = ''
  const rows = []
  for (let page = 0; page < 60; page++) {
    if (page > 0) await sleep(250)

    let data, res
    for (let retry = 0; retry < 4; retry++) {
      res = await fetch(`${KIWOOM_BASE}${path}`, {
        method: 'POST',
        headers: {
          Authorization:  `Bearer ${token}`,
          'Content-Type': 'application/json;charset=UTF-8',
          'api-id':       apiId,
          'cont-yn':      contYn,
          'next-key':     nextKey,
        },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error(`Kiwoom ${res.status} ${await res.text()}`)
      data = await res.json()
      if (data.return_code === 5) { await sleep(1200); continue } // 유량 초과 — 대기 후 재시도
      break
    }
    if (data.return_code !== undefined && data.return_code !== 0) {
      throw new Error(`[${data.return_code}] ${data.return_msg || '조회 실패'}`)
    }
    const listKey = Object.keys(data).find(k => Array.isArray(data[k]))
    const page_rows = listKey ? data[listKey] : []
    rows.push(...page_rows)

    const oldest = page_rows.length ? page_rows[page_rows.length - 1][dateField] : null
    if (oldest && oldest <= stopAtDt) break

    const cy = res.headers.get('cont-yn') || 'N'
    const nk = res.headers.get('next-key') || ''
    if (cy !== 'Y' || !nk || !page_rows.length) break
    contYn = 'Y'; nextKey = nk
  }
  return rows
}

// 국내 종목 일봉 (ka10081) — base_dt부터 과거로 페이징
export async function fetchKrDailyChart(code, fromISO, toISO) {
  const fromDt = fromISO.replace(/-/g, ''), toDt = toISO.replace(/-/g, '')
  const rows = await kiwoomChartCall(
    'kr', 'ka10081', '/api/dostk/chart',
    { stk_cd: code, base_dt: toDt, upd_stkpc_tp: '1' },
    'dt', fromDt
  )
  return rows
    .map(r => ({ date: toIso(r.dt), close: num(r.cur_prc) }))
    .filter(r => r.date >= fromISO && r.date <= toISO)
    .sort((a, b) => a.date.localeCompare(b.date))
}

// 미국 종목 일봉 (usa06012) — 거래소구분(ND:나스닥/NY:뉴욕/NA:아멕스) 순차 시도
export async function fetchUsDailyChart(code, fromISO, toISO) {
  const fromDt = fromISO.replace(/-/g, ''), toDt = toISO.replace(/-/g, '')
  let lastErr
  for (const stex of ['ND', 'NY', 'NA']) {
    try {
      const rows = await kiwoomChartCall(
        'us', 'usa06012', '/api/us/chart',
        { stex_tp: stex, stk_cd: code, strt_dt: toDt, upd_stkpc_tp: '1', exrt_appl_tp: '0' },
        'dt', fromDt
      )
      if (rows.length) {
        return rows
          .map(r => ({ date: toIso(r.dt), close: num(r.cur_prc) }))
          .filter(r => r.date >= fromISO && r.date <= toISO)
          .sort((a, b) => a.date.localeCompare(b.date))
      }
    } catch (e) { lastErr = e }
  }
  throw lastErr || new Error(`${code}: 해당 종목의 데이터를 찾을 수 없습니다.`)
}

export function transformKrHoldings(raw, accountId) {
  const items = raw.acnt_evlt_remn_indv_tot ?? []
  return items
    .map(it => ({
      code:        str(it.stk_cd).replace(/^A/, ''),
      name:        str(it.stk_nm),
      qty:         num(it.rmnd_qty),
      evalAmt:     num(it.evlt_amt),
      purchaseAmt: num(it.pur_amt),
      gainLoss:    num(it.evltv_prft),
      returnRate:  num(it.prft_rt),
      accountId,
      broker: 'kiwoom_kr',
    }))
    .filter(h => h.code && h.qty > 0)
}

export function transformKrCash(raw, accountId) {
  return [{ accountId, amount: num(raw['100stk_ord_alow_amt']) }]
}

// 원화환산 금액 기준 (국내 보유종목과 합산 가능하도록)
export function transformUsHoldings(raw, accountId) {
  const items = raw.result_list ?? []
  return items
    .map(it => ({
      code:        str(it.stk_cd),
      name:        str(it.frgn_stk_nm),
      qty:         num(it.poss_qty),
      evalAmt:     num(it.evlt_amt_krw),
      purchaseAmt: num(it.frgn_stk_book_amt_krw),
      gainLoss:    num(it.pl_amt_krw),
      returnRate:  num(it.pl_rt),
      accountId,
      broker: 'kiwoom_us',
    }))
    .filter(h => h.code && h.qty > 0)
}

// D+2 원화환산추정인출가능금액 기준
export function transformUsCash(raw, accountId) {
  return [{ accountId, amount: num(raw.d2_won_conv_alow_ch) }]
}

export function transformKrCashFlows(rows, accountId) {
  return rows
    .filter(it => str(it.trde_no))
    .map(it => ({
      accountId,
      broker: 'kiwoom_kr',
      date: toIso(it.trde_dt),
      tradeNo: `${str(it.trde_dt)}_${str(it.trde_no)}`,
      ioType: str(it.io_tp_nm),
      amount: num(it.trde_amt),
      memo: str(it.rmrk_nm),
      balance: num(it.entra_remn),
      time: str(it.proc_tm),
    }))
}
