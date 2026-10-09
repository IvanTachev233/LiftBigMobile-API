import { AuthUser } from '../auth/auth-user.interface';

// Who is writing program templates: the API itself (seeding) or a user.
export type ProgramActor =
  | { kind: 'system' }
  | { kind: 'user'; user: AuthUser };

export const SYSTEM_ACTOR: ProgramActor = { kind: 'system' };

export const userActor = (user: AuthUser): ProgramActor => ({
  kind: 'user',
  user,
});
