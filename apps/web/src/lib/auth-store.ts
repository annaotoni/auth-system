import { create } from 'zustand';

interface AuthState {
  accessToken: string | null;
  setAccessToken: (accessToken: string | null) => void;
}

// Access token só existe em memória — nunca em localStorage/sessionStorage,
// pra não ficar acessível a um XSS. Uma recarga de página perde o token de
// propósito; o bootstrap (ver App.tsx) recupera a sessão via refresh cookie.
export const useAuthStore = create<AuthState>((set) => ({
  accessToken: null,
  setAccessToken: (accessToken) => set({ accessToken }),
}));
