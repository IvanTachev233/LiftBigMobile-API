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
| `DATABASE_URL` | unset | Full PostgreSQL connection URL (e.g. Neon). When set, the `DB_*` variables below are ignored |
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
| `CORS_ORIGINS` | unset | Extra allowed CORS origins, comma-separated exact URLs (e.g. `https://liftbig.web.app`). Needed when a deployed web client calls the API from another origin |

Set the database variables, `NODE_ENV`, `TYPEORM_SYNC` and `RUN_MIGRATIONS` as real environment variables (shell, Docker, Cloud Run). `@nestjs/config` also loads a `.env` file from the working directory, but `src/config/database.config.ts` reads its values before that file is loaded, so a `.env` only reliably covers `JWT_SECRET`, `PORT` and `CORS_ORIGINS`. `.env` is gitignored.

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

## Deploying the exercise card tables

This change stores each exercise card as its own row (`workout_exercise`, `program_exercise`) with its sets under it (`workout_set`, `program_set`). It changes the API shape with no compatibility layer, and its migration drops columns, so follow these steps in order.

### 1. Back up the production database

Take the backup right before deploying, with the production `DATABASE_URL` (see [Environment variables](#environment-variables)) and a `pg_dump` at least as new as the server:

```bash
pg_dump "$DATABASE_URL" --format=custom --file=liftbig_before_cards.dump
pg_restore --list liftbig_before_cards.dump > /dev/null   # the file is readable
```

Keep the dump outside the repo and never commit it.

### 2. Deploy the API and the app together

The old app can't read the new API responses, and the new app can't talk to the old API. Deploy the API with `deploy_backend.sh` (see [Deployment](#deployment); it sets `TYPEORM_SYNC=true` and `RUN_MIGRATIONS=true`), then ship the app build from the matching app commit straight away. Device builds made before this change stop working with the new API until they are updated.

### 3. Check the migration

On startup the API runs the pending migration `ExerciseCardTables1709800000006` once, before `synchronize`, in a single transaction (together with any other pending migration). It groups the old flat set rows into one card per workout (or program), exercise and superset, then drops the old columns. On a database that already has it, nothing runs.

TypeORM's success messages are off in this config, so a good deploy shows no migration lines in the logs. A failure logs `Migration "ExerciseCardTables1709800000006" failed, error: ...`, rolls the whole transaction back and the API keeps retrying the connection (`Unable to connect to the database ... Retrying`). In that case the data is unchanged; redeploy the previous API.

After a successful deploy, check with `psql "$DATABASE_URL"`:

```sql
SELECT name FROM migrations WHERE name = 'ExerciseCardTables1709800000006';  -- one row
SELECT (SELECT count(*) FROM workout_exercise) AS workout_cards,
       (SELECT count(*) FROM workout_set)      AS workout_sets,
       (SELECT count(*) FROM program_exercise) AS program_cards,
       (SELECT count(*) FROM program_set)      AS program_sets;
```

The set counts must match the `workout_set` and `program_exercise` row counts from before the deploy (count them on the backup or just before deploying). Each card count is at most its set count. Then open a workout and a program in the app.

The migration leaves a small table, `exercise_card_migration_set_order` (each set's old order). Leave it in place: `down()` uses it to restore the old set order.

### 4. Roll back

Restore the backup and redeploy the previous API and app versions. Sets, cards and results written after the deploy are lost.

```bash
psql "$DATABASE_URL" -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'
pg_restore --no-owner --dbname="$DATABASE_URL" liftbig_before_cards.dump
```

`npm run migration:revert` also exists. It reverts the last migration through `src/config/data-source.ts`, which uses the same `DATABASE_URL` / `DB_*` variables (set `NODE_ENV=production` for SSL), and restores the old tables, columns and set order. Restoring the backup is the supported path, though: revert folds cards and sets created after the deploy back into the flat shape, so it doesn't give back the database as it was.

### API changes

Workouts and programs now return their exercises as cards, sorted by card `order`, then set `order` (the set number inside its card). A workout no longer has a top-level `sets` array.

```json
"exercises": [
  { "id": "…", "exerciseId": "…", "exercise": { … }, "order": 1, "supersetGroup": null,
    "sets": [{ "id": "…", "reps": 5, "weight": 100, "order": 1, … }] }
]
```

- `PATCH /workouts/:id`: `exercises` (cards with nested `sets`) replaces all of the workout's cards. Send a card's or set's `id` to keep it; ids from another workout are rejected with 400. `name`, `notes`, `date` and `status` can still be sent alone, which leaves the cards as they are.
- `POST /programs` and `PUT /programs/:id` (coach): the same nested shape (`exerciseId`, `order`, `supersetGroup`, `sets: [{ reps, weight, notes, order }]`). PUT updates cards and sets in place by `id`, so a client's `made` result is kept; rows without a known id are created, rows left out are deleted, and ids from another program are rejected with 400.
- `POST /programs/:id/exercises/:cardId/sets` (client): adds a set (`reps`, optional `weight`, `notes`, `made`) to a card of their own program.
- `PATCH /programs/:id/sets/:setId` (client): logs a result or edits one of their sets (`reps`, `weight`, `notes`, `made`, all optional).
- Removed: `POST /programs/:id/exercises` and `PATCH /programs/:id/exercises/:exerciseId`.

## Gotchas

- Nullable columns need an explicit type: `@Column({ type: 'varchar', nullable: true }) field: string | null`. Without `type`, TypeORM fails at runtime with "Data type Object not supported".
- CORS always allows `http://localhost:4200`, `http://localhost:8100`, `capacitor://localhost` and `https://localhost` (see `src/main.ts`). Allow any other client origin through `CORS_ORIGINS` rather than editing the code.
- Never commit database dumps or deploy archives (`liftbig_dump.sql` and `deploy.zip` are gitignored).
