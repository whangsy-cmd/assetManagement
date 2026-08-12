// 거래내역 탭 (DataView) — 계좌 선택 후 일자/거래종류별 검색 + 삭제/엑셀 다운로드
import { useEffect, useState } from 'react'
import * as XLSX from 'xlsx'
import { useAuth } from '../../contexts/AuthContext'
import { useAccounts } from '../../hooks/useAccounts'
import { getTransactionsByAccount, deleteDateData, deleteAccountData, deleteCollectionData, countCollection } from '../../utils/firestore'
import DeleteModal from '../../components/DeleteModal'
import { fmt, DateSelect } from './shared'

export default function TransactionsTab() {
  const { user } = useAuth()
  const { accounts } = useAccounts()
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [selectedDate, setSelectedDate] = useState('전체')
  const [selectedAccount, setSelectedAccount] = useState('')
  const [selectedType, setSelectedType] = useState('전체')
  const [modal, setModal] = useState(null) // { type: 'date'|'account'|'all', date?, accountId?, count }
  const [deleting, setDeleting] = useState(false)

  const load = async (accountId) => {
    setLoading(true)
    setLoadError('')
    try {
      const rows = await getTransactionsByAccount(user.uid, accountId)
      setData(rows)
    } catch (e) {
      setLoadError('데이터 로드 오류: ' + e.message)
    }
    setLoading(false)
  }

  useEffect(() => {
    if (!selectedAccount) { setData([]); return }
    setSelectedDate('전체')
    setSelectedType('전체')
    load(selectedAccount)
  }, [selectedAccount])

  const dates = [...new Set(data.map(d => d.date))].sort().reverse()
  const types = [...new Set(data.map(d => d.type))].sort()

  const sorted = [...data].sort((a, b) => b.date.localeCompare(a.date))
    .filter(d => selectedDate === '전체' || d.date === selectedDate)
    .filter(d => selectedType === '전체' || d.type === selectedType)

  const handleDelete = async () => {
    setDeleting(true)
    if (modal.type === 'date') {
      await deleteDateData(user.uid, 'transactions', modal.date)
    } else if (modal.type === 'account') {
      await deleteAccountData(user.uid, 'transactions', modal.accountId)
    } else {
      await deleteCollectionData(user.uid, 'transactions')
    }
    setModal(null)
    await load(selectedAccount)
    setDeleting(false)
  }

  const openDeleteAll = async () => {
    const count = await countCollection(user.uid, 'transactions')
    setModal({ type: 'all', count })
  }

  const handleExport = () => {
    const rows = sorted.map(r => ({
      날짜: r.date,
      계좌: r.accountId,
      거래종류: r.type,
      종목명: r.name,
      종목코드: r.code,
      통화: r.currency,
      수량: r.qty,
      거래금액: r.amount,
      수수료: r.fee,
      세금: r.tax,
      청산손익: r.profit || 0,
    }))
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, '거래내역')
    XLSX.writeFile(wb, `거래내역_${selectedAccount}.xlsx`)
  }

  return (
    <div>
      <div className="toolbar">
        <div className="date-row">
          <span className="tool-label">계좌 선택</span>
          <select value={selectedAccount} onChange={e => setSelectedAccount(e.target.value)} className="select input-sm" style={{ maxWidth: 260 }}>
            <option value="">계좌를 선택하세요</option>
            {accounts.map(a => <option key={a.accountId} value={a.accountId}>{a.name} ({a.accountId})</option>)}
          </select>
          {selectedAccount && (
            <>
              <span className="tool-label">날짜 선택</span>
              <DateSelect id="transactions-dates" dates={dates} value={selectedDate === '전체' ? '' : selectedDate} onChange={setSelectedDate} />
              {selectedDate !== '전체' && (
                <button className="btn btn-outline-red btn-sm" onClick={() => setSelectedDate('전체')}>전체보기</button>
              )}
              <span className="tool-label">거래종류 선택</span>
              <select value={selectedType} onChange={e => setSelectedType(e.target.value)} className="select input-sm" style={{ maxWidth: 260 }}>
                <option value="전체">전체</option>
                {types.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </>
          )}
        </div>
        {selectedAccount && (
          <div className="tool-right">
            <button className="btn btn-outline-green btn-sm" onClick={handleExport}>
              데이터 엑셀 다운로드
            </button>
            {selectedDate !== '전체' && (
              <button className="btn btn-outline-orange btn-sm" onClick={() => setModal({ type: 'date', date: selectedDate, count: data.filter(d => d.date === selectedDate).length })}>
                {selectedDate} 삭제
              </button>
            )}
            <button className="btn btn-outline-orange btn-sm" onClick={() => setModal({ type: 'account', accountId: selectedAccount, count: data.length })}>
              {selectedAccount} 삭제
            </button>
            <button className="btn btn-outline-red btn-sm" onClick={openDeleteAll}>
              전체 삭제
            </button>
          </div>
        )}
      </div>

      {!selectedAccount ? (
        <div className="empty">계좌를 선택하세요.</div>
      ) : loading ? (
        <div className="loading">로딩 중...</div>
      ) : loadError ? (
        <div className="neg" style={{ padding: 20, fontSize: 13 }}>{loadError}<br /><button className="btn btn-outline-red btn-sm" style={{ marginTop: 10 }} onClick={() => load(selectedAccount)}>재시도</button></div>
      ) : !data.length ? (
        <div className="empty">저장된 거래내역이 없습니다.</div>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>날짜</th>
                <th>계좌</th>
                <th>거래종류</th>
                <th>종목명</th>
                <th>종목코드</th>
                <th>통화</th>
                <th className="r">수량</th>
                <th className="r">거래금액</th>
                <th className="r">수수료</th>
                <th className="r">세금</th>
                <th className="r">청산손익</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(row => (
                <tr key={row.docId}>
                  <td>{row.date}</td>
                  <td>{row.accountId}</td>
                  <td>{row.type}</td>
                  <td>{row.name || '-'}</td>
                  <td>{row.code || '-'}</td>
                  <td>{row.currency}</td>
                  <td className="r">{row.qty ? fmt(row.qty) : '-'}</td>
                  <td className="r">{fmt(row.amount)}</td>
                  <td className="r">{fmt(row.fee)}</td>
                  <td className="r">{fmt(row.tax)}</td>
                  <td className="r">{row.profit ? fmt(row.profit) : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <DeleteModal
          title={
            modal.type === 'date' ? `${modal.date} 거래내역 삭제`
              : modal.type === 'account' ? `${modal.accountId} 거래내역 삭제`
              : '거래내역 전체 삭제'
          }
          requireConfirm={modal.type === 'all'}
          count={modal.count}
          onConfirm={handleDelete}
          onCancel={() => setModal(null)}
          loading={deleting}
        />
      )}
    </div>
  )
}
