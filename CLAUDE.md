# CLAUDE.md — auth-system

Projeto de portfólio: sistema de autenticação completo (cadastro, login,
verificação de e-mail, recuperação de senha) com foco em segurança de nível
produção. Este arquivo vale só para esta pasta e substitui, aqui, qualquer
convenção de outros projetos.

## Stack

- Back-end: NestJS + TypeScript estrito (`apps/api`)
- ORM: Prisma (PostgreSQL, `citext` para email) — padrão clássico, sem
  adapter: `PrismaService` só estende `PrismaClient` (`src/prisma`) e lê
  `DATABASE_URL` do ambiente via `env("DATABASE_URL")` no próprio
  `datasource` do schema. O CLI (migrate/status) usa esse mesmo `.env` via
  `prisma.config.ts`. Nota: a engine de validação de schema bundlada nesta
  versão (6.19.3) já é um preview do Prisma 7, que sinaliza `url` no schema
  como obsoleto — o aviso do editor pode ser ignorado; sem o `url` no
  schema, os comandos de CLI quebram (testado e confirmado).
- Front-end: React + TypeScript + Vite (`apps/web`)
- UI: TailwindCSS v4 + shadcn/ui
- Forms: React Hook Form + Zod
- Estado servidor: TanStack Query
- Contratos compartilhados (schemas Zod): `packages/shared`
- Hashing de senha: argon2 (Argon2id, parâmetros OWASP)
- E-mail: Nodemailer (Mailhog no dev, Resend em prod)
- Dev local: docker-compose (postgres + redis + mailhog)

## Arquitetura (apps/api)

Módulos por domínio em `src/modules/*` (auth, users, mail). Dentro de cada
módulo: `controller` (fino, sem regra de negócio) → `service` (regra de
negócio, nunca conhece HTTP) → acesso a dados via `PrismaService`
(`src/prisma`). Infra transversal em `src/common` (filters, guards,
decorators) e `src/config` (validação de env).

Regra central do domínio: tokens de refresh nunca são JWT — são valores
opacos (`crypto.randomBytes(32)`) e só o hash é persistido. Ver
`ARCHITECTURE.md` (criado na Fase 7) para os fluxos completos.

## Segurança — não negociável

1. Senha: Argon2id (`memoryCost: 19456, timeCost: 2, parallelism: 1`).
2. Access token: JWT 15min, corpo da resposta, vive só em memória no front.
3. Refresh token: opaco, hasheado no banco, cookie `httpOnly`+`Secure`+
   `SameSite=Strict`, TTL 7 dias.
4. Refresh rotation + reuse detection: token usado é revogado e substituído
   (`replacedBy`); tokens da mesma sessão compartilham `familyId`; reuso de
   token revogado revoga a family inteira.
5. Sem enumeração de usuário: respostas e tempo de resposta genéricos em
   register/login/forgot-password (sempre rodar `argon2.verify`, mesmo
   contra hash dummy).
6. Rate limit + lockout por IP e por conta (`failedLoginCount` +
   `lockedUntil` progressivo).
7. Reset de senha: token single-use, hasheado, TTL 30min; ao redefinir,
   revoga todos os refresh tokens do usuário.
8. Verificação de e-mail: token hasheado, TTL 24h; login exige e-mail
   verificado.
9. Política de senha: mínimo 8 caracteres + checagem opcional HIBP
   (k-anonymity, só primeiros 5 chars do SHA-1).
10. helmet + CORS com whitelist + cookie-parser.
11. Validação de entrada sempre via DTO (class-validator) ou Zod; Prisma
    parametriza tudo, nunca SQL cru.
12. Audit log (`AuthAuditLog`) para login ok/falho, logout, reset,
    verificação, reuse detection — sempre com IP e user-agent.
13. Segredos só em env, validados no boot com Zod (`src/config`); nunca
    commitar `.env`.
14. Erros: `ExceptionFilter` global, formato `{ statusCode, message, error }`,
    sem stack trace em produção.

## Convenções de código

- TypeScript estrito, sem `any` implícito.
- ESLint + Prettier obrigatórios; corrigir todo warning antes de finalizar
  uma fase (`npm run lint`, `npm run build`).
- Comentários enxutos: só o "porquê" de uma decisão não óbvia (ex.: reuse
  detection, timing attack, TTL escolhido). Nunca descrever o que a linha
  faz — nomes descritivos já cobrem isso.
- Funções pequenas, nomes descritivos, sem código morto, sem abstração
  especulativa (não adicionar camada/config para caso hipotético futuro).
- DTOs nunca atravessam camadas inteiras sem necessidade — services
  recebem apenas os dados de que precisam.

## Testes

- Toda funcionalidade nova precisa de teste (Jest/Supertest).
- Testes e2e cobrem os fluxos críticos: register → verify → login →
  refresh → reuse detection → reset.
- Mockar sempre serviços externos (e-mail, HIBP) nos testes; nunca chamada
  real de rede.
- Banco de teste isolado do banco de dev (nunca o mesmo `DATABASE_URL`).

## Git

- Conventional Commits (`feat:`, `fix:`, `chore:`, `test:`, `docs:` etc.).
- Um commit atômico por fase do roadmap, só depois de lint + testes + build
  passarem.
