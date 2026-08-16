// Firebase Google 로그인 상태 Context
import { createContext, useContext, useEffect, useState } from 'react'
import { onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth'
import { auth, provider } from '../firebase'
import { setKiwoomAuthUid } from '../utils/kiwoomApi'
import { setKrHolidayAuthUid } from '../utils/krHolidays'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(undefined) // undefined = loading

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, u => {
      setUser(u)
      setKiwoomAuthUid(u?.uid ?? null)
      setKrHolidayAuthUid(u?.uid ?? null)
    })
    return unsub
  }, [])

  const login = () => signInWithPopup(auth, provider)
  const logout = () => signOut(auth)

  return (
    <AuthContext.Provider value={{ user, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
