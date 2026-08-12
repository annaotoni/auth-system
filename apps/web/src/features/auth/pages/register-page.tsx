import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { registerSchema, type RegisterInput } from 'shared';
import { toast } from 'sonner';
import { AuthFooterLink } from '@/components/auth-footer-link';
import { AuthLayout } from '@/components/auth-layout';
import { FormField } from '@/components/form-field';
import { LinkButton } from '@/components/link-button';
import { PasswordStrengthMeter } from '@/components/password-strength-meter';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import * as authApi from '@/features/auth/api';
import { extractErrorMessage } from '@/lib/extract-error-message';

export function RegisterPage() {
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<RegisterInput>({ resolver: zodResolver(registerSchema) });

  const mutation = useMutation({
    mutationFn: authApi.register,
    onSuccess: (data) => setSuccessMessage(data.message),
    onError: (error) => toast.error(extractErrorMessage(error)),
  });

  if (successMessage) {
    return (
      <AuthLayout title="Verifique seu e-mail">
        <p className="text-sm text-muted-foreground">{successMessage}</p>
        <LinkButton to="/login" className="mt-4">
          Voltar para o login
        </LinkButton>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Criar conta" description="Cadastre-se para começar.">
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
            autoComplete="new-password"
            error={errors.password?.message}
            {...register('password')}
          />
          <PasswordStrengthMeter password={watch('password') ?? ''} />
        </div>
        <Button
          type="submit"
          variant="glow"
          disabled={mutation.isPending}
          className="mt-1.5 w-full"
        >
          {mutation.isPending && <Spinner />}
          Criar conta
        </Button>
      </form>
      <AuthFooterLink prompt="Já tem conta?" linkLabel="Entrar" to="/login" />
    </AuthLayout>
  );
}
