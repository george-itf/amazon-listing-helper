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

// Create connection pool using TCP with password (not Unix socket)
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'amazon_listing_helper',
  user: process.env.DB_USER || 'alh_user',
  password: process.env.DB_PASSWORD || 'AmazonHelper2026Secure!',

  // Pool configuration
  max: 20,                      // Maximum connections
  idleTimeoutMillis: 30000,     // Close idle connections after 30s
  connectionTimeoutMillis: 5000, // Timeout after 5s if can't connect
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

export default { query, getClient, transaction, testConnection, close, closePool };
