/**
 * Unified database adapter - works with both MySQL (local) and PostgreSQL (cloud)
 *
 * For local development (XAMPP): Uses mysql2
 *   Environment: DB_HOST=localhost, DB_USER=root, DB_PASSWORD=..., DB_NAME=process_automation_db
 *
 * For cloud deployment (Render/Supabase): Uses pg (node-postgres)
 *   Environment: DATABASE_URL=postgresql://user:pass@host:port/dbname
 *
 * Usage:
 *   const db = require('./db');
 *   const rows = await db.query('SELECT * FROM projects WHERE id = $1', [1]);  // works both ways
 */

let mysql = null;
let pg = null;

// Try to load MySQL driver (always available locally)
try {
  mysql = require('mysql2/promise');
} catch (e) {
  console.error('[DB] mysql2 not installed. Run: npm install mysql2');
}

// Try to load PostgreSQL driver (only needed for cloud deployment)
try {
  pg = require('pg');
} catch (e) {
  // pg is optional - only needed when DATABASE_URL is set
}

let driver = null;
let usePostgres = false;

async function initPool() {
  // Priority: DATABASE_URL (PostgreSQL) > DB_HOST (MySQL)
  if (process.env.DATABASE_URL) {
    if (!pg) {
      throw new Error('pg (node-postgres) is required for PostgreSQL. Run: npm install pg');
    }
    usePostgres = true;
    driver = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    });
    console.log('[DB] Connected to PostgreSQL');
  } else if (mysql) {
    usePostgres = false;
    driver = mysql.createPool({
      host: process.env.DB_HOST || 'localhost',
      port: process.env.DB_PORT || 3306,
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'process_automation_db',
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      enableKeepAlive: true,
      keepAliveInitialDelay: 10000,
      dateStrings: true,
    });
    console.log('[DB] Connected to MySQL');
  } else {
    throw new Error('No database driver available. Install mysql2 or set DATABASE_URL for PostgreSQL.');
  }
}

/**
 * Execute a SQL query. Uses $1, $2, $3... parameter style for both drivers.
 * MySQL mode: $N placeholders are automatically converted to ?
 * PostgreSQL mode: $N placeholders are used natively
 */
async function query(sql, params = []) {
  if (!driver) await initPool();

  if (usePostgres) {
    // PostgreSQL: native $1, $2, $3 syntax
    const result = await driver.query(sql, params);
    return result.rows;
  } else {
    // MySQL: convert $1, $2, $3 to ? placeholders
    let adaptedSql = sql.replace(/\$(\d+)/g, '?');
    const result = await driver.query(adaptedSql, params);
    return result[0]; // mysql2 returns [rows, fields]
  }
}

/**
 * Execute a query and return a single row
 */
async function queryOne(sql, params = []) {
  const rows = await query(sql, params);
  return rows.length > 0 ? rows[0] : null;
}

/**
 * Close all connections
 */
async function close() {
  if (driver) {
    await driver.end();
    console.log('[DB] Pool closed');
  }
}

module.exports = { initPool, query, queryOne, close, isPostgres: () => usePostgres };
