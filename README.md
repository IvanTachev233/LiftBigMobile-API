# LiftBig API

The backend for LiftBig, a strength-training app for coaches and clients. It handles auth (JWT), coach–client invites, programs and workouts.

Stack: NestJS 11, TypeORM 0.3, PostgreSQL 15. The mobile/web client lives in [LiftBigMobile](https://github.com/IvanTachev233/LiftBigMobile).

> **Running the whole app?** Start with the [LiftBigMobile README](https://github.com/IvanTachev233/LiftBigMobile#readme). It covers cloning both repos side by side, the Docker stack and the day-to-day dev loop. This README covers the API on its own.

## Prerequisites

- **Node.js 22** (NestJS 11 needs 20.11 or newer; the app repo pins 22, so use that for both).
- **PostgreSQL**, most easily through the app repo's compose file: `docker compose up -d postgres` from `liftbig-app/`. It listens on host port **5433**.

## Run locally

```bash
npm install
npm run start:dev    # watch mode on http://localhost:3000
```

With no environment variables set, the API connects to `localhost:5433` as `liftbig` / `password123` to database `liftbig_db`, which matches the compose file's local database. Outside production, TypeORM `synchronize` is on, so the schema is created and updated from the entities on startup.

Other scripts: `npm run start` (no watch), `npm run start:debug`, `npm run build` then `npm run start:prod` (runs `dist/main`).

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `DB_HOST` | `localhost` | PostgreSQL host (`postgres` inside Docker Compose) |
| `DB_PORT` | `5433` | PostgreSQL port (`5432` inside Docker Compose) |
| `DB_USERNAME` | `liftbig` | Database user |
| `DB_PASSWORD` | `password123` | Database password (local placeholder only) |
| `DB_NAME` | `liftbig_db` | Database name |
| `PORT` | `3000` | HTTP port |
| `JWT_SECRET` | `super-secret-key` | Signs access tokens (valid for 60 minutes). **Must be set to a strong secret anywhere other than your machine.** |
| `NODE_ENV` | unset | `production` turns on SSL for the DB connection and turns off automatic schema sync (unless `TYPEORM_SYNC=true`) |
| `TYPEORM_SYNC` | unset | `true` forces TypeORM `synchronize` on, even in production |
| `RUN_MIGRATIONS` | unset | `true` runs pending migrations on startup |

Set the database variables, `NODE_ENV`, `TYPEORM_SYNC` and `RUN_MIGRATIONS` as real environment variables (shell, Docker, Cloud Run). `@nestjs/config` also loads a `.env` file from the working directory, but `src/config/database.config.ts` reads its values before that file is loaded, so a `.env` only reliably covers `JWT_SECRET` and `PORT`. `.env` is gitignored.

## Tests and checks

```bash
npm run build
npm test            # unit tests (Jest)
npm run test:e2e    # boots the full AppModule, so it needs the database running
npm run test:cov
npm run lint        # ESLint with --fix: it rewrites files
npm run format      # Prettier
```

## Deployment

> Deploying changes production data. Talk to the maintainer before deploying.

- **Google Cloud Run** is the current production target (the app's production build points at a `*.run.app` URL). The maintainer deploys with an interactive script, `deploy_backend.sh`, which lives in their local workspace rather than in this repo. It sets `TYPEORM_SYNC=true` and `RUN_MIGRATIONS=true`, so **entity changes alter the production schema on deploy**. Adding nullable columns is safe. Treat renames, type changes and column removals as destructive.
- **Azure Web App**: every push to `master` runs [`.github/workflows/master_liftbigmobile-api5.yml`](.github/workflows/master_liftbigmobile-api5.yml), which builds and deploys to the `liftbigmobile-api5` Azure Web App. Whether that target is still in use isn't documented. Check before pushing to `master`.

## Gotchas

- Nullable columns need an explicit type: `@Column({ type: 'varchar', nullable: true }) field: string | null`. Without `type`, TypeORM fails at runtime with "Data type Object not supported".
- CORS only allows `http://localhost:4200`, `http://localhost:8100`, `capacitor://localhost`, `https://localhost` and the Azure origin (see `src/main.ts`). Add an origin there if you serve the client from somewhere else.
- Never commit database dumps or deploy archives (`liftbig_dump.sql` and `deploy.zip` are gitignored).
