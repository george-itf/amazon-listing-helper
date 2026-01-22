import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// PostgreSQL connection pool (for graceful shutdown)
import { closePool, initMlDataPool, testConnection } from './database/connection.js';
import { runMigrations } from './database/migrate.js';

// V2 API routes
import { registerV2Routes } from './routes/v2.routes.js';

// Job worker
import { startWorker, stopWorker } from './workers/job-worker.js';

// Startup tasks
import { runStartupTasks } from './services/startup-tasks.service.js';

// Observability
import { logger, httpLogger } from './lib/logger.js';
import { initSentry, captureException, flush as sentryFlush } from './lib/sentry.js';
import { getMetrics, getContentType } from './lib/metrics.js';
import { getSafeErrorMessage } from './lib/error-handler.js';

// Initialize Sentry early
initSentry();

// ============================================================================
// SECURITY: API Key Authentication
// ============================================================================

/**
 * Validate API key from request headers
 * Set API_KEY environment variable to enable authentication
 * If API_KEY is not set, authentication is disabled (for development)
 */
function validateApiKey(request) {
  const configuredApiKey = process.env.API_KEY;

  // If no API key is configured, skip authentication (dev mode)
  if (!configuredApiKey) {
    return true;
  }

  // Check Authorization header (Bearer token) or X-API-Key header
  const authHeader = request.headers.authorization;
  const apiKeyHeader = request.headers['x-api-key'];

  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    return token === configuredApiKey;
  }

  if (apiKeyHeader) {
    return apiKeyHeader === configuredApiKey;
  }

  return false;
}

/**
 * API key authentication hook
 * Skips auth for health/metrics endpoints
 */
async function authenticationHook(request, reply) {
  // Skip auth for health check endpoints
  const publicPaths = ['/api/v2/health', '/api/v2/ready', '/api/v2/live', '/api/v2/metrics'];
  if (publicPaths.some(p => request.url.startsWith(p))) {
    return;
  }

  // Skip auth if API_KEY is not configured (dev mode)
  if (!process.env.API_KEY) {
    return;
  }

  if (!validateApiKey(request)) {
    reply.code(401).send({
      success: false,
      error: 'Unauthorized',
      message: 'Valid API key required. Use Authorization: Bearer <key> or X-API-Key header.',
    });
    return reply;
  }
}

// CORS Configuration
// In production: only allow configured origins
// In development: allow localhost origins
function getCorsOrigin() {
  // If CORS_ALLOWED_ORIGINS is set, parse it as comma-separated list
  if (process.env.CORS_ALLOWED_ORIGINS) {
    const origins = process.env.CORS_ALLOWED_ORIGINS.split(',').map(o => o.trim());
    return origins.length === 1 ? origins[0] : origins;
  }

  // In production without explicit config, only allow same-origin (return false)
  if (process.env.NODE_ENV === 'production') {
    // Return the app's own URL if configured, otherwise reject cross-origin
    return process.env.APP_URL || false;
  }

  // Development: allow localhost origins
  return (origin, callback) => {
    // Allow requests with no origin (same-origin, curl, Postman, etc.)
    if (!origin) {
      callback(null, true);
      return;
    }

    // Allow localhost on any port in development
    const localhostPattern = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
    if (localhostPattern.test(origin)) {
      callback(null, true);
      return;
    }

    // Reject other origins in development
    callback(new Error('CORS not allowed for this origin'), false);
  };
}

const fastify = Fastify({
  logger: httpLogger, // Use structured pino logger
  bodyLimit: parseInt(process.env.BODY_LIMIT || '1048576', 10), // 1MB default, configurable
  trustProxy: process.env.TRUST_PROXY === 'true', // Required for rate limiting behind proxy
});

// ============================================================================
// SECURITY MIDDLEWARE
// ============================================================================

// 1. Security Headers (Helmet)
await fastify.register(helmet, {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"], // Required for inline styles in React
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'", 'https://api.keepa.com'],
    },
  },
  crossOriginEmbedderPolicy: false, // Disable for compatibility with external resources
});

// 2. CORS
await fastify.register(cors, {
  origin: getCorsOrigin(),
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-API-Key'],
});

// 3. Rate Limiting
await fastify.register(rateLimit, {
  max: parseInt(process.env.RATE_LIMIT_MAX || '100', 10), // Max requests per window
  timeWindow: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10), // 1 minute default
  skipOnError: false, // Don't skip rate limiting on errors
  keyGenerator: (request) => {
    // Use X-Forwarded-For if behind proxy, otherwise use IP
    return request.headers['x-forwarded-for']?.split(',')[0]?.trim() || request.ip;
  },
  errorResponseBuilder: (request, context) => ({
    success: false,
    error: 'Too Many Requests',
    message: `Rate limit exceeded. Try again in ${Math.ceil(context.ttl / 1000)} seconds.`,
    retryAfter: Math.ceil(context.ttl / 1000),
  }),
  // Higher limits for certain endpoints
  allowList: [], // No IPs exempt by default
});

// 4. API Key Authentication Hook (for /api/v2/* routes)
fastify.addHook('onRequest', async (request, reply) => {
  if (request.url.startsWith('/api/v2/')) {
    return authenticationHook(request, reply);
  }
});

// Register v2 API routes
await registerV2Routes(fastify);
logger.info('API v2 routes registered');
logger.info({
  helmet: true,
  rateLimit: process.env.RATE_LIMIT_MAX || 100,
  auth: process.env.API_KEY ? 'enabled' : 'disabled',
}, 'Security middleware configured');

// 5. Global Error Handler - sanitizes all unhandled errors
fastify.setErrorHandler((error, request, reply) => {
  // Log full error internally with structured logging
  httpLogger.error({
    err: error,
    method: request.method,
    url: request.url,
    statusCode: error.statusCode || 500,
  }, 'Request error');

  // Report to Sentry for 5xx errors
  if (!error.statusCode || error.statusCode >= 500) {
    captureException(error, {
      method: request.method,
      url: request.url,
      ip: request.ip,
    });
  }

  // Send sanitized error to client
  const statusCode = error.statusCode || 500;

  // For validation errors, provide helpful message
  if (error.validation) {
    return reply.status(400).send({
      success: false,
      error: 'Validation error',
      message: 'Invalid request parameters',
    });
  }

  // For all other errors, use safe message filtering (allows informative messages through, filters sensitive data)
  const safeMessage = getSafeErrorMessage(error, 'An unexpected error occurred');

  return reply.status(statusCode).send({
    success: false,
    error: safeMessage,
  });
});

// Serve static frontend files (React build)
const distPath = path.join(__dirname, '../dist');
if (fs.existsSync(distPath)) {
  await fastify.register(fastifyStatic, {
    root: distPath,
    prefix: '/',
  });

  // SPA fallback - serve index.html for non-API routes
  fastify.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith('/api/')) {
      reply.code(404).send({ error: 'Not Found', message: `Route ${request.method}:${request.url} not found` });
    } else {
      reply.sendFile('index.html');
    }
  });
  logger.info({ distPath }, 'Static frontend serving enabled');
} else {
  logger.warn('No dist folder found - frontend not served. Build alh-ui first.');
}

// Prometheus metrics endpoint
fastify.get('/metrics', async (request, reply) => {
  const metrics = await getMetrics();
  reply.header('Content-Type', getContentType()).send(metrics);
});

// ============================================
// START SERVER
// ============================================
const start = async () => {
  try {
    // Test database connection
    const dbOk = await testConnection();
    if (!dbOk) {
      logger.fatal('Database connection failed - exiting');
      process.exit(1);
    }

    // Run database migrations
    const migrationResult = await runMigrations();
    if (!migrationResult.success) {
      logger.fatal({ error: migrationResult.error }, 'Database migration failed - exiting');
      process.exit(1);
    }
    if (migrationResult.migrationsRun > 0) {
      logger.info({ count: migrationResult.migrationsRun }, 'Database migrations applied');
    }

    // Check schema health and auto-repair if needed
    const { checkSchemaHealth, resetFailedMigrations } = await import('./database/connection.js');
    const schemaHealth = await checkSchemaHealth();
    if (!schemaHealth.healthy) {
      logger.warn({
        missing: schemaHealth.missing,
        issues: schemaHealth.issues,
      }, 'Schema health check failed - attempting auto-repair...');

      // Auto-repair: reset failed migrations and re-run
      try {
        const resetResult = await resetFailedMigrations();
        if (resetResult.reset.length > 0) {
          logger.info({ reset: resetResult.reset }, 'Reset failed migrations');
          const repairMigrationResult = await runMigrations();
          logger.info({ count: repairMigrationResult.migrationsRun }, 'Re-ran migrations after reset');
        }

        // Check health again after repair
        const healthAfterRepair = await checkSchemaHealth();
        if (healthAfterRepair.healthy) {
          logger.info('Schema auto-repair successful');
        } else {
          logger.warn({
            stillMissing: healthAfterRepair.missing,
          }, 'Schema repair incomplete - some tables still missing');
        }
      } catch (repairError) {
        logger.error({ err: repairError }, 'Schema auto-repair failed');
      }
    }

    // Initialize ML data pool (non-blocking)
    initMlDataPool().catch(err => logger.warn({ err }, 'ML pool init warning'));

    const port = process.env.PORT || 4000;
    await fastify.listen({ port, host: '0.0.0.0' });
    logger.info({ port, env: process.env.NODE_ENV || 'development' }, 'Server started');

    // Start the job worker
    if (process.env.DISABLE_WORKER !== 'true') {
      startWorker();
      logger.info('Job worker started');

      // Run startup tasks (non-blocking) - queues feature/Keepa jobs for stale data
      runStartupTasks().catch(err => {
        logger.warn({ err }, 'Startup tasks warning');
      });
    }
  } catch (err) {
    logger.fatal({ err }, 'Failed to start server');
    process.exit(1);
  }
};

// Graceful shutdown
const gracefulShutdown = async (signal) => {
  logger.info({ signal }, 'Shutting down gracefully...');
  stopWorker();
  await fastify.close();
  await sentryFlush(); // Flush Sentry events before exit
  await closePool();
  logger.info('Server shutdown complete');
  process.exit(0);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

start();
