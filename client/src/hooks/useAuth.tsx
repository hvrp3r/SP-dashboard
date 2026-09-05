import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from 'react';
import * as authApi from '../api/auth.js';
import * as cosmeticsApi from '../api/cosmetics.js';
import { setAccessToken } from '../api/client.js';
import type { EquippedCosmetic, User } from '../types.js';

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  /** Cosmétiques équipés par l'utilisateur connecté — pour afficher son propre pseudo stylé (nav, accueil…). */
  equippedCosmetics: EquippedCosmetic[];
  login: (email: string, password: string) => Promise<User>;
  register: (username: string, email: string, password: string) => Promise<User>;
  logout: () => Promise<void>;
  setUser: (user: User) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const BALANCE_POLL_INTERVAL_MS = 15000;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [equippedCosmetics, setEquippedCosmetics] = useState<EquippedCosmetic[]>([]);

  function refreshEquipped() {
    cosmeticsApi
      .getMine()
      .then((data) => setEquippedCosmetics(data.equipped))
      .catch(() => {});
  }

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(
          `${import.meta.env.VITE_API_URL ?? 'http://localhost:3001'}/api/auth/refresh`,
          { method: 'POST', credentials: 'include' }
        );
        if (res.ok) {
          const data = (await res.json()) as { accessToken: string };
          setAccessToken(data.accessToken);
          const me = await authApi.getMe();
          setUser(me);
          refreshEquipped();
        }
      } catch {
        // Pas de session valide, l'utilisateur reste déconnecté
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Rafraîchit régulièrement le profil (solde SP, streak...) pour que les gains/pertes
  // survenus ailleurs (défi, mini-jeu, ajustement MSP) se reflètent sans rechargement.
  useEffect(() => {
    if (!user) return;
    const interval = setInterval(async () => {
      try {
        const me = await authApi.getMe();
        setUser(me);
      } catch {
        // Ignoré : le prochain sondage réessaiera.
      }
    }, BALANCE_POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [user?.id]);

  const login = useCallback(async (email: string, password: string) => {
    const data = await authApi.login(email, password);
    setAccessToken(data.accessToken);
    setUser(data.user);
    refreshEquipped();
    return data.user;
  }, []);

  const register = useCallback(async (username: string, email: string, password: string) => {
    const data = await authApi.register(username, email, password);
    setAccessToken(data.accessToken);
    setUser(data.user);
    refreshEquipped();
    return data.user;
  }, []);

  const logout = useCallback(async () => {
    await authApi.logout();
    setAccessToken(null);
    setUser(null);
    setEquippedCosmetics([]);
  }, []);

  return (
    <AuthContext.Provider
      value={{ user, loading, equippedCosmetics, login, register, logout, setUser }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth doit être utilisé dans un AuthProvider');
  return ctx;
}
