import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { clearAuth, getAuth, setAuth } from '../api/storage';
import { setAuthErrorHandler } from '../api/errors';
import { isExpired } from '../utils/jwt';

const Ctx = createContext(null);

export function AuthProvider({ children }) {
  const [auth, setAuthState] = useState(() => {
    const a = getAuth();
    if (a && isExpired(a.token)) { clearAuth(); return null; }
    return a;
  });

  const signIn = useCallback(async (username, password) => {
    const a = await api.login(username, password);
    setAuth(a);
    setAuthState(a);
    return a;
  }, []);

  const signUp = useCallback(async (username, password) => {
    await api.register(username, password);
    return signIn(username, password);
  }, [signIn]);

  const signOut = useCallback(() => { clearAuth(); setAuthState(null); }, []);

  // Contract: 401 INVALID_TOKEN / TOKEN_EXPIRED -> log in again (no refresh endpoint in v1.0).
  useEffect(() => { setAuthErrorHandler(() => signOut()); return () => setAuthErrorHandler(null); }, [signOut]);

  const value = useMemo(() => ({ auth, signIn, signUp, signOut }), [auth, signIn, signUp, signOut]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
