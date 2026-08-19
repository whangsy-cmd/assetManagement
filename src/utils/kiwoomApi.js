// 키움 REST API — 브라우저에서 api.kiwoom.com 직접 호출
// CORS가 차단되면 브라우저 콘솔에 CORS 오류가 표시됩니다
// appkey/secretkey는 빌드에 포함되면 배포된 정적 파일에서 그대로 추출 가능하므로
// Firestore(본인 uid 경로, 보안규칙으로 보호)에서 런타임에 읽어온다.

import { getKiwoomKeys } from './firestore'
import { TRANSFER_TYPES } from './finance'
import { alignToBusinessDay } from './parsers'

// 앱이 분류 가능한 거래종류(적요명)인지 — 이체/매매/배당·이자/세금 중 하나에도 안 걸리면 미확인 유형
const isKnownTxType = (type) =>
  TRANSFER_TYPES.has(type) || /매수|매도/.test(type) || /배당|분배금|이자|이용료/.test(type) || type.includes('세')

const KIWOOM_BASE = 'https://api.kiwoom.com'

// ── 전역 호출 제한 (초당 5회) — 화면 여러 곳에서 동시에 호출해도 합산 5회/초를 넘지 않도록 모든 Kiwoom 요청을 하나의 큐로 직렬화 ──
const RATE_LIMIT_INTERVAL = 210 // ms, 초당 5회(200ms)보다 살짝 여유
let _rateQueue = Promise.resolve()
let _lastCallAt = 0

// ── 최근 API 요청/응답 로그 (오류/빈 결과 디버깅용 팝업에서 표시) — 토큰 발급(secretkey 포함)은 절대 기록 안 함 ──
const _callLog = []
export function getKiwoomCallLog() { return _callLog }
function logCall(url, body, status, responseText) {
  let request, response
  try { request = JSON.parse(body) } catch { request = body }
  try { response = JSON.parse(responseText) } catch { response = responseText }
  _callLog.push({ time: new Date().toISOString(), url, request, status, response })
  if (_callLog.length > 10) _callLog.shift()
}

function throttledFetch(url, opts) {
  const run = _rateQueue.then(async () => {
    const wait = _lastCallAt + RATE_LIMIT_INTERVAL - Date.now()
    if (wait > 0) await sleep(wait)
    _lastCallAt = Date.now()
    const res = await fetch(url, opts)
    if (!url.includes('/oauth2/token')) {
      res.clone().text().then(text => logCall(url, opts.body, res.status, text)).catch(() => {})
    }
    return res
  })
  _rateQueue = run.then(() => {}, () => {}) // 에러 나도 큐는 계속 진행
  return run
}

let _uid = null
let _keysCache = null

export function setKiwoomAuthUid(uid) {
  if (uid !== _uid) {
    _keysCache = null
    // uid가 바뀌면 이전 사용자의 키움 API 토큰도 무효화 (교차 계정 오염 방지)
    _tokens.kr = _tokens.us = null
    _expiry.kr = _expiry.us = 0
  }
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
  const res = await throttledFetch(`${KIWOOM_BASE}/oauth2/token`, {
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
  const res = await throttledFetch(`${KIWOOM_BASE}${path}`, {
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

// 국내 종목 기본정보(ka10001) — 미등록 종목코드 자동등록 시 종목명 조회용
export async function fetchKrStockInfo(code) {
  const data = await kiwoomCall('kr', 'ka10001', { stk_cd: code }, '/api/dostk/stkinfo')
  if (data.return_code !== undefined && data.return_code !== 0) throw new Error(`[${data.return_code}] ${data.return_msg || '조회 실패'}`)
  return { code: str(data.stk_cd) || code, name: str(data.stk_nm) }
}

// 미국 종목 조회(usa10100) — 미등록 종목코드 자동등록 시 종목명 조회용. 거래소구분(ND/NY/NA) 순차 시도
export async function fetchUsStockInfo(code) {
  let lastErr
  for (const stex of ['ND', 'NY', 'NA']) {
    try {
      const data = await kiwoomCall('us', 'usa10100', { stex_tp: stex, stk_cd: code }, '/api/us/stkinfo')
      if (data.return_code !== undefined && data.return_code !== 0) throw new Error(`[${data.return_code}] ${data.return_msg || '조회 실패'}`)
      const name = str(data.stk_nm) || str(data.stk_enm)
      if (name) return { code: str(data.stk_cd) || code, name }
    } catch (e) { lastErr = e }
  }
  throw lastErr || new Error(`${code}: 해당 종목의 정보를 찾을 수 없습니다.`)
}

export const fetchUsLedger = () => kiwoomCall('us', 'ust21070', { stex_tp: '', stk_cd: '' }, '/api/us/acnt')

export const fetchUsCashDetail = () => kiwoomCall('us', 'ust21160', {}, '/api/us/acnt')

// cont-yn/next-key 페이징하며 리스트 응답 전체 수집. 유량 초과(HTTP 429 또는 return_code 5) 시 대기 후 재시도
async function kiwoomListCall(kind, apiId, path, body, listKey) {
  const token = await getToken(kind)
  let contYn = 'N', nextKey = ''
  const rows = []
  let notice = ''
  for (let page = 0; page < 20; page++) {
    let res, data
    for (let retry = 0; retry < 4; retry++) {
      res = await throttledFetch(`${KIWOOM_BASE}${path}`, {
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
    // return_code 0(성공)이어도 "최근 1년까지만 조회 가능" 같은 안내가 return_msg에 실려오는 경우가 있어 보존 — 결과가 비어도 이유를 보여주기 위함
    const msg = (data.return_msg || '').trim()
    if (msg && !/^조회가?\s*완료/.test(msg)) notice = msg
    rows.push(...(data[listKey] ?? []))
    const cy = res.headers.get('cont-yn') || 'N'
    const nk = res.headers.get('next-key') || ''
    if (cy !== 'Y' || !nk) break
    contYn = 'Y'; nextKey = nk
  }
  rows.notice = notice
  return rows
}

// 위탁종합거래내역요청(kt00015) 응답 배열(trst_ovrl_trde_prps_array) 필드 스펙 — 나중에 참조용으로 기록
// trde_dt 거래일자 · trde_no 거래번호 · rmrk_nm 적요명 · crd_deal_tp_nm 신용거래구분명 · exct_amt 정산금액
// loan_amt_rpya 대출금상환 · fc_trde_amt 거래금액(외) · fc_exct_amt 정산금액(외) · entra_remn 예수금잔고 · crnc_cd 통화코드
// trde_ocr_tp 거래종류구분(1:입출금,2:펀드,3:ELS,4:채권,5:해외채권,6:외화RP,7:외화발행어음) · trde_kind_nm 거래종류명
// stk_nm 종목명 · trde_amt 거래금액 · trde_agri_tax 거래및농특세 · rpy_diffa 상환차금 · fc_trde_tax 거래세(외)
// dly_sum 연체합 · fc_entra 외화예수금잔고 · mdia_tp_nm 매체구분명 · io_tp/io_tp_nm 입출구분 · orig_deal_no 원거래번호
// stk_cd 종목코드(접두어 A:주식/J:ELW/Q:ETN + 6자리) · trde_qty_jwa_cnt 거래수량/좌수 · cmsn 수수료 · int_ls_usfe 이자/대주이용
// fc_cmsn 수수료(외) · fc_dly_sum 연체합(외) · vlbl_nowrm 유가금잔 · proc_tm 처리시간 · isin_cd ISIN코드
// stex_cd/stex_nm 거래소코드/명 · trde_unit 거래단가/환율 · incm_resi_tax 소득/주민세 · loan_dt 대출일
// uncl_ocr 미수(원/주) · rpym_sum 변제합 · cntr_dt 체결일 · rcpy_no 출납번호 · prcsr 처리자 · proc_brch 처리점
// trde_stle 매매형태 · txon_base_pric 과세기준가 · tax_sum_cmsn 세금수수료합 · frgn_pay_txam 외국납부세액(외)
// fc_uncl_ocr 미수(외) · rpym_sum_fr 변제합(외) · rcpmnyer 입금자 · trde_prtc_tp 거래내역구분
// (금액류는 좌측 0-padding 부호 포함 15자리 문자열)

// 위탁종합거래내역요청(kt00015) — tp:'1'(입출금)만 조회
export const fetchKrCashFlows = (strtDt, endDt) => kiwoomListCall(
  'kr', 'kt00015', '/api/dostk/acnt',
  { strt_dt: strtDt, end_dt: endDt, tp: '1', stk_cd: '', crnc_cd: '', gds_tp: '0', frgn_stex_code: '', dmst_stex_tp: '%' },
  'trst_ovrl_trde_prps_array'
)

// 위탁종합거래내역요청(kt00015) — tp:'0'(전체, 매매+입출금 등) — 국내 거래내역 붙여넣기 대체용
export const fetchKrTransactions = (strtDt, endDt) => kiwoomListCall(
  'kr', 'kt00015', '/api/dostk/acnt',
  { strt_dt: strtDt, end_dt: endDt, tp: '0', stk_cd: '', crnc_cd: '', gds_tp: '0', frgn_stex_code: '', dmst_stex_tp: '%' },
  'trst_ovrl_trde_prps_array'
)

// 위탁종합거래내역(kt00015) 응답 → 앱 거래내역 포맷(parseKiwoomKrTransactions과 동일한 행 형태, accountId/broker는 호출부에서 부여).
// 체결일(cntr_dt)이 있으면 실제 체결일 사용, 없으면 거래일자(정산일) 사용.
// 앱이 분류 못하는 새 적요명(rmrk_nm)이 나오면 잘못 분류된 채 조용히 저장되는 걸 막기 위해 즉시 오류로 중단
export function transformKrTransactions(raw) {
  const rows = raw
    .filter(it => str(it.rmrk_nm))
    .map(it => {
      const cntrDt = str(it.cntr_dt)
      const dateRaw = cntrDt && cntrDt !== '00000000' ? cntrDt : str(it.trde_dt)
      return {
        date: toIso(dateRaw),
        type: str(it.rmrk_nm),
        name: str(it.stk_nm),
        code: str(it.stk_cd).replace(/^[A-Z]/, ''),
        currency: str(it.crnc_cd) || 'KRW',
        qty: num(it.trde_qty_jwa_cnt),
        price: num(it.trde_unit),
        amount: num(it.trde_amt),
        fee: num(it.cmsn),
        tax: num(it.trde_agri_tax) + num(it.incm_resi_tax),
        time: str(it.proc_tm),
      }
    })

  const unknownTypes = [...new Set(rows.filter(r => !isKnownTxType(r.type)).map(r => r.type))]
  if (unknownTypes.length) throw new Error(`알 수 없는 거래종류: ${unknownTypes.join(', ')} — 분류 로직 확인 필요, 자동 등록 중단됨`)

  return rows
}

// 일자별종목별실현손익요청(ka10073) — stk_cd 비우면 기간 내 전종목 조회. 국내 현금/신용매매 실현손익 붙여넣기(3058-4099) 대체용
export const fetchKrRealizedProfit = (strtDt, endDt) => kiwoomListCall(
  'kr', 'ka10073', '/api/dostk/acnt',
  { stk_cd: '', strt_dt: strtDt, end_dt: endDt },
  'dt_stk_rlzt_pl'
)

// ka10073 응답(dt_stk_rlzt_pl) 필드 스펙 — 나중에 참조용으로 기록
// dt 일자 · tdy_htssel_cmsn 당일hts매도수수료(스펙명과 달리 실제로는 거래구분(현금/신용, crd_tp와 동일값) — 수수료 아님, 사용 안 함)
// stk_nm 종목명 · cntr_qty 체결량 · buy_uv 매입단가 · cntr_pric 체결가 · tdy_sel_pl 당일매도손익 · pl_rt 손익율 · stk_cd 종목코드
// tdy_trde_cmsn 당일매매수수료 · tdy_trde_tax 당일매매세금 · wthd_alowa 인출가능금액 · loan_dt 대출일 · crd_tp 신용구분
// 거래금액(sellAmount) 전용 필드가 없어 체결가×체결량(cntr_pric×cntr_qty)으로 계산 — 붙여넣기 포맷의 수량×매도체결가와 동일한 방식.
// 동일 일자·종목에 분할체결로 여러 행이 올 수 있어(브로커 리포트와 달리 일자별 합산이 안 돼 있음) 호출부에서 합산 필요.
// tdy_trde_cmsn/tdy_trde_tax는 매도 기준이라 매수수수료는 포함 안 됨
export async function transformKrRealizedProfit(raw) {
  return Promise.all(raw.map(async it => ({
    date: await alignToBusinessDay(toIso(str(it.dt)), 'kr'),
    code: str(it.stk_cd),
    name: str(it.stk_nm),
    sellAmount: num(it.cntr_pric) * num(it.cntr_qty),
    realizedProfit: num(it.tdy_sel_pl),
    fee: num(it.tdy_trde_cmsn),
    tax: num(it.tdy_trde_tax),
    qty: num(it.cntr_qty),
  })))
}

// 해외주식 실현손익요청(ust21530) 필드 스펙 — 나중에 참조용으로 기록
// 상단 합계: tot_sell_amt 총매도금액 · tot_buy_amt 총매수금액 · tot_cmsn_tax 총수수료제세금 · tot_exct_amt 총정산금액 · tot_pl_amt 총손익금액 · tot_pl_rt 총실현수익률(%)
// result_list: sell_dt 매도일자 · stk_cd 종목코드 · frgn_stk_nm 종목명 · sell_qty 청산수량 · avg_buy_uv 매입평균가 · buy_amt 매입금액
// avg_sell_uv 매도평균가 · sell_amt 매도금액 · cmsn_tax 수수료제세금(합산, 세금 분리 불가) · pl_amt 손익금액 · pl_rt 실현수익률(%)
// prch_exrt 매입환율 · sell_exrt 매도환율 · krw_chg_dfrn_pl_amt 환차손익(원) · krw_chg_pl_amt 환실현손익(원) · comm_ord_tp 매체구분 · stex_nm 거래소명 · natn_nm 국가명
// fc_krw_tp:'0'(외화 기준)으로 조회 — '1'(원화)로 조회하면 cmsn_tax 등 일부 필드가 원화로 바뀌는지 불명확해서, 붙여넣기 포맷과 동일하게
// 전부 외화로 받아 직접 환산하는 쪽으로 통일. krw_chg_pl_amt(환실현손익)만 원화, sell_amt/cmsn_tax/pl_amt 등 나머지는 전부 외화.
export const fetchUsRealizedProfit = (strtDt, endDt) => kiwoomListCall(
  'us', 'ust21530', '/api/us/acnt',
  { strt_dt: strtDt, end_dt: endDt, fc_krw_tp: '0' },
  'result_list'
)

// ust21530 응답 → 앱 실현손익 행 형태(parseRealizedProfitOverseas와 동일, accountId는 호출부에서 부여).
// realizedProfit은 krw_chg_pl_amt(환실현손익) 대신 pl_amt(손익금액, 외화)×sell_exrt(매도환율)로 직접 계산(환차손익 제외한 순수 매매손익만 원화 반영).
// sellAmount(sell_amt)·liquidationProfit(pl_amt)·fee(cmsn_tax)는 전부 외화 그대로 유지(원화 미환산) — 실현손익만 원화 환산.
// 수수료+제세금 합산 필드라 세금 별도 분리는 불가. cmsn_tax는 매도 기준이라 매수수수료는 포함 안 됨
export async function transformUsRealizedProfit(raw) {
  return Promise.all(raw.map(async it => {
    const sellExrt = num(it.sell_exrt)
    const plAmount = num(it.pl_amt)
    return {
      date: await alignToBusinessDay(toIso(str(it.sell_dt)), 'us'),
      code: str(it.stk_cd),
      name: str(it.frgn_stk_nm),
      sellAmount: num(it.sell_amt),
      liquidationProfit: plAmount,
      realizedProfit: Math.round(plAmount * sellExrt),
      fee: num(it.cmsn_tax),
      exrt: sellExrt,
      qty: num(it.sell_qty),
    }
  }))
}

// ── 응답 → 앱 데이터 변환 ───────────────────────────────────────
function num(v) { return Number(String(v ?? 0).replace(/[,\s]/g, '')) || 0 }
// 시가/고가/저가/종가 필드는 전일대비 등락기호(+/-)가 값에 그대로 섞여와 음수로 파싱되는 경우가 있음 — 가격은 항상 0 이상이므로 절대값 처리
function priceNum(v) { return Math.abs(num(v)) }
function str(v) { return String(v ?? '').trim() }
const toIso = (yyyymmdd) => `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

// ── 차트(일봉) 조회 — cont-yn/next-key 페이징, dateField 기준일 이하면 조기 종료 ──
// 페이지 간격은 throttledFetch가 전역으로 보장(초당 5회 제한). 유량 초과(return_code 5) 시엔 추가로 대기 후 재시도.
async function kiwoomChartCall(kind, apiId, path, body, dateField, stopAtDt) {
  const token = await getToken(kind)
  let contYn = 'N', nextKey = ''
  const rows = []
  for (let page = 0; page < 60; page++) {
    let data, res
    for (let retry = 0; retry < 4; retry++) {
      res = await throttledFetch(`${KIWOOM_BASE}${path}`, {
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
    .map(r => ({ date: toIso(r.dt), close: priceNum(r.cur_prc) }))
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
          .map(r => ({ date: toIso(r.dt), close: priceNum(r.cur_prc) }))
          .filter(r => r.date >= fromISO && r.date <= toISO)
          .sort((a, b) => a.date.localeCompare(b.date))
      }
    } catch (e) { lastErr = e }
  }
  throw lastErr || new Error(`${code}: 해당 종목의 데이터를 찾을 수 없습니다.`)
}

// 국내 종목 일별주가 OHLC (ka10086) — qry_dt부터 과거로 페이징
export async function fetchKrDailyQuote(code, fromISO, toISO) {
  const fromDt = fromISO.replace(/-/g, ''), toDt = toISO.replace(/-/g, '')
  const rows = await kiwoomChartCall(
    'kr', 'ka10086', '/api/dostk/mrkcond',
    { stk_cd: code, qry_dt: toDt, indc_tp: '1' },
    'date', fromDt
  )
  return rows
    .map(r => ({ date: toIso(r.date), open: priceNum(r.open_pric), high: priceNum(r.high_pric), low: priceNum(r.low_pric), close: priceNum(r.close_pric) }))
    .filter(r => r.date >= fromISO && r.date <= toISO)
    .sort((a, b) => a.date.localeCompare(b.date))
}

// 미국 종목 일별주가 OHLC (usa20590) — base_dt부터 과거로 페이징, 거래소구분(ND/NY/NA) 순차 시도
export async function fetchUsDailyQuote(code, fromISO, toISO) {
  const fromDt = fromISO.replace(/-/g, ''), toDt = toISO.replace(/-/g, '')
  let lastErr
  for (const stex of ['ND', 'NY', 'NA']) {
    try {
      const rows = await kiwoomChartCall(
        'us', 'usa20590', '/api/us/mrkcond',
        { stex_tp: stex, stk_cd: code, base_dt: toDt },
        'dt', fromDt
      )
      if (rows.length) {
        return rows
          .map(r => ({ date: toIso(r.dt), open: priceNum(r.open_pric), high: priceNum(r.high_pric), low: priceNum(r.low_pric), close: priceNum(r.cur_prc) }))
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

