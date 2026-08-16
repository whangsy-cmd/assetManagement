// 공공데이터포털 특일 정보(SpcdeInfoService.getHoliDeInfo) — 관공서 공휴일(대체공휴일 포함) 조회.
// serviceKey는 빌드에 포함되면 배포된 정적 파일에서 그대로 추출 가능하므로 Firestore(본인 uid 경로)에서 런타임에 읽어온다.
import { getPublicDataApiKey } from './firestore'

let _uid = null
export function setKrHolidayAuthUid(uid) {
  _uid = uid
  _cache.clear()
}

const _cache = new Map() // year -> Promise<Set<'YYYY-MM-DD'>>

// KRX는 공공기관 휴일(API 결과)과 별개로 근로자의날(5/1)·12/31(폐장일, 결제 불가)에도 휴장 — API엔 안 나와서 항상 추가.
export function getKrMarketHolidays(year) {
  if (_cache.has(year)) return _cache.get(year)
  const promise = (async () => {
    if (!_uid) throw new Error('로그인이 필요합니다.')
    const serviceKey = await getPublicDataApiKey(_uid)
    if (!serviceKey) throw new Error('공공데이터포털 API 키가 설정되지 않았습니다. 계좌 관리에서 등록하세요.')
    const url = `https://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getHoliDeInfo?serviceKey=${serviceKey}&solYear=${year}&_type=json&numOfRows=50`
    const res = await fetch(url)
    if (!res.ok) throw new Error(`공휴일 조회 실패 (${year})`)
    const data = await res.json()
    const items = data?.response?.body?.items?.item
    const list = Array.isArray(items) ? items : (items ? [items] : [])
    const set = new Set(
      list.filter(it => it.isHoliday === 'Y').map(it => {
        const s = String(it.locdate)
        return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`
      })
    )
    set.add(`${year}-05-01`)
    set.add(`${year}-12-31`)
    return set
  })()
  _cache.set(year, promise)
  return promise
}
