import { WeightUnit } from '../../common/weight-unit';

export const KG_PER_LB = 0.45359237;

// Target weights are rounded to this step in the user's unit.
export const WEIGHT_INCREMENTS: Record<WeightUnit, number> = {
  [WeightUnit.KG]: 2.5,
  [WeightUnit.LB]: 5,
};

// Epley; a single is its own 1RM.
export function estimateOneRepMax(weight: number, reps: number): number {
  if (reps === 1) return weight;
  return (weight * (30 + reps)) / 30;
}

export function kgToLb(kg: number): number {
  return kg / KG_PER_LB;
}

export function lbToKg(lb: number): number {
  return lb * KG_PER_LB;
}

// Nearest multiple of increment; halves round up. The epsilon keeps
// floating-point noise just under a half from rounding down.
export function roundToIncrement(value: number, increment: number): number {
  return Math.round(value / increment + 1e-9) * increment;
}

// percent of the reference 1RM, rounded in the user's unit, returned in kg
// to 2 decimals. null percent gives null.
export function targetWeightKg(
  reference1RMKg: number,
  percent: number | null,
  unit: WeightUnit,
): number | null {
  if (percent === null) return null;
  const rawKg = (reference1RMKg * percent) / 100;
  const increment = WEIGHT_INCREMENTS[unit];
  const roundedKg =
    unit === WeightUnit.LB
      ? lbToKg(roundToIncrement(kgToLb(rawKg), increment))
      : roundToIncrement(rawKg, increment);
  return Math.round(roundedKg * 100) / 100;
}

export interface Prescription {
  exerciseId: string;
  percentOf1RM: number | null;
  referenceExerciseId: string | null;
}

// Target for a program exercise from the user's 1RMs (kg, keyed by
// exercise id), always taken from its reference lift.
export function prescribedTargetKg(
  prescription: Prescription,
  maxesKg: Record<string, number>,
  unit: WeightUnit,
): number | null {
  const { percentOf1RM, referenceExerciseId } = prescription;
  if (percentOf1RM === null || referenceExerciseId === null) return null;
  const max = maxesKg[referenceExerciseId];
  if (max === undefined) {
    throw new Error(`No 1RM for reference exercise ${referenceExerciseId}`);
  }
  return targetWeightKg(max, percentOf1RM, unit);
}
