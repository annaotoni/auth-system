import { isAxiosError } from 'axios';

export function extractErrorMessage(
  error: unknown,
  fallback = 'Algo deu errado. Tente novamente.',
): string {
  if (isAxiosError<{ message?: string }>(error)) {
    return error.response?.data.message ?? fallback;
  }
  return fallback;
}
