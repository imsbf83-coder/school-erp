import { createContext, useContext, useEffect, useState } from 'react';
import client from '../api/client';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    const stored = localStorage.getItem('user');
    return stored ? JSON.parse(stored) : null;
  });

  // Refresh `modules` from the server on every app load (not just at
  // login) — permission changes an admin makes take effect on the backend
  // immediately, but the frontend's copy of `user` only lived in
  // localStorage, so without this a nav item an admin just granted/revoked
  // wouldn't show/hide correctly until the next login. Silently does
  // nothing if there's no token or the request fails (e.g. offline) — the
  // stale cached modules from localStorage are used as a fallback either
  // way, and the actual page-level access check always happens on the
  // backend regardless of what the nav shows.
  useEffect(() => {
    if (!localStorage.getItem('token')) return;
    client
      .get('/me')
      .then(({ data }) => {
        setUser((prev) => {
          const merged = { ...prev, ...data };
          localStorage.setItem('user', JSON.stringify(merged));
          return merged;
        });
      })
      .catch(() => {
        // Token invalid/expired — client.js's 401 interceptor already
        // handles redirecting to /login in that case, nothing to do here.
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // identifier is an email (ADMIN/ACCOUNTANT/STAFF) or a mobile number
  // (TEACHER accounts created via Teacher Access).
  async function login(identifier, password) {
    const { data } = await client.post('/auth/login', { identifier, password });
    localStorage.setItem('token', data.token);

    // Fetch this user's module access right away so the very first render
    // of the nav after login is already correctly filtered, instead of
    // showing everything for a moment and then narrowing.
    let modules = null;
    try {
      const meRes = await client.get('/me');
      modules = meRes.data.modules;
    } catch {
      // Fall back to whatever /auth/login itself returned, with no
      // modules info — nav will just show the role-based defaults until
      // the background refresh above (or the next login) fills this in.
    }

    const mergedUser = { ...data.user, modules };
    localStorage.setItem('user', JSON.stringify(mergedUser));
    setUser(mergedUser);
    return mergedUser;
  }

  function logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setUser(null);
  }

  // `modules === null` means unrestricted (ADMIN) -> always true.
  function hasModule(moduleName) {
    if (!user) return false;
    if (user.modules === null || user.modules === undefined) return user.role === 'ADMIN';
    return user.modules.includes(moduleName);
  }

  return (
    <AuthContext.Provider value={{ user, login, logout, hasModule }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
