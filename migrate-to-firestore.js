require('dotenv').config();

const https = require('https');
const crypto = require('crypto');

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'pad-dashboard-ysu';
const SEED_ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD || '';
const SEED_DEFAULT_PASSWORD = process.env.SEED_DEFAULT_PASSWORD || '';
const BASE_URL = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function toFirestoreValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') {
    if (Number.isInteger(v)) return { integerValue: String(v) };
    return { doubleValue: v };
  }
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (Array.isArray(v)) {
    return { arrayValue: { values: v.map(toFirestoreValue) } };
  }
  if (typeof v === 'object') {
    const fields = {};
    for (const [key, val] of Object.entries(v)) {
      fields[key] = toFirestoreValue(val);
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(v) };
}

function docBody(data) {
  const fields = {};
  for (const [key, val] of Object.entries(data)) {
    fields[key] = toFirestoreValue(val);
  }
  return JSON.stringify({ fields });
}

function postDocument(collection, data, docId = null) {
  return new Promise((resolve, reject) => {
    const body = docBody(data);
    const url = docId
      ? `${BASE_URL}/${collection}?documentId=${docId}`
      : `${BASE_URL}/${collection}`;
    const req = https.request(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(JSON.parse(data));
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${data}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function patchDocument(collection, docId, data) {
  return new Promise((resolve, reject) => {
    const body = docBody(data);
    const req = https.request(
      `${BASE_URL}/${collection}/${docId}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(JSON.parse(data));
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${data}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function deleteCollection(collection) {
  return new Promise((resolve, reject) => {
    https.get(`${BASE_URL}/${collection}?pageSize=500`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', async () => {
        try {
          const result = JSON.parse(data);
          const docs = result.documents || [];
          for (const doc of docs) {
            const name = doc.name;
            const path = name.split('/documents/')[1];
            await new Promise((res2, rej2) => {
              const req = https.request(
                `${BASE_URL}/${path}`,
                { method: 'DELETE' },
                (res3) => {
                  let d = '';
                  res3.on('data', c => d += c);
                  res3.on('end', () => res2(d));
                }
              );
              req.on('error', rej2);
              req.end();
            });
          }
          resolve(docs.length);
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

// ============================================================
// DATA FROM process_automation_db.sql
// ============================================================

const departments = [
  { department_name: 'InFlex (IT Team)', description: 'Information Technology team', created_at: new Date('2026-01-01').toISOString(), updated_at: new Date('2026-01-01').toISOString() },
  { department_name: 'AILabU (YFS Sales Team)', description: 'AI Laboratory - Sales', created_at: new Date('2026-01-01').toISOString(), updated_at: new Date('2026-01-01').toISOString() },
  { department_name: 'HRWonders (HR Team)', description: 'Human Resources team', created_at: new Date('2026-01-01').toISOString(), updated_at: new Date('2026-01-01').toISOString() },
  { department_name: 'Quantum (CH Accounting)', description: 'Accounting and Finance team', created_at: new Date('2026-01-01').toISOString(), updated_at: new Date('2026-01-01').toISOString() },
  { department_name: 'VJCarie (Finance Team)', description: 'Finance Operations team', created_at: new Date('2026-01-01').toISOString(), updated_at: new Date('2026-01-01').toISOString() },
  { department_name: 'O.T.O.G (TMU Operations Team)', description: 'TMU Operations team', created_at: new Date('2026-01-01').toISOString(), updated_at: new Date('2026-01-01').toISOString() },
  { department_name: 'Mighty Movers (Supply Chain Team)', description: 'Supply Chain Management team', created_at: new Date('2026-01-01').toISOString(), updated_at: new Date('2026-01-01').toISOString() },
  { department_name: 'MOKI (MKI Team)', description: 'Marketing and Knowledge Integration team', created_at: new Date('2026-01-01').toISOString(), updated_at: new Date('2026-01-01').toISOString() },
  { department_name: 'Brandify (Trade Marketing)', description: 'Trade Marketing team', created_at: new Date('2026-01-01').toISOString(), updated_at: new Date('2026-01-01').toISOString() },
];

const users = [
  { username: 'admin', password_hash: sha256(SEED_ADMIN_PASSWORD), full_name: 'System Administrator', email: 'admin@company.com', role: 'admin', department_id: 1, is_active: 1, created_at: new Date('2026-01-01').toISOString(), updated_at: new Date('2026-01-01').toISOString() },
  { username: 'harold', password_hash: sha256(SEED_DEFAULT_PASSWORD), full_name: 'Harold Bumanlag', email: 'harold@company.com', role: 'user', department_id: 1, is_active: 1, created_at: new Date('2026-01-01').toISOString(), updated_at: new Date('2026-01-01').toISOString() },
  { username: 'niel', password_hash: sha256(SEED_DEFAULT_PASSWORD), full_name: 'Niel', email: 'niel@company.com', role: 'user', department_id: 1, is_active: 1, created_at: new Date('2026-01-01').toISOString(), updated_at: new Date('2026-01-01').toISOString() },
  { username: 'ivan', password_hash: sha256(SEED_DEFAULT_PASSWORD), full_name: 'Ivan', email: 'ivan@company.com', role: 'user', department_id: 1, is_active: 1, created_at: new Date('2026-01-01').toISOString(), updated_at: new Date('2026-01-01').toISOString() },
  { username: 'jireh', password_hash: sha256(SEED_DEFAULT_PASSWORD), full_name: 'Jireh', email: 'jireh@company.com', role: 'user', department_id: 1, is_active: 1, created_at: new Date('2026-01-01').toISOString(), updated_at: new Date('2026-01-01').toISOString() },
  { username: 'kong', password_hash: sha256(SEED_DEFAULT_PASSWORD), full_name: 'Kong', email: 'kong@company.com', role: 'user', department_id: 2, is_active: 1, created_at: new Date('2026-01-01').toISOString(), updated_at: new Date('2026-01-01').toISOString() },
  { username: 'julie', password_hash: sha256(SEED_DEFAULT_PASSWORD), full_name: 'Julie', email: 'julie@company.com', role: 'user', department_id: 3, is_active: 1, created_at: new Date('2026-01-01').toISOString(), updated_at: new Date('2026-01-01').toISOString() },
  { username: 'rodavallo', password_hash: sha256(SEED_DEFAULT_PASSWORD), full_name: 'Rodavallo', email: 'rodavallo@company.com', role: 'user', department_id: 4, is_active: 1, created_at: new Date('2026-01-01').toISOString(), updated_at: new Date('2026-01-01').toISOString() },
  { username: 'raquel', password_hash: sha256(SEED_DEFAULT_PASSWORD), full_name: 'Raquel', email: 'raquel@company.com', role: 'user', department_id: 5, is_active: 1, created_at: new Date('2026-01-01').toISOString(), updated_at: new Date('2026-01-01').toISOString() },
  { username: 'leony', password_hash: sha256(SEED_DEFAULT_PASSWORD), full_name: 'Leony', email: 'leony@company.com', role: 'user', department_id: 6, is_active: 1, created_at: new Date('2026-01-01').toISOString(), updated_at: new Date('2026-01-01').toISOString() },
  { username: 'jake', password_hash: sha256(SEED_DEFAULT_PASSWORD), full_name: 'Jake', email: 'jake@company.com', role: 'user', department_id: 7, is_active: 1, created_at: new Date('2026-01-01').toISOString(), updated_at: new Date('2026-01-01').toISOString() },
  { username: 'jennybel', password_hash: sha256(SEED_DEFAULT_PASSWORD), full_name: 'Jennybel', email: 'jennybel@company.com', role: 'user', department_id: 8, is_active: 1, created_at: new Date('2026-01-01').toISOString(), updated_at: new Date('2026-01-01').toISOString() },
  { username: 'geille', password_hash: sha256(SEED_DEFAULT_PASSWORD), full_name: 'Geille', email: 'geille@company.com', role: 'user', department_id: 9, is_active: 1, created_at: new Date('2026-01-01').toISOString(), updated_at: new Date('2026-01-01').toISOString() },
];

const projects = [
  { department_id: 1, project_name: 'Asset Management System', owner_id: 3, owner_name: 'Niel', stage: 'Build', progress: 60, start_date: '2026-03-01', due_date: '2026-07-15', priority: 'High', status: 'On Track', description: 'Automated asset tracking and management system', created_by: 1, created_at: new Date('2026-03-01').toISOString(), updated_at: new Date('2026-05-15').toISOString() },
  { department_id: 1, project_name: 'IT Asset Purchase Request Automation', owner_id: 4, owner_name: 'Ivan', stage: 'Build', progress: 50, start_date: '2026-03-15', due_date: '2026-07-30', priority: 'Medium', status: 'On Track', description: 'Automate IT asset purchase request workflow', created_by: 1, created_at: new Date('2026-03-15').toISOString(), updated_at: new Date('2026-05-15').toISOString() },
  { department_id: 1, project_name: 'Automated Item New Entry (Business Central)', owner_id: 5, owner_name: 'Jireh', stage: 'Build', progress: 50, start_date: '2026-04-01', due_date: '2026-08-01', priority: 'Medium', status: 'On Track', description: 'Auto-create new item entries in Business Central', created_by: 1, created_at: new Date('2026-04-01').toISOString(), updated_at: new Date('2026-05-15').toISOString() },
  { department_id: 1, project_name: 'Execom L10 Automation', owner_id: 2, owner_name: 'Harold', stage: 'Build', progress: 60, start_date: '2026-02-15', due_date: '2026-06-30', priority: 'High', status: 'At Risk', description: 'L10 executive communication automation', created_by: 1, created_at: new Date('2026-02-15').toISOString(), updated_at: new Date('2026-05-15').toISOString() },
  { department_id: 1, project_name: 'Process Automation Monitoring Dashboard', owner_id: 2, owner_name: 'Harold', stage: 'Build', progress: 25, start_date: '2026-05-01', due_date: '2026-08-15', priority: 'High', status: 'On Track', description: 'Central dashboard for tracking process automation projects', created_by: 1, created_at: new Date('2026-05-01').toISOString(), updated_at: new Date('2026-05-15').toISOString() },
  { department_id: 2, project_name: 'Gaisano Group Customer Review Dashboard', owner_id: 6, owner_name: 'Kong', stage: 'Test', progress: 70, start_date: '2026-01-20', due_date: '2026-06-30', priority: 'Critical', status: 'On Track', description: 'Customer review analytics dashboard for Gaisano Group', created_by: 1, created_at: new Date('2026-01-20').toISOString(), updated_at: new Date('2026-05-15').toISOString() },
  { department_id: 3, project_name: 'Recruitment and Selection Automation', owner_id: 7, owner_name: 'Julie', stage: 'Build', progress: 60, start_date: '2026-03-01', due_date: '2026-07-01', priority: 'High', status: 'On Track', description: 'Automate HR recruitment and selection process', created_by: 1, created_at: new Date('2026-03-01').toISOString(), updated_at: new Date('2026-05-15').toISOString() },
  { department_id: 4, project_name: 'Inventory Management and Reconciliation', owner_id: 8, owner_name: 'Rodavallo', stage: 'Test', progress: 25, start_date: '2026-02-01', due_date: '2026-06-15', priority: 'Critical', status: 'Delayed', description: 'Automated inventory reconciliation and management', created_by: 1, created_at: new Date('2026-02-01').toISOString(), updated_at: new Date('2026-05-15').toISOString() },
  { department_id: 5, project_name: 'Cash Flow Automation', owner_id: 9, owner_name: 'Raquel', stage: 'Deploy', progress: 30, start_date: '2026-01-01', due_date: '2026-05-31', priority: 'Critical', status: 'Completed', description: 'Automated cash flow forecasting and reporting', created_by: 1, created_at: new Date('2026-01-01').toISOString(), updated_at: new Date('2026-05-15').toISOString() },
  { department_id: 6, project_name: 'TMU Demand Planning System', owner_id: 10, owner_name: 'Leony', stage: 'Build', progress: 60, start_date: '2026-03-15', due_date: '2026-08-01', priority: 'Medium', status: 'On Track', description: 'Demand planning and forecasting system for TMU', created_by: 1, created_at: new Date('2026-03-15').toISOString(), updated_at: new Date('2026-05-15').toISOString() },
  { department_id: 7, project_name: 'Fleet Dispatch Prediction Automation', owner_id: 11, owner_name: 'Jake', stage: 'Build', progress: 25, start_date: '2026-04-01', due_date: '2026-09-01', priority: 'Medium', status: 'On Track', description: 'AI-powered fleet dispatch prediction system', created_by: 1, created_at: new Date('2026-04-01').toISOString(), updated_at: new Date('2026-05-15').toISOString() },
  { department_id: 8, project_name: 'MK Digital Order Management System', owner_id: 12, owner_name: 'Jennybel', stage: 'Build', progress: 60, start_date: '2026-02-20', due_date: '2026-07-20', priority: 'High', status: 'On Track', description: 'Personalized digital order management system', created_by: 1, created_at: new Date('2026-02-20').toISOString(), updated_at: new Date('2026-05-15').toISOString() },
  { department_id: 9, project_name: 'YFS Label Design System', owner_id: 13, owner_name: 'Geille', stage: 'Build', progress: 60, start_date: '2026-03-10', due_date: '2026-07-10', priority: 'Medium', status: 'On Track', description: 'Automated label design system for YFS products', created_by: 1, created_at: new Date('2026-03-10').toISOString(), updated_at: new Date('2026-05-15').toISOString() },
];

const activity = [
  { user_id: 9, user_name: 'Raquel', project_id: 9, action_type: 'stage', description: 'Cash Flow Automation moved to Deploy stage', old_value: null, new_value: null, created_at: new Date('2026-05-10').toISOString() },
  { user_id: 6, user_name: 'Kong', project_id: 6, action_type: 'progress', description: 'Gaisano Group Dashboard progress updated to 70%', old_value: null, new_value: null, created_at: new Date('2026-05-12').toISOString() },
  { user_id: 8, user_name: 'Rodavallo', project_id: 8, action_type: 'priority', description: 'Inventory Management flagged as delayed', old_value: null, new_value: null, created_at: new Date('2026-05-08').toISOString() },
  { user_id: 2, user_name: 'Harold', project_id: 5, action_type: 'create', description: 'New project added: Process Automation Monitoring Dashboard', old_value: null, new_value: null, created_at: new Date('2026-05-01').toISOString() },
  { user_id: 13, user_name: 'Geille', project_id: 13, action_type: 'progress', description: 'YFS Label Design System progress updated to 60%', old_value: null, new_value: null, created_at: new Date('2026-05-14').toISOString() },
  { user_id: 1, user_name: 'System Administrator', project_id: null, action_type: 'general', description: 'Database initialized with seed data', old_value: null, new_value: null, created_at: new Date('2026-01-01').toISOString() },
];

const emailSettings = {
  smtp_host: 'smtp.zoho.com',
  smtp_port: 587,
  smtp_secure: false,
  smtp_user: '',
  smtp_pass: '',
  from_name: 'Process Automation Dashboard',
  from_email: '',
  enabled: false,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

const permissions = [
  { role: 'admin', resource: 'projects', can_create: true, can_read: true, can_update: true, can_delete: true },
  { role: 'admin', resource: 'users', can_create: true, can_read: true, can_update: true, can_delete: true },
  { role: 'admin', resource: 'reports', can_create: true, can_read: true, can_update: true, can_delete: false },
  { role: 'admin', resource: 'settings', can_create: true, can_read: true, can_update: true, can_delete: false },
  { role: 'user', resource: 'projects', can_create: true, can_read: true, can_update: true, can_delete: false },
  { role: 'user', resource: 'users', can_create: false, can_read: false, can_update: false, can_delete: false },
  { role: 'user', resource: 'reports', can_create: false, can_read: true, can_update: false, can_delete: false },
  { role: 'user', resource: 'settings', can_create: false, can_read: true, can_update: false, can_delete: false },
];

async function migrate() {
  console.log('Starting Firestore migration...');

  // Clear existing data
  console.log('Clearing existing collections...');
  try { await deleteCollection('users'); console.log('  Cleared users'); } catch (e) { console.log('  users empty or error:', e.message); }
  try { await deleteCollection('departments'); console.log('  Cleared departments'); } catch (e) { console.log('  departments empty or error:', e.message); }
  try { await deleteCollection('projects'); console.log('  Cleared projects'); } catch (e) { console.log('  projects empty or error:', e.message); }
  try { await deleteCollection('activity'); console.log('  Cleared activity'); } catch (e) { console.log('  activity empty or error:', e.message); }
  try { await deleteCollection('email_settings'); console.log('  Cleared email_settings'); } catch (e) { console.log('  email_settings empty or error:', e.message); }
  try { await deleteCollection('permissions'); console.log('  Cleared permissions'); } catch (e) { console.log('  permissions empty or error:', e.message); }

  // Insert departments with explicit IDs
  console.log('Inserting departments...');
  for (let i = 0; i < departments.length; i++) {
    await postDocument('departments', departments[i], String(i + 1));
  }
  console.log(`  Inserted ${departments.length} departments`);

  // Insert users with explicit IDs
  console.log('Inserting users...');
  for (let i = 0; i < users.length; i++) {
    await postDocument('users', users[i], String(i + 1));
  }
  console.log(`  Inserted ${users.length} users`);

  // Insert projects with explicit IDs
  console.log('Inserting projects...');
  for (let i = 0; i < projects.length; i++) {
    await postDocument('projects', projects[i], String(i + 1));
  }
  console.log(`  Inserted ${projects.length} projects`);

  // Insert activity with auto IDs
  console.log('Inserting activity...');
  for (const a of activity) {
    await postDocument('activity', a);
  }
  console.log(`  Inserted ${activity.length} activity logs`);

  // Insert email settings with auto ID
  console.log('Inserting email settings...');
  await postDocument('email_settings', emailSettings, 'default');
  console.log('  Inserted email settings');

  // Insert permissions
  console.log('Inserting permissions...');
  for (let i = 0; i < permissions.length; i++) {
    await postDocument('permissions', permissions[i], String(i + 1));
  }
  console.log(`  Inserted ${permissions.length} permissions`);

  console.log('\nMigration complete!');
  console.log('Visit https://pad-dashboard-ysu.web.app to see the data.');
}

migrate().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
