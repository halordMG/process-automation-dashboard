/**
 * Process Automation Monitoring Dashboard - Backend API
 * Node.js + Express + MySQL (local) / PostgreSQL (cloud)
 *
 * Local: Uses mysql2 via XAMPP MySQL
 * Cloud: Uses pg (node-postgres) via DATABASE_URL (Render, Supabase, etc.)
 */

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const path = require('path');
const db = require('./db');
const emailService = require('./email');
const rbac = require('./rbac');
const firebaseAdmin = require('./firebase-admin');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Security headers
app.use((req, res, next) => {
  // Prevent MIME-type sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');

  // Prevent clickjacking by disallowing framing entirely
  res.setHeader('X-Frame-Options', 'DENY');

  // Modern replacement for X-Frame-Options; ignored in meta tags, so set it here
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://unpkg.com https://cdn.tailwindcss.com https://cdn.jsdelivr.net https://www.gstatic.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self' http://localhost:3001 ws://localhost:3001 https://*.googleapis.com https://*.cloudfunctions.net; img-src 'self' data: blob:; frame-ancestors 'none'; base-uri 'self'; form-action 'self';");

  // Send only the origin when navigating cross-origin, full URL for same-origin
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  // Disable the legacy XSS auditor to avoid harmful side-effects
  res.setHeader('X-XSS-Protection', '0');

  next();
});

app.use(express.static(path.join(__dirname, '..')));

// In-memory token store
const activeTokens = new Map();

// ============================================================
// DATABASE HELPERS (unified via db.js)
// ============================================================

async function get(sql, params = []) {
  const row = await db.queryOne(sql, params);
  return row;
}

async function all(sql, params = []) {
  return db.query(sql, params);
}

async function run(sql, params = []) {
  if (db.isPostgres()) {
    // PostgreSQL: use RETURNING to get insertId
    const returningMatch = sql.match(/^(INSERT\s+INTO\s+\S+)/i);
    if (returningMatch && !sql.toLowerCase().includes('returning')) {
      const pgSql = sql.replace(/;\s*$/, '') + ' RETURNING *';
      const rows = await db.query(pgSql, params);
      return { lastID: rows.length > 0 ? rows[0].id : null, changes: rows.length };
    }
    const rows = await db.query(sql, params);
    return { lastID: null, changes: rows.length };
  } else {
    // MySQL: use existing mysql2 pool directly for insertId
    const result = await db.query(sql, params);
    return { lastID: result.insertId || result[0]?.insertId, changes: result.affectedRows || result[0]?.affectedRows || 0 };
  }
}

// ============================================================
// AUTH MIDDLEWARE
// ============================================================

async function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token || !activeTokens.has(token)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const session = activeTokens.get(token);
  if (!session || !session.role) {
    return res.status(401).json({ error: 'Unauthorized: invalid session' });
  }
  req.user = session;
  next();
}

// RBAC: adminMiddleware replaced by rbac.requirePermission(resource, action).
// Policy is DENY BY DEFAULT — every route must declare an explicit permission.
async function getProjectOwnerId(req) {
  const p = db.isPostgres();
  const { id } = req.params;
  const row = await db.queryOne(
    `SELECT owner_id FROM projects WHERE id = ${p ? '$1' : '?'}`,
    [id]
  );
  return row ? row.owner_id : null;
}

// ============================================================
// AUTH ROUTES
// ============================================================

app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    const passHash = crypto.createHash('sha256').update(password).digest('hex');
    const user = await get(
      db.isPostgres()
        ? 'SELECT id, username, full_name, email, role, department_id, is_active FROM users WHERE username = $1 AND password_hash = $2 AND is_active = 1'
        : 'SELECT id, username, full_name, email, role, department_id, is_active FROM users WHERE username = ? AND password_hash = ? AND is_active = 1',
      [username, passHash]
    );

    if (!user) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const token = crypto.randomBytes(32).toString('hex');
    activeTokens.set(token, { ...user, token });

    const nowFn = db.isPostgres() ? 'CURRENT_TIMESTAMP' : 'NOW()';
    await run(`UPDATE users SET last_login = ${nowFn} WHERE id = ${db.isPostgres() ? '$1' : '?'}`, [user.id]);

    res.json({
      token,
      user: { id: user.id, username: user.username, name: user.full_name, role: user.role, department_id: user.department_id }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/auth/me', authMiddleware, (req, res) => {
  res.json({ user: req.user });
});

app.post('/api/auth/firebase-token', authMiddleware, async (req, res) => {
  try {
    if (!firebaseAdmin.isAvailable()) {
      return res.status(503).json({
        error: 'Firebase Admin is not configured. Set FIREBASE_PROJECT_ID and FIREBASE_SERVICE_ACCOUNT_JSON to enable Firestore RBAC.',
      });
    }

    const token = await firebaseAdmin.createCustomToken(req.user.id, req.user.role, {
      username: req.user.username,
      department_id: req.user.department_id,
    });

    res.json({ firebaseToken: token });
  } catch (err) {
    console.error('Firebase token error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/logout', authMiddleware, (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  activeTokens.delete(token);
  res.json({ message: 'Logged out successfully' });
});

// ============================================================
// DASHBOARD ROUTES
// ============================================================

app.get('/api/dashboard/stats', authMiddleware, rbac.requirePermission('reports', 'read'), async (req, res) => {
  try {
    const p = db.isPostgres();
    const ifnull = p ? 'COALESCE' : 'IFNULL';
    const isUser = req.user.role !== 'admin';
    const userWhere = isUser ? (p ? ' AND owner_id = $1' : ' AND owner_id = ?') : '';
    const userParams = isUser ? [req.user.id] : [];

    const total = await get(`SELECT COUNT(*) as count FROM projects WHERE 1=1${userWhere}`, [...userParams]);
    const deployed = await get(`SELECT COUNT(*) as count FROM projects WHERE stage = 'Deploy'${userWhere}`, [...userParams]);
    const atRisk = await get(`SELECT COUNT(*) as count FROM projects WHERE status IN ('At Risk', 'Delayed')${userWhere}`, [...userParams]);
    const avgProgress = await get(`SELECT ${ifnull}(AVG(progress), 0) as avg FROM projects WHERE 1=1${userWhere}`, [...userParams]);
    const activeUsers = await get('SELECT COUNT(*) as count FROM users WHERE is_active = 1');
    const deptCount = await get('SELECT COUNT(*) as count FROM departments');

    res.json({
      total: total.count,
      deployed: deployed.count,
      atRisk: atRisk.count,
      avgProgress: Math.round(avgProgress.avg * 100) / 100,
      activeUsers: activeUsers.count,
      totalDepartments: deptCount.count
    });
  } catch (err) {
    console.error('Dashboard stats error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/dashboard/by-stage', authMiddleware, rbac.requirePermission('reports', 'read'), async (req, res) => {
  try {
    const p = db.isPostgres();
    const orderBy = p
      ? "ORDER BY CASE stage WHEN 'Discovery' THEN 1 WHEN 'Design' THEN 2 WHEN 'Build' THEN 3 WHEN 'Test' THEN 4 WHEN 'Deploy' THEN 5 ELSE 6 END"
      : "ORDER BY FIELD(stage, 'Discovery', 'Design', 'Build', 'Test', 'Deploy')";
    const isUser = req.user.role !== 'admin';
    const userWhere = isUser ? (p ? ' WHERE owner_id = $1' : ' WHERE owner_id = ?') : '';
    const userParams = isUser ? [req.user.id] : [];

    const rows = await all(`
      SELECT stage, COUNT(*) as count, ROUND(AVG(progress), 2) as avg_progress
      FROM projects ${userWhere} GROUP BY stage ${orderBy}
    `, userParams);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/dashboard/by-department', authMiddleware, rbac.requirePermission('reports', 'read'), async (req, res) => {
  try {
    const p = db.isPostgres();
    const isUser = req.user.role !== 'admin';
    const userJoin = isUser ? (p ? ' AND p.owner_id = $1' : ' AND p.owner_id = ?') : '';
    const userParams = isUser ? [req.user.id] : [];

    const rows = await all(`
      SELECT d.department_name, COUNT(p.id) as count, ROUND(AVG(p.progress), 2) as avg_progress,
      COUNT(CASE WHEN p.status IN ('At Risk', 'Delayed') THEN 1 END) as at_risk_count
      FROM departments d LEFT JOIN projects p ON d.id = p.department_id${userJoin}
      GROUP BY d.id, d.department_name ORDER BY count DESC
    `, userParams);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// PROJECTS ROUTES
// ============================================================

app.get('/api/projects', authMiddleware, rbac.requirePermission('projects', 'read'), async (req, res) => {
  try {
    const { search, department, stage, priority, status } = req.query;
    const p = db.isPostgres();
    let sql = `SELECT p.*, d.department_name FROM projects p JOIN departments d ON p.department_id = d.id WHERE 1=1`;
    const params = [];

    if (req.user.role !== 'admin') {
      sql += p ? ' AND p.owner_id = $' + (params.length + 1) : ' AND p.owner_id = ?';
      params.push(req.user.id);
    }

    if (search) {
      sql += p ? ' AND (p.project_name ILIKE $' + (params.length + 1) + ' OR p.owner_name ILIKE $' + (params.length + 2) + ')' : ' AND (p.project_name LIKE ? OR p.owner_name LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }
    if (department && department !== 'All') {
      sql += p ? ' AND d.department_name = $' + (params.length + 1) : ' AND d.department_name = ?';
      params.push(department);
    }
    if (stage && stage !== 'All') {
      sql += p ? ' AND p.stage = $' + (params.length + 1) : ' AND p.stage = ?';
      params.push(stage);
    }
    if (priority && priority !== 'All') {
      sql += p ? ' AND p.priority = $' + (params.length + 1) : ' AND p.priority = ?';
      params.push(priority);
    }
    if (status && status !== 'All') {
      sql += p ? ' AND p.status = $' + (params.length + 1) : ' AND p.status = ?';
      params.push(status);
    }

    sql += ' ORDER BY p.created_at DESC';
    const rows = await all(sql, params);
    res.json(rows);
  } catch (err) {
    console.error('Get projects error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/projects', authMiddleware, rbac.requirePermission('projects', 'create'), async (req, res) => {
  try {
    const p = db.isPostgres();
    let { department_id, project_name, owner_name, owner_id, stage, progress, start_date, due_date, priority, status, description } = req.body;

    if (req.user.role !== 'admin') {
      owner_name = req.user.full_name || req.user.name;
      owner_id = req.user.id;
      const userDept = await get(`SELECT department_id FROM users WHERE id = ${p ? '$1' : '?'}`, [req.user.id]);
      if (userDept) department_id = userDept.department_id;
    }

    if (!owner_id && owner_name) {
      const owner = await get(`SELECT id FROM users WHERE full_name = ${p ? '$1' : '?'}`, [owner_name]);
      if (owner) owner_id = owner.id;
    }

    const result = await run(`
      INSERT INTO projects (department_id, project_name, owner_id, owner_name, stage, progress, start_date, due_date, priority, status, description, created_by)
      VALUES ${p ? '($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)' : '(?,?,?,?,?,?,?,?,?,?,?,?)'}
      ${p ? 'RETURNING id' : ''}
    `, [department_id, project_name, owner_id || null, owner_name, stage, progress, start_date || null, due_date || null, priority, status, description, req.user.id]);

    await run(`
      INSERT INTO activity_logs (user_id, user_name, project_id, project_name, action_type, description)
      VALUES ${p ? '($1,$2,$3,$4,$5,$6)' : '(?,?,?,?,?,?)'}
    `, [req.user.id, req.user.name || req.user.full_name, result.lastID, project_name, 'create', `Project "${project_name}" created by ${req.user.full_name || req.user.name}`]);

    res.status(201).json({ id: result.lastID, message: 'Project created' });
  } catch (err) {
    console.error('Create project error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/projects/:id', authMiddleware, rbac.requirePermission('projects', 'update'), async (req, res) => {
  try {
    const p = db.isPostgres();
    const { id } = req.params;
    let { department_id, project_name, owner_name, owner_id, stage, progress, start_date, due_date, priority, status, description } = req.body;

    const oldProj = await get(`SELECT stage, owner_id, owner_name FROM projects WHERE id = ${p ? '$1' : '?'}`, [id]);
    if (!oldProj) return res.status(404).json({ error: 'Project not found' });

    if (req.user.role !== 'admin') {
      if (oldProj.owner_id !== req.user.id) {
        return res.status(403).json({ error: 'Forbidden: You can only update your own projects' });
      }
      owner_name = req.user.full_name || req.user.name;
      owner_id = req.user.id;
      const userDept = await get(`SELECT department_id FROM users WHERE id = ${p ? '$1' : '?'}`, [req.user.id]);
      if (userDept) department_id = userDept.department_id;
    }

    if (!owner_id && owner_name) {
      const owner = await get(`SELECT id FROM users WHERE full_name = ${p ? '$1' : '?'}`, [owner_name]);
      if (owner) owner_id = owner.id;
    }

    const nowFn = p ? 'CURRENT_TIMESTAMP' : 'NOW()';
    await run(`
      UPDATE projects SET department_id=${p ? '$1' : '?'}, project_name=${p ? '$2' : '?'}, owner_id=${p ? '$3' : '?'}, owner_name=${p ? '$4' : '?'}, stage=${p ? '$5' : '?'}, progress=${p ? '$6' : '?'}, start_date=${p ? '$7' : '?'}, due_date=${p ? '$8' : '?'}, priority=${p ? '$9' : '?'}, status=${p ? '$10' : '?'}, description=${p ? '$11' : '?'}, updated_at=${nowFn}
      WHERE id=${p ? '$12' : '?'}
    `, [department_id, project_name, owner_id || null, owner_name, stage, progress, start_date || null, due_date || null, priority, status, description, id]);

    if (oldProj.stage !== stage) {
      await run(`
        INSERT INTO project_stage_history (project_id, from_stage, to_stage, changed_by, changed_by_name)
        VALUES ${p ? '($1,$2,$3,$4,$5)' : '(?,?,?,?,?)'}
      `, [id, oldProj.stage, stage, req.user.id, req.user.name || req.user.full_name]);
    }

    await run(`
      INSERT INTO activity_logs (user_id, user_name, project_id, project_name, action_type, description)
      VALUES ${p ? '($1,$2,$3,$4,$5,$6)' : '(?,?,?,?,?,?)'}
    `, [req.user.id, req.user.name || req.user.full_name, id, project_name, 'update', `Project "${project_name}" updated by ${req.user.full_name || req.user.name}`]);

    res.json({ message: 'Project updated' });
  } catch (err) {
    console.error('Update project error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/projects/:id', authMiddleware, rbac.requirePermission('projects', 'delete'), async (req, res) => {
  try {
    const p = db.isPostgres();
    const { id } = req.params;
    const proj = await get(`SELECT project_name, owner_id FROM projects WHERE id = ${p ? '$1' : '?'}`, [id]);
    if (!proj) return res.status(404).json({ error: 'Project not found' });

    if (req.user.role !== 'admin' && proj.owner_id !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden: You can only delete your own projects' });
    }

    await run(`DELETE FROM projects WHERE id = ${p ? '$1' : '?'}`, [id]);
    await run(`
      INSERT INTO activity_logs (user_id, user_name, action_type, description)
      VALUES ${p ? '($1,$2,$3,$4)' : '(?,?,?,?)'}
    `, [req.user.id, req.user.name || req.user.full_name, 'delete', `Project "${proj.project_name}" deleted by ${req.user.full_name || req.user.name}`]);

    res.json({ message: 'Project deleted' });
  } catch (err) {
    console.error('Delete project error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// USERS ROUTES
// ============================================================

app.get('/api/users', authMiddleware, rbac.requirePermission('users', 'read'), async (req, res) => {
  try {
    const rows = await all(`
      SELECT u.id, u.username, u.full_name, u.email, u.role, u.is_active, u.created_at, d.department_name
      FROM users u LEFT JOIN departments d ON u.department_id = d.id
      ORDER BY u.created_at DESC
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/users', authMiddleware, rbac.requirePermission('users', 'create'), async (req, res) => {
  try {
    const p = db.isPostgres();
    const { username, password, full_name, email, role, department_id } = req.body;
    const passHash = crypto.createHash('sha256').update(password).digest('hex');
    const result = await run(`
      INSERT INTO users (username, password_hash, full_name, email, role, department_id, is_active)
      VALUES ${p ? '($1,$2,$3,$4,$5,$6,1)' : '(?,?,?,?,?,?,1)'}
      ${p ? 'RETURNING id' : ''}
    `, [username, passHash, full_name, email, role, department_id]);

    await run(`
      INSERT INTO activity_logs (user_id, user_name, action_type, description)
      VALUES ${p ? '($1,$2,$3,$4)' : '(?,?,?,?)'}
    `, [req.user.id, req.user.name || req.user.full_name, 'general', `User "${full_name}" created by ${req.user.full_name || req.user.name}`]);

    res.status(201).json({ id: result.lastID, message: 'User created' });
  } catch (err) {
    console.error('Create user error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/users/:id', authMiddleware, rbac.requirePermission('users', 'update'), async (req, res) => {
  try {
    const p = db.isPostgres();
    const { id } = req.params;
    const { full_name, email, role, department_id, is_active, password } = req.body;

    if (password && password.trim()) {
      const passHash = crypto.createHash('sha256').update(password).digest('hex');
      await run(`
        UPDATE users SET full_name=${p ? '$1' : '?'}, email=${p ? '$2' : '?'}, role=${p ? '$3' : '?'}, department_id=${p ? '$4' : '?'}, is_active=${p ? '$5' : '?'}, password_hash=${p ? '$6' : '?'}, updated_at=CURRENT_TIMESTAMP WHERE id=${p ? '$7' : '?'}
      `, [full_name, email, role, department_id, is_active, passHash, id]);
    } else {
      await run(`
        UPDATE users SET full_name=${p ? '$1' : '?'}, email=${p ? '$2' : '?'}, role=${p ? '$3' : '?'}, department_id=${p ? '$4' : '?'}, is_active=${p ? '$5' : '?'}, updated_at=CURRENT_TIMESTAMP WHERE id=${p ? '$6' : '?'}
      `, [full_name, email, role, department_id, is_active, id]);
    }

    res.json({ message: 'User updated' });
  } catch (err) {
    console.error('Update user error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/users/:id', authMiddleware, rbac.requirePermission('users', 'delete'), async (req, res) => {
  try {
    const p = db.isPostgres();
    const { id } = req.params;
    const user = await get(`SELECT full_name, role FROM users WHERE id = ${p ? '$1' : '?'}`, [id]);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.role === 'admin') return res.status(403).json({ error: 'Cannot delete admin users' });

    await run(`DELETE FROM users WHERE id = ${p ? '$1' : '?'}`, [id]);
    res.json({ message: 'User deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// ACTIVITY ROUTES
// ============================================================

app.get('/api/activity', authMiddleware, rbac.requirePermission('reports', 'read'), async (req, res) => {
  try {
    const p = db.isPostgres();
    const isUser = req.user.role !== 'admin';
    let sql = 'SELECT * FROM activity_logs WHERE 1=1';
    const params = [];
    if (isUser) {
      sql += p ? ' AND project_id IN (SELECT id FROM projects WHERE owner_id = $1)' : ' AND project_id IN (SELECT id FROM projects WHERE owner_id = ?)';
      params.push(req.user.id);
    }
    sql += ' ORDER BY created_at DESC LIMIT 50';
    const rows = await all(sql, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// DEPARTMENTS ROUTES
// ============================================================

app.get('/api/departments', authMiddleware, rbac.requirePermission('projects', 'read'), async (req, res) => {
  try {
    const rows = await all('SELECT * FROM departments ORDER BY department_name');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// REPORTS ROUTES
// ============================================================

app.get('/api/reports/by-status', authMiddleware, rbac.requirePermission('reports', 'read'), async (req, res) => {
  try {
    const p = db.isPostgres();
    const isUser = req.user.role !== 'admin';
    const userWhere = isUser ? (p ? ' AND owner_id = $1' : ' AND owner_id = ?') : '';
    const userParams = isUser ? [req.user.id] : [];
    const rows = await all(`SELECT status, COUNT(*) as count FROM projects WHERE 1=1${userWhere} GROUP BY status`, userParams);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/reports/by-owner', authMiddleware, rbac.requirePermission('reports', 'read'), async (req, res) => {
  try {
    const p = db.isPostgres();
    const isUser = req.user.role !== 'admin';
    const userWhere = isUser ? (p ? ' AND owner_id = $1' : ' AND owner_id = ?') : '';
    const userParams = isUser ? [req.user.id] : [];
    const rows = await all(`
      SELECT owner_name, COUNT(*) as count, ROUND(AVG(progress), 2) as avg_progress
      FROM projects WHERE 1=1${userWhere} GROUP BY owner_name ORDER BY count DESC
    `, userParams);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// PERMISSIONS ROUTE
// ============================================================

app.get('/api/permissions', authMiddleware, rbac.requirePermission('settings', 'read'), async (req, res) => {
  try {
    const p = db.isPostgres();
    const rows = await all(`SELECT * FROM permissions WHERE role = ${p ? '$1' : '?'}`, [req.user.role]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// EMAIL SETTINGS TABLE (auto-create if missing)
// ============================================================
async function initEmailTable() {
  const p = db.isPostgres();
  try {
    if (p) {
      await db.query(`
        CREATE TABLE IF NOT EXISTS email_settings (
          id SERIAL PRIMARY KEY,
          smtp_host VARCHAR(255) DEFAULT 'smtp.zoho.com',
          smtp_port INTEGER DEFAULT 587,
          smtp_secure BOOLEAN DEFAULT false,
          smtp_user VARCHAR(255),
          smtp_pass VARCHAR(255),
          from_name VARCHAR(255) DEFAULT 'Process Automation Dashboard',
          from_email VARCHAR(255),
          enabled BOOLEAN DEFAULT false,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
    } else {
      await db.query(`
        CREATE TABLE IF NOT EXISTS email_settings (
          id INTEGER PRIMARY KEY AUTO_INCREMENT,
          smtp_host VARCHAR(255) DEFAULT 'smtp.zoho.com',
          smtp_port INTEGER DEFAULT 587,
          smtp_secure INTEGER DEFAULT 0,
          smtp_user VARCHAR(255),
          smtp_pass VARCHAR(255),
          from_name VARCHAR(255) DEFAULT 'Process Automation Dashboard',
          from_email VARCHAR(255),
          enabled INTEGER DEFAULT 0,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
    }
    console.log('[Email] Settings table ready');
  } catch (err) {
    console.error('[Email] Failed to create settings table:', err.message);
  }
}

// ============================================================
// EMAIL ROUTES
// ============================================================

// Get email settings
app.get('/api/settings/email', authMiddleware, rbac.requirePermission('settings', 'read'), async (req, res) => {
  try {
    const settings = await emailService.loadSettings();
    if (!settings) {
      return res.json({
        smtpHost: 'smtp.zoho.com',
        smtpPort: 587,
        smtpSecure: false,
        smtpUser: '',
        smtpPass: '',
        fromName: 'Process Automation Dashboard',
        fromEmail: '',
        enabled: false,
      });
    }
    // Don't return password in plain text for security
    const masked = { ...settings, smtpPass: settings.smtpPass ? '********' : '' };
    res.json(masked);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Save email settings
app.post('/api/settings/email', authMiddleware, rbac.requirePermission('settings', 'update'), async (req, res) => {
  try {
    const { smtpHost, smtpPort, smtpSecure, smtpUser, smtpPass, fromName, fromEmail, enabled } = req.body;

    // Load existing to preserve password if not changed
    const existing = await emailService.loadSettings();
    const finalPass = smtpPass === '********' && existing ? existing.smtpPass : smtpPass;

    await emailService.saveSettings({
      smtpHost: smtpHost || 'smtp.zoho.com',
      smtpPort: parseInt(smtpPort) || 587,
      smtpSecure: !!smtpSecure,
      smtpUser: smtpUser || '',
      smtpPass: finalPass || '',
      fromName: fromName || 'Process Automation Dashboard',
      fromEmail: fromEmail || '',
      enabled: !!enabled,
    });

    res.json({ message: 'Email settings saved successfully' });
  } catch (err) {
    console.error('Save email settings error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Send test email
app.post('/api/notifications/test', authMiddleware, rbac.requirePermission('settings', 'update'), async (req, res) => {
  try {
    const { toEmail } = req.body;
    if (!toEmail) return res.status(400).json({ error: 'Recipient email is required' });

    const settings = await emailService.loadSettings();
    const result = await emailService.sendTestEmail(toEmail, settings);
    res.json(result);
  } catch (err) {
    console.error('Test email error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Send project notification
app.post('/api/notifications/project', authMiddleware, rbac.requirePermission('projects', 'read'), async (req, res) => {
  try {
    const { projectId, recipients } = req.body;
    if (!projectId || !recipients || !recipients.length) {
      return res.status(400).json({ error: 'Project ID and recipients are required' });
    }

    const p = db.isPostgres();
    const project = await db.queryOne(`
      SELECT p.*, d.department_name FROM projects p
      JOIN departments d ON p.department_id = d.id
      WHERE p.id = ${p ? '$1' : '?'}
    `, [projectId]);

    if (!project) return res.status(404).json({ error: 'Project not found' });

    const settings = await emailService.loadSettings();
    const result = await emailService.sendProjectNotification(
      project,
      recipients,
      settings,
      req.user.name || req.user.full_name
    );

    // Log activity
    await run(`
      INSERT INTO activity_logs (user_id, user_name, project_id, project_name, action_type, description)
      VALUES ${p ? '($1,$2,$3,$4,$5,$6)' : '(?,?,?,?,?,?)'}
    `, [req.user.id, req.user.name || req.user.full_name, projectId, project.project_name, 'notification', `Email notification sent to ${recipients.join(', ')}`]);

    res.json(result);
  } catch (err) {
    console.error('Project notification error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Send overdue alerts
app.post('/api/notifications/overdue', authMiddleware, rbac.requirePermission('reports', 'read'), async (req, res) => {
  try {
    const { recipients } = req.body;
    if (!recipients || !recipients.length) {
      return res.status(400).json({ error: 'Recipients are required' });
    }

    const p = db.isPostgres();
    const nowFn = p ? 'CURRENT_DATE' : 'DATE(NOW())';
    const overdueProjects = await db.query(`
      SELECT p.*, d.department_name FROM projects p
      JOIN departments d ON p.department_id = d.id
      WHERE p.due_date IS NOT NULL AND p.due_date < ${nowFn} AND p.status != 'Completed'
      ORDER BY p.due_date ASC
    `);

    if (overdueProjects.length === 0) {
      return res.json({ message: 'No overdue projects found' });
    }

    const settings = await emailService.loadSettings();
    const result = await emailService.sendOverdueAlert(
      overdueProjects,
      recipients,
      settings,
      req.user.name || req.user.full_name
    );

    res.json({ ...result, overdueCount: overdueProjects.length });
  } catch (err) {
    console.error('Overdue alert error:', err);
    res.status(500).json({ error: err.message });
  }
});


// ============================================================
// BACKUP & RESTORE ROUTES
// ============================================================

async function initBackupTable() {
  const p = db.isPostgres();
  try {
    if (p) {
      await db.query(`
        CREATE TABLE IF NOT EXISTS backup_settings (
          id SERIAL PRIMARY KEY,
          enabled BOOLEAN DEFAULT false,
          frequency VARCHAR(50) DEFAULT 'Daily',
          run_time VARCHAR(10) DEFAULT '02:00',
          timezone VARCHAR(100) DEFAULT 'Asia/Manila',
          retention_days INTEGER DEFAULT 7,
          store_local BOOLEAN DEFAULT true,
          upload_ftp BOOLEAN DEFAULT false,
          email_offsite BOOLEAN DEFAULT false,
          ftp_host VARCHAR(255),
          ftp_user VARCHAR(255),
          ftp_pass VARCHAR(255),
          ftp_path VARCHAR(255),
          email_to VARCHAR(255),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
    } else {
      await db.query(`
        CREATE TABLE IF NOT EXISTS backup_settings (
          id INTEGER PRIMARY KEY AUTO_INCREMENT,
          enabled INTEGER DEFAULT 0,
          frequency VARCHAR(50) DEFAULT 'Daily',
          run_time VARCHAR(10) DEFAULT '02:00',
          timezone VARCHAR(100) DEFAULT 'Asia/Manila',
          retention_days INTEGER DEFAULT 7,
          store_local INTEGER DEFAULT 1,
          upload_ftp INTEGER DEFAULT 0,
          email_offsite INTEGER DEFAULT 0,
          ftp_host VARCHAR(255),
          ftp_user VARCHAR(255),
          ftp_pass VARCHAR(255),
          ftp_path VARCHAR(255),
          email_to VARCHAR(255),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
    }
    console.log('[Backup] Settings table ready');
  } catch (err) {
    console.error('[Backup] Failed to create settings table:', err.message);
  }
}

async function getBackupSettings() {
  const row = await db.queryOne('SELECT * FROM backup_settings ORDER BY id DESC LIMIT 1');
  if (!row) return null;
  const bool = (v) => (db.isPostgres() ? !!v : v === 1);
  return {
    enabled: bool(row.enabled),
    frequency: row.frequency,
    runTime: row.run_time,
    timezone: row.timezone,
    retentionDays: row.retention_days,
    storeLocal: bool(row.store_local),
    uploadFtp: bool(row.upload_ftp),
    emailOffsite: bool(row.email_offsite),
    ftpHost: row.ftp_host || '',
    ftpUser: row.ftp_user || '',
    ftpPass: row.ftp_pass || '',
    ftpPath: row.ftp_path || '',
    emailTo: row.email_to || '',
  };
}

app.get('/api/backup/export', authMiddleware, rbac.requirePermission('settings', 'read'), async (req, res) => {
  try {
    const data = {
      exportedAt: new Date().toISOString(),
      exportedBy: req.user.username,
      version: '1.0',
    };
    data.departments = await all('SELECT * FROM departments ORDER BY id');
    data.users = await all('SELECT id, username, password_hash, full_name, email, role, department_id, is_active, last_login, created_at, updated_at FROM users ORDER BY id');
    data.projects = await all('SELECT * FROM projects ORDER BY id');
    data.activityLogs = await all('SELECT * FROM activity_logs ORDER BY id');
    data.projectStageHistory = await all('SELECT * FROM project_stage_history ORDER BY id');
    data.emailSettings = await all('SELECT * FROM email_settings ORDER BY id LIMIT 1');
    data.backupSettings = await all('SELECT * FROM backup_settings ORDER BY id LIMIT 1');

    const filename = `pad-backup-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('Backup export error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/backup/import', authMiddleware, rbac.requirePermission('settings', 'update'), async (req, res) => {
  try {
    const data = req.body;
    if (!data || typeof data !== 'object') {
      return res.status(400).json({ error: 'Invalid backup data' });
    }

    const p = db.isPostgres();
    const nowFn = p ? 'CURRENT_TIMESTAMP' : 'NOW()';

    // Disable foreign key checks for MySQL
    if (!p) {
      await db.query('SET FOREIGN_KEY_CHECKS = 0');
    }

    // Clear existing data in reverse dependency order
    await db.query('DELETE FROM project_stage_history');
    await db.query('DELETE FROM activity_logs');
    await db.query('DELETE FROM projects');
    await db.query('DELETE FROM users');
    await db.query('DELETE FROM departments');
    await db.query('DELETE FROM email_settings');

    // Helper to build dynamic INSERTs using the columns actually present in the backup.
    const insertRows = async (table, rows) => {
      if (!Array.isArray(rows) || rows.length === 0) return;
      const isoDateRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z?$/;
      for (const row of rows) {
        const keys = Object.keys(row).filter(k => row[k] !== undefined);
        const cols = keys.map(k => k);
        const placeholders = keys.map((_, i) => (p ? `$${i + 1}` : '?')).join(',');
        const values = keys.map(k => {
          const v = row[k];
          if (v === null) return null;
          // Convert JS booleans to integers for MySQL/MariaDB tinyint columns
          if (typeof v === 'boolean') return p ? v : (v ? 1 : 0);
          // Convert ISO datetime strings to MySQL/MariaDB datetime format
          if (!p && typeof v === 'string' && isoDateRegex.test(v)) {
            return v.replace('T', ' ').replace(/\.\d+Z?$/, '').replace(/Z$/, '');
          }
          return v;
        });
        await run(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${placeholders})`, values);
      }
    };

    await insertRows('departments', data.departments);
    await insertRows('users', data.users);
    await insertRows('projects', data.projects);
    await insertRows('activity_logs', data.activityLogs);
    await insertRows('project_stage_history', data.projectStageHistory);
    await insertRows('email_settings', data.emailSettings);

    // Re-enable foreign key checks
    if (!p) {
      await db.query('SET FOREIGN_KEY_CHECKS = 1');
    }

    await run(`
      INSERT INTO activity_logs (user_id, user_name, action_type, description)
      VALUES ${p ? '($1,$2,$3,$4)' : '(?,?,?,?)'}
    `, [req.user.id, req.user.name || req.user.full_name, 'general', `Backup restored by ${req.user.full_name || req.user.name}`]);

    res.json({ message: 'Backup restored successfully' });
  } catch (err) {
    console.error('Backup import error:', err);
    // Re-enable FK checks on error
    if (!db.isPostgres()) {
      try { await db.query('SET FOREIGN_KEY_CHECKS = 1'); } catch {}
    }
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/backup/settings', authMiddleware, rbac.requirePermission('settings', 'read'), async (req, res) => {
  try {
    const settings = await getBackupSettings();
    if (!settings) {
      return res.json({
        enabled: false,
        frequency: 'Daily',
        runTime: '02:00',
        timezone: 'Asia/Manila',
        retentionDays: 7,
        storeLocal: true,
        uploadFtp: false,
        emailOffsite: false,
        ftpHost: '',
        ftpUser: '',
        ftpPass: '',
        ftpPath: '',
        emailTo: '',
      });
    }
    res.json(settings);
  } catch (err) {
    console.error('Get backup settings error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/backup/settings', authMiddleware, rbac.requirePermission('settings', 'update'), async (req, res) => {
  try {
    const {
      enabled, frequency, runTime, timezone, retentionDays,
      storeLocal, uploadFtp, emailOffsite,
      ftpHost, ftpUser, ftpPass, ftpPath, emailTo
    } = req.body;

    const p = db.isPostgres();
    const existing = await db.queryOne('SELECT id FROM backup_settings ORDER BY id DESC LIMIT 1');
    const intVal = (v) => (v ? 1 : 0);

    if (existing) {
      await run(`
        UPDATE backup_settings SET
          enabled = ${p ? '$1' : '?'},
          frequency = ${p ? '$2' : '?'},
          run_time = ${p ? '$3' : '?'},
          timezone = ${p ? '$4' : '?'},
          retention_days = ${p ? '$5' : '?'},
          store_local = ${p ? '$6' : '?'},
          upload_ftp = ${p ? '$7' : '?'},
          email_offsite = ${p ? '$8' : '?'},
          ftp_host = ${p ? '$9' : '?'},
          ftp_user = ${p ? '$10' : '?'},
          ftp_pass = ${p ? '$11' : '?'},
          ftp_path = ${p ? '$12' : '?'},
          email_to = ${p ? '$13' : '?'},
          updated_at = ${p ? 'CURRENT_TIMESTAMP' : 'CURRENT_TIMESTAMP'}
        WHERE id = ${p ? '$14' : '?'}
      `, [intVal(enabled), frequency || 'Daily', runTime || '02:00', timezone || 'Asia/Manila', parseInt(retentionDays) || 7,
          intVal(storeLocal), intVal(uploadFtp), intVal(emailOffsite),
          ftpHost || '', ftpUser || '', ftpPass || '', ftpPath || '', emailTo || '',
          existing.id]);
    } else {
      await run(`
        INSERT INTO backup_settings (enabled, frequency, run_time, timezone, retention_days, store_local, upload_ftp, email_offsite, ftp_host, ftp_user, ftp_pass, ftp_path, email_to)
        VALUES ${p ? '($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)' : '(?,?,?,?,?,?,?,?,?,?,?,?,?)'}
      `, [intVal(enabled), frequency || 'Daily', runTime || '02:00', timezone || 'Asia/Manila', parseInt(retentionDays) || 7,
          intVal(storeLocal), intVal(uploadFtp), intVal(emailOffsite),
          ftpHost || '', ftpUser || '', ftpPass || '', ftpPath || '', emailTo || '']);
    }

    res.json({ message: 'Backup settings saved' });
  } catch (err) {
    console.error('Save backup settings error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/backup/run', authMiddleware, rbac.requirePermission('settings', 'update'), async (req, res) => {
  try {
    const data = {
      exportedAt: new Date().toISOString(),
      exportedBy: req.user.username,
      version: '1.0',
    };
    data.departments = await all('SELECT * FROM departments ORDER BY id');
    data.users = await all('SELECT id, username, password_hash, full_name, email, role, department_id, is_active, last_login, created_at, updated_at FROM users ORDER BY id');
    data.projects = await all('SELECT * FROM projects ORDER BY id');
    data.activityLogs = await all('SELECT * FROM activity_logs ORDER BY id');
    data.projectStageHistory = await all('SELECT * FROM project_stage_history ORDER BY id');
    data.emailSettings = await all('SELECT * FROM email_settings ORDER BY id LIMIT 1');
    data.backupSettings = await all('SELECT * FROM backup_settings ORDER BY id LIMIT 1');

    const fs = require('fs');
    const backupDir = process.env.BACKUP_DIR || path.join(__dirname, '..', 'backup');
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

    const filename = `pad-backup-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`;
    const filePath = path.join(backupDir, filename);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));

    await run(`
      INSERT INTO activity_logs (user_id, user_name, action_type, description)
      VALUES ${db.isPostgres() ? '($1,$2,$3,$4)' : '(?,?,?,?)'}
    `, [req.user.id, req.user.name || req.user.full_name, 'general', `Manual backup created: ${filename}`]);

    res.json({ message: 'Backup created', filename, path: filePath });
  } catch (err) {
    console.error('Run backup error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// HEALTH CHECK
// ============================================================
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ============================================================
// START SERVER
// ============================================================
db.initPool().then(async () => {
  await initEmailTable();
  await initBackupTable();
  app.listen(PORT, () => {
    console.log(`\n==============================================`);
    console.log(`Process Automation API Server`);
    console.log(`==============================================`);
    console.log(`Server running on port ${PORT}`);
    console.log(`Database: ${db.isPostgres() ? 'PostgreSQL' : 'MySQL'}`);
    if (db.isPostgres()) {
      console.log(`Frontend: Deploy to Netlify/Vercel/GitHub Pages`);
    } else {
      console.log(`Dashboard: http://localhost:${PORT}/ProcessAutomationDashboard.html`);
      console.log(`phpMyAdmin: http://localhost/phpmyadmin`);
    }
    console.log(`\nTo get started:`);
    console.log(`  Local: npm start`);
    console.log(`  Cloud: npm start (set DATABASE_URL env var)`);
    console.log(`==============================================\n`);
  });
}).catch(err => {
  console.error('Failed to start server:', err.message);
  process.exit(1);
});
