/**
 * Database Migration Module
 *
 * Runs pending migrations on server startup.
 * Migrations are tracked in the _migrations table.
 */

import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { query, getClient } from './connection.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Run all pending database migrations
 * @returns {Promise<{success: boolean, migrationsRun: number, error?: string}>}
 */
export async function runMigrations() {
  console.log('[Migrations] Starting migration check...');

  try {
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

export default { runMigrations };
