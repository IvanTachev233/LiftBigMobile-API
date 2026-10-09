import { Injectable } from '@nestjs/common';
import { ProgramActor } from './program-actor';

@Injectable()
export class ProgramAuthoringPolicy {
  // Only the system writes program templates; no user can yet.
  canAuthor(actor: ProgramActor): boolean {
    return actor.kind === 'system';
  }
}
