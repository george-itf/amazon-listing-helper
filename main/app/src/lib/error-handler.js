/**
 * Error Handler Module
 *
 * Provides safe error handling that doesn't expose internal details.
 * Sanitizes error messages before sending to clients.
 *
 * @module ErrorHandler
 */

/**
 * Known safe error messages that can be shown to clients
 * Map of error patterns to user-friendly messages
 */
const SAFE_ERROR_MESSAGES = {
  'not found': 'Resource not found',
  'invalid': 'Invalid request',
  'required': 'Missing required field',
  'already exists': 'Resource already exists',
  'duplicate': 'Duplicate entry',
  'unauthorized': 'Unauthorized',
  'forbidden': 'Access denied',
  'rate limit': 'Rate limit exceeded',
  'timeout': 'Request timed out',
  'guardrails': 'Operation blocked by guardrails',
  // SP-API errors - allow through with their messages
  'sp-api': null, // null means pass through original message
  'sp_api': null,
  'refresh_token': null,
  'invalid_grant': null,
  'credentials not configured': null,
  'marketplace': null,
  'seller central': null,
  'report failed': null,
  'report timed out': null,
};

/**
 * Patterns that indicate internal errors (should not be exposed)
 * Be specific to avoid filtering legitimate error messages
 */
const INTERNAL_ERROR_PATTERNS = [
  /password\s*[=:]/i,
  /connection refused/i,
  /ECONNREFUSED/i,
  /database error/i,
  /postgres.*error/i,
  /syntax error at/i,
  /column .* does not exist/i,
  /relation .* does not exist/i,
  /permission denied for/i,
  /stack trace/i,
  /node_modules/i,
  /at .+:\d+:\d+/i, // Stack trace line pattern
  /secret_key\s*[=:]/i,
  /client_secret\s*[=:]/i,
  /api_key\s*[=:]/i,
  /private_key/i,
  /ENOENT/i,
  /EACCES/i,
];

/**
 * Check if an error message contains internal/sensitive information
 * @param {string} message - Error message to check
 * @returns {boolean} True if message contains sensitive info
 */
function containsSensitiveInfo(message) {
  if (!message || typeof message !== 'string') return true;

  return INTERNAL_ERROR_PATTERNS.some(pattern => pattern.test(message));
}

/**
 * Get a safe error message for a given error
 * @param {Error|string} error - The error object or message
 * @param {string} [fallback] - Fallback message if error cannot be safely shown
 * @returns {string} Safe error message
 */
export function getSafeErrorMessage(error, fallback = 'An error occurred') {
  const message = error?.message || (typeof error === 'string' ? error : '');

  // Check if message is safe to show
  if (containsSensitiveInfo(message)) {
    return fallback;
  }

  // Check for known safe error patterns
  const lowerMessage = message.toLowerCase();
  for (const [pattern, safeMessage] of Object.entries(SAFE_ERROR_MESSAGES)) {
    if (lowerMessage.includes(pattern)) {
      // If safeMessage is null, pass through the original message (for SP-API errors etc.)
      return safeMessage === null ? message : safeMessage;
    }
  }

  // If message is short and doesn't look sensitive, it's probably safe
  if (message.length < 100 && !containsSensitiveInfo(message)) {
    return message;
  }

  return fallback;
}

/**
 * Create a sanitized error response object
 * @param {Error|string} error - The error
 * @param {Object} [context] - Additional context (will be sanitized)
 * @returns {Object} Safe error response
 */
export function createErrorResponse(error, context = {}) {
  const safeMessage = getSafeErrorMessage(error);

  // Only include context fields that are safe
  const safeContext = {};
  const allowedContextKeys = ['listing_id', 'job_id', 'asin', 'sku', 'field', 'code'];

  for (const key of allowedContextKeys) {
    if (context[key] !== undefined) {
      safeContext[key] = context[key];
    }
  }

  return {
    success: false,
    error: safeMessage,
    ...(Object.keys(safeContext).length > 0 && { context: safeContext }),
  };
}

/**
 * Determine HTTP status code from error
 * @param {Error} error - The error
 * @returns {number} HTTP status code
 */
export function getErrorStatusCode(error) {
  const message = error?.message?.toLowerCase() || '';

  if (message.includes('not found')) return 404;
  if (message.includes('already exists') || message.includes('duplicate')) return 409;
  if (message.includes('invalid') || message.includes('required')) return 400;
  if (message.includes('unauthorized')) return 401;
  if (message.includes('forbidden') || message.includes('access denied')) return 403;
  if (message.includes('rate limit')) return 429;
  if (message.includes('timeout')) return 504;

  return 500;
}

/**
 * Log error with full details (for internal logging only)
 * This should be used to log the FULL error before sending sanitized response
 * @param {string} context - Where the error occurred
 * @param {Error} error - The full error
 * @param {Object} [request] - Request object for additional context
 */
export function logError(context, error, request = null) {
  const logData = {
    context,
    message: error?.message,
    stack: error?.stack,
    timestamp: new Date().toISOString(),
  };

  if (request) {
    logData.method = request.method;
    logData.url = request.url;
    logData.ip = request.ip;
    // Don't log full body/headers - could contain sensitive data
  }

  // In production, this would go to structured logging
  console.error('[Error]', JSON.stringify(logData, null, 2));
}

/**
 * Send a safe error response
 * Logs full error internally and sends sanitized response to client
 * @param {Object} reply - Fastify reply object
 * @param {Error} error - The error
 * @param {string} [context] - Error context for logging
 * @returns {Object} Reply object
 */
export function sendErrorResponse(reply, error, context = 'Unknown') {
  // Log full error internally
  logError(context, error);

  // Send sanitized response
  const statusCode = getErrorStatusCode(error);
  const safeResponse = createErrorResponse(error);

  return reply.status(statusCode).send(safeResponse);
}

export default {
  getSafeErrorMessage,
  createErrorResponse,
  getErrorStatusCode,
  logError,
  sendErrorResponse,
};
