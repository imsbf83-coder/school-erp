import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import Layout from './Layout';

export default function ProtectedRoute({ children, roles }) {
  const { user } = useAuth();

  if (!user) return <Navigate to="/login" replace />;

  if (roles && !roles.includes(user.role)) {
    return (
      <Layout>
        <p className="text-slate2">You don't have permission to view this page.</p>
      </Layout>
    );
  }

  return <Layout>{children}</Layout>;
}
