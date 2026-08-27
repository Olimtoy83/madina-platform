import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  getCurrentUser,
  login as loginApi,
  logout as logoutApi,
} from '../shared/api/authApi'
import { subscribeToUnauthorized } from '../shared/api/httpClient'
import {
  AuthSession,
  type AuthApi,
} from '../shared/auth/AuthSession'
import { AuthContext } from './AuthContext'

interface AuthProviderProps {
  children: ReactNode
}

const authApi: AuthApi = {
  getCurrentUser,
  login: loginApi,
  logout: logoutApi,
}

export function AuthProvider({
  children,
}: AuthProviderProps) {
  const sessionRef = useRef<AuthSession | null>(null)

  if (!sessionRef.current) {
    sessionRef.current = new AuthSession(authApi)
  }

  const session = sessionRef.current
  const [state, setState] = useState(session.getState())

  useEffect(() => {
    const unsubscribe = session.subscribe(setState)
    const unsubscribeUnauthorized = subscribeToUnauthorized(() => {
      session.invalidate()
    })

    void session.refresh()

    return () => {
      unsubscribe()
      unsubscribeUnauthorized()
    }
  }, [session])

  const value = useMemo(() => ({
    ...state,
    isAuthenticated: state.user !== null,
    login: session.login.bind(session),
    logout: session.logout.bind(session),
    refresh: session.refresh.bind(session),
  }), [session, state])

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  )
}
