// 섹터 관리 화면 (종목별 섹터 분류)
import { useEffect, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { getSectors, saveSector, deleteDocument, deleteCollectionData, countCollection } from '../utils/firestore'
import DeleteModal from '../components/DeleteModal'
import '../common.css'

export default function SectorManager() {
  const { user } = useAuth()
  const [sectors, setSectors] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState({})
  const [saving, setSaving] = useState(null)
  const [filter, setFilter] = useState('classified')
  const [modal, setModal] = useState(null) // { type: 'row'|'all', code?, count }
  const [deleting, setDeleting] = useState(false)

  const load = async () => {
    const data = await getSectors(user.uid)
    setSectors(data.sort((a, b) => a.sector.localeCompare(b.sector) || (a.name || '').localeCompare(b.name || '')))
    setLoading(false)
  }

  useEffect(() => { if (user) load() }, [user])

  const handleChange = (code, field, value) => {
    setEditing(e => ({ ...e, [code]: { ...(e[code] || {}), [field]: value } }))
  }

  const handleSave = async (s) => {
    setSaving(s.code)
    const updated = { ...s, ...(editing[s.code] || {}) }
    await saveSector(user.uid, updated)
    setSaving(null)
    setEditing(e => { const n = { ...e }; delete n[s.code]; return n })
    load()
  }

  const openDeleteAll = async () => {
    const count = await countCollection(user.uid, 'sectors')
    setModal({ type: 'all', count })
  }

  const handleDelete = async () => {
    setDeleting(true)
    if (modal.type === 'row') {
      await deleteDocument(user.uid, 'sectors', modal.code)
    } else {
      await deleteCollectionData(user.uid, 'sectors')
    }
    setModal(null)
    await load()
    setDeleting(false)
  }

  const displayed = filter === 'unclassified'
    ? sectors.filter(s => s.sector === '미분류')
    : filter === 'classified'
      ? sectors.filter(s => s.sector !== '미분류')
      : sectors

  if (loading) return <div style={styles.loading}>로딩 중...</div>

  return (
    <div>
      <div style={styles.toolbar}>
        <div style={styles.left}>
          <span style={styles.count}>총 {sectors.length}개 종목</span>
          <div style={styles.filters}>
            <button style={filter === 'classified' ? styles.filterActive : styles.filterBtn} onClick={() => setFilter('classified')}>
              분류 ({sectors.filter(s => s.sector !== '미분류').length})
            </button>
            <button style={filter === 'unclassified' ? styles.filterActive : styles.filterBtn} onClick={() => setFilter('unclassified')}>
              미분류 ({sectors.filter(s => s.sector === '미분류').length})
            </button>
            <button style={filter === 'all' ? styles.filterActive : styles.filterBtn} onClick={() => setFilter('all')}>전체</button>
          </div>
        </div>
        <div style={styles.right}>
          <button style={styles.allDelBtn} onClick={openDeleteAll}>전체 삭제</button>
        </div>
      </div>

      <div style={styles.tableWrap}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>종목코드</th>
              <th style={styles.th}>종목명</th>
              <th style={styles.th}>섹터</th>
              <th style={styles.th}>메모</th>
              <th style={styles.th}></th>
            </tr>
          </thead>
          <tbody>
            {displayed.map(s => {
              const e = editing[s.code] || {}
              const changed = Object.keys(e).length > 0
              return (
                <tr key={s.code} style={styles.tr}>
                  <td style={styles.td}><code style={styles.code}>{s.code}</code></td>
                  <td style={styles.td}>{s.name}</td>
                  <td style={styles.td}>
                    <input
                      style={{ ...styles.inlineInput, borderColor: e.sector ? '#3b82f6' : '#1e293b' }}
                      value={e.sector !== undefined ? e.sector : s.sector}
                      onChange={ev => handleChange(s.code, 'sector', ev.target.value)}
                    />
                  </td>
                  <td style={styles.td}>
                    <input
                      style={styles.inlineInput}
                      value={e.memo !== undefined ? e.memo : (s.memo || '')}
                      onChange={ev => handleChange(s.code, 'memo', ev.target.value)}
                      placeholder="메모"
                    />
                  </td>
                  <td style={styles.td}>
                    <div style={styles.actions}>
                      <button
                        style={{ ...styles.saveBtn, opacity: changed ? 1 : 0.3, cursor: changed ? 'pointer' : 'default' }}
                        onClick={() => changed && handleSave(s)}
                        disabled={!changed || saving === s.code}
                      >
                        {saving === s.code ? '저장 중' : '저장'}
                      </button>
                      <button style={styles.delBtn} onClick={() => setModal({ type: 'row', code: s.code, count: 1 })}>삭제</button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {modal && (
        <DeleteModal
          title={modal.type === 'row' ? `${modal.code} 삭제` : '섹터 전체 삭제'}
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

const styles = {
  loading: { color: '#94a3b8', padding: 40, textAlign: 'center' },
  toolbar: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, gap: 12 },
  left: { display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  right: { display: 'flex', alignItems: 'center', gap: 8 },
  count: { color: '#64748b', fontSize: 13 },
  filters: { display: 'flex', gap: 8 },
  filterBtn: { background: '#1e293b', color: '#94a3b8', border: 'none', borderRadius: 8, padding: '7px 14px', cursor: 'pointer', fontSize: 13 },
  filterActive: { background: '#1d4ed8', color: '#fff', border: 'none', borderRadius: 8, padding: '7px 14px', cursor: 'pointer', fontSize: 13, fontWeight: 600 },
  allDelBtn: { background: 'transparent', color: '#f87171', border: '1px solid #7f1d1d', borderRadius: 8, padding: '7px 16px', cursor: 'pointer', fontSize: 13, fontWeight: 600 },
  tableWrap: { overflowX: 'auto' },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: { background: '#1e293b', color: '#94a3b8', padding: '10px 12px', textAlign: 'left', fontSize: 13, fontWeight: 600 },
  tr: { borderBottom: '1px solid #0f172a' },
  td: { color: '#e2e8f0', padding: '9px 12px', fontSize: 13 },
  code: { background: '#0f172a', padding: '2px 6px', borderRadius: 4, fontSize: 11, fontFamily: 'monospace' },
  inlineInput: { background: '#0f172a', border: '1px solid #1e293b', borderRadius: 6, padding: '6px 8px', color: '#f1f5f9', fontSize: 13, width: '100%', minWidth: 100 },
  actions: { display: 'flex', gap: 6, alignItems: 'center' },
  saveBtn: { background: '#22c55e', color: '#fff', border: 'none', borderRadius: 6, padding: '5px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap' },
  delBtn: { background: 'transparent', color: '#ef4444', border: '1px solid #7f1d1d', borderRadius: 6, padding: '5px 10px', cursor: 'pointer', fontSize: 12 },
}
