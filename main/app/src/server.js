import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// PostgreSQL connection pool (for graceful shutdown)
import { closePool, initMlDataPool, testConnection } from './database/connection.js';

// V2 API routes
import { registerV2Routes } from './routes/v2.routes.js';

// Job worker
import { startWorker, stopWorker } from './workers/job-worker.js';

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

const fastify = Fastify({ logger: true });
await fastify.register(cors, {
  origin: getCorsOrigin(),
  credentials: true, // Allow cookies/auth headers if needed
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
});

// Register v2 API routes
await registerV2Routes(fastify);
console.log('API v2 routes registered');

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
  console.log('Static frontend serving enabled from:', distPath);
} else {
  console.log('No dist folder found - frontend not served. Build alh-ui first.');
}

// ============================================
// START SERVER
// ============================================
const start = async () => {
  try {
    // Test database connection
    const dbOk = await testConnection();
    if (!dbOk) {
      console.error('Database connection failed - exiting');
      process.exit(1);
    }

    // Initialize ML data pool (non-blocking)
    initMlDataPool().catch(err => console.warn('ML pool init warning:', err.message));

    const port = process.env.PORT || 4000;
    await fastify.listen({ port, host: '0.0.0.0' });
    console.log(`Server running on http://0.0.0.0:${port}`);

    // Start the job worker
    if (process.env.DISABLE_WORKER !== 'true') {
      startWorker();
      console.log('Job worker started');
    }
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
};

// Graceful shutdown
const gracefulShutdown = async (signal) => {
  console.log(`\n${signal} received. Shutting down gracefully...`);
  stopWorker();
  await fastify.close();
  await closePool();
  console.log('Server shutdown complete');
  process.exit(0);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

start();
