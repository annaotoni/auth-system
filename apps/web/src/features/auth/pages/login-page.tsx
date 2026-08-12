import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router-dom';
import { loginSchema, type LoginInput } from 'shared';
import { toast } from 'sonner';
import { AuthFooterLink } from '@/components/auth-footer-link';
import { AuthLayout } from '@/components/auth-layout';
import { FormField } from '@/components/form-field';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import * as authApi from '@/features/auth/api';
import { useAuthStore } from '@/lib/auth-store';
import { extractErrorMessage } from '@/lib/extract-error-message';

const EMAIL_NOT_VERIFIED_MESSAGE = 'E-mail não verificado';

export function LoginPage() {
  const navigate = useNavigate();
  const setAccessToken = useAuthStore((state) => state.setAccessToken);
  const [unverifiedEmail, setUnverifiedEmail] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginInput>({ resolver: zodResolver(loginSchema) });

  const mutation = useMutation({
    mutationFn: authApi.login,
    onSuccess: (data) => {
      setAccessToken(data.accessToken);
      void navigate('/dashboard');
    },
    onError: (error, variables) => {
      const message = extractErrorMessage(error, 'Credenciais inválidas.');
      toast.error(message);
      setUnverifiedEmail(message === EMAIL_NOT_VERIFIED_MESSAGE ? variables.email : null);
    },
  });

  return (
    <AuthLayout title="Entrar" description="Acesse sua conta.">
      <form
        className="flex flex-col gap-4"
        onSubmit={handleSubmit((data) => mutation.mutate(data))}
      >
        <FormField
          label="E-mail"
          id="email"
          type="email"
          autoComplete="email"
          error={errors.email?.message}
          {...register('email')}
        />
        <div>
          <FormField
            label="Senha"
            id="password"
            type="password"
            autoComplete="current-password"
            error={errors.password?.message}
            {...register('password')}
          />
          <Link
            to="/forgot-password"
            className="mt-1.5 inline-block text-xs text-[rgba(140,200,250,0.78)] hover:text-[#8ad4ff]"
          >
            Esqueci minha senha
          </Link>
        </div>
        <Button
          type="submit"
          variant="glow"
          disabled={mutation.isPending}
          className="mt-1.5 w-full"
        >
          {mutation.isPending && <Spinner />}
          Entrar
        </Button>
      </form>
      {unverifiedEmail && (
        <p className="mt-3 text-center text-sm text-[rgba(178,205,235,0.7)]">
          <Link
            to={`/resend-verification?email=${encodeURIComponent(unverifiedEmail)}`}
            className="font-semibold text-[#7cc9ff] hover:text-[#a8ddff]"
          >
            Reenviar e-mail de verificação
          </Link>
        </p>
      )}
      <AuthFooterLink prompt="Não tem conta?" linkLabel="Cadastre-se" to="/register" />
    </AuthLayout>
  );
}
