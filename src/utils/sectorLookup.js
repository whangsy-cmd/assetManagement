// 신규 종목 등록 시 네이버(국내)/야후(해외)에서 섹터 자동 조회
const isKoreanCode = (code) => /^\d{6}$/.test(code)

async function fetchNaverSector(code) {
  const res = await fetch(`https://m.stock.naver.com/api/stock/${code}/basic`)
  if (!res.ok) return null
  const data = await res.json()
  return data?.wicsSectorName ?? null
}

async function fetchYahooSector(symbol) {
  const res = await fetch(
    `https://query2.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbol)}`
  )
  if (!res.ok) return null
  const data = await res.json()
  return data?.quoteResponse?.result?.[0]?.sector ?? null
}

export async function lookupSector(code) {
  if (!code) return null
  try {
    if (isKoreanCode(code)) {
      return await fetchNaverSector(code)
    } else {
      return await fetchYahooSector(code)
    }
  } catch {
    return null
  }
}
