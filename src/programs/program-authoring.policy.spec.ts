import { ProgramAuthoringPolicy } from './program-authoring.policy';
import { SYSTEM_ACTOR, userActor } from './program-actor';

describe('ProgramAuthoringPolicy', () => {
  const policy = new ProgramAuthoringPolicy();
  const user = (role: 'COACH' | 'CLIENT') =>
    userActor({
      id: 'u1',
      email: 'u1@example.com',
      name: null,
      role,
      coachId: null,
    });

  it('lets the system author programs', () => {
    expect(policy.canAuthor(SYSTEM_ACTOR)).toBe(true);
  });

  it('denies every user, coaches included', () => {
    expect(policy.canAuthor(user('CLIENT'))).toBe(false);
    expect(policy.canAuthor(user('COACH'))).toBe(false);
  });
});
