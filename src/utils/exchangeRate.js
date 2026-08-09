// 날짜별 USD→KRW 환율 조회 (frankfurter.app, 키 불필요). 같은 날짜는 캐싱해서 한 번만 호출.
const cache = new Map()

export async function getUsdKrwRate(dateISO) {
  if (cache.has(dateISO)) return cache.get(dateISO)
  const res = await fetch(`https://api.frankfurter.dev/v1/${dateISO}?from=USD&to=KRW`)
  if (!res.ok) throw new Error(`환율 조회 실패 (${dateISO})`)
  const data = await res.json()
  const rate = data.rates?.KRW
  if (!rate) throw new Error(`환율 데이터 없음 (${dateISO})`)
  cache.set(dateISO, rate)
  return rate
}
