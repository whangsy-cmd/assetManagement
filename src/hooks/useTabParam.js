// 탭 상태를 URL 쿼리(?tab=탭이름)로 관리 — 새로고침해도 같은 탭 유지, 라벨 기준이라 탭 순서 바뀌어도 안전
import { useSearchParams } from 'react-router-dom'

export function useTabParam(tabs, paramName = 'tab') {
  const [searchParams, setSearchParams] = useSearchParams()
  const fromUrl = tabs.indexOf(searchParams.get(paramName))
  const tab = fromUrl >= 0 ? fromUrl : 0

  const setTab = (i) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      next.set(paramName, tabs[i])
      return next
    }, { replace: true })
  }

  return [tab, setTab]
}
