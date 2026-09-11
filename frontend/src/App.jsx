import { Routes, Route } from 'react-router-dom';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Classes from './pages/Classes';
import Students from './pages/Students';
import Attendance from './pages/Attendance';
import Exams from './pages/Exams';
import Admissions from './pages/Admissions';
import Staff from './pages/Staff';
import TeacherAccess from './pages/TeacherAccess';
import BusFees from './pages/BusFees';
import TransportExpenses from './pages/TransportExpenses';
import Reports from './pages/Reports';
import ProtectedRoute from './components/ProtectedRoute';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
      <Route path="/classes" element={<ProtectedRoute roles={['ADMIN']}><Classes /></ProtectedRoute>} />
      <Route path="/students" element={<ProtectedRoute><Students /></ProtectedRoute>} />
      <Route path="/attendance" element={<ProtectedRoute><Attendance /></ProtectedRoute>} />
      <Route path="/exams" element={<ProtectedRoute><Exams /></ProtectedRoute>} />
      <Route path="/admissions" element={<ProtectedRoute><Admissions /></ProtectedRoute>} />
      <Route path="/staff" element={<ProtectedRoute roles={['ADMIN']}><Staff /></ProtectedRoute>} />
      <Route path="/teacher-access" element={<ProtectedRoute roles={['ADMIN']}><TeacherAccess /></ProtectedRoute>} />
      <Route path="/bus-fees" element={<ProtectedRoute roles={['ADMIN', 'ACCOUNTANT', 'STAFF']}><BusFees /></ProtectedRoute>} />
      <Route path="/transport-expenses" element={<ProtectedRoute roles={['ADMIN', 'ACCOUNTANT']}><TransportExpenses /></ProtectedRoute>} />
      <Route path="/reports" element={<ProtectedRoute><Reports /></ProtectedRoute>} />
    </Routes>
  );
}
