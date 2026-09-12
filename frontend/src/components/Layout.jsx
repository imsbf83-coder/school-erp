import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

// `moduleKey: null` means "always visible to any logged-in user" — matches
// routes that only ever check requireAuth (no role/permission gate) today,
// e.g. Classes/Students/Attendance, which are further scoped per-teacher
// by classAccess.js rather than by module permission.
//
// `adminOnly: true` means visible to ADMIN alone, regardless of any
// StaffPermission grant — used for screens that manage OTHER people's
// access (Teacher Access) rather than doing day-to-day work in a module.
//
// Everything else names the MODULES key from backend/src/utils/permissions.js
// that the corresponding route actually checks — see canSee() below for how
// this combines with role.
const modules = [
  { to: '/', label: 'Dashboard', accent: '#1B2438', moduleKey: null },
  { to: '/classes', label: 'Classes', accent: '#4A6B8A', moduleKey: null },
  { to: '/students', label: 'Students', accent: '#2F7D5A', moduleKey: null },
  { to: '/attendance', label: 'Attendance', accent: '#B4903D', moduleKey: null },
  { to: '/exams', label: 'Examinations', accent: '#7A4FB5', moduleKey: 'EXAMS', teacherAlwaysSees: true },
  { to: '/admissions', label: 'Admission / Withdrawal', accent: '#B23A48', moduleKey: 'ADMISSIONS' },
  { to: '/staff', label: 'Staff', accent: '#2E6E8E', moduleKey: 'STAFF' },
  { to: '/teacher-access', label: 'Teacher Access', accent: '#4F7A6B', adminOnly: true },
  { to: '/staff-access', label: 'Staff Access', accent: '#6B4F91', adminOnly: true },
  { to: '/bus-fees', label: 'Bus Fee Collection', accent: '#C0632E', moduleKey: 'BUS' },
  { to: '/transport-expenses', label: 'Transport Expenses', accent: '#8A5A2E', moduleKey: 'BUS' },
  { to: '/reports', label: 'Reports', accent: '#5B6B7C', moduleKey: null },
];

export default function Layout({ children }) {
  const { user, logout, hasModule } = useAuth();
  const navigate = useNavigate();
  // Sidebar is an off-canvas drawer on small screens (hidden by default,
  // slides in over the content when opened) and a normal always-visible
  // column on md+ screens — see the `md:` classes below, which override
  // the mobile transform/positioning entirely once there's room for it.
  const [sidebarOpen, setSidebarOpen] = useState(false);

  function closeSidebar() {
    setSidebarOpen(false);
  }

  // Mirrors the actual backend rule for each module (see
  // backend/src/routes/*.js) rather than just checking permissions in
  // isolation — ADMIN sees everything; a module with `teacherAlwaysSees`
  // (currently just Exams) is also always visible to TEACHER, matching
  // exams.js's requireRoleOrPermission(['ADMIN','TEACHER'], MODULES.EXAMS);
  // everyone else needs an explicit StaffPermission grant for that module.
  function canSee(item) {
    if (!user) return false;
    if (user.role === 'ADMIN') return true;
    if (item.adminOnly) return false;
    if (item.moduleKey === null) return true; // no gate on the backend route
    if (item.teacherAlwaysSees && user.role === 'TEACHER') return true;
    return hasModule(item.moduleKey);
  }

  const visibleModules = modules.filter(canSee);

  return (
    <div className="min-h-screen flex bg-paper text-ink">
      {/* Mobile top bar: only visible below md, gives access to the menu
          toggle since the sidebar itself is off-canvas at that width. */}
      <div className="md:hidden fixed top-0 inset-x-0 h-14 bg-ink flex items-center px-4 z-30">
        <button
          onClick={() => setSidebarOpen(true)}
          aria-label="Open menu"
          className="text-white p-2 -ml-2"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
        <p className="font-display text-paper text-lg ml-3">The Register</p>
      </div>

      {/* Backdrop: only rendered (and only clickable) while the mobile
          drawer is open, so it doesn't sit above the page on desktop or
          when closed. */}
      {sidebarOpen && (
        <div
          onClick={closeSidebar}
          className="md:hidden fixed inset-0 bg-black/50 z-40"
          aria-hidden="true"
        />
      )}

      {/* Sidebar styled as a ledger index with tab dividers.
          Mobile (< md): fixed off-canvas drawer, slid in/out with a
          transform based on sidebarOpen.
          Desktop (md+): back to the original static, always-visible column
          — the transform/fixed positioning is overridden by md:relative
          and md:translate-x-0. */}
      <aside
        className={`w-64 bg-ink flex flex-col shrink-0 fixed inset-y-0 left-0 z-50 transform transition-transform duration-200 md:relative md:transform-none ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="px-6 py-6 border-b border-white/10 flex items-center justify-between">
          <div>
            <p className="font-display text-paper text-xl leading-tight">The Register</p>
            <p className="font-mono text-[10px] text-white/40 uppercase tracking-widest mt-1">
              School Management System
            </p>
          </div>
          {/* Close button: mobile only, since desktop never has this drawer
              "open" in a way that needs closing. */}
          <button
            onClick={closeSidebar}
            aria-label="Close menu"
            className="md:hidden text-white/60 hover:text-white p-1"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <nav className="flex-1 py-4 overflow-y-auto">
          {visibleModules.map((m) => (
            <NavLink
              key={m.to}
              to={m.to}
              end={m.to === '/'}
              onClick={closeSidebar}
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

      {/* pt-14 on mobile makes room for the fixed top bar; md+ drops it
          since the top bar itself is hidden there. */}
      <main className="flex-1 overflow-y-auto pt-14 md:pt-0">
        <div className="max-w-6xl mx-auto px-4 py-6 md:px-8 md:py-10">{children}</div>
      </main>
    </div>
  );
}
