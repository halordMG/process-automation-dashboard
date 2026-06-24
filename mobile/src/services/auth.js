import api from './api';
import { cacheCredentials, offlineLogin, setCurrentUser, getCurrentUser, clearCurrentUser } from './localDb';

export async function login(email, password) {
  // Try server first
  try {
    const res = await api.post('/api/v1/auth/login', { email, password });
    if (res.data?.token) {
      localStorage.setItem('prflow_token', res.data.token);
      const user = { ...res.data.user, token: res.data.token };
      await setCurrentUser(user);
      await cacheCredentials(email, password, user);
      return { success: true, user, online: true };
    }
  } catch (e) {
    // Server unavailable, try offline
    const offlineUser = await offlineLogin(email, password);
    if (offlineUser) {
      localStorage.setItem('prflow_token', 'offline-token');
      await setCurrentUser(offlineUser);
      return { success: true, user: offlineUser, online: false };
    }
  }

  return { success: false, error: 'Invalid credentials or server unreachable' };
}

export async function logout() {
  localStorage.removeItem('prflow_token');
  await clearCurrentUser();
}

export async function checkAuth() {
  const token = localStorage.getItem('prflow_token');
  if (!token) return null;

  const user = await getCurrentUser();
  return user;
}

export async function seedDemoAccounts() {
  const adminPassword = import.meta.env.VITE_DEMO_ADMIN_PASSWORD || '';
  const managerPassword = import.meta.env.VITE_DEMO_MANAGER_PASSWORD || '';
  const userPassword = import.meta.env.VITE_DEMO_USER_PASSWORD || '';

  const demoAccounts = [
    { email: 'admin@ysu.local', password: adminPassword, name: 'System Admin', role: 'admin', department: 'IT' },
    { email: 'manager@ysu.local', password: managerPassword, name: 'Dept Manager', role: 'manager', department: 'Marketing' },
    { email: 'user@ysu.local', password: userPassword, name: 'Staff User', role: 'user', department: 'Sales' },
  ];

  for (const acc of demoAccounts) {
    if (acc.password) {
      await cacheCredentials(acc.email, acc.password, acc);
    }
  }
}