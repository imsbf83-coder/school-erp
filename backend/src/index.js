require('dotenv').config();
const express = require('express');
const cors = require('cors');

const authRoutes = require('./routes/auth');
const studentRoutes = require('./routes/students');
const classRoutes = require('./routes/classes');
const admissionRoutes = require('./routes/admissions');
const attendanceRoutes = require('./routes/attendance');
const holidayRoutes = require('./routes/holidays');
const examRoutes = require('./routes/exams');
const gradeScaleRoutes = require('./routes/gradeScales');
const staffRoutes = require('./routes/staff');
const busRoutes = require('./routes/bus');
const staffAccessRoutes = require('./routes/staffAccess');
const meRoutes = require('./routes/me');

const app = express();

// Parse CORS_ORIGIN into a list of allowed origins. Falls back to allowing
// all origins if the variable is missing or empty, rather than silently
// producing an array with one blank entry that matches nothing.
const rawOrigins = (process.env.CORS_ORIGIN || '').split(',').map((o) => o.trim()).filter(Boolean);
app.use(cors({ origin: rawOrigins.length ? rawOrigins : '*' }));
app.use(express.json());

app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

app.use('/api/auth', authRoutes);
app.use('/api/students', studentRoutes);
app.use('/api/classes', classRoutes);
app.use('/api/admissions', admissionRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/holidays', holidayRoutes);
app.use('/api/exams', examRoutes);
app.use('/api/grade-scales', gradeScaleRoutes);
app.use('/api/staff', staffRoutes);
app.use('/api/bus', busRoutes);
app.use('/api/staff-access', staffAccessRoutes);
app.use('/api/me', meRoutes);

// 404 handler
app.use((req, res) => res.status(404).json({ error: 'Not found' }));

// Central error handler
app.use((err, req, res, next) => {
  console.error(err);
  if (err.code === 'P2025') {
    return res.status(404).json({ error: 'Record not found' });
  }
  if (err.code === 'P2003') {
    return res.status(409).json({ error: 'Cannot delete: other records still reference this item.' });
  }
  res.status(500).json({ error: 'Something went wrong on the server' });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`School ERP API running on port ${PORT}`));
