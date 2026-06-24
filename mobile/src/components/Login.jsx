import React, { useState } from 'react';
import { LogIn, WifiOff, Wifi } from 'lucide-react';
import { login } from '../services/auth';
import { syncService } from '../services/syncService';

function Login({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [isOnline, setIsOnline] = useState(syncService.isOnline);

  React.useEffect(() => {
    const cb = (online) => setIsOnline(online);
    syncService.addListener(cb);
    return () => syncService.removeListener(cb);
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    const result = await login(email, password);
    setLoading(false);

    if (result.success) {
      onLogin(result.user, result.online);
    } else {
      setError(result.error);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm bg-white rounded-xl card-shadow p-6">
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-12 h-12 bg-blue-100 rounded-full mb-3">
            <LogIn className="w-6 h-6 text-blue-700" />
          </div>
          <h1 className="text-2xl font-bold text-gray-800">PRFlow</h1>
          <p className="text-sm text-gray-500 mt-1">Purchase Request System</p>
        </div>

        <div className={`flex items-center justify-center gap-2 text-xs mb-4 px-3 py-1.5 rounded-full ${
          isOnline ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'
        }`}>
          {isOnline ? <Wifi size={14} /> : <WifiOff size={14} />}
          {isOnline ? 'Online' : 'Offline Mode Available'}
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-base tap-target focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="user@ysu.local"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-base tap-target focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="Enter password"
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 text-white py-3 rounded-lg text-base font-medium hover:bg-blue-700 active:bg-blue-800 disabled:opacity-50 tap-target transition-colors"
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        <div className="mt-6 p-3 bg-gray-50 rounded-lg">
          <p className="text-xs text-gray-500 font-medium mb-2">Demo Accounts:</p>
          <div className="space-y-1 text-xs text-gray-600">
            <p>admin@ysu.local</p>
            <p>manager@ysu.local</p>
            <p>user@ysu.local</p>
          </div>
          <p className="text-xs text-gray-400 mt-2">
            Passwords are set via VITE_DEMO_*_PASSWORD environment variables.
          </p>
        </div>
      </div>
    </div>
  );
}

export default Login;