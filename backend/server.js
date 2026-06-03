/**
 * Process Automation Monitoring Dashboard - Backend API
 * Node.js + Express + MySQL (local) / PostgreSQL (cloud)
 *
 * Local: Uses mysql2 via XAMPP MySQL
 * Cloud: Uses pg (node-postgres) via DATABASE_URL (Render, Supabase, etc.)
 */

const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const path = require('path');
const db = require('./db');
const emailService = require('./email');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());
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
  req.user = activeTokens.get(token);
  next();
}

async function adminMiddleware(req, res, next) {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden: Admin access required' });
  }
  next();
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

app.post('/api/auth/logout', authMiddleware, (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  activeTokens.delete(token);
  res.json({ message: 'Logged out successfully' });
});

// ============================================================
// DASHBOARD ROUTES
// ============================================================

app.get('/api/dashboard/stats', authMiddleware, async (req, res) => {
  try {
    const q = (sql) => sql;
    const ifnull = db.isPostgres() ? 'COALESCE' : 'IFNULL';

    const total = await get('SELECT COUNT(*) as count FROM projects');
    const deployed = await get("SELECT COUNT(*) as count FROM projects WHERE stage = 'Deploy'");
    const atRisk = await get("SELECT COUNT(*) as count FROM projects WHERE status IN ('At Risk', 'Delayed')");
    const avgProgress = await get(`SELECT ${ifnull}(AVG(progress), 0) as avg FROM projects`);
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

app.get('/api/dashboard/by-stage', authMiddleware, async (req, res) => {
  try {
    const orderBy = db.isPostgres()
      ? "ORDER BY CASE stage WHEN 'Discovery' THEN 1 WHEN 'Design' THEN 2 WHEN 'Build' THEN 3 WHEN 'Test' THEN 4 WHEN 'Deploy' THEN 5 ELSE 6 END"
      : "ORDER BY FIELD(stage, 'Discovery', 'Design', 'Build', 'Test', 'Deploy')";

    const rows = await all(`
      SELECT stage, COUNT(*) as count, ROUND(AVG(progress), 2) as avg_progress
      FROM projects GROUP BY stage ${orderBy}
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/dashboard/by-department', authMiddleware, async (req, res) => {
  try {
    const rows = await all(`
      SELECT d.department_name, COUNT(p.id) as count, ROUND(AVG(p.progress), 2) as avg_progress,
      COUNT(CASE WHEN p.status IN ('At Risk', 'Delayed') THEN 1 END) as at_risk_count
      FROM departments d LEFT JOIN projects p ON d.id = p.department_id
      GROUP BY d.id, d.department_name ORDER BY count DESC
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// PROJECTS ROUTES
// ============================================================

app.get('/api/projects', authMiddleware, async (req, res) => {
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

app.post('/api/projects', authMiddleware, async (req, res) => {
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

    const nowFn = p ? 'CURRENT_TIMESTAMP' : 'NOW()';
    await run(`
      INSERT INTO activity_logs (user_id, user_name, project_id, project_name, action_type, description, created_at)
      VALUES ${p ? '($1,$2,$3,$4,$5,$6,$7)' : '(?,?,?,?,?,?,?)'}
    `, [req.user.id, req.user.name || req.user.full_name, result.lastID, project_name, 'create', `Project "${project_name}" created by ${req.user.full_name || req.user.name}`, nowFn]);

    res.status(201).json({ id: result.lastID, message: 'Project created' });
  } catch (err) {
    console.error('Create project error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/projects/:id', authMiddleware, async (req, res) => {
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
      INSERT INTO activity_logs (user_id, user_name, project_id, project_name, action_type, description, created_at)
      VALUES ${p ? '($1,$2,$3,$4,$5,$6,$7)' : '(?,?,?,?,?,?,?)'}
    `, [req.user.id, req.user.name || req.user.full_name, id, project_name, 'update', `Project "${project_name}" updated by ${req.user.full_name || req.user.name}`, nowFn]);

    res.json({ message: 'Project updated' });
  } catch (err) {
    console.error('Update project error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/projects/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const p = db.isPostgres();
    const { id } = req.params;
    const proj = await get(`SELECT project_name FROM projects WHERE id = ${p ? '$1' : '?'}`, [id]);
    if (!proj) return res.status(404).json({ error: 'Project not found' });

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

app.get('/api/users', authMiddleware, adminMiddleware, async (req, res) => {
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

app.post('/api/users', authMiddleware, adminMiddleware, async (req, res) => {
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

app.put('/api/users/:id', authMiddleware, adminMiddleware, async (req, res) => {
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

app.delete('/api/users/:id', authMiddleware, adminMiddleware, async (req, res) => {
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

app.get('/api/activity', authMiddleware, async (req, res) => {
  try {
    const rows = await all('SELECT * FROM activity_logs ORDER BY created_at DESC LIMIT 50');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// DEPARTMENTS ROUTES
// ============================================================

app.get('/api/departments', authMiddleware, async (req, res) => {
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

app.get('/api/reports/by-status', authMiddleware, async (req, res) => {
  try {
    const rows = await all('SELECT status, COUNT(*) as count FROM projects GROUP BY status');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/reports/by-owner', authMiddleware, async (req, res) => {
  try {
    const rows = await all(`
      SELECT owner_name, COUNT(*) as count, ROUND(AVG(progress), 2) as avg_progress
      FROM projects GROUP BY owner_name ORDER BY count DESC
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// PERMISSIONS ROUTE
// ============================================================

app.get('/api/permissions', authMiddleware, async (req, res) => {
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
          id INTEGER PRIMARY KEY AUTOINCREMENT,
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
app.get('/api/settings/email', authMiddleware, adminMiddleware, async (req, res) => {
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
app.post('/api/settings/email', authMiddleware, adminMiddleware, async (req, res) => {
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
app.post('/api/notifications/test', authMiddleware, adminMiddleware, async (req, res) => {
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
app.post('/api/notifications/project', authMiddleware, async (req, res) => {
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
app.post('/api/notifications/overdue', authMiddleware, adminMiddleware, async (req, res) => {
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
