import { applyDecorators } from '@nestjs/common';
import { IsDateString, Matches } from 'class-validator';

// A real calendar date written as YYYY-MM-DD, without a time.
export function IsCalendarDate() {
  return applyDecorators(
    Matches(/^\d{4}-\d{2}-\d{2}$/, {
      message: '$property must be a YYYY-MM-DD date',
    }),
    IsDateString({ strict: true }),
  );
}
