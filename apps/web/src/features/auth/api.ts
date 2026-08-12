import type { ForgotPasswordInput, LoginInput, RegisterInput, ResetPasswordInput } from 'shared';
import { apiClient } from '@/lib/api-client';

export interface MessageResponse {
  message: string;
}

export interface LoginResponse {
  accessToken: string;
}

export interface UserProfile {
  id: string;
  email: string;
  emailVerifiedAt: string | null;
  createdAt: string;
}

export async function register(input: RegisterInput): Promise<MessageResponse> {
  const { data } = await apiClient.post<MessageResponse>('/auth/register', input);
  return data;
}

export async function verifyEmail(token: string): Promise<MessageResponse> {
  const { data } = await apiClient.get<MessageResponse>('/auth/verify', {
    params: { token },
  });
  return data;
}

export async function login(input: LoginInput): Promise<LoginResponse> {
  const { data } = await apiClient.post<LoginResponse>('/auth/login', input);
  return data;
}

export async function refresh(): Promise<LoginResponse> {
  const { data } = await apiClient.post<LoginResponse>('/auth/refresh');
  return data;
}

export async function logout(): Promise<void> {
  await apiClient.post('/auth/logout');
}

export async function resendVerification(input: ForgotPasswordInput): Promise<MessageResponse> {
  const { data } = await apiClient.post<MessageResponse>('/auth/resend-verification', input);
  return data;
}

export async function forgotPassword(input: ForgotPasswordInput): Promise<MessageResponse> {
  const { data } = await apiClient.post<MessageResponse>('/auth/forgot-password', input);
  return data;
}

export async function resetPassword(input: ResetPasswordInput): Promise<MessageResponse> {
  const { data } = await apiClient.post<MessageResponse>('/auth/reset-password', input);
  return data;
}

export async function me(): Promise<UserProfile> {
  const { data } = await apiClient.get<UserProfile>('/users/me');
  return data;
}
