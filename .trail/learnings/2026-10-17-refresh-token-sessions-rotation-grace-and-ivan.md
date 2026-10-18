---
title: "Refresh-token sessions: rotation, grace and migration 0009"
author: Ivan
date: 2026-10-17
branch: LB-31-User-Gets-Logged-Out-Mid-Session
cost: { minutes: 16, tokens: 223605 }
touches:
  - README.md
  - src/auth/auth.controller.ts
  - src/auth/auth.module.ts
  - src/auth/auth.service.spec.ts
  - src/auth/auth.service.ts
  - src/auth/dto/auth.dto.ts
  - src/users/account-deletion.ts
  - src/users/users.controller.ts
  - src/users/users.service.ts
  - test/e2e-app.ts
---

## Decided
- `auth_session` keeps only the current and previous token hash (spec § LB-31). Previous token within 60 s of its rotation = retry (rotates again, keeps the first rotatedAt so the grace never grows); later = reuse → session revoked, 401.
- A token two or more rotations old matches no row → plain 401, session not revoked (open question to the user; full "any older token revokes" would need a token history or a session id in the token).
- Sign-in deletes the user's revoked, expired and `tokenVersion <` current sessions (`<`, not `<>`, so a stale read can't delete newer sessions).
- `JWT_ACCESS_TTL`: a bare number is converted to seconds, because jsonwebtoken reads a bare number string as milliseconds. Bad env values throw at startup.
- Migration 0009 copies sync's DDL and constraint/index names exactly, guarded by hasTable('user') and hasTable('auth_session').

## Tried and ruled out
- Running e2e session tests from `registerAndLogin`: it signs in twice (verify-email + login) and leaves two sessions, so `[session]` picks the wrong row. Use `createExistingUser` (one session).
- `Date.now.bind(Date)` as the real clock under a `Date.now` spy fails lint (no-unsafe-assignment); use `performance.timeOrigin + performance.now()`.

## Watch out
- TypeORM 0.3.28 runs migrations BEFORE synchronize at boot (DataSource.initialize), so a migration that matches sync's names leaves sync with 0 pending.
- To get the exact DDL/names, run `driver.createSchemaBuilder().log()` against a scratch copy of a `pg_dump` (restore inside the `liftbig_db` container, drop afterwards).
- Fake clock in e2e = `jest.spyOn(Date, 'now')` offset; services must use `Date.now()` (not `new Date()`) and set timestamps explicitly, since `new Date()` ignores the spy.
- Old app builds sign out on any 401, so a 15-min access TTL hits them until the new AAB ships (L9 decision).
