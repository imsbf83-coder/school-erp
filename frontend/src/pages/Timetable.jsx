import { useState } from 'react';
import PageHeader from '../components/PageHeader';
import { useAuth } from '../context/AuthContext';
import TimetableGrid from './timetable/TimetableGrid';
import TeacherwiseGrid from './timetable/TeacherwiseGrid';
import PeriodSetup from './timetable/PeriodSetup';
import ArrangementPanel from './timetable/ArrangementPanel';
import ArrangementReport from './timetable/ArrangementReport';
import TeacherContacts from './timetable/TeacherContacts';

// Academic year label for the printed heading, e.g. "2026-27". The new year
// starts in April.
function defaultYear() {
  const now = new Date();
  const y = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return `${y}-${String((y + 1) % 100).padStart(2, '0')}`;
}

export default function Timetable() {
  const { user, hasModule } = useAuth();
  // Same rule as the API: ADMIN, or anyone granted the TIMETABLE module.
  const canEdit = user?.role === 'ADMIN' || hasModule('TIMETABLE');
  const [tab, setTab] = useState('class');
  const [year, setYear] = useState(defaultYear());

  const tabs = [
    ['class', 'Class-wise'],
    ['teacher', 'Teacher-wise'],
    ...(canEdit
      ? [
          ['arrange', 'Arrangements'],
          ['report', 'Arrangement report'],
          ['contacts', 'Teachers'],
          ['setup', 'Period setup'],
        ]
      : []),
  ];

  return (
    <div>
      <div className="print:hidden">
        <PageHeader eyebrow="Module 08" title="Timetable" />
        <div className="flex flex-wrap gap-2 mb-6">
          {tabs.map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`text-sm px-4 py-2 rounded-md border ${
                tab === key ? 'bg-ink text-paper border-transparent' : 'border-ink/20 hover:bg-white'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'class' && <TimetableGrid canEdit={canEdit} year={year} onYearChange={setYear} />}
      {tab === 'teacher' && <TeacherwiseGrid year={year} onYearChange={setYear} />}
      {tab === 'arrange' && canEdit && <ArrangementPanel year={year} />}
      {tab === 'report' && canEdit && <ArrangementReport />}
      {tab === 'contacts' && canEdit && <TeacherContacts />}
      {tab === 'setup' && canEdit && <PeriodSetup />}
    </div>
  );
}
