import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import Layout from './Layout';

// `roles`, if given, is a list of roles that pass unconditionally — exactly
// like before. `moduleKey`, if given, ADDS a second way in: any user
// (regardless of role) who has been granted that module via Staff Access
// also passes. A route can use either, both, or neither — a route with
// neither is open to any logged-in user (matching a backend route that's
// just `requireAuth` with no further gate, e.g. Students/Attendance).
//
// ADMIN always passes regardless of what's configured, since ADMIN is
// unconditionally unrestricted everywhere else in the app too.
export default function ProtectedRoute({ children, roles, moduleKey }) {
  const { user, hasModule } = useAuth();

  if (!user) return <Navigate to="/login" replace />;

  const roleAllowed = user.role === 'ADMIN' || !roles || roles.includes(user.role);
  const modulePermission = moduleKey ? hasModule(moduleKey) : false;
  const allowed = roleAllowed || modulePermission;

  if (!allowed) {
    return (
      <Layout>
        <p className="text-slate2">You don't have permission to view this page.</p>
      </Layout>
    );
  }

  return <Layout>{children}</Layout>;
}
