/**
 * Sentry Error Tracking Module
 *
 * Initializes Sentry for error tracking and monitoring.
 * Only activates if SENTRY_DSN environment variable is set.
 *
 * Usage:
 *   import { initSentry, captureException, captureMessage } from './lib/sentry.js';
 *   initSentry(); // Call once at startup
 *
 * @module Sentry
 */

import * as Sentry from '@sentry/node';

let initialized = false;

/**
 * Initialize Sentry error tracking
 * Only initializes if SENTRY_DSN is configured
 *
 * @param {Object} options - Additional Sentry options
 */
export function initSentry(options = {}) {
  const dsn = process.env.SENTRY_DSN;

  if (!dsn) {
    console.log('[Sentry] SENTRY_DSN not configured, error tracking disabled');
    return;
  }

  if (initialized) {
    console.log('[Sentry] Already initialized');
    return;
  }

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || 'development',
    release: process.env.APP_VERSION || '1.0.0',

    // Performance monitoring sample rate
    tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE || '0.1'),

    // Don't send errors in development unless explicitly enabled
    enabled: process.env.NODE_ENV === 'production' || process.env.SENTRY_ENABLED === 'true',

    // Integrations
    integrations: [
      // HTTP integration for tracking requests
      Sentry.httpIntegration(),
    ],

    // Before send hook - can be used to filter/modify events
    beforeSend(event, hint) {
      // Don't send rate limit errors to Sentry (they're expected)
      const error = hint?.originalException;
      if (error?.message?.includes('429') || error?.message?.includes('rate limit')) {
        return null;
      }
      return event;
    },

    // Additional options
    ...options,
  });

  initialized = true;
  console.log('[Sentry] Initialized with DSN');
}

/**
 * Check if Sentry is initialized
 * @returns {boolean} True if Sentry is initialized
 */
export function isSentryEnabled() {
  return initialized;
}

/**
 * Capture an exception
 * @param {Error} error - Error to capture
 * @param {Object} context - Additional context
 */
export function captureException(error, context = {}) {
  if (!initialized) {
    console.error('[Sentry] Not initialized, error not captured:', error.message);
    return;
  }

  Sentry.captureException(error, {
    extra: context,
  });
}

/**
 * Capture a message
 * @param {string} message - Message to capture
 * @param {string} level - Sentry level (error, warning, info)
 * @param {Object} context - Additional context
 */
export function captureMessage(message, level = 'info', context = {}) {
  if (!initialized) {
    return;
  }

  Sentry.captureMessage(message, {
    level,
    extra: context,
  });
}

/**
 * Set user context
 * @param {Object} user - User information
 * @param {string} [user.id] - User ID
 * @param {string} [user.email] - User email
 */
export function setUser(user) {
  if (!initialized) return;
  Sentry.setUser(user);
}

/**
 * Add breadcrumb for debugging
 * @param {Object} breadcrumb - Breadcrumb data
 * @param {string} breadcrumb.message - Message
 * @param {string} breadcrumb.category - Category
 * @param {string} [breadcrumb.level] - Level
 * @param {Object} [breadcrumb.data] - Additional data
 */
export function addBreadcrumb(breadcrumb) {
  if (!initialized) return;
  Sentry.addBreadcrumb(breadcrumb);
}

/**
 * Set tag
 * @param {string} key - Tag key
 * @param {string} value - Tag value
 */
export function setTag(key, value) {
  if (!initialized) return;
  Sentry.setTag(key, value);
}

/**
 * Start a new transaction for performance monitoring
 * @param {string} name - Transaction name
 * @param {string} op - Operation type
 * @returns {Object|null} Transaction or null if not initialized
 */
export function startTransaction(name, op) {
  if (!initialized) return null;
  return Sentry.startSpan({ name, op });
}

/**
 * Flush pending events (call before shutdown)
 * @param {number} timeout - Timeout in ms
 * @returns {Promise<boolean>}
 */
export async function flush(timeout = 2000) {
  if (!initialized) return true;
  return Sentry.flush(timeout);
}

export default {
  initSentry,
  isSentryEnabled,
  captureException,
  captureMessage,
  setUser,
  addBreadcrumb,
  setTag,
  startTransaction,
  flush,
};
