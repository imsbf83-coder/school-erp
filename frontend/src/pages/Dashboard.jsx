import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import client from '../api/client';
import PageHeader from '../components/PageHeader';
import { useAuth } from '../context/AuthContext';

export default function Dashboard() {
  const { user } = useAuth();
  const [stats, setStats] = useState({ students: 0, staff: 0, classes: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [studentsRes, staffRes, classesRes] = await Promise.all([
          client.get('/students', { params: { pageSize: 1 } }),
          client.get('/staff'),
          client.get('/classes'),
        ]);
        setStats({
          students: studentsRes.data.total,
          staff: staffRes.data.length,
          classes: classesRes.data.length,
        });
      } catch (e) {
        // dashboard is best-effort; individual pages surface real errors
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const cards = [
    { label: 'Active Students', value: stats.students, to: '/students', accent: '#2F7D5A' },
    { label: 'Staff Members', value: stats.staff, to: '/staff', accent: '#2E6E8E' },
    { label: 'Classes', value: stats.classes, to: '/students', accent: '#B4903D' },
  ];

  return (
    <div>
      <PageHeader eyebrow="Overview" title={`Welcome back, ${user?.name?.split(' ')[0] || ''}`} />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 mb-10">
        {cards.map((c) => (
          <Link
            key={c.label}
            to={c.to}
            className="bg-white border border-ink/10 rounded-lg p-6 hover:shadow-md transition-shadow"
          >
            <div className="w-2 h-8 rounded-full mb-4" style={{ backgroundColor: c.accent }} />
            <p className="font-display text-4xl text-ink">{loading ? '—' : c.value}</p>
            <p className="text-sm text-slate2 mt-1">{c.label}</p>
          </Link>
        ))}
      </div>

      <div className="bg-white border border-ink/10 rounded-lg p-6">
        <h3 className="font-display text-lg text-ink mb-3">Quick actions</h3>
        <div className="flex flex-wrap gap-3">
          <Link to="/students" className="text-sm px-4 py-2 rounded-md bg-ink text-paper hover:bg-ink-light">
            Add a student
          </Link>
          <Link to="/attendance" className="text-sm px-4 py-2 rounded-md border border-ink/20 hover:bg-paper">
            Mark today's attendance
          </Link>
          <Link to="/exams" className="text-sm px-4 py-2 rounded-md border border-ink/20 hover:bg-paper">
            Enter exam marks
          </Link>
          <Link to="/admissions" className="text-sm px-4 py-2 rounded-md border border-ink/20 hover:bg-paper">
            Process admission / withdrawal
          </Link>
        </div>
      </div>
    </div>
  );
}
