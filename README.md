# LiftBig API

The backend for LiftBig, a strength-training app for coaches and clients. It handles auth (JWT), coach–client invites and workouts, both the ones clients log for themselves and the ones their coach assigns.

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

If your local database still has data from an older version (for example `program` tables), start once with `RUN_MIGRATIONS=true npm run start:dev`. Migrations run before `synchronize`; without them, `synchronize` drops old columns such as `workout_set.isCompleted` before the migration can move their data. The Docker stack already sets `RUN_MIGRATIONS=true`.

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
| `JWT_SECRET` | `super-secret-key` | Signs access tokens. **Must be set to a strong secret anywhere other than your machine.** |
| `JWT_ACCESS_TTL` | `15m` | Access token lifetime: a duration (`20s`, `15m`, `1h`) or a number of seconds. The app gets a new one with its refresh token (`POST /auth/refresh`) |
| `REFRESH_IDLE_DAYS` | `30` | A signed-in device's session ends after this many days without a refresh |
| `REFRESH_ABSOLUTE_DAYS` | `90` | A session ends this many days after sign-in, however often it is used |
| `NODE_ENV` | unset | `production` turns on SSL for the DB connection and turns off automatic schema sync (unless `TYPEORM_SYNC=true`) |
| `TYPEORM_SYNC` | unset | `true` forces TypeORM `synchronize` on, even in production |
| `RUN_MIGRATIONS` | unset | `true` runs pending migrations on startup |
| `BACKFILL_PBS` | unset | On every start the API records personal bests for logged sets that have none yet (a one-off for sets saved before bests were recorded automatically). `false` skips this |
| `SEED_PROGRAMS` | unset | On every start the API adds any missing sports, their required lifts, the global exercises they use and one published sample program per sport. `false` skips this |
| `CORS_ORIGINS` | unset | Extra allowed CORS origins, comma-separated exact URLs (e.g. `https://liftbig.web.app`). Needed when a deployed web client calls the API from another origin |
| `MAIL_PROVIDER_KEY` | unset | Resend API key for sign-up and password reset codes (set as a Cloud Run secret). Unset: mails, codes included, are written to the log instead of sent |
| `MAIL_FROM` | unset | Sender for those mails, e.g. `LiftBig <codes@your-domain>` on a domain verified in Resend. Required when `MAIL_PROVIDER_KEY` is set; the API refuses to start without it |
| `PRIVACY_OPERATOR_NAME` | unset | Who runs the app, shown on the `/privacy` page. Unset: the page shows `[OPERATOR NAME]` |
| `PRIVACY_CONTACT_EMAIL` | unset | Contact email on the `/privacy` page. Unset: the page shows `[CONTACT EMAIL]` |
| `APP_MIN_VERSION_CODE` | unset | Lowest Android versionCode still supported, from `GET /app-config`: older builds show a blocking "Update LiftBig" screen. Unset: no minimum. Anything but a whole number from 1 stops the API at startup |
| `APP_LATEST_VERSION_CODE` | unset | The newest versionCode on Play: older builds are offered the update once per start (dismissible). Unset: no offer |

Set the database variables, `NODE_ENV`, `TYPEORM_SYNC` and `RUN_MIGRATIONS` as real environment variables (shell, Docker, Cloud Run). `@nestjs/config` also loads a `.env` file from the working directory, but `src/config/database.config.ts` reads its values before that file is loaded, so a `.env` only reliably covers `JWT_SECRET`, `JWT_ACCESS_TTL`, `REFRESH_*_DAYS`, `PORT`, `CORS_ORIGINS`, `MAIL_PROVIDER_KEY`, `MAIL_FROM`, the `PRIVACY_*` and the `APP_*_VERSION_CODE` variables. `.env` is gitignored.

## Tests and checks

```bash
npm run build
npm test            # unit tests (Jest)
npm run test:e2e    # full AppModule on the liftbig_e2e database (needs the postgres container)
npm run test:cov
npm run lint        # ESLint with --fix: it rewrites files
npm run format      # Prettier
```

`npm run test:e2e` needs the postgres container (`docker compose up -d postgres` from the workspace root). It creates a `liftbig_e2e` database on that server if it is missing and rebuilds its schema from scratch for each test app, so `liftbig_db` is never touched. It refuses to run while `DATABASE_URL` is set.

## Deployment

> Deploying changes production data. Talk to the maintainer before deploying.

Production runs on **Google Cloud Run**; the app's production build points at its `*.run.app` URL. [`scripts/deploy.sh`](scripts/deploy.sh) uploads this repo and Cloud Build builds it with the `Dockerfile`. Files ignored by `.gitignore` (`.env`, dumps, `node_modules`, `dist`) are not uploaded.

Every deploy sets `NODE_ENV=production`, `TYPEORM_SYNC=false` and `RUN_MIGRATIONS=true`, so **production schema changes only through migrations** in `src/migrations`, run on startup. An entity change without a migration is not applied in production, even though local dev (no `NODE_ENV`) syncs it automatically. Deploys also set `BACKFILL_PBS=false`.

### One-time setup

```bash
scripts/gcp-setup.sh --project <project-id>
```

Run it in a terminal with an account that owns the project. It:

- logs in to `gcloud` if no account is active,
- enables the Cloud Run, Cloud Build, Artifact Registry and Secret Manager APIs,
- grants the Compute Engine default service account, which Cloud Build uses for source deploys, `roles/run.builder` and `roles/storage.objectViewer`,
- creates the secrets `DATABASE_URL`, `JWT_SECRET` and `MAIL_PROVIDER_KEY` in Secret Manager if they are missing (values are typed hidden; a blank `JWT_SECRET` generates a random one), and
- grants the service's runtime service account `roles/secretmanager.secretAccessor` on each of them.

It is safe to run again; existing secrets are left as they are. To change a secret's value, add a version and redeploy (the service reads `latest` when a revision is created):

```bash
read -r -s -p 'New value: ' v && printf '%s' "$v" |
  gcloud secrets versions add JWT_SECRET --project=<project-id> --data-file=-; unset v
```

Replacing `JWT_SECRET` signs every user out.

### Deploy

The script reads `GCP_PROJECT_ID`, `MAIL_FROM`, `CORS_ORIGINS`, `PRIVACY_OPERATOR_NAME` and `PRIVACY_CONTACT_EMAIL` from the API's `.env` (`--env-file PATH` for another file); it reads only those keys, never the file's secrets. Values already in the environment win:

```bash
# .env (gitignored)
GCP_PROJECT_ID=<project-id>
MAIL_FROM='LiftBig <codes@your-domain>'
CORS_ORIGINS=                              # empty: no extra web origins
PRIVACY_OPERATOR_NAME='...'
PRIVACY_CONTACT_EMAIL='...'
```

```bash
scripts/deploy.sh --dry-run                # prints the gcloud command, deploys nothing
scripts/deploy.sh
```

In a terminal, the script asks for any value still not set, shows the command and asks before deploying. Without a terminal, or with `--non-interactive`, it doesn't ask: it exits with an error naming each missing value, and passes `--quiet` to `gcloud`. `--project`, `--region` and `--service` override the env vars. `scripts/deploy.sh --help` lists the options.

| Name | Kind | Default | Notes |
| --- | --- | --- | --- |
| `GCP_PROJECT_ID` | input | required | The string project ID, not the project number |
| `GCP_REGION` | input | `europe-west1` | Cloud Run region |
| `SERVICE` | input | `liftbig-api` | Cloud Run service name |
| `MAIL_FROM` | env var | required | Sender of the code mails (see [Environment variables](#environment-variables)) |
| `CORS_ORIGINS` | env var | required, may be empty | Extra allowed web origins |
| `PRIVACY_OPERATOR_NAME` | env var | required | Shown on `/privacy` |
| `PRIVACY_CONTACT_EMAIL` | env var | required | Shown on `/privacy` |
| `NODE_ENV`, `TYPEORM_SYNC`, `RUN_MIGRATIONS`, `BACKFILL_PBS` | env var | `production`, `false`, `true`, `false` | Set by the script |
| `DATABASE_URL` | secret | Secret Manager `DATABASE_URL:latest` | Neon connection URL |
| `JWT_SECRET` | secret | Secret Manager `JWT_SECRET:latest` | Signs access tokens |
| `MAIL_PROVIDER_KEY` | secret | Secret Manager `MAIL_PROVIDER_KEY:latest` | Resend API key |

Env vars go through `--update-env-vars`, so any other env var on the service stays as it is. That includes `APP_MIN_VERSION_CODE` and `APP_LATEST_VERSION_CODE`: set them on the service itself (Cloud Run → the service → Edit & deploy new revision → Variables & Secrets) once the build they name is live on Play; the script doesn't set them. Secrets go through `--set-secrets`, so the service's secrets are exactly these three. The script also removes plain env vars with the secrets' names (`--remove-env-vars`, applied before the secrets), so a service that still has `DATABASE_URL` as a plain value switches to the secret in the same deploy. It never reads or prints a secret value.

Older plain env vars such as `DB_HOST` or `DB_PASSWORD` stay on the service until you remove them. The API ignores them once `DATABASE_URL` is set:

```bash
gcloud run services update liftbig-api --project=<project-id> --region=europe-west1 \
  --remove-env-vars=DB_HOST,DB_PORT,DB_USERNAME,DB_PASSWORD,DB_NAME
```

If a new revision fails to start (for example a secret can't be read), Cloud Run keeps serving the previous revision.

### Running from a pipeline later

A CI job runs the same script with no changes. Give it the inputs as env vars (none of them are secret) and authenticate `gcloud` as a deploy service account through **Workload Identity Federation**, so there is no service account key file to store. On GitHub Actions that means `permissions: id-token: write`, then `google-github-actions/auth` with `workload_identity_provider` and `service_account`, then `google-github-actions/setup-gcloud`, then `scripts/deploy.sh`. Without a terminal it never waits for input.

The deploy service account needs `roles/run.sourceDeveloper` and `roles/serviceusage.serviceUsageConsumer` on the project, and `roles/iam.serviceAccountUser` on the service's runtime service account. It never needs access to the secret values; the runtime service account reads them.

## Deploying the card tables and assigned workouts

Production runs a build from before the exercise card tables. The next deploy brings two migrations that run together:

- `ExerciseCardTables1709800000006` stores each exercise card as its own row (`workout_exercise`) with its sets under it.
- `AssignedWorkouts1709800000007` turns every coach program into a workout assigned to the client (`workout.assignedById` = the coach), keeping program, card and set ids. It splits each set into planned values (`reps`, `weight`) and the client's result (`made`, `actualReps`, `actualWeight`), then drops the `program`, `program_exercise` and `program_set` tables.

Both change the API shape with no compatibility layer and drop columns and tables, so follow these steps in order.

### 1. Check production and back up

Run these with the production `DATABASE_URL` (see [Environment variables](#environment-variables)) right before deploying, and keep the output:

```sql
-- Which migrations already ran. Expected: up to AddNameToUser1709800000005, without 0006 or 0007.
SELECT name FROM migrations ORDER BY id;
-- 0006 creates rows with uuid_generate_v4(). Expected: one row.
SELECT extname FROM pg_extension WHERE extname = 'uuid-ossp';
-- Row counts for the check in step 3.
SELECT (SELECT count(*) FROM workout)          AS workouts,
       (SELECT count(*) FROM workout_set)      AS workout_sets,
       (SELECT count(*) FROM program)          AS programs,
       (SELECT count(*) FROM program_exercise) AS program_rows;
-- The new weight columns hold at most 9999.99. Expected: 0.
SELECT count(*) FROM workout_set WHERE "actualWeight" >= 10000;
```

Also confirm which API commit the running Cloud Run revision was built from. These steps assume it is the last commit before the card tables (migrations 0000–0005, sets stored flat). If `migrations` already lists 0006, the card tables are live: count `program_set` too and use the second formula in step 3.

Then take the backup with a `pg_dump` at least as new as the server:

```bash
pg_dump "$DATABASE_URL" --format=custom --file=liftbig_before_assigned.dump
pg_restore --list liftbig_before_assigned.dump > /dev/null   # the file is readable
```

Keep the dump outside the repo and never commit it.

### 2. Deploy the API and the app together

The old app can't read the new API responses, and the new app can't talk to the old API (`/programs` is gone). Deploy the API with `scripts/deploy.sh` (see [Deployment](#deployment); it sets `TYPEORM_SYNC=true` and `RUN_MIGRATIONS=true`), then ship the app build from the matching app commit straight away. Device builds made before this change stop working until they are updated.

### 3. Check the migration

On startup the API runs both pending migrations once, before `synchronize`, in a single transaction. 0007 stops before changing anything if a program, card or set id is already used by a workout, card or set. On a database that already has both, nothing runs.

TypeORM's success messages are off in this config, so a good deploy shows no migration lines in the logs. A failure logs `Migration "..." failed, error: ...`, rolls the whole transaction back and the API keeps retrying the connection (`Unable to connect to the database ... Retrying`). In that case the data is unchanged; redeploy the previous API and app.

After a successful deploy, check with `psql "$DATABASE_URL"`:

```sql
SELECT name FROM migrations WHERE name IN ('ExerciseCardTables1709800000006', 'AssignedWorkouts1709800000007');  -- two rows
SELECT to_regclass('program') AS program_table;   -- NULL: the program tables are gone
SELECT (SELECT count(*) FROM workout)                                 AS workouts,
       (SELECT count(*) FROM workout WHERE "assignedById" IS NOT NULL) AS assigned,
       (SELECT count(*) FROM workout_exercise)                        AS cards,
       (SELECT count(*) FROM workout_set)                             AS sets;
```

Expected, using the counts from step 1:

- `workouts` = workouts + programs, and `assigned` = programs.
- `sets` = workout_sets + program_rows (before the card tables, each `program_exercise` row was one set).
- If 0006 had already run: `sets` = workout_sets + program_sets, and `cards` = workout cards + program cards.
- `cards` is at most `sets`.

Then open an assigned workout as its client and as the coach in the app.

What changes in the data:

- A self-made set that was ticked (`isCompleted`) gets `made = true`; the others stay unlogged.
- Volume (`totalWeightLifted`) now counts made sets only, so self-made workouts with unticked sets show a lower total than before.
- An assigned workout's status comes from its results: COMPLETED when every set is logged, IN_PROGRESS when some are, PLANNED otherwise.
- The old program logger could overwrite the coach's reps and weight with the client's values. Those values move over as the plan; the originals can't be recovered.

The migrations leave tables that the app ignores: `exercise_card_migration_set_order`, `assigned_workout_migration_sets`, `assigned_workout_migration_workouts` and `assigned_workout_migration_programs`. Leave them in place; `migration:revert` reads them.

### 4. Roll back

Restore the backup and redeploy the previous API and app versions. Workouts, sets and results written after the deploy are lost.

```bash
psql "$DATABASE_URL" -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'
pg_restore --no-owner --dbname="$DATABASE_URL" liftbig_before_assigned.dump
```

`npm run migration:revert` reverts only the last migration (through `src/config/data-source.ts`, set `NODE_ENV=production` for SSL), and it isn't the supported path: data the old tables can't hold is dropped (actual reps and weights, the status and notes of assigned workouts, set notes), and a missing weight comes back as 0.

### API changes

Every workout now carries `assignedById` and `assignedBy: { id, name } | null` (the assigning coach; null for a self-made workout). Exercises come back as cards sorted by card `order`, then set `order`. Each set is `{ id, reps, weight, order, made, actualReps, actualWeight, notes }`:

- `reps` and `weight` are the plan; `weight` may be null.
- `made`: true = made, false = missed, null = not logged.
- `actualReps` / `actualWeight`: null means "as planned".

Client and self routes (JWT; only the caller's own workouts, otherwise 404):

- `GET /workouts`, `GET /workouts/upcoming`, `GET /workouts/:id`: own workouts, assigned ones included.
- `POST /workouts`: creates a self-made workout. `assignedById` in the body is ignored.
- `PATCH /workouts/:id`:
  - Self-made: `name`, `notes`, `date`, `status` and `exercises`. Cards and sets are updated in place by `id`, and results left out of the body are kept. Rows without an id are created, rows left out are deleted, and ids not on this workout get 400.
  - Assigned: `status` only. Anything else gets 403.
- `DELETE /workouts/:id`: self-made only; an assigned workout gets 403.
- `POST /workouts/:id/cards/:cardId/sets`: adds a set (`reps`, optional `weight`, `made`, `actualReps`, `actualWeight`) to a card of an own workout. Returns 201 with the set.
- `PATCH /workouts/:id/sets/:setId`: logs a result (`made`, `actualReps`, `actualWeight`). Planned fields (`reps`, `weight`, `notes`) get 400. The first result moves a PLANNED workout to IN_PROGRESS.

Coach routes (COACH role; the client must be the caller's client in the database right now, otherwise 403):

- `GET /coach/clients/:clientId/workouts`: workouts the caller assigned to that client.
- `POST /coach/clients/:clientId/workouts`: assigns a planned workout (`name`, `date`, optional `notes`, `exercises` with `sets: [{ reps, weight, notes, order }]`). It starts as PLANNED.
- `GET /coach/workouts/:id`, `PUT /coach/workouts/:id`, `DELETE /coach/workouts/:id`: workouts the caller assigned (otherwise 404). PUT writes planned values only and updates cards and sets in place by `id`, so the client's results are kept, also when a set moves to another card. Ids not on this workout get 400. Sending `made`, `actualReps`, `actualWeight` or `status` gets 400.

Every write locks the workout row for its transaction, so concurrent coach and client saves don't overwrite each other.

Removed: every `/programs` route.

## Gotchas

- Nullable columns need an explicit type: `@Column({ type: 'varchar', nullable: true }) field: string | null`. Without `type`, TypeORM fails at runtime with "Data type Object not supported".
- CORS always allows `http://localhost:4200`, `http://localhost:8100`, `capacitor://localhost` and `https://localhost` (see `src/main.ts`). Allow any other client origin through `CORS_ORIGINS` rather than editing the code.
- Never commit database dumps or deploy archives (`liftbig_dump.sql` and `deploy.zip` are gitignored).
