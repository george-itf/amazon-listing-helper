/**
 * Database Migration Module
 *
 * Runs pending migrations on server startup.
 * Migrations are tracked in the _migrations table.
 *
 * B.2 FIX: Now supports rollback via:
 * - Paired files: NNN_name_up.sql and NNN_name_down.sql
 * - Or a single .sql file with -- @DOWN marker to separate up/down sections
 */

import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { query, getClient } from './connection.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Ensure base schema exists before running migrations
 * Runs schema.sql if listings table doesn't exist
 */
async function ensureBaseSchema() {
  // Check if listings table exists
  const { rows } = await query(`
    SELECT EXISTS (
      SELECT FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'listings'
    ) as exists
  `);

  if (rows[0].exists) {
    console.log('[Migrations] Base schema already exists');
    return;
  }

  // Run schema.sql to create base tables
  const schemaPath = join(__dirname, '../../schema.sql');
  if (!existsSync(schemaPath)) {
    console.warn('[Migrations] No schema.sql found, migrations may fail if tables do not exist');
    return;
  }

  console.log('[Migrations] Creating base schema from schema.sql...');
  const schemaSql = readFileSync(schemaPath, 'utf8');
  await query(schemaSql);
  console.log('[Migrations] Base schema created');
}

/**
 * Run all pending database migrations
 * @returns {Promise<{success: boolean, migrationsRun: number, error?: string}>}
 */
export async function runMigrations() {
  console.log('[Migrations] Starting migration check...');

  try {
    // Ensure base schema exists first (listings table, etc.)
    await ensureBaseSchema();

    // Create migrations tracking table if it doesn't exist
    await query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Get already applied migrations
    const { rows: applied } = await query('SELECT name FROM _migrations');
    const appliedSet = new Set(applied.map(r => r.name));
    console.log(`[Migrations] Previously applied: ${appliedSet.size}`);

    // Find migration files
    const migrationsDir = join(__dirname, '../../migrations');

    if (!existsSync(migrationsDir)) {
      console.log('[Migrations] No migrations directory found');
      return { success: true, migrationsRun: 0 };
    }

    const files = readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();

    console.log(`[Migrations] Found ${files.length} migration files`);

    // Run pending migrations
    let migrationsRun = 0;
    for (const file of files) {
      if (appliedSet.has(file)) {
        continue; // Already applied
      }

      console.log(`[Migrations] Running: ${file}`);
      const sql = readFileSync(join(migrationsDir, file), 'utf8');

      const client = await getClient();
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO _migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        console.log(`[Migrations] Applied: ${file}`);
        migrationsRun++;
      } catch (error) {
        await client.query('ROLLBACK');

        // Handle "already exists" errors gracefully (idempotent migrations)
        if (error.message.includes('already exists') ||
            error.message.includes('duplicate key')) {
          console.log(`[Migrations] ${file} - objects already exist, marking as applied`);
          await query('INSERT INTO _migrations (name) VALUES ($1) ON CONFLICT DO NOTHING', [file]);
        } else {
          console.error(`[Migrations] Failed: ${file} - ${error.message}`);
          throw error;
        }
      } finally {
        client.release();
      }
    }

    if (migrationsRun > 0) {
      console.log(`[Migrations] Complete - ${migrationsRun} new migrations applied`);
    } else {
      console.log('[Migrations] Up to date - no new migrations');
    }

    return { success: true, migrationsRun };
  } catch (error) {
    console.error('[Migrations] Error:', error.message);
    return { success: false, migrationsRun: 0, error: error.message };
  }
}

/**
 * B.2 FIX: Rollback N migrations
 *
 * Supports:
 * - Paired files: NNN_name_up.sql with NNN_name_down.sql
 * - Single file with -- @DOWN marker
 *
 * @param {number} count - Number of migrations to rollback (default 1)
 * @returns {Promise<{success: boolean, migrationsRolledBack: number, error?: string}>}
 */
export async function rollbackMigrations(count = 1) {
  console.log(`[Migrations] Rolling back ${count} migration(s)...`);

  try {
    // Get applied migrations in reverse order
    const { rows: applied } = await query(
      'SELECT name FROM _migrations ORDER BY applied_at DESC, id DESC LIMIT $1',
      [count]
    );

    if (applied.length === 0) {
      console.log('[Migrations] No migrations to rollback');
      return { success: true, migrationsRolledBack: 0 };
    }

    const migrationsDir = join(__dirname, '../../migrations');
    let rolledBack = 0;

    for (const migration of applied) {
      const migrationName = migration.name;
      console.log(`[Migrations] Rolling back: ${migrationName}`);

      // Try to find down migration
      let downSql = null;

      // Option 1: Paired _down.sql file
      const baseName = migrationName.replace('.sql', '').replace('_up', '');
      const downFilePath = join(migrationsDir, `${baseName}_down.sql`);

      if (existsSync(downFilePath)) {
        downSql = readFileSync(downFilePath, 'utf8');
      } else {
        // Option 2: Look for -- @DOWN marker in the original file
        const upFilePath = join(migrationsDir, migrationName);
        if (existsSync(upFilePath)) {
          const fullSql = readFileSync(upFilePath, 'utf8');
          const downMarkerIndex = fullSql.indexOf('-- @DOWN');
          if (downMarkerIndex !== -1) {
            downSql = fullSql.substring(downMarkerIndex + 8).trim();
          }
        }
      }

      if (!downSql) {
        console.warn(`[Migrations] No rollback SQL found for ${migrationName} - skipping`);
        // Remove from tracking anyway (unsafe but allows manual cleanup)
        await query('DELETE FROM _migrations WHERE name = $1', [migrationName]);
        rolledBack++;
        continue;
      }

      const client = await getClient();
      try {
        await client.query('BEGIN');
        await client.query(downSql);
        await client.query('DELETE FROM _migrations WHERE name = $1', [migrationName]);
        await client.query('COMMIT');
        console.log(`[Migrations] Rolled back: ${migrationName}`);
        rolledBack++;
      } catch (error) {
        await client.query('ROLLBACK');
        console.error(`[Migrations] Rollback failed for ${migrationName}: ${error.message}`);
        throw error;
      } finally {
        client.release();
      }
    }

    console.log(`[Migrations] Rollback complete - ${rolledBack} migration(s) rolled back`);
    return { success: true, migrationsRolledBack: rolledBack };
  } catch (error) {
    console.error('[Migrations] Rollback error:', error.message);
    return { success: false, migrationsRolledBack: 0, error: error.message };
  }
}

/**
 * Get migration status
 * @returns {Promise<{applied: string[], pending: string[]}>}
 */
export async function getMigrationStatus() {
  const migrationsDir = join(__dirname, '../../migrations');

  // Get applied migrations
  const { rows: applied } = await query('SELECT name FROM _migrations ORDER BY applied_at');
  const appliedNames = applied.map(r => r.name);
  const appliedSet = new Set(appliedNames);

  // Get all migration files
  const allFiles = existsSync(migrationsDir)
    ? readdirSync(migrationsDir)
        .filter(f => f.endsWith('.sql') && !f.includes('_down'))
        .sort()
    : [];

  // Find pending migrations
  const pending = allFiles.filter(f => !appliedSet.has(f));

  return {
    applied: appliedNames,
    pending,
  };
}

export default { runMigrations, rollbackMigrations, getMigrationStatus };
