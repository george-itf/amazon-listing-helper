/**
 * Structured Logger Module
 *
 * Provides structured logging using pino for better observability.
 * Logs include contextual fields like service, operation, identifiers.
 *
 * Usage:
 *   import { logger, createChildLogger } from './lib/logger.js';
 *   const log = createChildLogger({ service: 'keepa' });
 *   log.info({ asin: 'B001234', operation: 'fetch' }, 'Fetching ASIN data');
 *
 * @module Logger
 */

import pino from 'pino';

// Determine log level from environment
const LOG_LEVEL = process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug');

// Pretty print in development, JSON in production
const transport = process.env.NODE_ENV === 'production'
  ? undefined
  : {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname',
      },
    };

// Create base logger
export const logger = pino({
  level: LOG_LEVEL,
  transport,
  base: {
    app: 'amazon-listing-helper',
    env: process.env.NODE_ENV || 'development',
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level: (label) => ({ level: label }),
  },
});

/**
 * Create a child logger with additional context
 * @param {Object} context - Context to add to all log entries
 * @param {string} [context.service] - Service name (e.g., 'keepa', 'sp-api', 'worker')
 * @param {string} [context.operation] - Operation name
 * @returns {pino.Logger} Child logger
 */
export function createChildLogger(context) {
  return logger.child(context);
}

/**
 * Create loggers for specific services
 */
export const keepaLogger = createChildLogger({ service: 'keepa' });
export const spApiLogger = createChildLogger({ service: 'sp-api' });
export const workerLogger = createChildLogger({ service: 'worker' });
export const dbLogger = createChildLogger({ service: 'database' });
export const httpLogger = createChildLogger({ service: 'http' });

/**
 * Log an API call with standard fields
 * @param {pino.Logger} log - Logger instance
 * @param {Object} opts - Options
 * @param {string} opts.operation - API operation name
 * @param {string} [opts.asin] - ASIN if applicable
 * @param {string} [opts.sku] - SKU if applicable
 * @param {number} [opts.attempt] - Retry attempt number
 * @param {string} [opts.requestId] - Request ID
 * @param {number} [opts.durationMs] - Duration in milliseconds
 * @param {boolean} [opts.success] - Whether the call succeeded
 * @param {string} [opts.error] - Error message if failed
 */
export function logApiCall(log, opts) {
  const {
    operation,
    asin,
    sku,
    attempt,
    requestId,
    durationMs,
    success,
    error,
    ...extra
  } = opts;

  const logData = {
    operation,
    ...(asin && { asin }),
    ...(sku && { sku }),
    ...(attempt !== undefined && { attempt }),
    ...(requestId && { request_id: requestId }),
    ...(durationMs !== undefined && { duration_ms: durationMs }),
    ...(success !== undefined && { success }),
    ...(error && { error }),
    ...extra,
  };

  if (success === false || error) {
    log.error(logData, `${operation} failed`);
  } else {
    log.info(logData, `${operation} completed`);
  }
}

/**
 * Log a job event
 * @param {Object} opts - Options
 * @param {string} opts.jobId - Job ID
 * @param {string} opts.jobType - Job type
 * @param {string} opts.status - Job status
 * @param {number} [opts.attempt] - Attempt number
 * @param {string} [opts.error] - Error message
 */
export function logJobEvent(opts) {
  const { jobId, jobType, status, attempt, error, ...extra } = opts;

  const logData = {
    job_id: jobId,
    job_type: jobType,
    status,
    ...(attempt !== undefined && { attempt }),
    ...(error && { error }),
    ...extra,
  };

  if (status === 'failed' || error) {
    workerLogger.error(logData, `Job ${jobType} ${status}`);
  } else {
    workerLogger.info(logData, `Job ${jobType} ${status}`);
  }
}

export default logger;
