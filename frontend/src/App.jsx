import { Routes, Route } from 'react-router-dom';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Classes from './pages/Classes';
import Students from './pages/Students';
import Attendance from './pages/Attendance';
import Exams from './pages/Exams';
import Admissions from './pages/Admissions';
import Staff from './pages/Staff';
import BusFees from './pages/BusFees';
import BusReports from './pages/BusReports';
import TransportExpenses from './pages/TransportExpenses';
import Reports from './pages/Reports';
import Timetable from './pages/Timetable';
import ProtectedRoute from './components/ProtectedRoute';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
      <Route path="/classes" element={<ProtectedRoute roles={['ADMIN']}><Classes /></ProtectedRoute>} />
      <Route path="/students" element={<ProtectedRoute><Students /></ProtectedRoute>} />
      <Route path="/attendance" element={<ProtectedRoute><Attendance /></ProtectedRoute>} />
      {/* Matches backend/src/routes/exams.js: ADMIN and TEACHER always pass;
          anyone else needs the EXAMS module (e.g. an Exam Incharge account). */}
      <Route path="/exams" element={<ProtectedRoute roles={['ADMIN', 'TEACHER']} moduleKey="EXAMS"><Exams /></ProtectedRoute>} />
      {/* Matches backend/src/routes/admissions.js: ADMIN always passes;
          everyone else — including TEACHER — needs the ADMISSIONS module. */}
      <Route path="/admissions" element={<ProtectedRoute roles={['ADMIN']} moduleKey="ADMISSIONS"><Admissions /></ProtectedRoute>} />
      {/* Staff module was previously ADMIN-only; now also opens for anyone
          granted the STAFF module (e.g. a Coordinator handling HR tasks). */}
      <Route path="/staff" element={<ProtectedRoute roles={['ADMIN']} moduleKey="STAFF"><Staff /></ProtectedRoute>} />
      <Route path="/bus-fees" element={<ProtectedRoute roles={['ADMIN', 'ACCOUNTANT', 'STAFF']} moduleKey="BUS"><BusFees /></ProtectedRoute>} />
      <Route path="/bus-reports" element={<ProtectedRoute roles={['ADMIN', 'ACCOUNTANT', 'STAFF']} moduleKey="BUS"><BusReports /></ProtectedRoute>} />
      <Route path="/transport-expenses" element={<ProtectedRoute roles={['ADMIN', 'ACCOUNTANT']} moduleKey="BUS"><TransportExpenses /></ProtectedRoute>} />
      <Route path="/timetable" element={<ProtectedRoute roles={['ADMIN']} moduleKey="TIMETABLE"><Timetable /></ProtectedRoute>} />
      <Route path="/reports" element={<ProtectedRoute><Reports /></ProtectedRoute>} />
    </Routes>
  );
}
