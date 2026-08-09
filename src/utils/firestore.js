import {
  doc, setDoc, getDoc, getDocs, collection, deleteDoc,
  serverTimestamp, writeBatch, query
} from 'firebase/firestore'
import { lookupSector } from './sectorLookup'

function toCatKey(cat) {
  if (['isa', 'irp', 'pension'].includes(cat)) return 'pension'
  if (cat === 'overseas') return 'overseas'
  return 'domestic'
}
import { db } from '../firebase'

// ── 컬렉션 전체 삭제 (500개 단위 배치) ─────────────────────
async function deleteCollection(uid, colName) {
  const snap = await getDocs(collection(db, 'users', uid, colName))
  const docs = snap.docs
  for (let i = 0; i < docs.length; i += 500) {
    const batch = writeBatch(db)
    docs.slice(i, i + 500).forEach(d => batch.delete(d.ref))
    await batch.commit()
  }
}

export async function deleteCollectionData(uid, colName) {
  await deleteCollection(uid, colName)
}

export async function countCollection(uid, colName) {
  const snap = await getDocs(collection(db, 'users', uid, colName))
  return snap.size
}

// ── 보유종목 저장 ───────────────────────────────────────────
export async function saveHoldings(uid, date, holdings) {
  const batch = writeBatch(db)
  for (const h of holdings) {
    const id = `${date}_${h.accountId}_${h.code}`
    const ref = doc(db, 'users', uid, 'holdings', id)
    batch.set(ref, { ...h, id, date, createdAt: serverTimestamp() })
  }
  await batch.commit()
}

// ── 예수금 저장 ─────────────────────────────────────────────
export async function saveCash(uid, date, cashList) {
  const batch = writeBatch(db)
  for (const c of cashList) {
    const id = `${date}_${c.accountId}`
    const ref = doc(db, 'users', uid, 'cash', id)
    batch.set(ref, { ...c, id, date, createdAt: serverTimestamp() })
  }
  await batch.commit()
}

// ── 섹터 자동 생성 (신규 종목은 거래소 섹터 자동 조회) ──────
export async function ensureSectors(uid, holdings) {
  const uniqueCodes = [...new Set(holdings.map(h => h.code).filter(Boolean))]
  if (!uniqueCodes.length) return

  // 이미 등록된 코드 확인 (병렬)
  const snaps = await Promise.all(
    uniqueCodes.map(code => getDoc(doc(db, 'users', uid, 'sectors', code)))
  )
  const newCodes = uniqueCodes.filter((_, i) => !snaps[i].exists())
  if (!newCodes.length) return

  // 신규 종목만 섹터 조회 (병렬)
  const holdingByCode = Object.fromEntries(holdings.map(h => [h.code, h]))
  const resolved = await Promise.all(
    newCodes.map(async code => ({
      code,
      name: holdingByCode[code]?.name || '',
      sector: (await lookupSector(code)) ?? '미분류',
    }))
  )

  const batch = writeBatch(db)
  for (const { code, name, sector } of resolved) {
    batch.set(doc(db, 'users', uid, 'sectors', code), {
      code, name, sector, memo: '', updatedAt: serverTimestamp(),
    })
  }
  await batch.commit()
}

// ── 스냅샷 생성 ─────────────────────────────────────────────
export async function createSnapshot(uid, date) {
  const [holdingsSnap, cashSnap, loansSnap, accountsSnap] = await Promise.all([
    getDocs(query(collection(db, 'users', uid, 'holdings'))),
    getDocs(query(collection(db, 'users', uid, 'cash'))),
    getDocs(collection(db, 'users', uid, 'loans')),
    getDocs(collection(db, 'users', uid, 'accounts')),
  ])

  const todayHoldings = holdingsSnap.docs.map(d => d.data()).filter(d => d.date === date)
  const todayCash = cashSnap.docs.map(d => d.data()).filter(d => d.date === date)
  const loans = loansSnap.docs.map(d => d.data())
  const accountCatMap = Object.fromEntries(
    accountsSnap.docs.map(d => d.data()).map(a => [a.accountId, a.category])
  )

  // 이전 스냅샷 조회 (증감 계산용) — orderBy 없이 클라이언트 정렬
  const allSnaps = await getDocs(collection(db, 'users', uid, 'snapshots'))
  const prev = allSnaps.docs
    .map(d => d.data())
    .filter(d => d.date < date)
    .sort((a, b) => b.date.localeCompare(a.date))[0] ?? null

  // 카테고리별 잔액 집계
  const balances = { pension: 0, domestic: 0, overseas: 0 }
  for (const h of todayHoldings) {
    balances[toCatKey(accountCatMap[h.accountId] || 'domestic')] += h.evalAmt || 0
  }
  for (const c of todayCash) {
    balances[toCatKey(accountCatMap[c.accountId] || 'domestic')] += c.amount || 0
  }

  // 카테고리 객체 생성 (잔액, 증감, 증가율)
  function makeCat(key) {
    const balance = balances[key]
    const prevBalance = prev?.[key]?.balance ?? 0
    const change = balance - prevBalance
    const changeRate = prevBalance > 0 ? (change / prevBalance) * 100 : 0
    return { balance, change, changeRate }
  }

  const pension = makeCat('pension')
  const domestic = makeCat('domestic')
  const overseas = makeCat('overseas')

  const totalBalance = pension.balance + domestic.balance + overseas.balance
  const prevTotalBalance = prev?.totalBalance ?? 0
  const totalChange = totalBalance - prevTotalBalance
  const totalChangeRate = prevTotalBalance > 0 ? (totalChange / prevTotalBalance) * 100 : 0

  const totalLoan = loans.reduce((sum, l) => sum + (l.amount || 0), 0)
  const netBalance = totalBalance - totalLoan

  await setDoc(doc(db, 'users', uid, 'snapshots', date), {
    date,
    pension,
    domestic,
    overseas,
    totalBalance,
    totalChange,
    totalChangeRate,
    totalLoan,
    netBalance,
    createdAt: serverTimestamp(),
  })
}

// ── 대출금 CRUD ─────────────────────────────────────────────
export async function getLoans(uid) {
  const snap = await getDocs(collection(db, 'users', uid, 'loans'))
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
}

export async function saveLoan(uid, loan) {
  const id = loan.id || `loan_${Date.now()}`
  await setDoc(doc(db, 'users', uid, 'loans', id), { ...loan, id, updatedAt: serverTimestamp() })
  return id
}

export async function deleteLoan(uid, id) {
  await deleteDoc(doc(db, 'users', uid, 'loans', id))
}

// ── 계좌 목록 조회 ──────────────────────────────────────────
export async function getAccounts(uid) {
  const snap = await getDocs(collection(db, 'users', uid, 'accounts'))
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
}

// ── 스냅샷 히스토리 조회 ────────────────────────────────────
export async function getSnapshots(uid, count = 52) {
  const snap = await getDocs(collection(db, 'users', uid, 'snapshots'))
  return snap.docs.map(d => d.data())
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-count)
}

// ── 최신 보유종목 조회 (대시보드용) ────────────────────────
export async function getLatestHoldings(uid) {
  const snap = await getDocs(collection(db, 'users', uid, 'holdings'))
  const all = snap.docs.map(d => d.data())
  if (!all.length) return []
  const latestDate = all.map(d => d.date).sort().at(-1)
  return all.filter(d => d.date === latestDate)
}

// ── 최신 예수금 조회 (대시보드용) ──────────────────────────
export async function getLatestCash(uid) {
  const snap = await getDocs(collection(db, 'users', uid, 'cash'))
  const all = snap.docs.map(d => d.data())
  if (!all.length) return []
  const latestDate = all.map(d => d.date).sort().at(-1)
  return all.filter(d => d.date === latestDate)
}

// ── 섹터 목록 조회 ──────────────────────────────────────────
export async function getSectors(uid) {
  const snap = await getDocs(collection(db, 'users', uid, 'sectors'))
  return snap.docs.map(d => d.data())
}

// ── 섹터 저장 ───────────────────────────────────────────────
export async function saveSector(uid, sector) {
  await setDoc(
    doc(db, 'users', uid, 'sectors', sector.code),
    { ...sector, updatedAt: serverTimestamp() },
    { merge: true }
  )
}

// ── 전체 보유종목 조회 (데이터 조회용) ─────────────────────
export async function getAllHoldings(uid) {
  const snap = await getDocs(collection(db, 'users', uid, 'holdings'))
  return snap.docs.map(d => ({ docId: d.id, ...d.data() }))
    .sort((a, b) => b.date.localeCompare(a.date))
}

// ── 전체 예수금 조회 (데이터 조회용) ───────────────────────
export async function getAllCash(uid) {
  const snap = await getDocs(collection(db, 'users', uid, 'cash'))
  return snap.docs.map(d => ({ docId: d.id, ...d.data() }))
    .sort((a, b) => b.date.localeCompare(a.date))
}

// ── 전체 스냅샷 조회 (데이터 조회용) ───────────────────────
export async function getAllSnapshots(uid) {
  const snap = await getDocs(collection(db, 'users', uid, 'snapshots'))
  return snap.docs.map(d => ({ docId: d.id, ...d.data() }))
    .sort((a, b) => b.date.localeCompare(a.date))
}

// ── 입출금내역 저장 (거래번호 기준 중복방지) ────────────────
export async function saveCashFlows(uid, rows) {
  const noAccount = rows.find(r => !r.accountId)
  if (noAccount) throw new Error(`계좌번호가 없는 데이터가 있습니다: ${noAccount.date} ${noAccount.memo}`)
  for (let i = 0; i < rows.length; i += 500) {
    const batch = writeBatch(db)
    for (const r of rows.slice(i, i + 500)) {
      const id = `${r.accountId}_${r.tradeNo}`
      const ref = doc(db, 'users', uid, 'cashFlows', id)
      batch.set(ref, { ...r, id, createdAt: serverTimestamp() })
    }
    await batch.commit()
  }
}

// ── 전체 입출금내역 조회 (데이터 조회용) ────────────────────
export async function getAllCashFlows(uid) {
  const snap = await getDocs(collection(db, 'users', uid, 'cashFlows'))
  return snap.docs.map(d => ({ docId: d.id, ...d.data() }))
    .sort((a, b) => b.date.localeCompare(a.date))
}

// ── 계좌별 마지막 입출금내역 날짜 조회 ──────────────────────
export async function getLastCashFlowDate(uid, accountId) {
  const snap = await getDocs(collection(db, 'users', uid, 'cashFlows'))
  const dates = snap.docs.map(d => d.data()).filter(d => d.accountId === accountId).map(d => d.date)
  return dates.length ? dates.sort().at(-1) : null
}

// ── 옵션계좌 월별손익 저장/조회 (입출금내역과 별도 컬렉션, 브로커 제공 월손익 직접 입력) ──
export async function saveOptionMonthlyProfit(uid, rows) {
  const noAccount = rows.find(r => !r.accountId)
  if (noAccount) throw new Error(`계좌번호가 없는 데이터가 있습니다: ${noAccount.month}`)
  const batch = writeBatch(db)
  for (const r of rows) {
    const id = `${r.accountId}_${r.month}`
    const ref = doc(db, 'users', uid, 'optionMonthlyProfit', id)
    batch.set(ref, { ...r, id, createdAt: serverTimestamp() })
  }
  await batch.commit()
}

export async function getAllOptionMonthlyProfit(uid) {
  const snap = await getDocs(collection(db, 'users', uid, 'optionMonthlyProfit'))
  return snap.docs.map(d => ({ docId: d.id, ...d.data() }))
    .sort((a, b) => b.month.localeCompare(a.month))
}

export async function getLastOptionMonth(uid, accountId) {
  const snap = await getDocs(collection(db, 'users', uid, 'optionMonthlyProfit'))
  const months = snap.docs.map(d => d.data()).filter(d => d.accountId === accountId).map(d => d.month)
  return months.length ? months.sort().at(-1) : null
}

// ── 계좌별 평가 테이블 저장/조회 (holdings+cash 집계 결과 materialize) ──
export async function saveAccountEval(uid, rows) {
  for (let i = 0; i < rows.length; i += 500) {
    const batch = writeBatch(db)
    for (const r of rows.slice(i, i + 500)) {
      const id = `${r.date}_${r.accountId}`
      const ref = doc(db, 'users', uid, 'accountEval', id)
      batch.set(ref, { ...r, id, createdAt: serverTimestamp() })
    }
    await batch.commit()
  }
}

export async function getAllAccountEval(uid) {
  const snap = await getDocs(collection(db, 'users', uid, 'accountEval'))
  return snap.docs.map(d => ({ docId: d.id, ...d.data() }))
    .sort((a, b) => b.date.localeCompare(a.date) || a.accountId.localeCompare(b.accountId))
}

// ── 임시 계좌 일별 잔고 저장/조회 (브로커 리포트 붙여넣기 이전용) ──
export async function saveTempAccountBalance(uid, rows) {
  for (let i = 0; i < rows.length; i += 500) {
    const batch = writeBatch(db)
    for (const r of rows.slice(i, i + 500)) {
      const id = `${r.date}_${r.accountId}`
      const ref = doc(db, 'users', uid, 'tempAccountDailyBalance', id)
      batch.set(ref, { ...r, id, createdAt: serverTimestamp() })
    }
    await batch.commit()
  }
}

export async function getAllTempAccountBalance(uid) {
  const snap = await getDocs(collection(db, 'users', uid, 'tempAccountDailyBalance'))
  return snap.docs.map(d => ({ docId: d.id, ...d.data() }))
    .sort((a, b) => b.date.localeCompare(a.date) || a.accountId.localeCompare(b.accountId))
}

// ── 컬렉션 원본 문서 전체 조회 (백업용, 가공 없음) ──────────
export async function getAllDocsRaw(uid, colName) {
  const snap = await getDocs(collection(db, 'users', uid, colName))
  return snap.docs.map(d => ({ docId: d.id, ...d.data() }))
}

// ── 문서 단건 삭제 ──────────────────────────────────────────
export async function deleteDocument(uid, colName, docId) {
  await deleteDoc(doc(db, 'users', uid, colName, docId))
}

// ── 키움 API 키 저장/조회 (Firestore, 본인만 read 가능하도록 보안규칙 필요) ──
export async function saveKiwoomKeys(uid, keys) {
  await setDoc(doc(db, 'users', uid, 'settings', 'kiwoomKeys'), keys, { merge: true })
}

export async function getKiwoomKeys(uid) {
  const snap = await getDoc(doc(db, 'users', uid, 'settings', 'kiwoomKeys'))
  return snap.exists() ? snap.data() : null
}

// ── 리밸런싱 리포트 기본값 저장/조회 ────────────────────────
export async function getRebalanceSettings(uid) {
  const snap = await getDoc(doc(db, 'users', uid, 'settings', 'rebalance'))
  return snap.exists() ? snap.data() : null
}

export async function saveRebalanceSettings(uid, settings) {
  await setDoc(doc(db, 'users', uid, 'settings', 'rebalance'), settings, { merge: true })
}

// ── 이자·배당 소득 저장 ─────────────────────────────────────
export async function saveIncomeReport(uid, report) {
  await setDoc(doc(db, 'users', uid, 'incomeReports', String(report.year)), {
    ...report,
    updatedAt: serverTimestamp(),
  })
}

// ── 이자·배당 소득 전체 조회 ────────────────────────────────
export async function getIncomeReports(uid) {
  const snap = await getDocs(collection(db, 'users', uid, 'incomeReports'))
  return snap.docs.map(d => d.data()).sort((a, b) => b.year - a.year)
}

// ── 이자·배당 소득 단건 삭제 ────────────────────────────────
export async function deleteIncomeReport(uid, year) {
  await deleteDoc(doc(db, 'users', uid, 'incomeReports', String(year)))
}

// ── 특정 날짜 전체 삭제 ─────────────────────────────────────
export async function deleteDateData(uid, colName, date) {
  const snap = await getDocs(collection(db, 'users', uid, colName))
  const targets = snap.docs.filter(d => d.data().date === date)
  for (let i = 0; i < targets.length; i += 500) {
    const batch = writeBatch(db)
    targets.slice(i, i + 500).forEach(d => batch.delete(d.ref))
    await batch.commit()
  }
}

// ── 특정 계좌 전체 삭제 ─────────────────────────────────────
export async function deleteAccountData(uid, colName, accountId) {
  const snap = await getDocs(collection(db, 'users', uid, colName))
  const targets = snap.docs.filter(d => d.data().accountId === accountId)
  for (let i = 0; i < targets.length; i += 500) {
    const batch = writeBatch(db)
    targets.slice(i, i + 500).forEach(d => batch.delete(d.ref))
    await batch.commit()
  }
}
