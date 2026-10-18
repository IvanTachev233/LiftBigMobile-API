---
title: "API CI/CD plan: GitHub Actions + Workload Identity Federation to Cloud Run"
author: Ivan
date: 2026-10-18
branch: LB-31-User-Gets-Logged-Out-Mid-Session
cost: { minutes: 4, tokens: 95757 }
touches:
  - README.md
  - scripts/deploy.sh
---

## Decided
- Plan lives in workspace docs/ci-cd-plan.md; the user executes it by hand (learning exercise), nothing created in GCP/GitHub yet.
- Pipeline = .github/workflows/api.yml in liftbig-api: job `test` (Postgres 15 service container, DB_HOST=localhost DB_PORT=5432, npx eslint without --fix, build, unit, e2e) on PRs and master; job `deploy` only on master, environment `production`, concurrency group without cancel-in-progress, runs scripts/deploy.sh --non-interactive unchanged.
- Auth via Workload Identity Federation (pool `github`, provider `liftbig-api`, condition repo == IvanTachev233/LiftBigMobile-API && ref == refs/heads/master), deploy SA `github-deployer` with run.sourceDeveloper + serviceUsageConsumer on the project and iam.serviceAccountUser on the runtime (Compute default) SA. No key files; secrets stay in Secret Manager, GitHub gets only non-secret env vars.

## Tried and ruled out
- `npm run lint` in CI: the script has --fix, so it would pass silently.
- Fetching action READMEs with curl: blocked by the egress hook; Context7 only had deploy-cloudrun (auth@v2) and GitHub docs (checkout@v6), so action versions must be checked by the user.

## Watch out
- deploy.sh treats empty values as missing except CORS_ORIGINS, so an unset GitHub var fails the deploy loudly (good).
- e2e refuses to run if DATABASE_URL is set; reads DB_* with defaults liftbig/password123.
- WIF principalSet uses the project NUMBER, not the ID.
- TYPEORM_SYNC=true means every merge to master changes the production schema automatically.
- liftbig-api had uncommitted deploy.sh/README changes (.env reading) that must reach master before the pipeline uses them.
