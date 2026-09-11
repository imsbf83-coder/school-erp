import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const modules = [
  { to: '/', label: 'Dashboard', accent: '#1B2438' },
  { to: '/classes', label: 'Classes', accent: '#4A6B8A' },
  { to: '/students', label: 'Students', accent: '#2F7D5A' },
  { to: '/attendance', label: 'Attendance', accent: '#B4903D' },
  { to: '/exams', label: 'Examinations', accent: '#7A4FB5' },
  { to: '/admissions', label: 'Admission / Withdrawal', accent: '#B23A48' },
  { to: '/staff', label: 'Staff', accent: '#2E6E8E' },
  { to: '/teacher-access', label: 'Teacher Access', accent: '#4F7A6B' },
  { to: '/bus-fees', label: 'Bus Fee Collection', accent: '#C0632E' },
  { to: '/transport-expenses', label: 'Transport Expenses', accent: '#8A5A2E' },
  { to: '/reports', label: 'Reports', accent: '#5B6B7C' },
];

export default function Layout({ children }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="min-h-screen flex bg-paper text-ink">
      {/* Sidebar styled as a ledger index with tab dividers */}
      <aside className="w-64 bg-ink flex flex-col shrink-0">
        <div className="px-6 py-6 border-b border-white/10">
          <p className="font-display text-paper text-xl leading-tight">The Register</p>
          <p className="font-mono text-[10px] text-white/40 uppercase tracking-widest mt-1">
            School Management System
          </p>
        </div>

        <nav className="flex-1 py-4">
          {modules.map((m) => (
            <NavLink
              key={m.to}
              to={m.to}
              end={m.to === '/'}
              className={({ isActive }) =>
                `group flex items-center gap-0 relative pl-6 pr-4 py-3 text-sm transition-colors ${
                  isActive ? 'text-ink' : 'text-white/70 hover:text-white'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  {/* tab block */}
                  <span
                    className={`absolute inset-y-1 left-0 right-0 rounded-r-md transition-all ${
                      isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-10'
                    }`}
                    style={{ backgroundColor: isActive ? m.accent : m.accent }}
                  />
                  <span
                    className="w-2 h-2 rounded-full mr-3 relative z-10 shrink-0"
                    style={{ backgroundColor: m.accent, opacity: isActive ? 1 : 0.6 }}
                  />
                  <span className={`relative z-10 ${isActive ? 'font-medium' : ''}`}>{m.label}</span>
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="px-6 py-4 border-t border-white/10">
          <p className="text-white text-sm font-medium">{user?.name}</p>
          <p className="text-white/40 text-xs font-mono mb-3">{user?.role}</p>
          <button
            onClick={() => {
              logout();
              navigate('/login');
            }}
            className="text-xs text-white/60 hover:text-brass-light transition-colors"
          >
            Sign out →
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto">
        <div className="max-w-6xl mx-auto px-8 py-10">{children}</div>
      </main>
    </div>
  );
}
