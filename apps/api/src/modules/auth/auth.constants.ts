export const ACCESS_TOKEN_TTL = '15m';
// Janela de tempo que o usuário tem para inserir o OTP após as credenciais.
export const MFA_CHALLENGE_TTL_S = 5 * 60;
export const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const REFRESH_TOKEN_COOKIE_NAME = 'refreshToken';

// A partir da 5ª falha, cada bloco de 5 falhas adicionais escala pro próximo
// tier de bloqueio — penaliza mais quem insiste, sem travar por muito tempo
// um erro de digitação isolado.
export const LOCKOUT_THRESHOLD = 5;
export const LOCKOUT_TIERS_MS = [
  60_000, // 1 min
  5 * 60_000, // 5 min
  30 * 60_000, // 30 min
  60 * 60_000, // 1h
  24 * 60 * 60_000, // 24h
];
