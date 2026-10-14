/** Deux projets : tests unitaires (rapides, sans base) et tests e2e (vraie base PostgreSQL). */
const base = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json' }] },
  testEnvironment: 'node',
};
module.exports = {
  projects: [
    { ...base, displayName: 'unit', rootDir: 'src', testRegex: '.*\\.spec\\.ts$' },
    {
      ...base,
      displayName: 'e2e',
      rootDir: 'test',
      testRegex: '.*\\.e2e-spec\\.ts$',
      globalSetup: '<rootDir>/global-setup.ts',
      globalTeardown: '<rootDir>/global-teardown.ts',
    },
  ],
};
