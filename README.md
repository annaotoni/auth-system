# auth-system

Sistema de autenticação completo — cadastro, verificação de e-mail, login,
refresh token com rotação e detecção de reuso, recuperação de senha —
construído com foco em segurança de nível produção. Projeto de portfólio.

Para as decisões de arquitetura e segurança por trás do código, veja o
[ARCHITECTURE.md](./ARCHITECTURE.md).

## Stack

| Camada          | Tecnologia                                                      |
| --------------- | --------------------------------------------------------------- |
| Back-end        | NestJS + TypeScript estrito                                     |
| ORM             | Prisma + PostgreSQL (`citext` para e-mail case-insensitive)     |
| Front-end       | React + TypeScript + Vite                                       |
| UI              | TailwindCSS v4 + shadcn/ui                                      |
| Formulários     | React Hook Form + Zod                                           |
| Estado servidor | TanStack Query                                                  |
| Hash de senha   | Argon2id (parâmetros OWASP)                                     |
| E-mail          | Nodemailer — Mailhog no dev, Resend em produção                 |
| Testes          | Jest + Supertest (unitário, e2e mockado, e2e com Postgres real) |

## Funcionalidades de segurança

- Senha com Argon2id; comparação sempre feita mesmo sem usuário existente (anti-timing).
- Access token JWT de vida curta (15 min) + refresh token opaco, hasheado no banco, em cookie `httpOnly`+`Secure`+`SameSite=Strict`.
- Rotação de refresh token a cada uso, com detecção de reuso: token roubado reapresentado revoga a sessão inteira.
- Revogação imediata de access token no logout via blocklist Redis por `jti` (JWT ID) — token interceptado não funciona após logout.
- MFA com TOTP (Google Authenticator, Authy etc.) — setup, ativação e desativação por endpoint autenticado.
- Sem enumeração de usuário: resposta e tempo de resposta genéricos em cadastro, login e recuperação de senha.
- Rate limit por IP + lockout progressivo por conta (1 min → 5 min → 30 min → 1h → 24h).
- Rate limit individual em todos os endpoints sensíveis: login (5/min), register (5/min), forgot-password (3/min), refresh (10/min), reset-password (5/min), verify (10/min), MFA (5/min). Contadores persistem entre restarts via Redis.
- Verificação de e-mail obrigatória antes do login, com reenvio de link.
- Checagem opcional de senha vazada via HIBP (k-anonymity, sem enviar a senha).
- Log de auditoria (login, logout, reset, verificação, reuso de token, MFA) com IP e user-agent.
- Cabeçalhos de segurança (helmet), CORS configurável por allowlist de domínios via `CORS_ORIGINS`, validação de entrada em todo endpoint.

Detalhamento completo em [ARCHITECTURE.md](./ARCHITECTURE.md).

## Rodando localmente

Pré-requisitos: Node 24+, Docker (para Postgres + Redis + Mailhog).

```bash
git clone <url-do-repositório>
cd auth-system
npm install
```

### 1. Suba a infraestrutura local

```bash
docker compose up -d
```

Isso sobe Postgres (`localhost:5432`, usuário/senha `auth`/`auth`, banco
`auth_system`) e Mailhog (SMTP em `localhost:1025`, UI web em
[http://localhost:8025](http://localhost:8025) para ver os e-mails
enviados sem precisar de uma caixa real).

### 2. Configure as variáveis de ambiente

```bash
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
```

Gere um `JWT_ACCESS_SECRET` real (mínimo 32 caracteres) e cole em
`apps/api/.env`:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
```

Os demais valores padrão do `.env.example` já funcionam com o
`docker compose` acima.

### 3. Aplique as migrations

```bash
cd apps/api
npx prisma migrate deploy
```

> Se for a primeira vez rodando após adicionar MFA, a migration `add_mfa_fields` já está incluída.

### 4. Suba as aplicações

Em dois terminais separados, a partir da raiz do repositório:

```bash
npm run start:dev --workspace=api   # http://localhost:3000
npm run dev --workspace=web         # http://localhost:5173
```

Abra [http://localhost:5173](http://localhost:5173), cadastre uma conta e
confira o e-mail de verificação em
[http://localhost:8025](http://localhost:8025) (Mailhog captura tudo, não
envia de verdade).

## Testes

Todos os comandos abaixo rodam a partir de `apps/api`.

```bash
npm test              # unitários — Services com dependências mockadas
npm run test:e2e      # e2e HTTP — guards, DTOs, cookies, sem banco real
npm run test:e2e:real # e2e completo — Postgres real, banco isolado (auth_system_test)
```

O `test:e2e:real` sobe suas próprias migrations num banco
`auth_system_test` completamente separado do banco de desenvolvimento —
nunca toca `auth_system`. Veja [ARCHITECTURE.md](./ARCHITECTURE.md#testes)
para o porquê da separação em três camadas.

## CI

`.github/workflows/ci.yml` roda em todo push/PR: lint + testes unitários +
e2e mockado + e2e real (com um serviço Postgres efêmero do próprio
GitHub Actions) + build do back-end, e lint + build do front-end.

## Deploy (gratuito)

Stack sugerida, toda em camada free tier:

| Peça                | Serviço                                                        |
| ------------------- | -------------------------------------------------------------- |
| Banco Postgres      | [Neon](https://neon.tech)                                      |
| Redis               | [Upstash](https://upstash.com) (free tier)                     |
| API (NestJS)        | [Render](https://render.com) ou [Railway](https://railway.app) |
| Front-end (Vite)    | [Vercel](https://vercel.com)                                   |
| E-mail transacional | [Resend](https://resend.com)                                   |

> O `docker-compose.yml` sobe um serviço Redis usado pela aplicação para rate
> limiting persistente, blocklist de access tokens e challenges de MFA. Em
> produção, configure `REDIS_URL` com a URL do seu Redis.

### 1. Banco de dados — Neon

1. Crie um projeto gratuito em [neon.tech](https://neon.tech).
2. Copie a connection string (formato `postgresql://...`).
3. Rode as migrations localmente contra ela antes do primeiro deploy:
   ```bash
   DATABASE_URL="<connection-string-do-neon>" npx prisma migrate deploy
   ```
   (a partir de `apps/api`).

### 2. E-mail — Resend

1. Crie uma conta em [resend.com](https://resend.com) e gere uma API key.
2. Verifique um domínio (ou use o domínio de testes deles pra portfólio).
3. Configure as variáveis SMTP da API com as credenciais SMTP do Resend
   (`SMTP_HOST=smtp.resend.com`, `SMTP_PORT=465`, `SMTP_SECURE=true`,
   `SMTP_USER=resend`, `SMTP_PASS=<api-key>`).

### 3. API — Render ou Railway

1. Crie um novo serviço Web apontando pro repositório, diretório raiz
   `apps/api`.
2. Build command: `npm install && npx prisma generate && npm run build`.
3. Start command: `npm run start:prod`.
4. Configure as variáveis de ambiente (mesmas de `apps/api/.env.example`),
   com `DATABASE_URL` do Neon, `REDIS_URL` do Upstash, `NODE_ENV=production`,
   `FRONTEND_URL` e `CORS_ORIGINS` apontando para o domínio que o Vercel vai
   gerar no passo seguinte.

### 4. Front-end — Vercel

1. Importe o repositório na Vercel, diretório raiz `apps/web`.
2. Build command: `npm run build`. Output directory: `dist`.
3. Variável de ambiente `VITE_API_URL` apontando para a URL pública da API
   (passo anterior).
4. Depois do primeiro deploy, volte na API e atualize `FRONTEND_URL` com o
   domínio final do Vercel (necessário para CORS e para os links dos
   e-mails de verificação/reset apontarem pro lugar certo).

## Estrutura do monorepo

```
apps/
  api/      NestJS — módulos auth, users, mail, hibp (src/modules/*)
  web/      React + Vite — telas de autenticação (src/features/auth)
packages/
  shared/   Schemas Zod compartilhados entre api e web
```
