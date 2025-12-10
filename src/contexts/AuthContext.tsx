import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

interface User {
  username: string;
}

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  login: (username: string, password: string) => boolean;
  signup: (username: string, password: string) => { success: boolean; error?: string };
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

// Original admin account
const ADMIN_ACCOUNT = {
  username: 'alvin',
  password: 'REDACTED',
};

// Shared password for new account creation
const SIGNUP_PASSWORD = 'slaybot';

const AUTH_KEY = 'thesis-checker-auth';
const ACCOUNTS_KEY = 'thesis-checker-accounts';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    // Check for existing session
    const stored = localStorage.getItem(AUTH_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        setUser(parsed);
      } catch {
        localStorage.removeItem(AUTH_KEY);
      }
    }
  }, []);

  // Get stored accounts
  const getStoredAccounts = (): Record<string, string> => {
    try {
      const stored = localStorage.getItem(ACCOUNTS_KEY);
      return stored ? JSON.parse(stored) : {};
    } catch {
      return {};
    }
  };

  const login = (username: string, password: string): boolean => {
    // Check admin account first
    if (username === ADMIN_ACCOUNT.username && password === ADMIN_ACCOUNT.password) {
      const userData = { username };
      setUser(userData);
      localStorage.setItem(AUTH_KEY, JSON.stringify(userData));
      return true;
    }
    
    // Check stored accounts
    const accounts = getStoredAccounts();
    if (accounts[username] === password) {
      const userData = { username };
      setUser(userData);
      localStorage.setItem(AUTH_KEY, JSON.stringify(userData));
      return true;
    }
    
    return false;
  };

  const signup = (username: string, password: string): { success: boolean; error?: string } => {
    if (password !== SIGNUP_PASSWORD) {
      return { success: false, error: 'Invalid signup password' };
    }
    
    if (username === ADMIN_ACCOUNT.username) {
      return { success: false, error: 'Username already taken' };
    }
    
    const accounts = getStoredAccounts();
    if (accounts[username]) {
      return { success: false, error: 'Username already exists' };
    }
    
    // Store new account
    accounts[username] = password;
    localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
    
    // Auto login
    const userData = { username };
    setUser(userData);
    localStorage.setItem(AUTH_KEY, JSON.stringify(userData));
    
    return { success: true };
  };

  const logout = () => {
    setUser(null);
    localStorage.removeItem(AUTH_KEY);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        login,
        signup,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
