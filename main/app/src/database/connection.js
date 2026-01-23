/**
 * Database Connection Module
 * Provides PostgreSQL connection pool for the application
 */

import pg from 'pg';
import dotenv from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config({ path: join(__dirname, '../../../.env') });

const { Pool } = pg;

// SSL Configuration
// Railway and most PaaS providers use self-signed certificates
// Default: accept self-signed certs when using DATABASE_URL (cloud deployment)
// Set DB_SSL_REJECT_UNAUTHORIZED=true to enforce strict certificate verification
const sslConfig = process.env.DATABASE_URL
  ? {
      // Accept self-signed certs by default for cloud providers (Railway, Render, etc.)
      // Can be overridden by setting DB_SSL_REJECT_UNAUTHORIZED=true
      rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED === 'true',
    }
  : false; // Local dev typically doesn't use SSL

// A.3.4 FIX: DB statement timeout to prevent hung queries exhausting the pool
const DB_STATEMENT_TIMEOUT_MS = parseInt(process.env.DB_STATEMENT_TIMEOUT_MS || '30000', 10);

// O.2 FIX: Slow query threshold configurable via env, default raised to 500ms
// 100ms was too aggressive for complex joins, will spam logs
const SLOW_QUERY_THRESHOLD_MS = parseInt(process.env.SLOW_QUERY_THRESHOLD_MS || '500', 10);

// Create connection pool
// Railway provides DATABASE_URL, local dev uses individual vars
const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: sslConfig,
      max: parseInt(process.env.DB_POOL_MAX || '20', 10),
      idleTimeoutMillis: parseInt(process.env.DB_POOL_IDLE_TIMEOUT_MS || '30000', 10),
      connectionTimeoutMillis: parseInt(process.env.DB_POOL_CONNECTION_TIMEOUT_MS || '5000', 10),
      // A.3.4 FIX: Set statement_timeout to prevent hung queries
      statement_timeout: DB_STATEMENT_TIMEOUT_MS,
    })
  : new Pool({
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432', 10),
      database: process.env.DB_NAME || 'amazon_listing_helper',
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD, // Required - no hardcoded fallback
      max: parseInt(process.env.DB_POOL_MAX || '20', 10),
      idleTimeoutMillis: parseInt(process.env.DB_POOL_IDLE_TIMEOUT_MS || '30000', 10),
      connectionTimeoutMillis: parseInt(process.env.DB_POOL_CONNECTION_TIMEOUT_MS || '5000', 10),
      // A.3.4 FIX: Set statement_timeout to prevent hung queries
      statement_timeout: DB_STATEMENT_TIMEOUT_MS,
    });
// Test connection on startup
pool.on('connect', () => {
  console.log('[Database] Pool: new client connected');
});

pool.on('error', (err) => {
  console.error('[Database] Pool error:', err.message);
});

/**
 * Execute a query with parameters
 *
 * @param {string} text - SQL query
 * @param {Array} params - Query parameters
 * @param {pg.PoolClient} [client] - Optional transaction client. If provided, uses client.query
 *                                   instead of pool.query, enabling transactional execution.
 * @returns {Promise<pg.QueryResult>}
 */
export async function query(text, params = [], client = null) {
  const start = Date.now();
  const executor = client || pool;

  try {
    const result = await executor.query(text, params);
    const duration = Date.now() - start;

    // O.2 FIX: Use configurable threshold (default 500ms instead of 100ms)
    if (duration > SLOW_QUERY_THRESHOLD_MS) {
      console.log(`[Database] Slow query (${duration}ms):`, text.substring(0, 100));
    }

    return result;
  } catch (error) {
    console.error('Database query error:', error.message);
    console.error('Query:', text.substring(0, 200));
    throw error;
  }
}

/**
 * Get a client from the pool for transactions
 * @returns {Promise<pg.PoolClient>}
 */
export async function getClient() {
  const client = await pool.connect();
  const originalRelease = client.release.bind(client);

  // Track if client has been released
  let released = false;

  // Override release to prevent double-release
  client.release = () => {
    if (released) {
      console.warn('[Database] Warning: Client already released');
      return;
    }
    released = true;
    return originalRelease();
  };

  return client;
}

/**
 * Execute multiple queries in a transaction
 * @param {Function} callback - Function that receives client and executes queries
 * @returns {Promise<any>} - Result of the callback
 */
export async function transaction(callback) {
  const client = await getClient();

  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Test database connection
 * @returns {Promise<boolean>}
 */
export async function testConnection() {
  try {
    const result = await query('SELECT NOW() as now, current_database() as db');
    console.log('[Database] Connected:', result.rows[0]);
    return true;
  } catch (error) {
    console.error('[Database] Connection failed:', error.message);
    return false;
  }
}

/**
 * Close all connections in the pool
 */
export async function close() {
  await pool.end();
  console.log('[Database] Pool closed');
}

// Alias for backwards compatibility
export const closePool = close;

/**
 * Initialize ML data pool materialized view
 * Creates view on startup if it doesn't exist (migration 005 handles full creation)
 * This is a fallback for cases where migrations haven't run yet
 */
export async function initMlDataPool() {
  try {
    // Check if view exists (migration 005 should have created it)
    const checkResult = await query(`
      SELECT EXISTS (
        SELECT FROM pg_matviews WHERE matviewname = 'ml_data_pool'
      ) as exists
    `);

    if (checkResult.rows[0].exists) {
      console.log('[Database] ML data pool already exists');
      return true;
    }

    // View doesn't exist - create a simplified version as fallback
    // (The full version is created by migration 005)
    console.log('[Database] Creating simplified ML data pool (fallback)...');

    await query(`
      CREATE MATERIALIZED VIEW ml_data_pool AS
      SELECT
        l.id as listing_id,
        NULL::integer as asin_entity_id,
        l.seller_sku as sku,
        l.asin,
        'LISTING' as entity_type,
        l.title,
        NULL::varchar as brand,
        l.category::varchar as category,
        l.status as listing_status,
        l.price_inc_vat as current_price,
        l.available_quantity as current_quantity,
        NULL::numeric as computed_margin,
        NULL::numeric as opportunity_score,
        NULL::jsonb as all_features,
        NULL::timestamp as features_computed_at,
        CURRENT_TIMESTAMP as snapshot_at
      FROM listings l
    `);

    // Create indexes
    await query('CREATE INDEX IF NOT EXISTS idx_ml_pool_listing ON ml_data_pool(listing_id)');
    await query('CREATE INDEX IF NOT EXISTS idx_ml_pool_entity ON ml_data_pool(entity_type)');

    console.log('[Database] Simplified ML data pool created');
    return true;
  } catch (error) {
    console.error('[Database] ML data pool creation failed (non-fatal):', error.message);
    return false;
  }
}

/**
 * Check database schema health
 * Verifies that required tables exist and reports missing ones
 * @returns {Promise<{healthy: boolean, missing: string[], issues: string[]}>}
 */
export async function checkSchemaHealth() {
  const requiredTables = [
    'listings',
    'marketplaces',
    'components',
    'suppliers',
    'boms',
    'bom_lines',
    'listing_cost_overrides',
    'jobs',
    'listing_events',
    'listing_offer_current',
    'asin_entities',
    'keepa_snapshots',
    'feature_store',
    'recommendations',
    'recommendation_events',
    'settings',
  ];

  const missing = [];
  const issues = [];

  for (const table of requiredTables) {
    try {
      const result = await query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = $1
        ) as exists
      `, [table]);

      if (!result.rows[0].exists) {
        missing.push(table);
      }
    } catch (error) {
      issues.push(`Error checking table ${table}: ${error.message}`);
    }
  }

  // Check if migrations are marked as applied
  try {
    const migrationsResult = await query('SELECT name FROM _migrations ORDER BY name');
    const appliedMigrations = migrationsResult.rows.map(r => r.name);
    console.log('[Database] Applied migrations:', appliedMigrations);

    // Check if migration says it's applied but tables are missing
    if (appliedMigrations.includes('001_slice_a_schema.sql') &&
        (missing.includes('boms') || missing.includes('components'))) {
      issues.push('Migration 001 marked as applied but tables missing - migration likely failed');
    }
  } catch {
    // _migrations table might not exist
  }

  return {
    healthy: missing.length === 0 && issues.length === 0,
    missing,
    issues,
  };
}

/**
 * Reset migration status for re-running
 * Only resets migrations that have missing tables
 * @returns {Promise<{reset: string[]}>}
 */
export async function resetFailedMigrations() {
  const health = await checkSchemaHealth();
  const reset = [];

  if (health.missing.length === 0) {
    console.log('[Database] No failed migrations to reset');
    return { reset: [] };
  }

  // Map tables to their migrations
  const tableMigrationMap = {
    'marketplaces': '001_slice_a_schema.sql',
    'suppliers': '001_slice_a_schema.sql',
    'components': '001_slice_a_schema.sql',
    'boms': '001_slice_a_schema.sql',
    'bom_lines': '001_slice_a_schema.sql',
    'listing_cost_overrides': '001_slice_a_schema.sql',
    'jobs': '002_slice_b_schema.sql',
    'listing_events': '002_slice_b_schema.sql',
    'listing_offer_current': '002_slice_b_schema.sql',
    'asin_entities': '003_slice_c_schema.sql',
    'keepa_snapshots': '003_slice_c_schema.sql',
    'feature_store': '003_slice_c_schema.sql',
    'recommendations': '004_slice_d_schema.sql',
    'recommendation_events': '004_slice_d_schema.sql',
  };

  const migrationsToReset = new Set();
  for (const table of health.missing) {
    const migration = tableMigrationMap[table];
    if (migration) {
      migrationsToReset.add(migration);
    }
  }

  // Reset the migrations
  for (const migration of migrationsToReset) {
    try {
      await query('DELETE FROM _migrations WHERE name = $1', [migration]);
      reset.push(migration);
      console.log(`[Database] Reset migration: ${migration}`);
    } catch (error) {
      console.error(`[Database] Failed to reset migration ${migration}:`, error.message);
    }
  }

  return { reset };
}

export default { query, getClient, transaction, testConnection, close, closePool, initMlDataPool, checkSchemaHealth, resetFailedMigrations };
