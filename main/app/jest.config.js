/** @type {import('jest').Config} */
export default {
  testEnvironment: 'node',
  transform: {},
  moduleFileExtensions: ['js', 'mjs'],
  testMatch: ['**/tests/**/*.test.js', '**/*.test.js'],
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/tests/**',
    '!src/lib/sentry.js', // Sentry requires actual DSN
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  verbose: true,
  testTimeout: 10000,
  // Mock timers for backoff tests
  fakeTimers: {
    enableGlobally: false,
  },
  // Setup files
  setupFilesAfterEnv: ['./src/tests/setup.js'],
};
