import { createContext, useContext, useState, type ReactNode } from "react";

interface AuthState {
  token: string | null;
  setToken: (token: string | null) => void;
}

const AuthContext = createContext<AuthState>({
  token: null,
  setToken: () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setTokenState] = useState<string | null>(
    () => localStorage.getItem("prodscope_token"),
  );

  function setToken(t: string | null) {
    if (t) {
      localStorage.setItem("prodscope_token", t);
    } else {
      localStorage.removeItem("prodscope_token");
    }
    setTokenState(t);
  }

  return (
    <AuthContext.Provider value={{ token, setToken }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
