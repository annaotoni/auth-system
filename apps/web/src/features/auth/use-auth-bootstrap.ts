import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '@/lib/auth-store';
import * as authApi from './api';

// Access token vive só em memória, então some a cada reload. No boot da app,
// tenta uma renovação silenciosa via cookie de refresh antes de decidir se
// mostra a área logada ou o login — sem isso, todo F5 deslogaria o usuário.
export function useAuthBootstrap() {
  const setAccessToken = useAuthStore((state) => state.setAccessToken);

  return useQuery({
    queryKey: ['auth-bootstrap'],
    queryFn: async () => {
      try {
        const { accessToken } = await authApi.refresh();
        setAccessToken(accessToken);
        return true;
      } catch {
        setAccessToken(null);
        return false;
      }
    },
    retry: false,
    staleTime: Infinity,
  });
}
