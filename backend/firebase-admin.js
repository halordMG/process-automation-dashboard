/**
 * Firebase Admin SDK integration for secure mobile authentication.
 *
 * Required environment:
 *   FIREBASE_PROJECT_ID=your-project-id
 *   FIREBASE_SERVICE_ACCOUNT_JSON={...}  (JSON string of service account key)
 *
 * If the service account is not configured, custom token generation is disabled
 * and the mobile app will fall back to backend API authentication.
 */

let admin = null;
let isAvailable = false;

try {
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  const projectId = process.env.FIREBASE_PROJECT_ID;

  if (serviceAccountJson && projectId) {
    const serviceAccount = JSON.parse(serviceAccountJson);
    admin = require('firebase-admin');
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId,
    });
    isAvailable = true;
    console.log('[Firebase Admin] Initialized for project:', projectId);
  } else {
    console.log('[Firebase Admin] Not configured. Set FIREBASE_PROJECT_ID and FIREBASE_SERVICE_ACCOUNT_JSON to enable custom tokens.');
  }
} catch (err) {
  console.error('[Firebase Admin] Initialization failed:', err.message);
  isAvailable = false;
}

/**
 * Generate a Firebase custom token with the user's role as a claim.
 * The mobile app uses this token to sign in to Firebase Auth, after which
 * Firestore security rules can enforce RBAC via request.auth.token.role.
 *
 * @param {string} uid - stable user identifier (use backend user id)
 * @param {string} role - 'admin' | 'user'
 * @param {object} extraClaims - optional additional claims
 */
async function createCustomToken(uid, role, extraClaims = {}) {
  if (!isAvailable || !admin) {
    throw new Error('Firebase Admin is not configured');
  }

  const claims = {
    role,
    ...extraClaims,
  };

  return admin.auth().createCustomToken(String(uid), claims);
}

module.exports = {
  isAvailable: () => isAvailable,
  createCustomToken,
};
