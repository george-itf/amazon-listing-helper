/**
 * Database Migration Script for Railway
 *
 * Run with: railway run node scripts/migrate.js
 * Or locally: node scripts/migrate.js
 */

import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const { Pool } = pg;
const __dirname = dirname(fileURLToPath(import.meta.url));

async function migrate() {
  // Validate DATABASE_URL
  if (!process.env.DATABASE_URL) {
    console.error('ERROR: DATABASE_URL environment variable is not set');
    process.exit(1);
  }

  // Connect to database
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
  });

  try {
    // Test connection
    await pool.query('SELECT 1');
    console.log('Connected to database');

    // Create migrations tracking table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Get applied migrations
    const { rows: applied } = await pool.query('SELECT name FROM _migrations');
    const appliedSet = new Set(applied.map(r => r.name));
    console.log(`Previously applied migrations: ${appliedSet.size}`);

    // Find migration files
    const migrationsDir = join(__dirname, '..', 'migrations');

    if (!existsSync(migrationsDir)) {
      console.log('No migrations directory found');
      await pool.end();
      return;
    }

    const files = readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();

    console.log(`Found ${files.length} migration files`);

    // Run pending migrations
    let migrationsRun = 0;
    for (const file of files) {
      if (appliedSet.has(file)) {
        console.log(`⊘ ${file} (already applied)`);
        continue;
      }

      console.log(`→ Running: ${file}`);
      const sql = readFileSync(join(migrationsDir, file), 'utf8');

      try {
        await pool.query('BEGIN');
        await pool.query(sql);
        await pool.query('INSERT INTO _migrations (name) VALUES ($1)', [file]);
        await pool.query('COMMIT');
        console.log(`✓ ${file}`);
        migrationsRun++;
      } catch (error) {
        await pool.query('ROLLBACK');

        // Handle "already exists" errors gracefully
        if (error.message.includes('already exists') ||
            error.message.includes('duplicate key')) {
          console.log(`⊘ ${file} (objects already exist, marking as applied)`);
          await pool.query('INSERT INTO _migrations (name) VALUES ($1) ON CONFLICT DO NOTHING', [file]);
        } else {
          console.error(`✗ ${file}: ${error.message}`);
          throw error;
        }
      }
    }

    console.log(`\nMigrations complete! ${migrationsRun} new migrations applied.`);

  } catch (error) {
    console.error('Migration failed:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Also run schema.sql if it exists and hasn't been run
async function runSchema() {
  const schemaPath = join(__dirname, '..', 'schema.sql');

  if (!existsSync(schemaPath)) {
    return;
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
  });

  try {
    // Check if listings table exists (indicates schema was run)
    const { rows } = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_name = 'listings'
      )
    `);

    if (rows[0].exists) {
      console.log('Schema already applied (listings table exists)');
      return;
    }

    console.log('Running initial schema...');
    const sql = readFileSync(schemaPath, 'utf8');
    await pool.query(sql);
    console.log('Schema applied successfully');

  } catch (error) {
    console.error('Schema error:', error.message);
    // Don't fail completely, migrations might still work
  } finally {
    await pool.end();
  }
}

// Run both
console.log('=== Database Migration ===\n');
await runSchema();
console.log('');
await migrate();
