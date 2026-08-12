import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { GlowCard } from '@/components/glow-card';
import { PageBackground } from '@/components/page-background';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import * as authApi from '@/features/auth/api';
import { useAuthStore } from '@/lib/auth-store';

export function DashboardPage() {
  const navigate = useNavigate();
  const setAccessToken = useAuthStore((state) => state.setAccessToken);
  const query = useQuery({ queryKey: ['me'], queryFn: authApi.me });

  const logoutMutation = useMutation({
    mutationFn: authApi.logout,
    onSettled: () => {
      setAccessToken(null);
      void navigate('/login');
    },
  });

  return (
    <PageBackground>
      <GlowCard>
        <h1 className="m-0 text-[30px] leading-[1.15] font-semibold tracking-[-0.02em] text-[#f2f8ff]">
          Dashboard
        </h1>
        <p className="mt-2.5 mb-8 text-[15px] text-[rgba(178,205,235,0.72)]">
          Área protegida — só acessível autenticado.
        </p>

        <div className="flex flex-col gap-2 text-sm">
          {query.isPending && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Spinner /> Carregando perfil...
            </div>
          )}
          {query.isSuccess && (
            <>
              <p>
                <span className="text-muted-foreground">E-mail:</span> {query.data.email}
              </p>
              <p>
                <span className="text-muted-foreground">E-mail verificado em:</span>{' '}
                {query.data.emailVerifiedAt
                  ? new Date(query.data.emailVerifiedAt).toLocaleString('pt-BR')
                  : '—'}
              </p>
              <p>
                <span className="text-muted-foreground">Conta criada em:</span>{' '}
                {new Date(query.data.createdAt).toLocaleString('pt-BR')}
              </p>
            </>
          )}
        </div>

        <Button
          variant="outline"
          className="mt-6 w-full border-[rgba(120,178,235,0.20)] bg-transparent hover:bg-[rgba(120,178,235,0.08)]"
          onClick={() => logoutMutation.mutate()}
          disabled={logoutMutation.isPending}
        >
          {logoutMutation.isPending && <Spinner />}
          Sair
        </Button>
      </GlowCard>
    </PageBackground>
  );
}
