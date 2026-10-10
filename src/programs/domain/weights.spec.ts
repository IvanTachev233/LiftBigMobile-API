import { WeightUnit } from '../../common/weight-unit';
import {
  WEIGHT_INCREMENTS,
  estimateOneRepMax,
  kgToLb,
  lbToKg,
  prescribedTargetKg,
  roundToIncrement,
  targetWeightKg,
} from './weights';

const toDisplay = (value: number) => Math.round(value * 10) / 10;

describe('estimateOneRepMax', () => {
  it('returns the weight itself for a single', () => {
    expect(estimateOneRepMax(100, 1)).toBe(100);
  });

  it('uses Epley for more than one rep', () => {
    expect(estimateOneRepMax(100, 3)).toBe(110);
    expect(estimateOneRepMax(90, 2)).toBe(96);
  });
});

describe('unit conversion', () => {
  it('uses 1 lb = 0.45359237 kg', () => {
    expect(lbToKg(1)).toBe(0.45359237);
    expect(kgToLb(0.45359237)).toBe(1);
    expect(toDisplay(kgToLb(100))).toBe(220.5);
  });

  it('round-trips', () => {
    expect(lbToKg(kgToLb(102.06))).toBeCloseTo(102.06, 10);
  });
});

describe('roundToIncrement', () => {
  it('rounds to the nearest increment, halves up', () => {
    expect(roundToIncrement(73, 2.5)).toBe(72.5);
    expect(roundToIncrement(71.25, 2.5)).toBe(72.5);
    expect(roundToIncrement(71.24, 2.5)).toBe(70);
    expect(roundToIncrement(152.5, 5)).toBe(155);
  });
});

describe('targetWeightKg', () => {
  it('keeps the increments in one map', () => {
    expect(WEIGHT_INCREMENTS).toEqual({ kg: 2.5, lb: 5 });
  });

  it('rounds to 2.5 kg for kg users', () => {
    expect(targetWeightKg(100, 70, WeightUnit.KG)).toBe(70);
    expect(targetWeightKg(100, 73, WeightUnit.KG)).toBe(72.5);
    // 125 x 57% = 71.25, a half
    expect(targetWeightKg(125, 57, WeightUnit.KG)).toBe(72.5);
  });

  it('rounds to 5 lb for lb users and stores kg', () => {
    const stored = targetWeightKg(100, 70, WeightUnit.LB);
    expect(stored).toBe(70.31);
    expect(toDisplay(kgToLb(stored!))).toBe(155);
  });

  it('returns null without a percent', () => {
    expect(targetWeightKg(100, null, WeightUnit.KG)).toBeNull();
  });
});

describe('prescribedTargetKg', () => {
  const maxes = { 'back-squat': 100, 'pause-squat': 80 };

  it('uses the reference lift max, not the exercise own max', () => {
    const pauseSquat = {
      exerciseId: 'pause-squat',
      percentOf1RM: 70,
      referenceExerciseId: 'back-squat',
    };
    expect(prescribedTargetKg(pauseSquat, maxes, WeightUnit.KG)).toBe(70);
  });

  it('returns null for an exercise without a percent', () => {
    const accessory = {
      exerciseId: 'pause-squat',
      percentOf1RM: null,
      referenceExerciseId: null,
    };
    expect(prescribedTargetKg(accessory, maxes, WeightUnit.KG)).toBeNull();
  });

  it('throws when the reference max is missing', () => {
    const clean = {
      exerciseId: 'power-clean',
      percentOf1RM: 70,
      referenceExerciseId: 'clean',
    };
    expect(() => prescribedTargetKg(clean, maxes, WeightUnit.KG)).toThrow(
      'clean',
    );
  });
});
