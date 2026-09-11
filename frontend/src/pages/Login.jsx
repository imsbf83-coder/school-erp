import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Login() {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(identifier, password);
      navigate('/');
    } catch (err) {
      setError(err.response?.data?.error || 'Could not sign in. Check your details and try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-ink px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <p className="font-display text-paper text-3xl">The Register</p>
          <p className="font-mono text-[10px] text-white/40 uppercase tracking-widest mt-1">
            School Management System
          </p>
        </div>

        <form onSubmit={handleSubmit} className="bg-paper rounded-lg p-8 shadow-xl">
          <h2 className="font-display text-xl text-ink mb-6">Sign in</h2>

          {error && (
            <div className="bg-absent/10 border border-absent/30 text-absent text-sm rounded-md px-3 py-2 mb-4">
              {error}
            </div>
          )}

          <label className="block text-sm text-slate2 mb-1">Email or mobile number</label>
          <input
            type="text"
            required
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            className="w-full border border-ink/20 rounded-md px-3 py-2 mb-4 bg-white focus:border-brass outline-none"
            placeholder="admin@school.edu or 03001234567"
          />

          <label className="block text-sm text-slate2 mb-1">Password</label>
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full border border-ink/20 rounded-md px-3 py-2 mb-6 bg-white focus:border-brass outline-none"
            placeholder="••••••••"
          />

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-ink text-paper rounded-md py-2.5 font-medium hover:bg-ink-light transition-colors disabled:opacity-50"
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>

          <p className="text-xs text-slate2 mt-5 text-center">
            Demo: <span className="font-mono">admin@school.edu</span> / <span className="font-mono">Admin@123</span>
          </p>
        </form>
      </div>
    </div>
  );
}
