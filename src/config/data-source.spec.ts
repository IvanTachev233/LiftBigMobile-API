import dataSource from './data-source';

describe('CLI data source', () => {
  it('never syncs or runs migrations on connect', () => {
    expect(dataSource.options.synchronize).toBe(false);
    expect(dataSource.options.migrationsRun).toBe(false);
  });

  it('uses the API entities and migrations', () => {
    expect(dataSource.options.type).toBe('postgres');
    expect(dataSource.options.entities).toEqual([
      expect.stringMatching(/\*\.entity\{\.ts,\.js\}$/),
    ]);
    expect(dataSource.options.migrations).toEqual([
      expect.stringMatching(/migrations\/\*\{\.ts,\.js\}$/),
    ]);
  });
});
