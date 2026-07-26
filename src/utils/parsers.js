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
