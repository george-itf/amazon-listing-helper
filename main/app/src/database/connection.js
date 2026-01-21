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
// Create connection pool
// Railway provides DATABASE_URL, local dev uses individual vars
const pool = process.env.DATABASE_URL 
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: {
        rejectUnauthorized: false  // Required for Railway
      },
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    })
  : new Pool({
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432'),
      database: process.env.DB_NAME || 'amazon_listing_helper',
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD, // Required - no hardcoded fallback
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
// Test connection on startup
pool.on('connect', () => {
  console.log('📦 Database pool: new client connected');
});

pool.on('error', (err) => {
  console.error('❌ Database pool error:', err.message);
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
      console.log(`⚠️ Slow query (${duration}ms):`, text.substring(0, 100));
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
      console.warn('⚠️ Client already released');
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
    console.log('✅ Database connected:', result.rows[0]);
    return true;
  } catch (error) {
    console.error('❌ Database connection failed:', error.message);
    return false;
  }
}

/**
 * Close all connections in the pool
 */
export async function close() {
  await pool.end();
  console.log('📦 Database pool closed');
}

// Alias for backwards compatibility
export const closePool = close;

/**
 * Initialize ML data pool materialized view
 * Creates or updates the view on startup
 */
export async function initMlDataPool() {
  try {
    // Check if view exists
    const checkResult = await query(`
      SELECT EXISTS (
        SELECT FROM pg_matviews WHERE matviewname = 'ml_data_pool'
      ) as exists
    `);

    if (checkResult.rows[0].exists) {
      console.log('✅ ML data pool already exists');
      return true;
    }

    console.log('📊 Creating ML data pool...');

    // Create the materialized view
    await query(`
      CREATE MATERIALIZED VIEW ml_data_pool AS
      SELECT
        COALESCE(l.id, ae.listing_id) as listing_id,
        ae.id as asin_entity_id,
        COALESCE(l.sku, 'ASIN_' || ae.asin) as sku,
        COALESCE(l.asin, ae.asin) as asin,
        CASE WHEN l.id IS NOT NULL THEN 'LISTING' ELSE 'ASIN' END as entity_type,
        COALESCE(l.title, ae.title) as title,
        ae.brand,
        ae.category,
        l.status as listing_status,
        l.price as current_price,
        l.quantity as current_quantity,
        (fs.features_json->>'margin')::numeric as computed_margin,
        (fs.features_json->>'opportunity_score')::numeric as opportunity_score,
        fs.features_json as all_features,
        fs.computed_at as features_computed_at,
        CURRENT_TIMESTAMP as snapshot_at
      FROM asin_entities ae
      FULL OUTER JOIN listings l ON l.asin = ae.asin OR l.id = ae.listing_id
      LEFT JOIN LATERAL (
        SELECT features_json, computed_at FROM feature_store
        WHERE (entity_type = 'LISTING' AND entity_id = l.id)
           OR (entity_type = 'ASIN' AND entity_id = ae.id)
        ORDER BY computed_at DESC LIMIT 1
      ) fs ON true
      WHERE ae.id IS NOT NULL OR l.id IS NOT NULL
    `);

    // Create indexes
    await query('CREATE INDEX IF NOT EXISTS idx_ml_pool_listing ON ml_data_pool(listing_id)');
    await query('CREATE INDEX IF NOT EXISTS idx_ml_pool_asin ON ml_data_pool(asin_entity_id)');
    await query('CREATE INDEX IF NOT EXISTS idx_ml_pool_entity ON ml_data_pool(entity_type)');

    console.log('✅ ML data pool created successfully');
    return true;
  } catch (error) {
    console.error('⚠️ ML data pool creation failed (non-fatal):', error.message);
    return false;
  }
}

export default { query, getClient, transaction, testConnection, close, closePool, initMlDataPool };
