/**
 * Email Service — Zoho Mail SMTP Integration
 *
 * Supports sending email notifications via SMTP.
 * Default configuration is for Zoho Mail, but any SMTP provider works.
 */

const nodemailer = require('nodemailer');
const db = require('./db');

/**
 * Load email settings from database
 */
async function loadSettings() {
  try {
    const row = await db.queryOne('SELECT * FROM email_settings ORDER BY id DESC LIMIT 1');
    if (!row) return null;
    return {
      smtpHost: row.smtp_host,
      smtpPort: parseInt(row.smtp_port) || 587,
      smtpSecure: row.smtp_secure === 1 || row.smtp_secure === true,
      smtpUser: row.smtp_user,
      smtpPass: row.smtp_pass,
      fromName: row.from_name,
      fromEmail: row.from_email,
      enabled: row.enabled === 1 || row.enabled === true,
    };
  } catch (err) {
    console.error('[Email] Failed to load settings:', err.message);
    return null;
  }
}

/**
 * Save email settings to database
 */
async function saveSettings(settings) {
  const p = db.isPostgres();
  const existing = await db.queryOne('SELECT id FROM email_settings ORDER BY id DESC LIMIT 1');

  if (existing) {
    await db.query(`
      UPDATE email_settings SET
        smtp_host = ${p ? '$1' : '?'},
        smtp_port = ${p ? '$2' : '?'},
        smtp_secure = ${p ? '$3' : '?'},
        smtp_user = ${p ? '$4' : '?'},
        smtp_pass = ${p ? '$5' : '?'},
        from_name = ${p ? '$6' : '?'},
        from_email = ${p ? '$7' : '?'},
        enabled = ${p ? '$8' : '?'},
        updated_at = ${p ? 'CURRENT_TIMESTAMP' : 'NOW()'}
      WHERE id = ${p ? '$9' : '?'}
    `, [
      settings.smtpHost,
      settings.smtpPort,
      settings.smtpSecure ? 1 : 0,
      settings.smtpUser,
      settings.smtpPass,
      settings.fromName,
      settings.fromEmail,
      settings.enabled ? 1 : 0,
      existing.id,
    ]);
  } else {
    await db.query(`
      INSERT INTO email_settings (smtp_host, smtp_port, smtp_secure, smtp_user, smtp_pass, from_name, from_email, enabled)
      VALUES ${p ? '($1,$2,$3,$4,$5,$6,$7,$8)' : '(?,?,?,?,?,?,?,?)'}
    `, [
      settings.smtpHost,
      settings.smtpPort,
      settings.smtpSecure ? 1 : 0,
      settings.smtpUser,
      settings.smtpPass,
      settings.fromName,
      settings.fromEmail,
      settings.enabled ? 1 : 0,
    ]);
  }

  return { message: 'Email settings saved' };
}

/**
 * Create a nodemailer transporter from settings
 */
function createTransporter(settings) {
  return nodemailer.createTransporter({
    host: settings.smtpHost,
    port: settings.smtpPort,
    secure: settings.smtpSecure,
    auth: {
      user: settings.smtpUser,
      pass: settings.smtpPass,
    },
    tls: {
      rejectUnauthorized: false,
    },
  });
}

/**
 * Send a test email
 */
async function sendTestEmail(toEmail, settings) {
  if (!settings || !settings.enabled) {
    throw new Error('Email notifications are not enabled. Configure SMTP settings first.');
  }

  const transporter = createTransporter(settings);
  const info = await transporter.sendMail({
    from: `"${settings.fromName}" <${settings.fromEmail}>`,
    to: toEmail,
    subject: 'Process Automation Dashboard — Test Email',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #0ea5e9;">Test Email Successful</h2>
        <p>Your Zoho Mail SMTP configuration is working correctly.</p>
        <p>You can now send project notifications and overdue alerts from the dashboard.</p>
        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;" />
        <p style="color: #94a3b8; font-size: 12px;">Process Automation Monitoring Dashboard</p>
      </div>
    `,
  });

  return { message: 'Test email sent', messageId: info.messageId };
}

/**
 * Send project notification email
 */
async function sendProjectNotification(project, recipients, settings, senderName) {
  if (!settings || !settings.enabled) {
    throw new Error('Email notifications are not enabled.');
  }

  const transporter = createTransporter(settings);
  const dueDate = project.due_date || 'Not set';
  const statusColor = project.status === 'On Track' ? '#10b981' : project.status === 'At Risk' ? '#f59e0b' : project.status === 'Delayed' ? '#ef4444' : '#3b82f6';

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
      <div style="background: linear-gradient(135deg, #0ea5e9, #14b8a6); padding: 24px; color: white;">
        <h2 style="margin: 0; font-size: 20px;">Project Update</h2>
        <p style="margin: 8px 0 0 0; opacity: 0.9;">Process Automation Dashboard</p>
      </div>
      <div style="padding: 24px;">
        <h3 style="margin: 0 0 16px 0; color: #1e293b;">${project.project_name}</h3>
        <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
          <tr><td style="padding: 8px 0; color: #64748b; width: 120px;">Department</td><td style="padding: 8px 0; color: #1e293b;">${project.department_name || 'N/A'}</td></tr>
          <tr><td style="padding: 8px 0; color: #64748b;">Owner</td><td style="padding: 8px 0; color: #1e293b;">${project.owner_name || 'N/A'}</td></tr>
          <tr><td style="padding: 8px 0; color: #64748b;">Stage</td><td style="padding: 8px 0; color: #1e293b;">${project.stage}</td></tr>
          <tr><td style="padding: 8px 0; color: #64748b;">Progress</td><td style="padding: 8px 0; color: #1e293b;">${project.progress}%</td></tr>
          <tr><td style="padding: 8px 0; color: #64748b;">Priority</td><td style="padding: 8px 0; color: #1e293b;">${project.priority}</td></tr>
          <tr><td style="padding: 8px 0; color: #64748b;">Status</td><td style="padding: 8px 0; color: ${statusColor}; font-weight: bold;">${project.status}</td></tr>
          <tr><td style="padding: 8px 0; color: #64748b;">Due Date</td><td style="padding: 8px 0; color: #1e293b;">${dueDate}</td></tr>
        </table>
        ${project.description ? `<p style="margin-top: 16px; color: #475569; font-size: 13px;">${project.description}</p>` : ''}
      </div>
      <div style="background: #f8fafc; padding: 16px 24px; font-size: 12px; color: #94a3b8;">
        Sent by ${senderName || 'Process Automation Dashboard'}
      </div>
    </div>
  `;

  const info = await transporter.sendMail({
    from: `"${settings.fromName}" <${settings.fromEmail}>`,
    to: recipients.join(', '),
    subject: `Project Update: ${project.project_name} — ${project.status}`,
    html,
  });

  return { message: 'Notification sent', messageId: info.messageId, recipients: recipients.length };
}

/**
 * Send overdue project alert
 */
async function sendOverdueAlert(projects, recipients, settings, senderName) {
  if (!settings || !settings.enabled) {
    throw new Error('Email notifications are not enabled.');
  }

  const transporter = createTransporter(settings);
  const rows = projects.map(p => `
    <tr>
      <td style="padding: 10px; border-bottom: 1px solid #e2e8f0; color: #1e293b;">${p.project_name}</td>
      <td style="padding: 10px; border-bottom: 1px solid #e2e8f0; color: #64748b;">${p.department_name || 'N/A'}</td>
      <td style="padding: 10px; border-bottom: 1px solid #e2e8f0; color: #64748b;">${p.owner_name || 'N/A'}</td>
      <td style="padding: 10px; border-bottom: 1px solid #e2e8f0; color: #ef4444; font-weight: bold;">${p.due_date || 'No date'}</td>
    </tr>
  `).join('');

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
      <div style="background: linear-gradient(135deg, #ef4444, #f97316); padding: 24px; color: white;">
        <h2 style="margin: 0; font-size: 20px;">Overdue Projects Alert</h2>
        <p style="margin: 8px 0 0 0; opacity: 0.9;">${projects.length} project(s) are past their due date</p>
      </div>
      <div style="padding: 24px;">
        <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
          <thead>
            <tr style="background: #f1f5f9;">
              <th style="padding: 10px; text-align: left; color: #475569; font-size: 12px; text-transform: uppercase;">Project</th>
              <th style="padding: 10px; text-align: left; color: #475569; font-size: 12px; text-transform: uppercase;">Department</th>
              <th style="padding: 10px; text-align: left; color: #475569; font-size: 12px; text-transform: uppercase;">Owner</th>
              <th style="padding: 10px; text-align: left; color: #475569; font-size: 12px; text-transform: uppercase;">Due Date</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div style="background: #f8fafc; padding: 16px 24px; font-size: 12px; color: #94a3b8;">
        Sent by ${senderName || 'Process Automation Dashboard'}
      </div>
    </div>
  `;

  const info = await transporter.sendMail({
    from: `"${settings.fromName}" <${settings.fromEmail}>`,
    to: recipients.join(', '),
    subject: `Overdue Alert: ${projects.length} Project(s) Need Attention`,
    html,
  });

  return { message: 'Overdue alert sent', messageId: info.messageId, recipients: recipients.length };
}

module.exports = {
  loadSettings,
  saveSettings,
  sendTestEmail,
  sendProjectNotification,
  sendOverdueAlert,
};
