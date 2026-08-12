// USD 금액을 현재 환율로 환산해 KRW와 합산 (계좌평가 조회/종목별 손익 등에서 공용)
export function toKrw(krwAmt, usdAmt, usdRate) {
  return krwAmt + usdAmt * (usdRate || 0)
}
