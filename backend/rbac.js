/**
 * Role-Based Access Control (RBAC) module
 *
 * Policy: DENY BY DEFAULT.
 * - Every route must be explicitly authorized.
 * - If a permission row is missing for a role+resource+action, access is denied.
 * - Admin users still need explicit permissions; no implicit super-user bypass.
 */

const db = require('./db');

let permissionCache = null;
let permissionCacheAt = 0;
const CACHE_TTL_MS = 60_000; // refresh permissions every 60s

/**
 * Refresh the in-memory permission map from the database.
 * Map shape: { [role]: { [resource]: { create, read, update, delete } } }
 */
async function loadPermissions() {
  const now = Date.now();
  if (permissionCache && now - permissionCacheAt < CACHE_TTL_MS) {
    return permissionCache;
  }

  const rows = await db.query('SELECT role, resource, can_create, can_read, can_update, can_delete FROM permissions');
  const map = {};
  for (const row of rows) {
    if (!map[row.role]) map[row.role] = {};
    map[row.role][row.resource] = {
      create: row.can_create === 1 || row.can_create === true,
      read: row.can_read === 1 || row.can_read === true,
      update: row.can_update === 1 || row.can_update === true,
      delete: row.can_delete === 1 || row.can_delete === true,
    };
  }
  permissionCache = map;
  permissionCacheAt = now;
  return map;
}

/**
 * Clear the permission cache (useful after seeding or updating permissions).
 */
function clearPermissionCache() {
  permissionCache = null;
  permissionCacheAt = 0;
}

/**
 * Check if a role has a specific permission.
 * Deny by default: returns false if role, resource, or action is unknown.
 */
async function hasPermission(role, resource, action) {
  const perms = await loadPermissions();
  const rolePerms = perms[role];
  if (!rolePerms) return false;
  const resourcePerms = rolePerms[resource];
  if (!resourcePerms) return false;
  return resourcePerms[action] === true;
}

/**
 * Express middleware: require a specific permission.
 * @param {string} resource - e.g. 'projects', 'users', 'reports', 'settings'
 * @param {string} action - 'create' | 'read' | 'update' | 'delete'
 */
function requirePermission(resource, action) {
  return async (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const allowed = await hasPermission(req.user.role, resource, action);
    if (!allowed) {
      return res.status(403).json({ error: `Forbidden: ${action} permission required for ${resource}` });
    }

    next();
  };
}

/**
 * Express middleware: require ownership OR explicit resource permission.
 * Use for resource-level access control where users can only mutate their own records.
 *
 * @param {string} resource - resource name for permission lookup
 * @param {string} action - action name for permission lookup
 * @param {function} getOwnerId - async (req) => ownerUserId or null
 */
function requirePermissionOrOwnership(resource, action, getOwnerId) {
  return async (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const allowed = await hasPermission(req.user.role, resource, action);
    if (allowed) {
      return next();
    }

    // Deny by default unless ownership can be proven
    if (typeof getOwnerId !== 'function') {
      return res.status(403).json({ error: `Forbidden: ${action} permission required for ${resource}` });
    }

    try {
      const ownerId = await getOwnerId(req);
      if (ownerId !== null && String(ownerId) === String(req.user.id)) {
        return next();
      }
    } catch (err) {
      console.error('[RBAC] Ownership check error:', err.message);
    }

    return res.status(403).json({ error: `Forbidden: ${action} permission required for ${resource}` });
  };
}

/**
 * Helper to enforce deny-by-default on a request.
 * Returns true only when an explicit permission exists.
 */
async function can(role, resource, action) {
  return hasPermission(role, resource, action);
}

module.exports = {
  loadPermissions,
  clearPermissionCache,
  hasPermission,
  can,
  requirePermission,
  requirePermissionOrOwnership,
};
