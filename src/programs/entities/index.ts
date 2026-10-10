import { ProgramEnrollment } from './program-enrollment.entity';
import { ProgramTemplateExercise } from './program-template-exercise.entity';
import { ProgramTemplateSession } from './program-template-session.entity';
import { ProgramTemplate } from './program-template.entity';
import { SportRequiredLift } from './sport-required-lift.entity';
import { Sport } from './sport.entity';

export const programEntities = [
  Sport,
  SportRequiredLift,
  ProgramTemplate,
  ProgramTemplateSession,
  ProgramTemplateExercise,
  ProgramEnrollment,
];
