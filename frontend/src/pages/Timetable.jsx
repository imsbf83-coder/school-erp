import PageHeader from '../components/PageHeader';
import PeriodSetup from './timetable/PeriodSetup';

// The Timetable module is built in steps. Step 1 (this file) is the period
// setup: the daily bell schedules. The weekly class grid and the teacher view
// get added as tabs next to "Period setup".
export default function Timetable() {
  return (
    <div>
      <PageHeader eyebrow="Module 08" title="Timetable" />
      <PeriodSetup />
    </div>
  );
}
