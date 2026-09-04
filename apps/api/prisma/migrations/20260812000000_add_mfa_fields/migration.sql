-- AlterEnum: eventos de auditoria de MFA
BEGIN;
CREATE TYPE "AuthEvent_new" AS ENUM (
  'LOGIN_SUCCESS',
  'LOGIN_FAILED',
  'LOGOUT',
  'PASSWORD_RESET',
  'TOKEN_REUSE_DETECTED',
  'EMAIL_VERIFIED',
  'MFA_ENABLED',
  'MFA_DISABLED',
  'MFA_CHALLENGE_PASSED',
  'MFA_CHALLENGE_FAILED'
);
ALTER TABLE "auth_audit_log"
  ALTER COLUMN "event_type" TYPE "AuthEvent_new"
  USING ("event_type"::text::"AuthEvent_new");
ALTER TYPE "AuthEvent" RENAME TO "AuthEvent_old";
ALTER TYPE "AuthEvent_new" RENAME TO "AuthEvent";
DROP TYPE "AuthEvent_old";
COMMIT;

-- AlterTable: colunas de TOTP no usuário
ALTER TABLE "users"
  ADD COLUMN "mfa_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "mfa_secret" TEXT;
