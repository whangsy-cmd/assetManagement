// 종목관리 탭 — 시뮬레이션(셰넌/종목비교) 공용 가격 데이터(priceSeries) 등록/조회
import { useEffect, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { getSavedSymbols, downloadMissingRange, addDays, parseCsvPrices, saveCsvPrices } from '../utils/priceData'
import { deleteDocument } from '../utils/firestore'
import InputField, { numInputStyle } from '../components/InputField'
import '../common.css'

const TODAY = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
const DEFAULT_FROM = addDays(TODAY, -365 * 3)

export default function SymbolManageTab() {
  const { user } = useAuth()
  const [savedSymbols, setSavedSymbols] = useState([])
  const [symbolsLoading, setSymbolsLoading] = useState(true)

  const refreshSymbols = async () => {
    if (!user) return
    setSymbolsLoading(true)
    setSavedSymbols(await getSavedSymbols(user.uid))
    setSymbolsLoading(false)
  }

  useEffect(() => { refreshSymbols() /* eslint-disable-line react-hooks/exhaustive-deps */ }, [user])

  const [dlCode, setDlCode] = useState('')
  const [dlName, setDlName] = useState('')
  const [dlFrom, setDlFrom] = useState(DEFAULT_FROM)
  const [dlTo, setDlTo] = useState(TODAY)
  const [dlStatus, setDlStatus] = useState({ loading: false, msg: '', error: '' })

  const [csvCode, setCsvCode] = useState('')
  const [csvName, setCsvName] = useState('')
  const [csvText, setCsvText] = useState('')
  const [csvStatus, setCsvStatus] = useState({ loading: false, msg: '', error: '' })

  if (!user) return null

  const handleDownload = async () => {
    if (!dlCode.trim()) return
    setDlStatus({ loading: true, msg: '', error: '' })
    try {
      const { added, total } = await downloadMissingRange(user.uid, dlCode.trim(), dlName.trim(), dlFrom, dlTo)
      setDlStatus({ loading: false, msg: added > 0 ? `${added}건 추가 저장 (총 ${total}건)` : `이미 최신 상태 (총 ${total}건)`, error: '' })
      refreshSymbols()
    } catch (e) {
      setDlStatus({ loading: false, msg: '', error: e.message })
    }
  }

  const handleDeleteSymbol = async (code) => {
    if (!window.confirm(`${code} 가격 데이터를 삭제할까요?`)) return
    await deleteDocument(user.uid, 'priceSeries', code)
    refreshSymbols()
  }

  const handleCsvFile = (e) => {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      setCsvText(String(reader.result))
      if (!csvCode.trim()) {
        const base = file.name.replace(/\.csv$/i, '')
        setCsvCode(base.split(/[_\s]/)[0].toUpperCase())
      }
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  const handleCsvImport = async () => {
    if (!csvCode.trim() || !csvText.trim()) return
    setCsvStatus({ loading: true, msg: '', error: '' })
    try {
      const rows = parseCsvPrices(csvText)
      const { added, total } = await saveCsvPrices(user.uid, csvCode.trim(), csvName.trim(), rows)
      setCsvStatus({ loading: false, msg: `${added}건 반영 (총 ${total}건)`, error: '' })
      setCsvText('')
      refreshSymbols()
    } catch (e) {
      setCsvStatus({ loading: false, msg: '', error: e.message })
    }
  }

  return (
    <div className="card">
      <div className="section-header">
        <h3 className="section-title">저장된 종목 목록</h3>
        <button className="toggle-btn" onClick={refreshSymbols}>↺ 새로고침</button>
      </div>

      <div style={{ ...boxStyle, marginBottom: 14 }}>
        <div className="form-row" style={{ gap: 12, alignItems: 'flex-end' }}>
          <InputField label="종목코드"><input placeholder="예: 069500, AAPL" value={dlCode} onChange={e => setDlCode(e.target.value.trim())} style={{ ...numInputStyle, width: 130 }} /></InputField>
          <InputField label="종목명"><input placeholder="종목명" value={dlName} onChange={e => setDlName(e.target.value)} style={{ ...numInputStyle, width: 110 }} /></InputField>
          <InputField label="시작일"><input type="date" value={dlFrom} onChange={e => setDlFrom(e.target.value)} style={numInputStyle} /></InputField>
          <InputField label="종료일"><input type="date" value={dlTo} onChange={e => setDlTo(e.target.value)} style={numInputStyle} /></InputField>
          <button className="toggle-btn active" onClick={handleDownload} disabled={dlStatus.loading || !dlCode}>
            {dlStatus.loading ? '다운로드 중...' : '가격 데이터 다운로드'}
          </button>
        </div>
        {dlStatus.msg && <p className="dim" style={{ fontSize: 12, marginTop: 8 }}>{dlStatus.msg}</p>}
        {dlStatus.error && <p className="text-error" style={{ marginTop: 8 }}>{dlStatus.error}</p>}
        <p className="dim" style={{ fontSize: 12, marginTop: 8 }}>
          이미 저장된 구간은 건너뛰고 없는 구간만 내려받습니다. 6자리 숫자 코드는 국내(키움 ka10081), 그 외는 미국 종목(키움 usa06012)으로 조회합니다. 키움이 지원하지 않는 종목(레버리지 ETF 등)은 아래 CSV 가져오기를 이용하세요.
        </p>
      </div>

      <div style={{ ...boxStyle, marginBottom: 14 }}>
        <div style={{ color: '#f1f5f9', fontWeight: 700, fontSize: 13, marginBottom: 8 }}>CSV 파일 가져오기</div>
        <div className="form-row" style={{ gap: 12, marginBottom: 10, alignItems: 'flex-end' }}>
          <InputField label="종목코드"><input placeholder="예: SOXL" value={csvCode} onChange={e => setCsvCode(e.target.value.trim())} style={{ ...numInputStyle, width: 130 }} /></InputField>
          <InputField label="종목명"><input placeholder="종목명" value={csvName} onChange={e => setCsvName(e.target.value)} style={{ ...numInputStyle, width: 110 }} /></InputField>
          <InputField label="CSV 파일">
            <input type="file" accept=".csv,text/csv" onChange={handleCsvFile} style={{ ...numInputStyle, width: 220, padding: '4px 6px' }} />
          </InputField>
        </div>
        <textarea
          className="textarea"
          value={csvText}
          onChange={e => setCsvText(e.target.value)}
          placeholder={'파일을 선택하면 내용이 여기 표시됩니다. 직접 붙여넣기도 가능: date,close\n2024-01-02,187.15\n...'}
          rows={5}
          style={{ fontSize: 12, marginBottom: 8 }}
        />
        <button className="toggle-btn active" onClick={handleCsvImport} disabled={csvStatus.loading || !csvCode || !csvText}>
          {csvStatus.loading ? '가져오는 중...' : 'CSV 가져오기'}
        </button>
        {csvStatus.msg && <p className="dim" style={{ fontSize: 12, marginTop: 8 }}>{csvStatus.msg}</p>}
        {csvStatus.error && <p className="text-error" style={{ marginTop: 8 }}>{csvStatus.error}</p>}
        <p className="dim" style={{ fontSize: 12, marginTop: 8 }}>
          Shannon/fetch_stock.py로 로컬에서 받은 결과(예: <code>python fetch_stock.py SOXL 2022-01-01 2024-12-31</code> 실행 후 출력된 date,close CSV)를 붙여넣으면 됩니다.
        </p>
      </div>

      {symbolsLoading ? (
        <p className="dim">불러오는 중...</p>
      ) : savedSymbols.length === 0 ? (
        <p className="dim">저장된 가격 데이터가 없습니다. 위에서 종목을 다운로드하세요.</p>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr><th>코드</th><th>이름</th><th>시장</th><th className="r">구간</th><th className="r">건수</th><th></th></tr>
            </thead>
            <tbody>
              {savedSymbols.map(s => (
                <tr key={s.code}>
                  <td>{s.code}</td>
                  <td>{s.name}</td>
                  <td className="dim">{s.market}</td>
                  <td className="r dim">{s.minDate} ~ {s.maxDate}</td>
                  <td className="r">{s.count}</td>
                  <td className="r"><button className="toggle-btn" style={{ color: '#f87171', borderColor: '#7f1d1d' }} onClick={() => handleDeleteSymbol(s.code)}>삭제</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

const boxStyle = { minWidth: 280, flex: 1, background: '#0f172a', border: '1px solid #334155', borderRadius: 10, padding: 14 }
