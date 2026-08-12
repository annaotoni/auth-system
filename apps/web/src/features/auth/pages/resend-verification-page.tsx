import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useSearchParams } from 'react-router-dom';
import { forgotPasswordSchema, type ForgotPasswordInput } from 'shared';
import { toast } from 'sonner';
import { AuthLayout } from '@/components/auth-layout';
import { FormField } from '@/components/form-field';
import { LinkButton } from '@/components/link-button';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import * as authApi from '@/features/auth/api';
import { extractErrorMessage } from '@/lib/extract-error-message';

export function ResendVerificationPage() {
  const [searchParams] = useSearchParams();
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ForgotPasswordInput>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: searchParams.get('email') ?? '' },
  });

  const mutation = useMutation({
    mutationFn: authApi.resendVerification,
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
    <AuthLayout
      title="Reenviar verificação"
      description="Informe seu e-mail para receber um novo link de confirmação."
    >
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
        <Button
          type="submit"
          variant="glow"
          disabled={mutation.isPending}
          className="mt-1.5 w-full"
        >
          {mutation.isPending && <Spinner />}
          Reenviar link
        </Button>
      </form>
      <p className="mt-6 border-t border-[rgba(120,178,235,0.12)] pt-5 text-center text-sm text-[rgba(178,205,235,0.7)]">
        <Link to="/login" className="font-semibold text-[#7cc9ff] hover:text-[#a8ddff]">
          Voltar para o login
        </Link>
      </p>
    </AuthLayout>
  );
}
