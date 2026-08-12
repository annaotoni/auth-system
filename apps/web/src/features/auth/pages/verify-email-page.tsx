import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { AuthLayout } from '@/components/auth-layout';
import { LinkButton } from '@/components/link-button';
import { Spinner } from '@/components/ui/spinner';
import * as authApi from '@/features/auth/api';
import { extractErrorMessage } from '@/lib/extract-error-message';

export function VerifyEmailPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  const query = useQuery({
    queryKey: ['verify-email', token],
    queryFn: () => authApi.verifyEmail(token ?? ''),
    enabled: Boolean(token),
    retry: false,
  });

  return (
    <AuthLayout title="Verificação de e-mail">
      {!token && <p className="text-sm text-destructive">Link de verificação inválido.</p>}
      {token && query.isPending && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner /> Verificando...
        </div>
      )}
      {query.isSuccess && <p className="text-sm text-emerald-400">{query.data.message}</p>}
      {query.isError && (
        <p className="text-sm text-destructive">
          {extractErrorMessage(query.error, 'Token inválido ou expirado.')}
        </p>
      )}

      {query.isError ? (
        <>
          <LinkButton to="/resend-verification" className="mt-4">
            Solicitar novo link
          </LinkButton>
          <p className="mt-4 text-center text-sm text-[rgba(178,205,235,0.7)]">
            <Link to="/login" className="font-semibold text-[#7cc9ff] hover:text-[#a8ddff]">
              Voltar para o login
            </Link>
          </p>
        </>
      ) : (
        <LinkButton to="/login" className="mt-4">
          Ir para o login
        </LinkButton>
      )}
    </AuthLayout>
  );
}
