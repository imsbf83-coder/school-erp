// Examinations — exam creation, marks entry, and the editable grading scale.
//
// An exam now carries a term (1-3 assessment, 4 = final term, which also
// decides promotion), a pass percentage applied to every subject, and per
// subject who sits it: everyone, Muslim / non-Muslim students, or one of the
// two 9-10 elective groups. That last part is why a student's total is over
// only the subjects they actually sit, and why the marks grid greys out the
// cells that don't apply to them.

import { useEffect, useState } from 'react';
import client from '../api/client';
import PageHeader from '../components/PageHeader';
import { sectionsFor, sectionsForMany } from '../utils/sections';
import { useAuth } from '../context/AuthContext';
import GradeScaleEditor from './exams/GradeScaleEditor';
import ImportMarks from './exams/ImportMarks';
import AwardList from './exams/AwardList';

const APPLIES_OPTIONS = [
  { value: 'ALL', label: 'Everyone' },
  { value: 'MUSLIM', label: 'Muslim students' },
  { value: 'NON_MUSLIM', label: 'Non-Muslim students' },
  { value: 'GROUP_COMPUTER', label: 'Computer group' },
  { value: 'GROUP_BIOLOGY', label: 'Biology group' },
];
const APPLIES_SHORT = {
  ALL: '',
  MUSLIM: 'Muslim',
  NON_MUSLIM: 'Non-Muslim',
  GROUP_COMPUTER: 'Computer',
  GROUP_BIOLOGY: 'Biology',
};

const TERM_OPTIONS = [
  { value: '1', label: 'Term 1' },
  { value: '2', label: 'Term 2' },
  { value: '3', label: 'Term 3' },
  { value: '4', label: 'Final Term' },
];

const DEFAULT_PASS_PERCENT = 40;

function round2(n) {
  return Math.round(n * 100) / 100;
}

// Pass marks track the pass % of the maximum until someone types over them —
// `passMarksTouched` is form-only state and is ignored by the API.
function passMarksFor(maxMarks, passPercent) {
  const max = Number(maxMarks) || 0;
  const pct = Number(passPercent);
  return round2((max * (Number.isFinite(pct) ? pct : DEFAULT_PASS_PERCENT)) / 100);
}

function blankSubject(passPercent) {
  return { subjectName: '', appliesTo: 'ALL', gradeOnly: '', maxMarks: 100, passMarks: passMarksFor(100, passPercent), passMarksTouched: false };
}

const emptyForm = {
  name: '',
  academicYear: '2026-2027',
  classIds: [],
  // Per class: which sections sit this exam. A class missing from here, or
  // with an empty list, means the whole class.
  sectionsByClassId: {},
  startDate: '',
  endDate: '',
  term: '1',
  passPercent: DEFAULT_PASS_PERCENT,
  maxFailedSubjects: '',
  minOverallPercent: '',
  subjects: [blankSubject(DEFAULT_PASS_PERCENT)],
};

// "9 (A, B), 8" — spells out which sections of each class an exam covers.
function examScopeLabel(exam) {
  return exam.classes
    .map((ec) => (ec.sections ? `${ec.class.name} (${ec.sections})` : ec.class.name))
    .join(', ');
}

function termLabel(term) {
  if (!term) return '';
  return term === 4 ? 'Final Term' : `Term ${term}`;
}

export default function Exams() {
  const { user } = useAuth();
  const [tab, setTab] = useState('exams');
  const [showForm, setShowForm] = useState(false);

  return (
    <div>
      <PageHeader
        eyebrow="Module 03"
        title="Examinations"
        action={
          tab === 'exams' ? (
            <button onClick={() => setShowForm((v) => !v)} className="text-sm px-4 py-2 rounded-md bg-ink text-paper hover:bg-ink-light">
              {showForm ? 'Cancel' : '+ New exam'}
            </button>
          ) : null
        }
      />

      <div className="flex gap-2 mb-6">
        <TabButton active={tab === 'exams'} onClick={() => setTab('exams')} label="Exams" />
        <TabButton active={tab === 'award'} onClick={() => setTab('award')} label="Award List" />
        <TabButton active={tab === 'scale'} onClick={() => setTab('scale')} label="Grading scale" />
      </div>

      {tab === 'exams' ? (
        <ExamsTab showForm={showForm} setShowForm={setShowForm} />
      ) : tab === 'award' ? (
        <AwardList />
      ) : (
        <GradeScaleEditor canEdit={user?.role === 'ADMIN'} />
      )}
    </div>
  );
}

function TabButton({ active, onClick, label }) {
  return (
    <button
      onClick={onClick}
      className={`text-sm px-4 py-2 rounded-full border transition-colors ${
        active ? 'bg-ink text-paper border-ink' : 'border-ink/20 text-slate2 hover:bg-white'
      }`}
    >
      {label}
    </button>
  );
}

function ExamsTab({ showForm, setShowForm }) {
  const { user } = useAuth();
  const [exams, setExams] = useState([]);
  const [selectedExamId, setSelectedExamId] = useState('');
  const [resultSection, setResultSection] = useState(''); // '' = every section the exam covers
  const [showImport, setShowImport] = useState(false);
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(true);
  const [formError, setFormError] = useState('');
  const [markError, setMarkError] = useState('');
  const [classes, setClasses] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [defaults, setDefaults] = useState(null); // { catalogue, gradeNumbers, mixedRanges }
  // Once a subject row is edited by hand, ticking another class must not wipe
  // the typed-in list, so the pre-fill stops there.
  const [subjectsTouched, setSubjectsTouched] = useState(false);
  // Set while editing an existing exam instead of creating a new one. Classes
  // aren't editable here (see the PUT route's comment), so the class picker
  // is replaced with a read-only summary whenever this is set.
  const [editingExamId, setEditingExamId] = useState(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    loadExams();
    client.get('/classes').then((res) => setClasses(res.data));
  }, []);

  // Closing the form (Cancel, or after a successful save) always drops back
  // to "create new" — an edit in progress shouldn't linger for next time.
  useEffect(() => {
    if (!showForm) {
      setEditingExamId(null);
      setForm(emptyForm);
      setSubjectsTouched(false);
      setFormError('');
    }
  }, [showForm]);

  function startEdit(exam) {
    const sectionsByClassId = {};
    exam.classes.forEach((ec) => {
      if (ec.sections) sectionsByClassId[ec.classId] = ec.sections.split(',');
    });
    setForm({
      name: exam.name,
      academicYear: exam.academicYear || '',
      classIds: exam.classes.map((ec) => ec.classId),
      sectionsByClassId,
      startDate: (exam.startDate || '').slice(0, 10),
      endDate: (exam.endDate || '').slice(0, 10),
      term: exam.term ? String(exam.term) : '1',
      passPercent: exam.passPercent,
      maxFailedSubjects: exam.maxFailedSubjects ?? '',
      minOverallPercent: exam.minOverallPercent ?? '',
      subjects: exam.subjects.map((s) => ({
        examSubjectId: s.id,
        subjectName: s.subjectName,
        appliesTo: s.appliesTo,
        gradeOnly: s.gradeOnly ?? '',
        maxMarks: s.maxMarks,
        passMarks: s.passMarks,
        passMarksTouched: true,
      })),
    });
    setSubjectsTouched(true);
    setFormError('');
    setEditingExamId(exam.id);
    setShowForm(true);
  }

  async function handleDeleteExam(exam) {
    const marksEntered = selectedExamId === String(exam.id) && results
      ? results.rows.reduce((sum, r) => sum + r.subjects.filter((c) => c.appeared).length, 0)
      : null;
    const warning = marksEntered
      ? `This deletes "${exam.name}" and all ${marksEntered} mark(s) already entered for it. This cannot be undone.`
      : `Delete "${exam.name}"? This cannot be undone.`;
    if (!window.confirm(warning)) return;

    setDeleting(true);
    setFormError('');
    try {
      await client.delete(`/exams/${exam.id}`);
      if (String(exam.id) === selectedExamId) {
        setSelectedExamId('');
        setResults(null);
      }
      await loadExams();
    } catch (err) {
      setFormError(err.response?.data?.error || 'Could not delete this exam.');
    } finally {
      setDeleting(false);
    }
  }

  // Switching exam resets the section filter — the new exam may not cover it.
  // Done here rather than in an effect so the results only load once.
  function changeExam(id) {
    setSelectedExamId(id);
    setResultSection('');
    setMarkError('');
  }

  useEffect(() => {
    if (selectedExamId) loadResults(selectedExamId);
  }, [selectedExamId, resultSection]);

  // Pre-fill the subject list for the ticked classes: 9 subjects for 6-8, 12
  // for 9-10, each already carrying who sits it.
  useEffect(() => {
    if (!showForm || form.classIds.length === 0) {
      setDefaults(null);
      return;
    }
    let cancelled = false;
    client
      .get('/exams/subject-defaults', { params: { classIds: form.classIds.join(',') } })
      .then((res) => {
        if (cancelled) return;
        setDefaults(res.data);
        if (subjectsTouched || !res.data.subjects?.length) return;
        setForm((f) => ({
          ...f,
          subjects: res.data.subjects.map((s) => ({
            subjectName: s.subjectName,
            appliesTo: s.appliesTo,
            gradeOnly: s.gradeOnly ?? '',
            maxMarks: 100,
            passMarks: passMarksFor(100, f.passPercent),
            passMarksTouched: false,
          })),
        }));
      })
      .catch(() => {
        if (!cancelled) setDefaults(null);
      });
    return () => {
      cancelled = true;
    };
  }, [showForm, form.classIds.join(','), subjectsTouched]);

  async function loadExams() {
    setLoading(true);
    try {
      const { data } = await client.get('/exams');
      setExams(data);
      if (data.length && !selectedExamId) setSelectedExamId(String(data[0].id));
    } finally {
      setLoading(false);
    }
  }

  async function loadResults(id) {
    const { data } = await client.get(`/exams/${id}/results`, {
      params: resultSection ? { section: resultSection } : {},
    });
    setResults(data);
  }

  function updateSubject(idx, field, value) {
    setSubjectsTouched(true);
    setForm((f) => {
      const subjects = [...f.subjects];
      const row = { ...subjects[idx], [field]: value };
      if (field === 'passMarks') row.passMarksTouched = true;
      if (field === 'maxMarks' && !row.passMarksTouched) row.passMarks = passMarksFor(value, f.passPercent);
      subjects[idx] = row;
      return { ...f, subjects };
    });
  }

  // Changing the pass % re-derives every pass-marks figure that hasn't been
  // typed over by hand.
  function changePassPercent(value) {
    setForm((f) => ({
      ...f,
      passPercent: value,
      subjects: f.subjects.map((s) => (s.passMarksTouched ? s : { ...s, passMarks: passMarksFor(s.maxMarks, value) })),
    }));
  }

  function addSubjectRow() {
    setSubjectsTouched(true);
    setForm((f) => ({ ...f, subjects: [...f.subjects, blankSubject(f.passPercent)] }));
  }

  function removeSubjectRow(idx) {
    setSubjectsTouched(true);
    setForm((f) => ({ ...f, subjects: f.subjects.filter((_, i) => i !== idx) }));
  }

  function toggleClass(classId) {
    setForm((f) => {
      const has = f.classIds.includes(classId);
      // Un-ticking a class drops its section picks too, so they can't be
      // submitted for a class that's no longer part of the exam.
      const sectionsByClassId = { ...f.sectionsByClassId };
      if (has) delete sectionsByClassId[classId];
      return {
        ...f,
        classIds: has ? f.classIds.filter((id) => id !== classId) : [...f.classIds, classId],
        sectionsByClassId,
      };
    });
  }

  function toggleSection(classId, section) {
    setForm((f) => {
      const current = f.sectionsByClassId[classId] || [];
      const next = current.includes(section) ? current.filter((s) => s !== section) : [...current, section];
      const sectionsByClassId = { ...f.sectionsByClassId };
      if (next.length) sectionsByClassId[classId] = next;
      else delete sectionsByClassId[classId]; // none ticked = whole class
      return { ...f, sectionsByClassId };
    });
  }

  async function handleSaveExam(e) {
    e.preventDefault();
    setFormError('');
    const isFinal = form.term === '4';
    const payload = {
      ...form,
      term: Number(form.term),
      passPercent: Number(form.passPercent),
      maxFailedSubjects: isFinal && form.maxFailedSubjects !== '' ? Number(form.maxFailedSubjects) : null,
      minOverallPercent: isFinal && form.minOverallPercent !== '' ? Number(form.minOverallPercent) : null,
    };
    try {
      if (editingExamId) {
        await client.put(`/exams/${editingExamId}`, payload);
      } else {
        await client.post('/exams', payload);
      }
      const savedId = editingExamId;
      setShowForm(false);
      await loadExams();
      if (savedId) await loadResults(savedId);
    } catch (err) {
      setFormError(err.response?.data?.error || `Could not ${editingExamId ? 'update' : 'create'} this exam.`);
    }
  }

  // A blank cell deletes the mark, which is how a student is marked absent —
  // "appeared" everywhere else means a mark exists. Reloading afterwards is
  // what refreshes the total, % and grade columns.
  async function saveMark(studentId, examSubjectId, marksObtained) {
    setMarkError('');
    const blank = String(marksObtained).trim() === '';
    await client.post('/exams/marks', {
      studentId,
      examSubjectId,
      marksObtained: blank ? '' : Number(marksObtained),
    });
    await loadResults(selectedExamId);
  }

  async function handleMarkSave(studentId, examSubjectId, value) {
    try {
      await saveMark(studentId, examSubjectId, value);
      return true;
    } catch (err) {
      setMarkError(err.response?.data?.error || 'Could not save that mark.');
      return false;
    }
  }

  // Sections offered on the result sheet: the ones each class is scoped to,
  // or — for a class covered in full — every section that class has.
  const resultSectionOptions = results
    ? sectionsForMany(
        results.exam.classes.map((ec) => ({
          id: ec.classId,
          sections: ec.sections || ec.class?.sections,
        })),
        []
      )
    : [];

  const isFinalTerm = form.term === '4';
  const showSectionColumn = !resultSection && resultSectionOptions.length > 0;
  const leadingColumns = 3 + (results && results.exam.classes.length > 1 ? 1 : 0) + (showSectionColumn ? 1 : 0);

  return (
    <div>
      {showForm && (
        <form onSubmit={handleSaveExam} className="bg-white border border-ink/10 rounded-lg p-6 mb-8">
          {formError && <p className="text-absent text-sm mb-4">{formError}</p>}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm text-slate2 mb-1">Exam name</label>
              <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full border border-ink/20 rounded-md px-3 py-2" placeholder="Mid-Term Exam" />
            </div>
            <div>
              <label className="block text-sm text-slate2 mb-1">Classes &amp; sections</label>
              {editingExamId ? (
                <div className="w-full border border-ink/20 rounded-md px-3 py-2 bg-ink/5 text-sm text-slate2">
                  {classes
                    .filter((c) => form.classIds.includes(c.id))
                    .map((c) => {
                      const picked = form.sectionsByClassId[c.id] || [];
                      return picked.length ? `${c.name} (${picked.join(', ')})` : c.name;
                    })
                    .join(', ') || '—'}
                  <p className="text-xs text-slate2 mt-1 italic">
                    Classes can't be changed on an existing exam — delete and recreate it if the class scope itself needs to change.
                  </p>
                </div>
              ) : (
                <div className="w-full border border-ink/20 rounded-md px-3 py-2 bg-white max-h-40 overflow-y-auto space-y-1">
                  {classes.length === 0 ? (
                    <p className="text-sm text-slate2">No classes yet.</p>
                  ) : (
                    classes.map((c) => {
                      const ticked = form.classIds.includes(c.id);
                      const options = sectionsFor(classes, c.id);
                      const picked = form.sectionsByClassId[c.id] || [];
                      return (
                        <div key={c.id}>
                          <label className="flex items-center gap-2 text-sm">
                            <input type="checkbox" checked={ticked} onChange={() => toggleClass(c.id)} />
                            {c.name}
                          </label>
                          {ticked && options.length > 0 && (
                            <div className="pl-6 pt-1 pb-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                              {options.map((s) => (
                                <label key={s} className="flex items-center gap-1.5 text-xs text-slate2">
                                  <input
                                    type="checkbox"
                                    checked={picked.includes(s)}
                                    onChange={() => toggleSection(c.id, s)}
                                  />
                                  {s}
                                </label>
                              ))}
                              <span className="text-xs text-slate2 italic">
                                {picked.length === 0 ? 'whole class' : `section ${picked.join(', ')} only`}
                              </span>
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              )}
              {!editingExamId && form.classIds.length === 0 && (
                <p className="text-xs text-slate2 mt-1">Select at least one class — pick several to run one exam across all of them. Leave a class's sections unticked to include the whole class.</p>
              )}
            </div>
            <div>
              <label className="block text-sm text-slate2 mb-1">Start date</label>
              <input required type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} className="w-full border border-ink/20 rounded-md px-3 py-2" />
            </div>
            <div>
              <label className="block text-sm text-slate2 mb-1">End date</label>
              <input required type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} className="w-full border border-ink/20 rounded-md px-3 py-2" />
            </div>
            <div>
              <label className="block text-sm text-slate2 mb-1">Term</label>
              <select value={form.term} onChange={(e) => setForm({ ...form, term: e.target.value })} className="w-full border border-ink/20 rounded-md px-3 py-2 bg-white">
                {TERM_OPTIONS.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm text-slate2 mb-1">Pass % (every subject)</label>
              <input type="number" step="0.01" min="0" max="100" value={form.passPercent} onChange={(e) => changePassPercent(e.target.value)} className="w-full border border-ink/20 rounded-md px-3 py-2" />
            </div>
          </div>

          {isFinalTerm && (
            <div className="border border-brass/40 bg-brass/10 rounded-md px-4 py-3 mb-4">
              <p className="text-sm font-medium text-ink mb-2">Promotion rule for the final term</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-slate2 mb-1">Max failed subjects allowed</label>
                  <input type="number" min="0" value={form.maxFailedSubjects} onChange={(e) => setForm({ ...form, maxFailedSubjects: e.target.value })} className="w-full border border-ink/20 rounded-md px-3 py-2" placeholder="2" />
                </div>
                <div>
                  <label className="block text-sm text-slate2 mb-1">Minimum overall %</label>
                  <input type="number" step="0.01" min="0" max="100" value={form.minOverallPercent} onChange={(e) => setForm({ ...form, minOverallPercent: e.target.value })} className="w-full border border-ink/20 rounded-md px-3 py-2" placeholder="40" />
                </div>
              </div>
              <p className="text-xs text-slate2 mt-2">
                A student who fails nothing passes outright. Otherwise both conditions must hold to be promoted — up to
                this many failed subjects <em>and</em> at least this overall %. Leave either blank and no status is
                calculated for this exam.
              </p>
            </div>
          )}

          <p className="text-sm font-medium text-ink mb-1">Subjects</p>
          {defaults?.catalogue && !subjectsTouched && (
            <p className="text-xs text-slate2 mb-2">
              Pre-filled with the standard subjects for {defaults.catalogue}. Edit, remove or add rows as needed.
            </p>
          )}
          {defaults?.mixedRanges && (
            <p className="text-xs text-brass-dark mb-2">
              The classes you picked span both 6-8 and 9-10, which use different subject sets — one exam per range is
              recommended. The list below is pre-filled from the lower range.
            </p>
          )}
          <div className="hidden sm:grid grid-cols-12 gap-3 text-xs text-slate2 mb-1">
            <span className="col-span-3">Subject name</span>
            <span className="col-span-3">Sat by</span>
            <span className="col-span-1" title="Restrict to one grade, e.g. PST for grade 10 only. Leave blank for every grade in this exam.">Grade</span>
            <span className="col-span-2">Max marks</span>
            <span className="col-span-2">Pass marks</span>
          </div>
          {form.subjects.map((s, idx) => (
            <div key={idx} className="grid grid-cols-1 sm:grid-cols-12 gap-3 mb-2 items-center">
              <input required placeholder="Subject name" value={s.subjectName} onChange={(e) => updateSubject(idx, 'subjectName', e.target.value)} className="sm:col-span-3 border border-ink/20 rounded-md px-3 py-2" />
              <select value={s.appliesTo} onChange={(e) => updateSubject(idx, 'appliesTo', e.target.value)} className="sm:col-span-3 border border-ink/20 rounded-md px-3 py-2 bg-white">
                {APPLIES_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <input
                type="number"
                min="1"
                max="12"
                placeholder="Any"
                value={s.gradeOnly ?? ''}
                onChange={(e) => updateSubject(idx, 'gradeOnly', e.target.value)}
                title="Restrict to one grade, e.g. PST for grade 10 only. Leave blank for every grade in this exam."
                className="sm:col-span-1 border border-ink/20 rounded-md px-2 py-2"
              />
              <input type="number" min="1" placeholder="Max marks" value={s.maxMarks} onChange={(e) => updateSubject(idx, 'maxMarks', Number(e.target.value))} className="sm:col-span-2 border border-ink/20 rounded-md px-3 py-2" />
              <input type="number" step="0.01" placeholder="Pass marks" value={s.passMarks} onChange={(e) => updateSubject(idx, 'passMarks', Number(e.target.value))} className="sm:col-span-2 border border-ink/20 rounded-md px-3 py-2" />
              <button
                type="button"
                onClick={() => removeSubjectRow(idx)}
                disabled={form.subjects.length === 1}
                className="sm:col-span-1 text-xs text-absent hover:underline disabled:opacity-30 disabled:no-underline"
              >
                Remove
              </button>
            </div>
          ))}
          <button type="button" onClick={addSubjectRow} className="text-sm text-brass-dark hover:underline mb-2">+ Add subject</button>
          <p className="text-xs text-slate2 mb-4">
            Pass marks follow {form.passPercent}% of the maximum until you type over them. Pass or fail is decided on the
            percentage itself, so the figure here is for the printed sheet.
          </p>

          <div>
            <button
              type="submit"
              disabled={form.classIds.length === 0}
              className="text-sm px-4 py-2 rounded-md bg-present text-white hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {editingExamId ? 'Save changes' : 'Create exam'}
            </button>
          </div>
        </form>
      )}

      {!loading && exams.length > 0 && (
        <div className="flex flex-wrap gap-4 mb-6 items-end">
          <div>
            <label className="block text-sm text-slate2 mb-1">Viewing results for</label>
            <select value={selectedExamId} onChange={(e) => changeExam(e.target.value)} className="border border-ink/20 rounded-md px-3 py-2 bg-white">
              {exams.map((ex) => (
                <option key={ex.id} value={ex.id}>
                  {ex.name}{ex.term ? ` — ${termLabel(ex.term)}` : ''} — {examScopeLabel(ex)}
                </option>
              ))}
            </select>
          </div>
          {resultSectionOptions.length > 0 && (
            <div>
              <label className="block text-sm text-slate2 mb-1">Section</label>
              <select
                value={resultSection}
                onChange={(e) => setResultSection(e.target.value)}
                className="border border-ink/20 rounded-md px-3 py-2 bg-white"
              >
                <option value="">All sections in this exam</option>
                {resultSectionOptions.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
          )}
          {results && (
            <>
              <button
                type="button"
                onClick={() => startEdit(results.exam)}
                className="text-sm px-4 py-2 rounded-md border border-ink/20 bg-white hover:bg-paper"
              >
                Edit exam
              </button>
              {user?.role === 'ADMIN' && (
                <button
                  type="button"
                  disabled={deleting}
                  onClick={() => handleDeleteExam(results.exam)}
                  className="text-sm px-4 py-2 rounded-md border border-absent/40 text-absent bg-white hover:bg-absent/5 disabled:opacity-40"
                >
                  {deleting ? 'Deleting…' : 'Delete exam'}
                </button>
              )}
              <button
                type="button"
                onClick={() => setShowImport((v) => !v)}
                className="text-sm px-4 py-2 rounded-md border border-ink/20 bg-white hover:bg-paper"
              >
                {showImport ? 'Hide import' : 'Import marks from a sheet'}
              </button>
            </>
          )}
        </div>
      )}

      {showImport && results && (
        <ImportMarks
          exam={results.exam}
          rows={results.rows}
          section={resultSection}
          onImported={() => loadResults(selectedExamId)}
        />
      )}

      {markError && <p className="text-absent text-sm mb-4">{markError}</p>}

      {results?.warnings?.length > 0 && (
        <div className="mb-4 border border-brass/40 bg-brass/10 rounded-md px-4 py-3 space-y-1">
          {results.warnings.map((w) => (
            <p key={w.kind} className="text-sm text-ink">
              {w.message}
              {w.names?.length > 0 && (
                <span className="text-slate2"> ({w.names.join(', ')}{w.count > w.names.length ? ', …' : ''})</span>
              )}
            </p>
          ))}
        </div>
      )}

      {results && (
        <div className="bg-white border border-ink/10 rounded-lg overflow-x-auto">
          <table className="register-table w-full text-sm">
            <thead>
              <tr className="border-b border-ink/10 text-left">
                <th className="px-4 py-3">Admission No</th>
                <th className="px-4 py-3">Roll</th>
                <th className="px-4 py-3">Name</th>
                {results.exam.classes.length > 1 && <th className="px-4 py-3">Class</th>}
                {showSectionColumn && <th className="px-4 py-3">Section</th>}
                {results.exam.subjects.map((sub) => (
                  <th key={sub.id} className="px-3 py-3 text-center">
                    {sub.subjectName}
                    <span className="block font-normal text-slate2 text-xs">
                      /{sub.maxMarks}
                      {APPLIES_SHORT[sub.appliesTo] ? ` · ${APPLIES_SHORT[sub.appliesTo]}` : ''}
                      {sub.gradeOnly ? ` · Grade ${sub.gradeOnly}` : ''}
                    </span>
                  </th>
                ))}
                <th className="px-3 py-3 border-l border-ink/10">Obt.</th>
                <th className="px-3 py-3">Total</th>
                <th className="px-3 py-3">%</th>
                <th className="px-3 py-3">Grade</th>
              </tr>
            </thead>
            <tbody>
              {results.rows.length === 0 && (
                <tr>
                  <td className="px-4 py-6 text-slate2" colSpan={leadingColumns + results.exam.subjects.length + 4}>
                    No students in this exam's{resultSection ? ` section ${resultSection}` : ''} scope.
                  </td>
                </tr>
              )}
              {results.rows.map((row) => (
                <tr key={row.studentId} className={`border-b border-ink/5 last:border-0 ${row.isFail ? 'text-absent' : ''}`}>
                  <td className="px-4 py-3 font-mono text-xs">{row.admissionNumber || '—'}</td>
                  <td className="px-4 py-3 font-mono text-xs">{row.rollNumber || '—'}</td>
                  <td className="px-4 py-3 whitespace-nowrap">{row.name}</td>
                  {results.exam.classes.length > 1 && <td className="px-4 py-3 text-slate2">{row.className}</td>}
                  {showSectionColumn && <td className="px-4 py-3 text-slate2">{row.section || '—'}</td>}
                  {row.subjects.map((cell) => (
                    <td key={cell.examSubjectId} className="px-3 py-2 text-center">
                      {cell.applicable ? (
                        <MarkCell
                          cell={cell}
                          onSave={(value) => handleMarkSave(row.studentId, cell.examSubjectId, value)}
                        />
                      ) : (
                        <span className="text-slate2" title="This student does not sit this subject">—</span>
                      )}
                    </td>
                  ))}
                  <td className="px-3 py-3 font-medium border-l border-ink/10">{row.obtained}</td>
                  <td className="px-3 py-3 text-slate2">{row.totalMarks}</td>
                  <td className="px-3 py-3">{row.overallPercent === null ? '—' : `${row.overallPercent}%`}</td>
                  <td className="px-3 py-3 font-medium">{row.overallGrade || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {results && results.rows.length > 0 && (
        <p className="text-xs text-slate2 mt-2">
          A dash instead of a box means the student doesn't sit that subject, and their total is over only the subjects
          they do. Clearing a box marks the student absent for that subject — absent is neither a pass nor a fail.
          {results.exam.passPercent != null && ` Pass mark is ${results.exam.passPercent}% of each subject's maximum.`}
        </p>
      )}

      {!loading && exams.length === 0 && (
        <p className="text-slate2 text-sm">No exams yet. Create one to start entering marks.</p>
      )}
    </div>
  );
}

// One marks box. Kept as its own component so a rejected mark (above the
// maximum, or a subject the student doesn't sit) can be rolled back to the
// stored value without re-rendering the whole sheet.
function MarkCell({ cell, onSave }) {
  const stored = cell.marks === null || cell.marks === undefined ? '' : String(cell.marks);
  const [value, setValue] = useState(stored);

  useEffect(() => {
    setValue(stored);
  }, [stored]);

  async function commit() {
    if (value.trim() === stored.trim()) return;
    const ok = await onSave(value);
    if (!ok) setValue(stored);
  }

  return (
    <input
      type="number"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
      }}
      className={`w-16 border rounded-md px-2 py-1 text-sm text-center ${
        cell.appeared && !cell.passed ? 'border-absent/60 text-absent' : 'border-ink/20'
      }`}
      max={cell.maxMarks}
      min={0}
      title={cell.appeared ? `${cell.percent}% · ${cell.grade || ''}` : 'Blank = absent'}
    />
  );
}
