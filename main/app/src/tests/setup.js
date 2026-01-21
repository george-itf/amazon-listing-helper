/**
 * Jest Test Setup
 *
 * Runs before each test file.
 */

import { jest } from '@jest/globals';

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error'; // Quiet logs during tests

// Mock console to reduce noise (optional - comment out for debugging)
// global.console = {
//   ...console,
//   log: jest.fn(),
//   info: jest.fn(),
//   warn: jest.fn(),
// };

// Clean up after each test
afterEach(() => {
  jest.clearAllMocks();
});
