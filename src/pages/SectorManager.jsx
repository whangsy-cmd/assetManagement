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
    setSectors(data.sort((a, b) => (a.name || '').localeCompare(b.name || '')))
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

  if (loading) return <div className="loading">로딩 중...</div>

  return (
    <div>
      <div style={styles.toolbar}>
        <div style={styles.left}>
          <span className="text-muted">총 {sectors.length}개 종목</span>
          <div className="toggle-group">
            <button className={'toggle-btn' + (filter === 'classified' ? ' active' : '')} onClick={() => setFilter('classified')}>
              분류 ({sectors.filter(s => s.sector !== '미분류').length})
            </button>
            <button className={'toggle-btn' + (filter === 'unclassified' ? ' active' : '')} onClick={() => setFilter('unclassified')}>
              미분류 ({sectors.filter(s => s.sector === '미분류').length})
            </button>
            <button className={'toggle-btn' + (filter === 'all' ? ' active' : '')} onClick={() => setFilter('all')}>전체</button>
          </div>
        </div>
        <div style={styles.right}>
          <button className="btn btn-outline-red btn-sm" onClick={openDeleteAll}>전체 삭제</button>
        </div>
      </div>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>종목코드</th>
              <th>종목명</th>
              <th>섹터</th>
              <th>메모</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {displayed.map(s => {
              const e = editing[s.code] || {}
              const changed = Object.keys(e).length > 0
              return (
                <tr key={s.code}>
                  <td><code className="code-chip">{s.code}</code></td>
                  <td>{s.name}</td>
                  <td>
                    <input
                      className="input input-sm"
                      style={{ width: '100%', minWidth: 100, borderColor: e.sector ? '#3b82f6' : '#1e293b' }}
                      value={e.sector !== undefined ? e.sector : s.sector}
                      onChange={ev => handleChange(s.code, 'sector', ev.target.value)}
                    />
                  </td>
                  <td>
                    <input
                      className="input input-sm"
                      style={{ width: '100%', minWidth: 100 }}
                      value={e.memo !== undefined ? e.memo : (s.memo || '')}
                      onChange={ev => handleChange(s.code, 'memo', ev.target.value)}
                      placeholder="메모"
                    />
                  </td>
                  <td>
                    <div style={styles.actions}>
                      <button
                        className="btn btn-primary btn-sm"
                        style={{ opacity: changed ? 1 : 0.3, cursor: changed ? 'pointer' : 'default' }}
                        onClick={() => changed && handleSave(s)}
                        disabled={!changed || saving === s.code}
                      >
                        {saving === s.code ? '저장 중' : '저장'}
                      </button>
                      <button className="btn btn-outline-red btn-sm" onClick={() => setModal({ type: 'row', code: s.code, count: 1 })}>삭제</button>
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
  toolbar: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, gap: 12 },
  left: { display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  right: { display: 'flex', alignItems: 'center', gap: 8 },
  actions: { display: 'flex', gap: 6, alignItems: 'center' },
}
