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

// Create connection pool
// Railway provides DATABASE_URL, local dev uses individual vars
const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: sslConfig,
      max: parseInt(process.env.DB_POOL_MAX || '20', 10),
      idleTimeoutMillis: parseInt(process.env.DB_POOL_IDLE_TIMEOUT_MS || '30000', 10),
      connectionTimeoutMillis: parseInt(process.env.DB_POOL_CONNECTION_TIMEOUT_MS || '5000', 10),
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
 * @param {string} text - SQL query
 * @param {Array} params - Query parameters
 * @returns {Promise<pg.QueryResult>}
 */
export async function query(text, params = []) {
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;

    // Log slow queries (>100ms)
    if (duration > 100) {
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

export default { query, getClient, transaction, testConnection, close, closePool, initMlDataPool };
