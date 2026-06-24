import axios from 'axios';
import { addToSyncQueue, getPurchaseRequests, getApprovals, getPurchaseRequestById } from './localDb';
import { syncService } from './syncService';

const API_BASE_URL = import.meta.env.VITE_API_URL;

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

api.interceptors.request.use(async (config) => {
  const token = localStorage.getItem('prflow_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('prflow_token');
      window.dispatchEvent(new CustomEvent('auth:logout'));
    }
    return Promise.reject(error);
  }
);

export async function offlineAwareRequest(method, url, data = null, options = {}) {
  const isOnline = syncService.isOnline;
  const entityType = options.entityType || 'generic';

  if (isOnline) {
    try {
      const response = await api[method](url, data);
      return response;
    } catch (e) {
      // If network error, fall through to offline handling
      if (!e.response) {
        return handleOfflineRequest(method, url, data, entityType);
      }
      throw e;
    }
  }

  return handleOfflineRequest(method, url, data, entityType);
}

async function handleOfflineRequest(method, url, data, entityType) {
  if (method === 'get') {
    // Return cached data
    if (entityType === 'purchase_requests') {
      const localData = await getPurchaseRequests();
      return { data: { requests: localData }, offline: true };
    }
    if (entityType === 'approvals') {
      const localData = await getApprovals();
      return { data: { pending_approvals: localData }, offline: true };
    }
    if (entityType === 'purchase_request' && data?.id) {
      const localData = await getPurchaseRequestById(data.id);
      return { data: localData, offline: true };
    }
    return { data: null, offline: true };
  }

  // Offline mutation: queue it
  let actionName = method;
  if (url.includes('/pr') && method === 'post') actionName = 'create_pr';
  else if (url.includes('/approve')) actionName = 'approve_pr';
  else if (url.includes('/reject')) actionName = 'reject_pr';
  else if (url.includes('/rfi')) actionName = 'rfi_pr';

  await addToSyncQueue(actionName, entityType, { url, data });
  return { data: { queued: true, message: 'Saved offline. Will sync when online.' }, offline: true };
}

export default api;