// 성과분석 화면 — 대시보드 옆 메인 메뉴로 분리 (탭 구현은 ./dataview/PerformanceTab)
import PerformanceTab from './dataview/PerformanceTab'
import '../common.css'

export default function PerformanceAnalysis() {
  return (
    <div className="page">
      <div className="page-heading-row">
        <h2 className="page-heading">성과분석</h2>
      </div>
      <PerformanceTab />
    </div>
  )
}
