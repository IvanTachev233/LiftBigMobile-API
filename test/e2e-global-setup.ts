import { ensureE2eDatabase } from './e2e-database';

export default async function globalSetup(): Promise<void> {
  await ensureE2eDatabase();
}
