import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useSearchParams } from 'react-router-dom';
import { resetPasswordSchema } from 'shared';
import { toast } from 'sonner';
import { z } from 'zod';
import { AuthLayout } from '@/components/auth-layout';
import { FormField } from '@/components/form-field';
import { LinkButton } from '@/components/link-button';
import { PasswordStrengthMeter } from '@/components/password-strength-meter';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import * as authApi from '@/features/auth/api';
import { extractErrorMessage } from '@/lib/extract-error-message';

const resetFormSchema = resetPasswordSchema
  .omit({ token: true })
  .extend({ confirmPassword: z.string() })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: 'As senhas não coincidem.',
    path: ['confirmPassword'],
  });

type ResetFormInput = z.infer<typeof resetFormSchema>;

export function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<ResetFormInput>({ resolver: zodResolver(resetFormSchema) });

  const mutation = useMutation({
    mutationFn: authApi.resetPassword,
    onSuccess: (data) => setSuccessMessage(data.message),
    onError: (error) => toast.error(extractErrorMessage(error, 'Token inválido ou expirado.')),
  });

  if (!token) {
    return (
      <AuthLayout title="Link inválido">
        <p className="text-sm text-destructive">
          Este link de redefinição de senha é inválido. Solicite um novo.
        </p>
        <LinkButton to="/forgot-password" className="mt-4">
          Solicitar novo link
        </LinkButton>
      </AuthLayout>
    );
  }

  if (successMessage) {
    return (
      <AuthLayout title="Senha redefinida">
        <p className="text-sm text-muted-foreground">{successMessage}</p>
        <LinkButton to="/login" className="mt-4">
          Ir para o login
        </LinkButton>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Redefinir senha" description="Escolha uma nova senha.">
      <form
        className="flex flex-col gap-4"
        onSubmit={handleSubmit((data) => mutation.mutate({ token, newPassword: data.newPassword }))}
      >
        <div>
          <FormField
            label="Nova senha"
            id="newPassword"
            type="password"
            autoComplete="new-password"
            error={errors.newPassword?.message}
            {...register('newPassword')}
          />
          <PasswordStrengthMeter password={watch('newPassword') ?? ''} />
        </div>
        <FormField
          label="Confirmar nova senha"
          id="confirmPassword"
          type="password"
          autoComplete="new-password"
          error={errors.confirmPassword?.message}
          {...register('confirmPassword')}
        />
        <Button
          type="submit"
          variant="glow"
          disabled={mutation.isPending}
          className="mt-1.5 w-full"
        >
          {mutation.isPending && <Spinner />}
          Redefinir senha
        </Button>
      </form>
    </AuthLayout>
  );
}
