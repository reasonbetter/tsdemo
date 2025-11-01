# tsdemo

Single codebase for local dev and Vercel deploys. Use env vars to point to different services (local Postgres vs Neon). No code divergence required.

## Quick Start

- Install deps: `npm install`
- Copy env: `cp .env.example .env.local` and fill values (local DB or Neon dev)
- Dev: `npm run dev`

## Secrets and Git

- `.env.local` and `.env.*.local` are ignored. Do not commit secrets.
- Install the local pre-commit hook to block secrets:
  - `bash scripts/install-git-hooks.sh`
  - Bypass if needed: `git commit --no-verify`
- Quick audit any time: `bash scripts/scan_secrets.sh`

## Vercel + Neon

- Create Neon DB branches (dev/preview/prod) or separate DBs.
- In Vercel Project → Settings → Environment Variables:
  - Production: `DATABASE_URL` → Neon prod
  - Preview: `DATABASE_URL` → Neon preview/dev
  - Add `OPENAI_API_KEY` (server-side; not exposed to client)
- Deploys:
  - Push a branch → Vercel Preview URL
  - Merge to `main` → Production deploy

## Prisma (if applicable)

- Local dev: `npx prisma migrate dev` (with local DB or Neon dev in `.env.local`)
- Neon prod/preview: `npx prisma migrate deploy` (run locally or in CI)

## Common Tasks

- Adjust transition message duration: `utils/transitionPhrases.ts` (`DEFAULT_TRANSITION_DELAY_MS`)
- Update transition text: `utils/transitionPhrases.ts` phrase list
- Tweak fade timing: `tailwind.config.ts` (`animate-fadeIn`)
