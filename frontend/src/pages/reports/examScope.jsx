// The exam / class / scope pickers shared by the two exam reports.
//
// Both reports answer the same question at different granularity, so they
// take the same scope: one exam, one class, and either the whole class or a
// single section. The API mirrors that — `?classId=` plus an optional
// `&section=` — which is what makes the classwise and class/section-wise
// versions of a report two views of one endpoint.

import { useEffect, useState } from 'react';
import client from '../../api/client';
import { sectionsFor } from '../../utils/sections';

// Which sections of a class sit a given exam: the sections the exam was
// scoped to, or — for a class covered in full — every section that class has.
export function examSectionsFor(exam, classId) {
  if (!exam || !classId) return [];
  const ec = exam.classes.find((c) => String(c.classId) === String(classId));
  if (!ec) return [];
  const scoped = String(ec.sections || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (scoped.length) return scoped;
  return sectionsFor([{ id: ec.classId, sections: ec.class?.sections }], ec.classId);
}

// Holds the pickers' state and keeps it consistent: switching exam resets the
// class, and switching class resets the section, because section A of class 9
// and section A of class 8 are not the same group.
export function useExamScope() {
  const [exams, setExams] = useState([]);
  const [examId, setExamId] = useState('');
  const [classId, setClassId] = useState('');
  const [section, setSection] = useState(''); // '' = whole class

  useEffect(() => {
    client.get('/exams').then((res) => {
      setExams(res.data);
      if (res.data.length) setExamId(String(res.data[0].id));
    });
  }, []);

  const exam = exams.find((e) => String(e.id) === String(examId)) || null;
  const classOptions = exam ? exam.classes.map((ec) => ({ id: ec.classId, name: ec.class?.name })) : [];

  // Default to (and stay on) a class that's actually part of the chosen exam.
  useEffect(() => {
    if (!exam) return;
    const stillThere = classOptions.some((c) => String(c.id) === String(classId));
    if (!stillThere) {
      setClassId(classOptions.length ? String(classOptions[0].id) : '');
      setSection('');
    }
  }, [examId, exams.length]);

  const sectionOptions = examSectionsFor(exam, classId);

  useEffect(() => {
    if (section && !sectionOptions.includes(section)) setSection('');
  }, [classId, sectionOptions.join(',')]);

  function changeExam(id) {
    setExamId(id);
    setClassId('');
    setSection('');
  }

  function changeClass(id) {
    setClassId(id);
    setSection('');
  }

  return {
    exams,
    exam,
    examId,
    changeExam,
    classId,
    changeClass,
    classOptions,
    section,
    setSection,
    sectionOptions,
    className: classOptions.find((c) => String(c.id) === String(classId))?.name || '',
  };
}

export function ExamScopePicker({ scope }) {
  const { exams, examId, changeExam, classId, changeClass, classOptions, section, setSection, sectionOptions } = scope;

  return (
    <div className="flex flex-wrap gap-4 mb-4 items-end print:hidden">
      <div>
        <label className="block text-sm text-slate2 mb-1">Exam</label>
        <select value={examId} onChange={(e) => changeExam(e.target.value)} className="border border-ink/20 rounded-md px-3 py-2 bg-white min-w-[200px]">
          {exams.length === 0 && <option value="">No exams yet</option>}
          {exams.map((ex) => (
            <option key={ex.id} value={ex.id}>
              {ex.name}
              {ex.term ? ` — ${ex.term === 4 ? 'Final Term' : `Term ${ex.term}`}` : ''}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-sm text-slate2 mb-1">Class</label>
        <select value={classId} onChange={(e) => changeClass(e.target.value)} className="border border-ink/20 rounded-md px-3 py-2 bg-white">
          {classOptions.length === 0 && <option value="">—</option>}
          {classOptions.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-sm text-slate2 mb-1">Scope</label>
        <select
          value={section}
          onChange={(e) => setSection(e.target.value)}
          disabled={sectionOptions.length === 0}
          className="border border-ink/20 rounded-md px-3 py-2 bg-white disabled:opacity-50"
        >
          <option value="">Whole class</option>
          {sectionOptions.map((s) => (
            <option key={s} value={s}>Section {s}</option>
          ))}
        </select>
      </div>
    </div>
  );
}

// The data problems the API flags — a blank religion or a missing elective
// group both quietly shrink a student's total, so they're shown rather than
// left to be discovered in a printed sheet.
export function ScopeWarnings({ warnings }) {
  if (!warnings || warnings.length === 0) return null;
  return (
    <div className="mb-4 border border-brass/40 bg-brass/10 rounded-md px-4 py-3 space-y-1">
      {warnings.map((w) => (
        <p key={w.kind} className="text-sm text-ink">
          {w.message}
          {w.names?.length > 0 && (
            <span className="text-slate2"> ({w.names.join(', ')}{w.count > w.names.length ? ', …' : ''})</span>
          )}
        </p>
      ))}
    </div>
  );
}
