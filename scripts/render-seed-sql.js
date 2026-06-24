/**
 * Render SQL seed files from templates using values in the project root .env.
 *
 * Usage:
 *   node scripts/render-seed-sql.js
 *
 * This script reads SEED_ADMIN_PASSWORD and SEED_DEFAULT_PASSWORD from .env,
 * computes the SHA-256 hashes required by PostgreSQL, and generates:
 *   - process_automation_db.sql
 *   - cloud-deploy/schema-postgres.sql
 *
 * Never commit the generated .sql seed files or .env to version control.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const rootDir = path.resolve(__dirname, '..');
const envPath = path.join(rootDir, '.env');

function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function loadEnv(path) {
  const vars = {};
  if (!fs.existsSync(path)) return vars;
  const content = fs.readFileSync(path, 'utf8');
  content.split(/\r?\n/).forEach(line => {
    const match = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (match) {
      vars[match[1]] = match[2];
    }
  });
  return vars;
}

function renderTemplate(templatePath, outputPath, substitutions) {
  if (!fs.existsSync(templatePath)) {
    console.error(`Missing template: ${templatePath}`);
    process.exit(1);
  }
  let content = fs.readFileSync(templatePath, 'utf8');
  for (const [key, value] of Object.entries(substitutions)) {
    const token = `\${${key}}`;
    content = content.split(token).join(value);
  }
  fs.writeFileSync(outputPath, content);
  console.log(`Rendered ${outputPath}`);
}

if (!fs.existsSync(envPath)) {
  console.error(`Missing .env file at ${envPath}`);
  console.error('Copy .env.example to .env and fill in your values, then run this script again.');
  process.exit(1);
}

const env = loadEnv(envPath);

const adminPassword = env.SEED_ADMIN_PASSWORD || '';
const defaultPassword = env.SEED_DEFAULT_PASSWORD || '';

if (!adminPassword || !defaultPassword) {
  console.error('SEED_ADMIN_PASSWORD and SEED_DEFAULT_PASSWORD must be set in .env');
  process.exit(1);
}

const substitutions = {
  SEED_ADMIN_PASSWORD: adminPassword,
  SEED_DEFAULT_PASSWORD: defaultPassword,
  SEED_ADMIN_PASSWORD_HASH: sha256(adminPassword),
  SEED_DEFAULT_PASSWORD_HASH: sha256(defaultPassword),
};

renderTemplate(
  path.join(rootDir, 'process_automation_db.sql.template'),
  path.join(rootDir, 'process_automation_db.sql'),
  substitutions
);

renderTemplate(
  path.join(rootDir, 'cloud-deploy', 'schema-postgres.sql.template'),
  path.join(rootDir, 'cloud-deploy', 'schema-postgres.sql'),
  substitutions
);

console.log('SQL seed rendering complete.');
