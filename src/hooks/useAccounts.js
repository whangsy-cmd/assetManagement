import { useEffect, useState } from 'react'
import { collection, onSnapshot, doc, setDoc, deleteDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from '../contexts/AuthContext'

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
        setAccounts(snap.docs.map(d => ({ id: d.id, ...d.data() })))
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

  return { accounts, loading, error, saveAccount, deleteAccount }
}
