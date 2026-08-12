import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { useAuthStore } from './auth-store';

type RetriableRequest = InternalAxiosRequestConfig & { _retry?: boolean };

const AUTH_ENDPOINTS_WITHOUT_REFRESH = ['/auth/login', '/auth/refresh'];

export const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_URL,
  withCredentials: true, // necessário pro cookie httpOnly de refresh
});

// Instância isolada, sem os interceptors abaixo: usada só pra chamar
// /auth/refresh, pra uma falha de refresh não reentrar no próprio handler de 401.
const refreshClient = axios.create({
  baseURL: import.meta.env.VITE_API_URL,
  withCredentials: true,
});

apiClient.interceptors.request.use((config) => {
  const accessToken = useAuthStore.getState().accessToken;
  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`;
  }
  return config;
});

let isRefreshing = false;
let pendingRequests: Array<(token: string | null) => void> = [];

function resolvePendingRequests(token: string | null): void {
  pendingRequests.forEach((resolve) => resolve(token));
  pendingRequests = [];
}

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as RetriableRequest | undefined;

    const shouldTryRefresh =
      error.response?.status === 401 &&
      originalRequest &&
      !originalRequest._retry &&
      !AUTH_ENDPOINTS_WITHOUT_REFRESH.some((path) => originalRequest.url?.includes(path));

    if (!shouldTryRefresh) {
      return Promise.reject(error);
    }

    // Um refresh concorrente já está em voo: entra na fila em vez de
    // disparar outro — o back-end rotaciona o token a cada uso, então uma
    // segunda chamada simultânea invalidaria a primeira.
    if (isRefreshing) {
      return new Promise((resolve, reject) => {
        pendingRequests.push((token) => {
          if (!token) {
            reject(error);
            return;
          }
          originalRequest._retry = true;
          originalRequest.headers.Authorization = `Bearer ${token}`;
          resolve(apiClient(originalRequest));
        });
      });
    }

    isRefreshing = true;

    try {
      const { data } = await refreshClient.post<{ accessToken: string }>('/auth/refresh');
      useAuthStore.getState().setAccessToken(data.accessToken);
      resolvePendingRequests(data.accessToken);

      originalRequest._retry = true;
      originalRequest.headers.Authorization = `Bearer ${data.accessToken}`;
      return apiClient(originalRequest);
    } catch (refreshError) {
      resolvePendingRequests(null);
      useAuthStore.getState().setAccessToken(null);
      // Sessão realmente morreu (expirada ou reuse detection) — redireciona
      // direto, já que a falha pode vir de qualquer componente na árvore.
      window.location.href = '/login';
      return Promise.reject(refreshError);
    } finally {
      isRefreshing = false;
    }
  },
);
