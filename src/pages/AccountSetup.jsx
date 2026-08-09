// 계좌 관리 화면 (계좌 등록/수정/삭제, 대출금 관리)
import { useState, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useAccounts } from '../hooks/useAccounts'
import { getLoans, saveLoan, deleteLoan, getKiwoomKeys, saveKiwoomKeys } from '../utils/firestore'
import { clearKiwoomKeysCache } from '../utils/kiwoomApi'
import '../common.css'

const INITIAL_ACCOUNTS = [
  { accountId: '010-9786-1102-1', broker: 'mirae', category: 'pension',  name: '미래에셋 연금저축', type: 'stock' },
  { accountId: '010-9786-1102-2', broker: 'mirae', category: 'domestic', name: '미래에셋 일반',     type: 'stock' },
  { accountId: '010-9786-1102-3', broker: 'mirae', category: 'pension',  name: '미래에셋 ISA',      type: 'stock' },
  { accountId: '010-9786-1102-5', broker: 'mirae', category: 'pension',  name: '미래에셋 IRP',      type: 'stock' },
]

const BROKER_LABEL = { mirae: '미래에셋', kiwoom_kr: '키움 국내', kiwoom_us: '키움 해외', ibk: '기업은행' }
export const CATEGORY_LABEL = { domestic: '국내', overseas: '해외', pension: '연금', futures: '선물옵션', irp: '연금', isa: '연금', general: '국내' }

export default function AccountSetup() {
  const { user } = useAuth()
  const { accounts, loading, error, saveAccount, deleteAccount } = useAccounts()
  const [form, setForm] = useState({ accountId: '', broker: 'kiwoom_kr', category: 'domestic', name: '', type: 'stock' })
  const [saving, setSaving] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [editName, setEditName] = useState('')
  const [editCategory, setEditCategory] = useState('')
  const [editBroker, setEditBroker] = useState('')
  const [actionError, setActionError] = useState('')

  // 대출금
  const [loans, setLoans] = useState([])
  const [loanForm, setLoanForm] = useState({ name: '', amount: '' })
  const [editingLoan, setEditingLoan] = useState(null) // { id, name, amount }
  const [loanSaving, setLoanSaving] = useState(false)

  // 키움 API 키
  const [kiwoomStatus, setKiwoomStatus] = useState({ kr: false, us: false })
  const [kiwoomForm, setKiwoomForm] = useState({ kr_appkey: '', kr_secretkey: '', us_appkey: '', us_secretkey: '' })
  const [kiwoomSaving, setKiwoomSaving] = useState(false)

  const loadKiwoomStatus = () => {
    getKiwoomKeys(user.uid).then(data => {
      setKiwoomStatus({
        kr: !!(data?.kr_appkey && data?.kr_secretkey),
        us: !!(data?.us_appkey && data?.us_secretkey),
      })
    })
  }

  useEffect(() => {
    if (user) { getLoans(user.uid).then(setLoans); loadKiwoomStatus() }
  }, [user])

  const handleSaveKiwoom = async (e) => {
    e.preventDefault()
    const filled = Object.fromEntries(Object.entries(kiwoomForm).filter(([, v]) => v.trim()))
    if (!Object.keys(filled).length) return
    setKiwoomSaving(true)
    await saveKiwoomKeys(user.uid, filled)
    clearKiwoomKeysCache()
    setKiwoomForm({ kr_appkey: '', kr_secretkey: '', us_appkey: '', us_secretkey: '' })
    loadKiwoomStatus()
    setKiwoomSaving(false)
  }

  const handleAddLoan = async (e) => {
    e.preventDefault()
    if (!loanForm.name.trim() || !loanForm.amount) return
    setLoanSaving(true)
    await saveLoan(user.uid, { name: loanForm.name.trim(), amount: Number(String(loanForm.amount).replace(/,/g, '')) })
    setLoanForm({ name: '', amount: '' })
    setLoans(await getLoans(user.uid))
    setLoanSaving(false)
  }

  const handleSaveLoan = async (loan) => {
    setLoanSaving(true)
    await saveLoan(user.uid, { ...loan, name: editingLoan.name, amount: Number(String(editingLoan.amount).replace(/,/g, '')) })
    setEditingLoan(null)
    setLoans(await getLoans(user.uid))
    setLoanSaving(false)
  }

  const handleDeleteLoan = async (id) => {
    await deleteLoan(user.uid, id)
    setLoans(await getLoans(user.uid))
  }

  const handleInitAccounts = async () => {
    setSaving(true)
    setActionError('')
    try {
      for (const acc of INITIAL_ACCOUNTS) await saveAccount(acc)
    } catch (e) {
      setActionError('초기 등록 실패: ' + e.message)
    }
    setSaving(false)
  }

  const handleAdd = async (e) => {
    e.preventDefault()
    if (!form.accountId.trim() || !form.name.trim()) return
    setSaving(true)
    setActionError('')
    try {
      await saveAccount({ ...form, accountId: form.accountId.trim() })
      setForm({ accountId: '', broker: 'kiwoom_kr', category: 'general', name: '', type: 'stock' })
    } catch (e) {
      setActionError('추가 실패: ' + e.message)
    }
    setSaving(false)
  }

  const handleEditSave = async (acc) => {
    setSaving(true)
    setActionError('')
    try {
      await saveAccount({ ...acc, name: editName, category: editCategory, broker: editBroker })
      setEditingId(null)
    } catch (e) {
      setActionError('수정 실패: ' + e.message)
    }
    setSaving(false)
  }

  const handleDeleteAccount = async (accountId) => {
    if (!confirm(`계좌 ${accountId}를 삭제할까요?`)) return
    setActionError('')
    try {
      await deleteAccount(accountId)
    } catch (e) {
      setActionError('삭제 실패: ' + e.message)
    }
  }

  if (loading) return <div style={styles.loading}>로딩 중...</div>

  if (error) return (
    <div className="page">
      <h2 style={styles.heading}>계좌 관리</h2>
      <div style={styles.errorBox}>
        <strong>Firestore 연결 오류</strong>
        <p style={{ margin: '8px 0 0', fontSize: 13 }}>{error}</p>
        <p style={{ margin: '8px 0 0', fontSize: 12, color: '#94a3b8' }}>
          Firebase Console → Firestore → 규칙 탭에서 보안 규칙을 확인하세요.
        </p>
      </div>
    </div>
  )

  return (
    <div className="page">
      <h2 style={styles.heading}>계좌 관리</h2>

      {accounts.length === 0 && (
        <div style={styles.initBox}>
          <p style={styles.initText}>미래에셋 기본 계좌 4개를 한 번에 등록합니다.</p>
          <button style={styles.initBtn} onClick={handleInitAccounts} disabled={saving}>
            {saving ? '등록 중...' : '미래에셋 기본 계좌 초기 등록'}
          </button>
        </div>
      )}

      {actionError && <p style={styles.errorText}>{actionError}</p>}

      <div style={styles.tableWrap}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>계좌번호</th>
              <th style={styles.th}>증권사</th>
              <th style={styles.th}>유형</th>
              <th style={styles.th}>이름</th>
              <th style={styles.th}>작업</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map(acc => (
              <tr key={acc.id} style={styles.tr}>
                <td style={styles.td}><code style={styles.code}>{acc.accountId}</code></td>
                <td style={styles.td}>
                  {editingId === acc.id ? (
                    <select style={styles.inlineSelect} value={editBroker} onChange={e => setEditBroker(e.target.value)}>
                      <option value="mirae">미래에셋</option>
                      <option value="kiwoom_kr">키움 국내</option>
                      <option value="kiwoom_us">키움 해외</option>
                      <option value="ibk">기업은행</option>
                    </select>
                  ) : (
                    BROKER_LABEL[acc.broker] || acc.broker
                  )}
                </td>
                <td style={styles.td}>
                  {editingId === acc.id ? (
                    <select style={styles.inlineSelect} value={editCategory} onChange={e => setEditCategory(e.target.value)}>
                      <option value="domestic">국내</option>
                      <option value="overseas">해외</option>
                      <option value="pension">연금</option>
                      <option value="futures">선물옵션</option>
                    </select>
                  ) : (
                    CATEGORY_LABEL[acc.category] || acc.category
                  )}
                </td>
                <td style={styles.td}>
                  {editingId === acc.id ? (
                    <input
                      style={styles.inlineInput}
                      value={editName}
                      onChange={e => setEditName(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleEditSave(acc)}
                      autoFocus
                    />
                  ) : (
                    acc.name
                  )}
                </td>
                <td style={styles.td}>
                  <div style={styles.actions}>
                    {editingId === acc.id ? (
                      <>
                        <button style={styles.confirmBtn} onClick={() => handleEditSave(acc)} disabled={saving}>저장</button>
                        <button style={styles.cancelBtn} onClick={() => setEditingId(null)}>취소</button>
                      </>
                    ) : (
                      <>
                        <button style={styles.editBtn} onClick={() => { setEditingId(acc.id); setEditName(acc.name); setEditCategory(acc.category); setEditBroker(acc.broker) }}>수정</button>
                        <button style={styles.delBtn} onClick={() => handleDeleteAccount(acc.id)}>삭제</button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={styles.formBox}>
        <h3 style={styles.formTitle}>계좌 추가</h3>
        <form onSubmit={handleAdd} style={styles.form}>
          <input
            style={styles.input}
            placeholder="계좌번호"
            value={form.accountId}
            onChange={e => setForm(f => ({ ...f, accountId: e.target.value }))}
          />
          <select style={styles.select} value={form.broker} onChange={e => setForm(f => ({ ...f, broker: e.target.value }))}>
            <option value="mirae">미래에셋</option>
            <option value="kiwoom_kr">키움 국내</option>
            <option value="kiwoom_us">키움 해외</option>
            <option value="ibk">기업은행</option>
          </select>
          <select style={styles.select} value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
            <option value="domestic">국내</option>
            <option value="overseas">해외</option>
            <option value="pension">연금</option>
            <option value="futures">선물옵션</option>
          </select>
          <input
            style={styles.input}
            placeholder="표시 이름"
            value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
          />
          <button style={styles.addBtn} type="submit" disabled={saving}>
            {saving ? '저장 중...' : '추가'}
          </button>
        </form>
      </div>

      {/* 대출금 관리 */}
      <div style={styles.loanBox}>
        <h3 style={styles.formTitle}>대출금 관리</h3>
        <p style={styles.loanDesc}>현재 대출 잔액을 등록하면 스냅샷 생성 시 순자산에 반영됩니다.</p>

        {loans.length > 0 && (
          <div style={styles.tableWrap}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>대출명</th>
                  <th style={styles.th}>잔액</th>
                  <th style={styles.th}>작업</th>
                </tr>
              </thead>
              <tbody>
                {loans.map(loan => (
                  <tr key={loan.id} style={styles.tr}>
                    <td style={styles.td}>
                      {editingLoan?.id === loan.id
                        ? <input style={styles.inlineInput} value={editingLoan.name} onChange={e => setEditingLoan(l => ({ ...l, name: e.target.value }))} autoFocus />
                        : loan.name}
                    </td>
                    <td style={{ ...styles.td, textAlign: 'right' }}>
                      {editingLoan?.id === loan.id
                        ? <input style={{ ...styles.inlineInput, width: 130, textAlign: 'right' }} value={editingLoan.amount} onChange={e => setEditingLoan(l => ({ ...l, amount: e.target.value }))} />
                        : <span style={{ color: '#f87171' }}>-{loan.amount?.toLocaleString()}원</span>}
                    </td>
                    <td style={styles.td}>
                      <div style={styles.actions}>
                        {editingLoan?.id === loan.id ? (
                          <>
                            <button style={styles.confirmBtn} onClick={() => handleSaveLoan(loan)} disabled={loanSaving}>저장</button>
                            <button style={styles.cancelBtn} onClick={() => setEditingLoan(null)}>취소</button>
                          </>
                        ) : (
                          <>
                            <button style={styles.editBtn} onClick={() => setEditingLoan({ id: loan.id, name: loan.name, amount: loan.amount })}>수정</button>
                            <button style={styles.delBtn} onClick={() => handleDeleteLoan(loan.id)}>삭제</button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                <tr style={{ borderTop: '2px solid #334155' }}>
                  <td style={{ ...styles.td, fontWeight: 700, color: '#94a3b8' }}>합계</td>
                  <td style={{ ...styles.td, textAlign: 'right', fontWeight: 700, color: '#f87171' }}>
                    -{loans.reduce((s, l) => s + (l.amount || 0), 0).toLocaleString()}원
                  </td>
                  <td style={styles.td} />
                </tr>
              </tbody>
            </table>
          </div>
        )}

        <form onSubmit={handleAddLoan} style={{ ...styles.form, marginTop: 12 }}>
          <input
            style={styles.input}
            placeholder="대출명 (예: 신용대출)"
            value={loanForm.name}
            onChange={e => setLoanForm(f => ({ ...f, name: e.target.value }))}
          />
          <input
            style={styles.input}
            placeholder="잔액 (원)"
            value={loanForm.amount}
            onChange={e => setLoanForm(f => ({ ...f, amount: e.target.value }))}
            type="number"
            min="0"
          />
          <button style={styles.addBtn} type="submit" disabled={loanSaving}>
            {loanSaving ? '저장 중...' : '추가'}
          </button>
        </form>
      </div>

      {/* 키움 API 키 */}
      <div style={styles.loanBox}>
        <h3 style={styles.formTitle}>키움 API 키</h3>
        <p style={styles.loanDesc}>
          국내: {kiwoomStatus.kr ? <span style={{ color: '#4ade80' }}>등록됨</span> : <span style={{ color: '#f87171' }}>미등록</span>}
          {'  ·  '}
          해외: {kiwoomStatus.us ? <span style={{ color: '#4ade80' }}>등록됨</span> : <span style={{ color: '#f87171' }}>미등록</span>}
          <br />저장 후에는 값이 표시되지 않습니다. 변경하려면 새 값을 입력 후 저장하세요.
        </p>
        <form onSubmit={handleSaveKiwoom} style={styles.form}>
          <input style={styles.input} placeholder="국내 appkey" type="password" value={kiwoomForm.kr_appkey} onChange={e => setKiwoomForm(f => ({ ...f, kr_appkey: e.target.value }))} />
          <input style={styles.input} placeholder="국내 secretkey" type="password" value={kiwoomForm.kr_secretkey} onChange={e => setKiwoomForm(f => ({ ...f, kr_secretkey: e.target.value }))} />
          <input style={styles.input} placeholder="해외 appkey" type="password" value={kiwoomForm.us_appkey} onChange={e => setKiwoomForm(f => ({ ...f, us_appkey: e.target.value }))} />
          <input style={styles.input} placeholder="해외 secretkey" type="password" value={kiwoomForm.us_secretkey} onChange={e => setKiwoomForm(f => ({ ...f, us_secretkey: e.target.value }))} />
          <button style={styles.addBtn} type="submit" disabled={kiwoomSaving}>
            {kiwoomSaving ? '저장 중...' : '저장'}
          </button>
        </form>
      </div>

    </div>
  )
}

const styles = {
  loading: { color: '#94a3b8', padding: 40, textAlign: 'center' },
  heading: { color: '#f1f5f9', fontSize: 22, fontWeight: 700, marginBottom: 24 },
  initBox: { background: '#1e293b', borderRadius: 10, padding: '20px 24px', marginBottom: 24, display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' },
  initText: { color: '#94a3b8', margin: 0, flex: 1 },
  initBtn: { background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 20px', cursor: 'pointer', fontWeight: 600, whiteSpace: 'nowrap' },
  errorBox: { background: '#450a0a', border: '1px solid #ef4444', borderRadius: 10, padding: '16px 20px', color: '#fca5a5' },
  errorText: { color: '#f87171', fontSize: 13, marginBottom: 12 },
  tableWrap: { overflowX: 'auto', marginBottom: 32 },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: { background: '#1e293b', color: '#94a3b8', padding: '10px 14px', textAlign: 'left', fontSize: 13, fontWeight: 600 },
  tr: { borderBottom: '1px solid #1e293b' },
  td: { color: '#e2e8f0', padding: '10px 14px', fontSize: 14 },
  code: { background: '#0f172a', padding: '2px 6px', borderRadius: 4, fontSize: 12, fontFamily: 'monospace' },
  actions: { display: 'flex', gap: 6 },
  editBtn: { background: 'transparent', color: '#60a5fa', border: '1px solid #60a5fa', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 12 },
  delBtn: { background: 'transparent', color: '#ef4444', border: '1px solid #ef4444', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 12 },
  confirmBtn: { background: '#22c55e', color: '#fff', border: 'none', borderRadius: 6, padding: '4px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 600 },
  cancelBtn: { background: 'transparent', color: '#94a3b8', border: '1px solid #334155', borderRadius: 6, padding: '8px 18px', cursor: 'pointer', fontSize: 14 },
  inlineInput: { background: '#0f172a', border: '1px solid #3b82f6', borderRadius: 6, padding: '4px 8px', color: '#f1f5f9', fontSize: 14, width: 160 },
  inlineSelect: { background: '#0f172a', border: '1px solid #3b82f6', borderRadius: 6, padding: '4px 8px', color: '#f1f5f9', fontSize: 14 },
  formBox: { background: '#1e293b', borderRadius: 10, padding: '20px 24px', marginBottom: 24 },
  formTitle: { color: '#f1f5f9', fontSize: 16, fontWeight: 600, marginBottom: 16 },
  form: { display: 'flex', gap: 10, flexWrap: 'wrap' },
  input: { flex: 2, minWidth: 140, background: '#0f172a', border: '1px solid #334155', borderRadius: 8, padding: '10px 12px', color: '#f1f5f9', fontSize: 14 },
  select: { flex: 1, minWidth: 110, background: '#0f172a', border: '1px solid #334155', borderRadius: 8, padding: '10px 12px', color: '#f1f5f9', fontSize: 14 },
  addBtn: { background: '#22c55e', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 20px', cursor: 'pointer', fontWeight: 600 },
  loanBox: { background: '#1e293b', borderRadius: 10, padding: '20px 24px', marginTop: 24 },
  loanDesc: { color: '#64748b', fontSize: 13, marginBottom: 16 },
}
