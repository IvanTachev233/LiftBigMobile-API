---
title: Idempotent creates with client ids (LB-31 L2)
author: Ivan
date: 2026-10-17
branch: LB-31-User-Gets-Logged-Out-Mid-Session
cost: { minutes: 1, tokens: 1337 }
touches:
  - "src/workouts/workouts.service.ts#create"
  - "src/workouts/workouts.service.ts#addSet"
  - src/workouts/workouts.controller.ts
  - src/workouts/dto/workout.dto.ts
  - test/idempotent-creates.e2e-spec.ts
---

## Decided
- A client `id` on `POST /workouts` / add set: the same id from the same user returns the stored row and writes nothing; an id used elsewhere is 409. With an `id` both the first call and replays answer 200 (DoD "both 200"); without one, 201 as before.
- Workout: `createQueryBuilder().insert().orIgnore()` (Postgres `ON CONFLICT DO NOTHING`), then read the row and check `userId`; the reply is the full `findOne` view so a replay after cards were saved carries them.
- Set: checked inside the existing transaction after `lockWorkout`, so concurrent replays on one workout serialize; a set id on another card (even the same user's) is 409, not a replay.

## Tried and ruled out
- `repo.save` with a client id: TypeORM loads the row by primary key and UPDATEs it, so another user's workout could be overwritten. Insert-or-ignore instead.
- Returning `{ row, created }` from the service to pick 201/200: would change existing unit tests and the controller spec mock; the controller sets 200 whenever an `id` is sent instead.

## Watch out
- `test/fake-workout-db.ts` has no `createQueryBuilder`, so the workout id path is covered by e2e only.
- Self-mode PATCH (L2b): a card/set id not on the workout creates the row under that id; `assertNewIdsUnused` 409s ids in use anywhere else. Rows sent without an id still get fresh ids on each resend, so the app should always send ids. Coach (`planned`) mode still 400s unknown ids.
- `test/fake-workout-db.ts` supports `In` (added for `assertNewIdsUnused`).
