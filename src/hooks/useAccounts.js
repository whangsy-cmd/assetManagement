// 계좌 목록 실시간 구독 훅 — order 필드 기준 정렬(계좌관리 드래그 순서), 모든 계좌선택 드롭다운이 이 순서를 따름
import { useEffect, useState } from 'react'
import { collection, onSnapshot, doc, setDoc, deleteDoc, serverTimestamp, writeBatch } from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from '../contexts/AuthContext'

const sortAccounts = (list) => [...list].sort((a, b) =>
  (a.order ?? Infinity) - (b.order ?? Infinity) || a.accountId.localeCompare(b.accountId)
)

export function useAccounts() {
  const { user } = useAuth()
  const [accounts, setAccounts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!user) return
    const ref = collection(db, 'users', user.uid, 'accounts')
    const unsub = onSnapshot(
      ref,
      snap => {
        setAccounts(sortAccounts(snap.docs.map(d => ({ id: d.id, ...d.data() }))))
        setLoading(false)
        setError('')
      },
      err => {
        console.error('Firestore error:', err)
        setError(err.code + ': ' + err.message)
        setLoading(false)
      }
    )
    return unsub
  }, [user])

  const saveAccount = async (account) => {
    const ref = doc(db, 'users', user.uid, 'accounts', account.accountId)
    await setDoc(ref, { ...account, createdAt: serverTimestamp() }, { merge: true })
  }

  const deleteAccount = async (accountId) => {
    await deleteDoc(doc(db, 'users', user.uid, 'accounts', accountId))
  }

  // 드래그로 재정렬한 전체 목록을 받아 order 필드 일괄 저장
  const reorderAccounts = async (orderedList) => {
    const batch = writeBatch(db)
    orderedList.forEach((acc, i) => {
      batch.set(doc(db, 'users', user.uid, 'accounts', acc.accountId), { order: i }, { merge: true })
    })
    await batch.commit()
  }

  return { accounts, loading, error, saveAccount, deleteAccount, reorderAccounts }
}
