// 이자·배당 소득 리포트 화면
import { useState, useEffect, useRef } from 'react'
import * as XLSX from 'xlsx'
import { useAuth } from '../contexts/AuthContext'
import {
  saveIncomeReport, getIncomeReports, deleteIncomeReport,
  saveTaxPayments, getAllTaxPayments, deleteDocument, deleteCollectionData,
} from '../utils/firestore'
import '../common.css'

function parseNum(str) {
  return parseInt(String(str).replace(/,/g, '').trim(), 10) || 0
}

function fmt(n) {
  if (!n && n !== 0) return '-'
  return Math.round(n).toLocaleString()
}

function parseExcel(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'array' })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })

        // 포맷 감지: 새 포맷은 row0 col0이 귀속년도 헤더
        const isNewFormat = String(rows[0]?.[0]).replace(/\s/g, '').includes('귀속년도')

        let year, items

        if (isNewFormat) {
          // 새 포맷: 헤더 2행, 데이터 row2~, 마지막 행 합계
          items = []
          for (let i = 2; i < rows.length; i++) {
            const row = rows[i]
            const type = String(row[1]).trim()
            if (type !== '이자' && type !== '배당') continue
            const rowYear = parseInt(String(row[0]).replace(/[^0-9]/g, ''), 10)
            if (rowYear) year = rowYear
            items.push({
              type,
              payer: String(row[2]).trim(),
              regNum: String(row[3]).trim(),
              accountNum: String(row[4]).trim(),
              dividendSurcharge: String(row[5]).trim() === '여',
              amount: parseNum(row[6]),
              incomeTax: parseNum(row[7]),
              localTax: parseNum(row[8]),
              ruralTax: parseNum(row[9]),
            })
          }
          if (!year) throw new Error('귀속년도를 찾을 수 없습니다.')
        } else {
          // 구 포맷: row1 col2에 년도, 상세 row11~
          year = parseInt(String(rows[1]?.[2]).replace(/[^0-9]/g, ''), 10)
          if (!year) throw new Error('귀속년도를 찾을 수 없습니다.')
          items = []
          for (let i = 11; i < rows.length; i++) {
            const row = rows[i]
            const type = String(row[0]).trim()
            if (type !== '이자' && type !== '배당') continue
            items.push({
              type,
              payer: String(row[1]).trim(),
              regNum: String(row[2]).trim(),
              accountNum: '',
              dividendSurcharge: String(row[3]).trim() === '여',
              amount: parseNum(row[4]),
              incomeTax: parseNum(row[5]),
              localTax: parseNum(row[6]),
              ruralTax: parseNum(row[7]),
            })
          }
        }

        if (!items.length) throw new Error('파싱 결과가 없습니다. 형식을 확인하세요.')

        const totalInterest = items.filter(i => i.type === '이자').reduce((s, i) => s + i.amount, 0)
        const totalDividend = items.filter(i => i.type === '배당').reduce((s, i) => s + i.amount, 0)
        const totalIncomeTax = items.reduce((s, i) => s + i.incomeTax, 0)
        const totalLocalTax = items.reduce((s, i) => s + i.localTax, 0)

        resolve({ year, totalInterest, totalDividend, totalIncomeTax, totalLocalTax, items })
      } catch (err) {
        reject(err)
      }
    }
    reader.onerror = () => reject(new Error('파일 읽기 실패'))
    reader.readAsArrayBuffer(file)
  })
}

// 납부일자\t세목\t납부세액 형식 붙여넣기 파싱 (엑셀 복사 시 값이 "..."로 감싸질 수 있음)
function parseTaxPasteText(text) {
  return text.trim().split('\n').map(l => l.trim()).filter(Boolean).map(line => {
    const [date, taxType, amountStr] = line.split('\t').map(c => c.trim().replace(/^"|"$/g, ''))
    return { date, taxType, amount: parseNum(amountStr) }
  }).filter(r => r.date && r.taxType)
}

export default function IncomeReport() {
  const { user } = useAuth()
  const [reports, setReports] = useState(null)
  const [selectedYear, setSelectedYear] = useState(null)
  const [preview, setPreview] = useState(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const fileRef = useRef()

  const [taxPayments, setTaxPayments] = useState([])
  const [taxPasteOpen, setTaxPasteOpen] = useState(false)
  const [taxPasteText, setTaxPasteText] = useState(
    '2025-06-23\t양도소득세\t11,110,470\n' +
    '2025-05-21\t양도소득세\t11,110,470\n' +
    '2026-08-03\t양도소득세\t22,000,000\n' +
    '2026-05-27\t양도소득세\t23,310,160\n' +
    '2026-05-01\t종합소득세\t128,450\n' +
    '2026-05-27\t지방소득세(양도소득)\t4,531,010\n' +
    '2026-05-01\t지방소득세(종합소득)\t12,840\n' +
    '2025-06-23\t지방소득세(양도소득)\t2,222,090'
  )
  const [taxPreview, setTaxPreview] = useState(null)
  const [taxError, setTaxError] = useState('')
  const [taxSaving, setTaxSaving] = useState(false)

  const loadTaxPayments = () => getAllTaxPayments(user.uid).then(setTaxPayments)

  useEffect(() => {
    getIncomeReports(user.uid).then(r => {
      setReports(r)
      setLoading(false)
    })
    loadTaxPayments()
  }, [user.uid])

  const handleFile = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setError('')
    setPreview(null)
    try {
      const parsed = await parseExcel(file)
      setPreview(parsed)
    } catch (err) {
      setError('파싱 오류: ' + err.message)
    }
    e.target.value = ''
  }

  const handleSave = async () => {
    if (!preview) return
    setSaving(true)
    setError('')
    try {
      await saveIncomeReport(user.uid, preview)
      const updated = await getIncomeReports(user.uid)
      setReports(updated)
      setSelectedYear(preview.year)
      setPreview(null)
    } catch (err) {
      setError('저장 오류: ' + err.message)
    }
    setSaving(false)
  }

  const handleDelete = async (year) => {
    if (!window.confirm(`${year}년 데이터를 삭제하시겠습니까?`)) return
    await deleteIncomeReport(user.uid, year)
    const updated = await getIncomeReports(user.uid)
    setReports(updated)
    setSelectedYear(prev => prev === year ? null : prev)
  }

  const handleRowClick = (year) => {
    setSelectedYear(prev => prev === year ? null : year)
    setPreview(null)
  }

  const current = selectedYear ? reports?.find(r => r.year === selectedYear) : null

  const handleTaxParse = () => {
    setTaxError('')
    try {
      const rows = parseTaxPasteText(taxPasteText)
      if (!rows.length) throw new Error('파싱 결과가 없습니다. 탭으로 구분된 납부일자/세목/납부세액 형식인지 확인하세요.')
      setTaxPreview(rows)
    } catch (err) {
      setTaxError('파싱 오류: ' + err.message)
    }
  }

  const handleTaxSave = async () => {
    if (!taxPreview) return
    setTaxSaving(true)
    setTaxError('')
    try {
      await saveTaxPayments(user.uid, taxPreview)
      await loadTaxPayments()
      setTaxPreview(null)
      setTaxPasteText('')
      setTaxPasteOpen(false)
    } catch (err) {
      setTaxError('저장 오류: ' + err.message)
    }
    setTaxSaving(false)
  }

  const handleTaxDeleteRow = async (docId) => {
    await deleteDocument(user.uid, 'taxPayments', docId)
    await loadTaxPayments()
  }

  const handleTaxDeleteAll = async () => {
    if (!window.confirm('세금납부내역 전체를 삭제하시겠습니까?')) return
    await deleteCollectionData(user.uid, 'taxPayments')
    await loadTaxPayments()
  }

  if (loading) return <div className="loading">로딩 중...</div>

  return (
    <div className="page">
      <div className="page-heading-row">
        <h2 className="page-heading">이자·배당·세금</h2>
        <span className="dim" style={{ marginLeft: 'auto', fontSize: 12 }}>키움 금융소득내역서 확인</span>
        <button style={btnStyle} onClick={() => fileRef.current?.click()}>
          + 엑셀 등록
        </button>
        <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }} onChange={handleFile} />
      </div>

      {error && <p style={{ color: '#f87171', fontSize: 13, marginBottom: 12 }}>{error}</p>}

      {/* 엑셀 파싱 미리보기 */}
      {preview && (
        <div className="card" style={{ marginBottom: 12 }}>
          <div className="section-header">
            <span className="section-title">{preview.year}년 미리보기</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button style={cancelBtnStyle} onClick={() => setPreview(null)}>취소</button>
              <button style={{ ...btnStyle, opacity: saving ? 0.5 : 1 }} onClick={handleSave} disabled={saving}>
                {saving ? '저장 중...' : '저장'}
              </button>
            </div>
          </div>
          <ItemTable items={preview.items} />
        </div>
      )}

      {/* 연도별 합계 표 */}
      {reports?.length > 0 && (
        <div className="card" style={{ marginBottom: 12 }}>
          <div className="section-header" style={{ marginBottom: 8 }}>
            <span className="section-title">연도별 합계</span>
            <span className="dim" style={{ fontSize: 12 }}>행 클릭 시 상세 표출</span>
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>귀속년도</th>
                  <th className="r">이자소득</th>
                  <th className="r">배당소득</th>
                  <th className="r">소계</th>
                  <th className="r">원천징수세</th>
                  <th className="r">세후 수령액</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {reports.map(r => {
                  const tax = (r.totalIncomeTax || 0) + (r.totalLocalTax || 0)
                  const total = (r.totalInterest || 0) + (r.totalDividend || 0)
                  const net = total - tax
                  const isOpen = selectedYear === r.year
                  return (
                    <tr
                      key={r.year}
                      onClick={() => handleRowClick(r.year)}
                      style={{ cursor: 'pointer', background: isOpen ? '#1a2740' : undefined }}
                    >
                      <td style={{ fontWeight: 600, color: isOpen ? '#93c5fd' : '#f1f5f9' }}>
                        {r.year}년 {isOpen ? '▲' : '▼'}
                      </td>
                      <td className="r dim">{fmt(r.totalInterest)}</td>
                      <td className="r dim">{fmt(r.totalDividend)}</td>
                      <td className="r bold">{fmt(total)}</td>
                      <td className="r neg">{fmt(tax)}</td>
                      <td className="r purple bold">{fmt(net)}</td>
                      <td style={{ textAlign: 'right' }}>
                        <button
                          style={cancelBtnStyle}
                          onClick={ev => { ev.stopPropagation(); handleDelete(r.year) }}
                        >삭제</button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 연도 상세 */}
      {current && (
        <div className="card">
          <div className="section-header" style={{ marginBottom: 8 }}>
            <span className="section-title">{current.year}년 상세 내역</span>
          </div>
          <ItemTable items={current.items} />
        </div>
      )}

      {!preview && !reports?.length && (
        <div className="empty">등록된 데이터가 없습니다. 엑셀 파일을 등록하세요.</div>
      )}

      {/* 세금납부내역 */}
      <div className="card" style={{ marginTop: 12 }}>
        <div className="section-header" style={{ marginBottom: 8 }}>
          <span className="section-title">세금납부내역</span>
          <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
            <button style={cancelBtnStyle} onClick={() => setTaxPasteOpen(o => !o)}>
              {taxPasteOpen ? '취소' : '+ 붙여넣기 등록'}
            </button>
            {taxPayments.length > 0 && (
              <button style={cancelBtnStyle} onClick={handleTaxDeleteAll}>전체 삭제</button>
            )}
          </div>
        </div>

        {taxPasteOpen && (
          <div style={{ marginBottom: 12 }}>
            <p className="dim" style={{ fontSize: 12, marginBottom: 6 }}>
              납부일자, 세목, 납부세액 순서로 탭 구분해 붙여넣기 (엑셀에서 복사한 그대로)
            </p>
            <textarea
              value={taxPasteText}
              onChange={e => setTaxPasteText(e.target.value)}
              rows={6}
              style={textareaStyle}
              placeholder={'2025-06-23\t양도소득세\t11,110,470'}
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button style={btnStyle} onClick={handleTaxParse}>미리보기</button>
              {taxPreview && (
                <button style={{ ...btnStyle, opacity: taxSaving ? 0.5 : 1 }} onClick={handleTaxSave} disabled={taxSaving}>
                  {taxSaving ? '저장 중...' : `${taxPreview.length}건 저장`}
                </button>
              )}
            </div>
            {taxError && <p style={{ color: '#f87171', fontSize: 13, marginTop: 8 }}>{taxError}</p>}
            {taxPreview && (
              <div className="table-wrap" style={{ marginTop: 10 }}>
                <table className="data-table">
                  <thead>
                    <tr><th>납부일자</th><th>세목</th><th className="r">납부세액</th></tr>
                  </thead>
                  <tbody>
                    {taxPreview.map((r, i) => (
                      <tr key={i}>
                        <td>{r.date}</td>
                        <td>{r.taxType}</td>
                        <td className="r">{fmt(r.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {taxPayments.length > 0 ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr><th>납부일자</th><th>세목</th><th className="r">납부세액</th><th></th></tr>
              </thead>
              <tbody>
                {taxPayments.map(r => (
                  <tr key={r.docId}>
                    <td>{r.date}</td>
                    <td>{r.taxType}</td>
                    <td className="r">{fmt(r.amount)}</td>
                    <td style={{ textAlign: 'right' }}>
                      <button style={cancelBtnStyle} onClick={() => handleTaxDeleteRow(r.docId)}>삭제</button>
                    </td>
                  </tr>
                ))}
                <tr className="total-row">
                  <td colSpan={2} style={{ fontWeight: 700 }}>합계</td>
                  <td className="r bold">{fmt(taxPayments.reduce((s, r) => s + (r.amount || 0), 0))}</td>
                  <td></td>
                </tr>
              </tbody>
            </table>
          </div>
        ) : (
          !taxPasteOpen && <div className="empty">등록된 세금납부내역이 없습니다.</div>
        )}
      </div>
    </div>
  )
}

function ItemTable({ items }) {
  const interest = items.filter(i => i.type === '이자')
  const dividend = items.filter(i => i.type === '배당')

  const hasAccount = items.some(i => i.accountNum)
  const cols = hasAccount ? 7 : 6

  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>구분</th>
            <th>지급자</th>
            {hasAccount && <th>계좌번호</th>}
            <th className="r">소득금액</th>
            <th className="r">소득세</th>
            <th className="r">지방세</th>
            <th className="r">농특세</th>
          </tr>
        </thead>
        <tbody>
          {interest.length > 0 && (
            <>
              <tr>
                <td colSpan={cols} style={{ background: '#0f172a', color: '#64748b', fontSize: 11, padding: '4px 12px', fontWeight: 600 }}>이자소득</td>
              </tr>
              {interest.map((item, i) => <ItemRow key={i} item={item} hasAccount={hasAccount} />)}
              <TotalRow items={interest} label="이자 소계" cols={cols} />
            </>
          )}
          {dividend.length > 0 && (
            <>
              <tr>
                <td colSpan={cols} style={{ background: '#0f172a', color: '#64748b', fontSize: 11, padding: '4px 12px', fontWeight: 600 }}>배당소득</td>
              </tr>
              {dividend.map((item, i) => <ItemRow key={i} item={item} hasAccount={hasAccount} />)}
              <TotalRow items={dividend} label="배당 소계" cols={cols} />
            </>
          )}
          <TotalRow items={items} label="합계" bold cols={cols} />
        </tbody>
      </table>
    </div>
  )
}

function ItemRow({ item, hasAccount }) {
  return (
    <tr>
      <td><span className={'badge badge-' + (item.type === '이자' ? 'domestic' : 'overseas')}>{item.type}</span></td>
      <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.payer}</td>
      {hasAccount && <td className="dim" style={{ fontFamily: 'monospace', fontSize: 12 }}>{item.accountNum}</td>}
      <td className="r">{fmt(item.amount)}</td>
      <td className="r dim">{fmt(item.incomeTax)}</td>
      <td className="r dim">{fmt(item.localTax)}</td>
      <td className="r dim">{fmt(item.ruralTax)}</td>
    </tr>
  )
}

function TotalRow({ items, label, bold, cols }) {
  const sum = (k) => items.reduce((s, i) => s + (i[k] || 0), 0)
  return (
    <tr className="total-row">
      <td colSpan={cols - 4} style={{ fontWeight: bold ? 700 : 600, color: bold ? '#f1f5f9' : '#94a3b8' }}>{label}</td>
      <td className={'r' + (bold ? ' bold' : '')} style={{ color: bold ? '#f1f5f9' : '#94a3b8' }}>{fmt(sum('amount'))}</td>
      <td className="r dim">{fmt(sum('incomeTax'))}</td>
      <td className="r dim">{fmt(sum('localTax'))}</td>
      <td className="r dim">{fmt(sum('ruralTax'))}</td>
    </tr>
  )
}

const btnStyle = {
  background: '#7c3aed', color: '#fff', border: 'none', borderRadius: 8,
  padding: '7px 16px', cursor: 'pointer', fontWeight: 600, fontSize: 13,
}

const cancelBtnStyle = {
  background: 'transparent', color: '#64748b', border: '1px solid #334155',
  borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 12,
}

const textareaStyle = {
  width: '100%', background: '#0f172a', border: '1px solid #334155', borderRadius: 8,
  padding: '12px', color: '#f1f5f9', fontSize: 13, fontFamily: 'monospace',
  resize: 'vertical', boxSizing: 'border-box',
}
