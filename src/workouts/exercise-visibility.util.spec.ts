import { FindOperator, Repository } from 'typeorm';
import { Exercise } from './entities/exercise.entity';
import {
  isExerciseVisible,
  nameEqualsIgnoringCase,
  ownerIdForVisibility,
  visibleExerciseWhere,
} from './exercise-visibility.util';

describe('exercise-visibility.util', () => {
  describe('ownerIdForVisibility', () => {
    it('uses the coach themself for a COACH', () => {
      expect(
        ownerIdForVisibility({ id: 'coach-1', role: 'COACH', coachId: null }),
      ).toBe('coach-1');
    });

    it("uses the client's coach for a CLIENT", () => {
      expect(
        ownerIdForVisibility({
          id: 'client-1',
          role: 'CLIENT',
          coachId: 'coach-1',
        }),
      ).toBe('coach-1');
    });

    it('returns null for a CLIENT without a coach', () => {
      expect(
        ownerIdForVisibility({ id: 'client-2', role: 'CLIENT', coachId: null }),
      ).toBeNull();
    });
  });

  describe('visibleExerciseWhere', () => {
    it('returns global + owner clauses, each with the extra filter', () => {
      const where = visibleExerciseWhere('coach-1', { id: 'ex-1' });
      expect(where).toHaveLength(2);
      expect(where[0].id).toBe('ex-1');
      expect((where[0].createdById as FindOperator<unknown>).type).toBe(
        'isNull',
      );
      expect(where[1]).toEqual({ id: 'ex-1', createdById: 'coach-1' });
    });

    it('returns only the global clause without an owner', () => {
      const where = visibleExerciseWhere(null);
      expect(where).toHaveLength(1);
      expect((where[0].createdById as FindOperator<unknown>).type).toBe(
        'isNull',
      );
    });
  });

  describe('isExerciseVisible', () => {
    const repoWithCount = (count: number) => {
      const repo = { count: jest.fn(() => Promise.resolve(count)) };
      return {
        repo,
        typed: repo as unknown as Repository<Exercise>,
      };
    };

    it('is true when a visible row matches the id', async () => {
      const { repo, typed } = repoWithCount(1);
      await expect(isExerciseVisible(typed, 'ex-1', 'coach-1')).resolves.toBe(
        true,
      );
      expect(repo.count).toHaveBeenCalledWith({
        where: visibleExerciseWhere('coach-1', { id: 'ex-1' }),
      });
    });

    it('is false when no visible row matches', async () => {
      const { typed } = repoWithCount(0);
      await expect(isExerciseVisible(typed, 'ex-1', null)).resolves.toBe(false);
    });
  });

  describe('nameEqualsIgnoringCase', () => {
    it('builds an exact LOWER() comparison with the name bound, not inlined', () => {
      const op = nameEqualsIgnoringCase("Squat_%'");
      expect(op.type).toBe('raw');
      expect(op.getSql?.('"Exercise"."name"')).toBe(
        'LOWER("Exercise"."name") = LOWER(:exerciseName)',
      );
      expect(op.objectLiteralParameters).toEqual({ exerciseName: "Squat_%'" });
    });
  });
});
