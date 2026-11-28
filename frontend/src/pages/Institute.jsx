import { useEffect, useRef, useState } from 'react';
import client from '../api/client';
import PageHeader from '../components/PageHeader';
import printElement from './timetable/printElement';
import { refreshInstitute, useSchoolInfo } from '../context/useSchoolInfo';

// Institute Data: the school's own profile, laid out like the FEMIS school
// record. Three sections (Basic Information, Contact Information, School
// Management Committee) plus the logo and principal's signature used on
// printouts. Drop-down boxes are suggestions only: any value can be typed.

const BPS = Array.from({ length: 22 }, (_, i) => `BPS-${i + 1}`);

const OPTIONS = {
  status: ['Functional', 'Non-functional', 'Closed'],
  institutionType: ['Schools', 'Colleges'],
  educationSector: ['Urban 1', 'Urban 2', 'Rural'],
  addressType: ['Sector', 'Housing Society', 'Village', 'Others'],
  designatedFor: ['Boys', 'Girls', 'Co-education'],
  academicLevel: ['Primary', 'Middle', 'Secondary', 'Higher Secondary'],
  academicLevelClasses: ['I - V', 'I - VIII', 'VI - VIII', 'VI - X', 'IX - X', 'XI - XII'],
  medium: ['English', 'Urdu'],
  workingShift: ['Morning', 'Evening'],
  buildingOwnership: ['Govt Building', 'Rented Building', 'Donated Building', 'Others'],
  hoiBps: BPS,
  postingCategory: ['Permanent', 'Acting Charge', 'Temporary'],
  meetingType: ['Annual Planning Meeting', 'Quarterly Meeting', 'Monthly Meeting', 'Budget Meeting', 'Emergency Meeting', 'Other'],
  memberType: ['Chairman', 'Vice Chairman', 'President', 'Secretary', 'Member', 'Member Technical', 'Finance Secretary'],
  gender: ['Male', 'Female'],
};

const BASIC = [
  { key: 'status', label: 'Status', req: true },
  { key: 'name', label: 'Institution name', req: true },
  { key: 'shortName', label: 'Short name / abbreviated', req: true },
  { key: 'emisCode', label: 'EMIS code', req: true },
  { key: 'nisNumber', label: 'Institution NIS no.' },
  { key: 'institutionType', label: 'Institution type', req: true },
  { key: 'educationSector', label: 'Education sector', req: true },
  { key: 'addressType', label: 'Address type', req: true },
  { key: 'sector', label: 'Sector', req: true },
  { key: 'address', label: 'Address', wide: true },
  { key: 'latitude', label: 'Latitude', type: 'number', step: 'any' },
  { key: 'longitude', label: 'Longitude', type: 'number', step: 'any' },
  { key: 'establishedYear', label: 'Established year', type: 'number' },
  { key: 'designatedFor', label: 'Designated for', req: true },
  { key: 'academicLevel', label: 'Academic level (highest)', req: true },
  { key: 'academicLevelClasses', label: 'Academic level classes', req: true },
  { key: 'medium', label: 'Medium', req: true },
  { key: 'workingShift', label: 'Working shift', req: true },
  { key: 'buildingOwnership', label: 'Building ownership', req: true },
];

// Contact Information is one section with three groups
const CONTACT_GROUPS = [
  {
    title: 'Administrator',
    hint: 'The head of institution (HOI).',
    fields: [
      { key: 'hoiName', label: 'Name of HOI', req: true },
      { key: 'hoiBps', label: 'BPS', req: true },
    ],
  },
  {
    title: 'Principal',
    fields: [
      { key: 'principalPhoneRes', label: 'Phone # (Res)', type: 'tel', placeholder: 'e.g. 051-0000000' },
      { key: 'principalMobile', label: 'Mobile phone (WhatsApp) #', req: true, type: 'tel' },
      { key: 'hoiPostingDate', label: 'Date of posting as HOI in present institution', req: true, type: 'date' },
      { key: 'postingCategory', label: 'Posting category', req: true },
    ],
  },
  {
    title: 'Institute',
    fields: [
      { key: 'phone1', label: 'Phone # 1', req: true, type: 'tel' },
      { key: 'phone2', label: 'Phone # 2', req: true, type: 'tel' },
      { key: 'fax', label: 'Fax number', placeholder: 'e.g. +92-XX-XXXXXXX' },
      { key: 'email', label: 'E-mail', req: true, type: 'email' },
      { key: 'webUrl', label: 'Web URL', placeholder: 'https://www.school.edu.pk' },
    ],
  },
];

const EMPTY_MEMBER = { memberType: '', name: '', contact: '', gender: 'Male' };
const EMPTY_MEETING = { meetingType: '', meetingDate: '', meetingTime: '', venue: '', minutesIssued: false };

function Field({ f, value, onChange }) {
  const listId = OPTIONS[f.key] ? `inst-${f.key}` : undefined;
  return (
    <div className={f.wide ? 'sm:col-span-2' : ''}>
      <label className="block text-sm text-slate2 mb-1">
        {f.label}
        {f.req && <span className="text-absent"> *</span>}
      </label>
      <input
        type={f.type || 'text'}
        step={f.step}
        list={listId}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder={f.placeholder}
        className="w-full border border-ink/20 rounded-md px-3 py-2 bg-white text-sm"
      />
      {listId && (
        <datalist id={listId}>
          {OPTIONS[f.key].map((o) => <option key={o} value={o} />)}
        </datalist>
      )}
    </div>
  );
}

function Section({ title, hint, children }) {
  return (
    <section className="bg-white border border-ink/10 rounded-lg p-4 sm:p-6 mb-6">
      <h2 className="font-display text-xl text-ink">{title}</h2>
      {hint && <p className="text-sm text-slate2 mt-0.5 mb-4">{hint}</p>}
      {!hint && <div className="mb-4" />}
      {children}
    </section>
  );
}

function YesNo({ label, value, onChange }) {
  return (
    <div>
      <p className="text-sm text-slate2 mb-1">
        {label}
        <span className="text-absent"> *</span>
      </p>
      <div className="flex gap-3">
        {[[true, 'Yes'], [false, 'No']].map(([v, text]) => (
          <button
            type="button"
            key={text}
            onClick={() => onChange(v)}
            className={`text-sm px-5 py-2 rounded-md border min-w-[5rem] ${
              value === v ? 'bg-ink text-paper border-transparent' : 'border-ink/20 text-slate2 hover:bg-paper'
            }`}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

// ---- images: shrunk in the browser so they stay small ----
function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file is not an image that can be read.')); };
    img.src = url;
  });
}

async function imageToDataUrl(file, maxDim, maxBytes) {
  const img = await loadImage(file);
  let scale = Math.min(1, maxDim / Math.max(img.width, img.height));
  for (let i = 0; i < 6; i += 1) {
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d').drawImage(img, 0, 0, w, h);
    const url = canvas.toDataURL('image/png');
    if (Math.floor(((url.length - 22) * 3) / 4) <= maxBytes) return url;
    scale *= 0.75;
  }
  throw new Error('This image is too detailed to shrink enough. Try a smaller image.');
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error('Could not read that file.'));
    r.readAsDataURL(file);
  });
}

const kb = (n) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

function FileBox({ kind, label, help, accept, meta, preview, busy, onPick, onRemove, onDownload }) {
  const ref = useRef(null);
  return (
    <div className="border border-ink/10 rounded-md p-3">
      <p className="text-sm font-medium text-ink">{label}</p>
      <p className="text-xs text-slate2 mb-2">{help}</p>
      {preview && <img src={preview} alt={label} className="h-20 max-w-[12rem] object-contain border border-ink/10 rounded bg-white mb-2" />}
      {meta ? (
        <p className="text-xs text-slate2 mb-2">
          {meta.fileName} · {kb(meta.size)}
        </p>
      ) : (
        <p className="text-xs text-slate2 mb-2">Nothing uploaded.</p>
      )}
      <input ref={ref} type="file" accept={accept} className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onPick(kind, f); }} />
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={() => ref.current?.click()} className="text-sm px-3 py-1.5 rounded-md border border-ink/20 hover:bg-paper disabled:opacity-50">
          {busy ? 'Uploading…' : meta ? 'Replace' : 'Choose file'}
        </button>
        {meta && onDownload && (
          <button type="button" onClick={() => onDownload(kind)} className="text-sm px-3 py-1.5 rounded-md border border-ink/20 hover:bg-paper">View / download</button>
        )}
        {meta && (
          <button type="button" onClick={() => onRemove(kind)} className="text-sm px-3 py-1.5 rounded-md border border-ink/20 text-absent hover:bg-paper">Remove</button>
        )}
      </div>
    </div>
  );
}

export default function Institute() {
  const school = useSchoolInfo(); // current logo / signature previews
  const [fields, setFields] = useState(null);
  const [members, setMembers] = useState([]);
  const [meetings, setMeetings] = useState([]);
  const [files, setFiles] = useState({});
  const [saved, setSaved] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busyKind, setBusyKind] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const printRef = useRef(null);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await client.get('/institute');
        setFields(data.fields);
        setMembers(data.members);
        setMeetings(data.meetings || []);
        setFiles(data.files || {});
        setSaved(data.saved);
      } catch (err) {
        setError(err.response?.data?.error || 'Could not load the institute data.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const set = (key) => (value) => setFields((f) => ({ ...f, [key]: value }));
  const setMember = (i, patch) => setMembers((list) => list.map((m, idx) => (idx === i ? { ...m, ...patch } : m)));
  const setMeeting = (i, patch) => setMeetings((list) => list.map((m, idx) => (idx === i ? { ...m, ...patch } : m)));

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    setNotice('');
    try {
      await client.put('/institute', { fields, members, meetings });
      setSaved(true);
      setNotice('Institute data saved.');
      await refreshInstitute();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not save.');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {
      setSaving(false);
    }
  }

  async function pickFile(kind, file) {
    setBusyKind(kind);
    setError('');
    setNotice('');
    try {
      let dataUrl;
      if (kind === 'logo') dataUrl = await imageToDataUrl(file, 400, 250 * 1024);
      else if (kind === 'signature') dataUrl = await imageToDataUrl(file, 600, 250 * 1024);
      else dataUrl = await readFileAsDataUrl(file);
      const { data } = await client.put(`/institute/files/${kind}`, { fileName: file.name, dataUrl });
      setFiles((f) => ({ ...f, [kind]: { fileName: file.name, size: data.size } }));
      setNotice('File uploaded.');
      if (kind !== 'ownership') await refreshInstitute();
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Could not upload the file.');
    } finally {
      setBusyKind('');
    }
  }

  async function removeFile(kind) {
    if (!window.confirm('Remove this file?')) return;
    setError('');
    try {
      await client.delete(`/institute/files/${kind}`);
      setFiles((f) => ({ ...f, [kind]: null }));
      if (kind !== 'ownership') await refreshInstitute();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not remove the file.');
    }
  }

  async function downloadOwnership(kind) {
    try {
      const { data } = await client.get(`/institute/files/${kind}`);
      const a = document.createElement('a');
      a.href = data.dataUrl;
      a.download = data.fileName;
      a.click();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not open the file.');
    }
  }

  function handlePrint() {
    const clone = printRef.current.cloneNode(true);
    clone.classList.remove('hidden');
    printElement(clone, 'Institute profile');
  }

  if (loading) return <p className="text-slate2">Loading…</p>;
  if (!fields) return <p className="text-absent text-sm">{error || 'Could not load.'}</p>;

  const dateDisplay = (d) => (d ? `${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(0, 4)}` : '');
  const printRows = (list) =>
    list.map((f) => (
      <tr key={f.key}>
        <td className="border border-ink/30 px-2 py-1 font-semibold w-1/3">{f.label}</td>
        <td className="border border-ink/30 px-2 py-1">{f.type === 'date' ? dateDisplay(fields[f.key]) : String(fields[f.key] ?? '')}</td>
      </tr>
    ));

  return (
    <form onSubmit={handleSave}>
      <PageHeader eyebrow="Module 09" title="Institute Data" />

      {!saved && (
        <p className="text-sm bg-brass/10 border border-brass/30 rounded-md px-3 py-2 mb-4">
          These values were filled in from your FEMIS school record. Check them and press <strong>Save</strong>.
        </p>
      )}
      {error && <p className="text-absent text-sm mb-4">{error}</p>}
      {notice && <p className="text-present text-sm mb-4">{notice}</p>}

      {/* 1. Basic information */}
      <Section title="Basic Information" hint="Please provide your basic information below.">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {BASIC.map((f) => (
            <Field key={f.key} f={f} value={fields[f.key]} onChange={set(f.key)} />
          ))}
        </div>
        <div className="mt-5 max-w-sm">
          <FileBox
            kind="ownership"
            label="Ownership document (optional)"
            help="PDF, PNG or JPG, up to 3 MB."
            accept=".pdf,image/png,image/jpeg"
            meta={files.ownership}
            busy={busyKind === 'ownership'}
            onPick={pickFile}
            onRemove={removeFile}
            onDownload={downloadOwnership}
          />
        </div>
      </Section>

      {/* 2. Contact information (administrator + principal + institute) */}
      <Section title="Contact Information" hint="Administrator, principal and institute contact details.">
        {CONTACT_GROUPS.map((g, gi) => (
          <div key={g.title} className={gi > 0 ? 'mt-6 pt-5 border-t border-ink/10' : ''}>
            <h3 className="font-medium text-ink mb-1">{g.title}</h3>
            {g.hint && <p className="text-xs text-slate2 mb-3">{g.hint}</p>}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-3">
              {g.fields.map((f) => (
                <Field key={f.key} f={f} value={fields[f.key]} onChange={set(f.key)} />
              ))}
            </div>
          </div>
        ))}
      </Section>

      {/* 3. Management committee */}
      <Section title="Institution / College Management Committee (SMC/CMC)" hint="Please provide the SMC/CMC details below.">
        <div className="flex flex-wrap gap-8 mb-6">
          <YesNo label="Status of SMC / CMC" value={fields.smcExists} onChange={set('smcExists')} />
          <YesNo label="SMC / CMC functional?" value={fields.smcFunctional} onChange={set('smcFunctional')} />
        </div>

        <h3 className="font-medium text-ink mb-3">Committee Members</h3>
        <datalist id="inst-memberType">{OPTIONS.memberType.map((o) => <option key={o} value={o} />)}</datalist>
        <datalist id="inst-gender">{OPTIONS.gender.map((o) => <option key={o} value={o} />)}</datalist>
        <div className="space-y-3">
          {members.map((m, i) => (
            <div key={i} className="border border-ink/10 rounded-md p-3 grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
              <div className="sm:col-span-3">
                <label className="block text-xs text-slate2 mb-1">Member type <span className="text-absent">*</span></label>
                <input list="inst-memberType" value={m.memberType} onChange={(e) => setMember(i, { memberType: e.target.value })} className="w-full border border-ink/20 rounded-md px-2 py-2 bg-white text-sm" />
              </div>
              <div className="sm:col-span-4">
                <label className="block text-xs text-slate2 mb-1">Member name <span className="text-absent">*</span></label>
                <input value={m.name} onChange={(e) => setMember(i, { name: e.target.value })} className="w-full border border-ink/20 rounded-md px-2 py-2 bg-white text-sm" />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs text-slate2 mb-1">Contact number <span className="text-absent">*</span></label>
                <input type="tel" value={m.contact} onChange={(e) => setMember(i, { contact: e.target.value })} className="w-full border border-ink/20 rounded-md px-2 py-2 bg-white text-sm" />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs text-slate2 mb-1">Gender <span className="text-absent">*</span></label>
                <input list="inst-gender" value={m.gender} onChange={(e) => setMember(i, { gender: e.target.value })} className="w-full border border-ink/20 rounded-md px-2 py-2 bg-white text-sm" />
              </div>
              <div className="sm:col-span-1 flex sm:justify-end">
                <button
                  type="button"
                  onClick={() => setMembers((list) => list.filter((_, idx) => idx !== i))}
                  aria-label="Remove member"
                  className="px-3 py-2 text-sm border border-ink/20 rounded-md text-absent hover:bg-paper"
                >
                  ✕
                </button>
              </div>
            </div>
          ))}
        </div>
        <button type="button" onClick={() => setMembers((list) => [...list, { ...EMPTY_MEMBER }])} className="mt-3 text-sm px-4 py-2 rounded-md border border-ink/20 hover:bg-paper">
          + Add member
        </button>

        <div className="mt-8 pt-5 border-t border-ink/10">
          <h3 className="font-medium text-ink mb-3">Bank Account Details</h3>
          <YesNo label="SMC / CMC Bank Account Available?" value={fields.smcBankAccount} onChange={set('smcBankAccount')} />
        </div>

        <div className="mt-8 pt-5 border-t border-ink/10">
          <h3 className="font-medium text-ink mb-3">SMC / CMC Meeting Records</h3>
          <datalist id="inst-meetingType">{OPTIONS.meetingType.map((o) => <option key={o} value={o} />)}</datalist>
          {meetings.length === 0 && <p className="text-sm text-slate2 mb-3">No meetings recorded.</p>}
          <div className="space-y-3">
            {meetings.map((m, i) => (
              <div key={i} className="border border-ink/10 rounded-md p-3 grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
                <div className="sm:col-span-3">
                  <label className="block text-xs text-slate2 mb-1">Meeting type <span className="text-absent">*</span></label>
                  <input list="inst-meetingType" value={m.meetingType} onChange={(e) => setMeeting(i, { meetingType: e.target.value })} className="w-full border border-ink/20 rounded-md px-2 py-2 bg-white text-sm" />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs text-slate2 mb-1">Meeting date <span className="text-absent">*</span></label>
                  <input type="date" value={m.meetingDate} onChange={(e) => setMeeting(i, { meetingDate: e.target.value })} className="w-full border border-ink/20 rounded-md px-2 py-2 bg-white text-sm" />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs text-slate2 mb-1">Time <span className="text-absent">*</span></label>
                  <input type="time" value={m.meetingTime} onChange={(e) => setMeeting(i, { meetingTime: e.target.value })} className="w-full border border-ink/20 rounded-md px-2 py-2 bg-white text-sm" />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs text-slate2 mb-1">Venue <span className="text-absent">*</span></label>
                  <input value={m.venue} onChange={(e) => setMeeting(i, { venue: e.target.value })} className="w-full border border-ink/20 rounded-md px-2 py-2 bg-white text-sm" />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs text-slate2 mb-1">Minutes issued <span className="text-absent">*</span></label>
                  <select value={m.minutesIssued ? 'yes' : 'no'} onChange={(e) => setMeeting(i, { minutesIssued: e.target.value === 'yes' })} className="w-full border border-ink/20 rounded-md px-2 py-2 bg-white text-sm">
                    <option value="yes">Yes</option>
                    <option value="no">No</option>
                  </select>
                </div>
                <div className="sm:col-span-1 flex sm:justify-end">
                  <button
                    type="button"
                    onClick={() => setMeetings((list) => list.filter((_, idx) => idx !== i))}
                    aria-label="Remove meeting"
                    className="px-3 py-2 text-sm border border-ink/20 rounded-md text-absent hover:bg-paper"
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>
          <button type="button" onClick={() => setMeetings((list) => [...list, { ...EMPTY_MEETING }])} className="mt-3 text-sm px-4 py-2 rounded-md border border-ink/20 hover:bg-paper">
            + Add meeting
          </button>
        </div>
      </Section>

      {/* extra: used on printouts */}
      <Section title="Logo and Signature" hint="Printed on the Report Card. Images are shrunk automatically.">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-2xl">
          <FileBox
            kind="logo"
            label="School logo"
            help="PNG, JPG or WEBP. A transparent PNG looks best."
            accept="image/png,image/jpeg,image/webp"
            meta={files.logo}
            preview={school.logo}
            busy={busyKind === 'logo'}
            onPick={pickFile}
            onRemove={removeFile}
          />
          <FileBox
            kind="signature"
            label="Principal's signature"
            help="A clear photo or scan of the signature on white or transparent background."
            accept="image/png,image/jpeg,image/webp"
            meta={files.signature}
            preview={school.principalSignature}
            busy={busyKind === 'signature'}
            onPick={pickFile}
            onRemove={removeFile}
          />
        </div>
        <p className="text-xs text-slate2 mt-3">When no file is uploaded here, the logo and signature already built into the app are used.</p>
      </Section>

      <div className="sticky bottom-0 z-10 -mx-4 md:-mx-8 px-4 md:px-8 py-3 bg-paper/95 backdrop-blur border-t border-ink/10 flex flex-wrap gap-3">
        <button type="submit" disabled={saving} className="text-sm px-6 py-2.5 rounded-md bg-ink text-paper hover:bg-ink-light disabled:opacity-50">
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button type="button" onClick={handlePrint} className="text-sm px-5 py-2.5 rounded-md border border-ink/20 hover:bg-white">
          Print profile
        </button>
      </div>

      {/* one-page profile (hidden on screen; copied into the print window) */}
      <div ref={printRef} className="hidden">
        <div className="flex items-center gap-4 mb-3">
          {school.logo && <img src={school.logo} alt="" className="w-16 h-16 object-contain" />}
          <div>
            <p className="font-display text-xl uppercase">{fields.name}</p>
            <p className="font-display text-base">INSTITUTE PROFILE</p>
          </div>
        </div>
        <p className="font-semibold mt-3 mb-1">Basic Information</p>
        <table className="w-full text-sm border-collapse mb-3"><tbody>{printRows(BASIC)}</tbody></table>
        <p className="font-semibold mt-3 mb-1">Contact Information</p>
        <table className="w-full text-sm border-collapse mb-3"><tbody>{printRows(CONTACT_GROUPS.flatMap((g) => g.fields))}</tbody></table>
        <p className="font-semibold mt-3 mb-1">
          Management Committee (SMC/CMC) · Status: {fields.smcExists ? 'Yes' : 'No'} · Functional: {fields.smcFunctional ? 'Yes' : 'No'}
        </p>
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr>
              {['Member type', 'Name', 'Contact number', 'Gender'].map((h) => (
                <th key={h} className="border border-ink/30 px-2 py-1 text-left">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {members.map((m, i) => (
              <tr key={i}>
                <td className="border border-ink/30 px-2 py-1">{m.memberType}</td>
                <td className="border border-ink/30 px-2 py-1">{m.name}</td>
                <td className="border border-ink/30 px-2 py-1">{m.contact}</td>
                <td className="border border-ink/30 px-2 py-1">{m.gender}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="font-semibold mt-3 mb-1">
          Bank Account Details · SMC / CMC bank account available: {fields.smcBankAccount ? 'Yes' : 'No'}
        </p>
        <p className="font-semibold mt-3 mb-1">SMC / CMC Meeting Records</p>
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr>
              {['Meeting type', 'Date', 'Time', 'Venue', 'Minutes issued'].map((h) => (
                <th key={h} className="border border-ink/30 px-2 py-1 text-left">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {meetings.length === 0 && (
              <tr><td className="border border-ink/30 px-2 py-1" colSpan={5}>No meetings recorded.</td></tr>
            )}
            {meetings.map((m, i) => (
              <tr key={i}>
                <td className="border border-ink/30 px-2 py-1">{m.meetingType}</td>
                <td className="border border-ink/30 px-2 py-1">{dateDisplay(m.meetingDate)}</td>
                <td className="border border-ink/30 px-2 py-1">{m.meetingTime}</td>
                <td className="border border-ink/30 px-2 py-1">{m.venue}</td>
                <td className="border border-ink/30 px-2 py-1">{m.minutesIssued ? 'Yes' : 'No'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </form>
  );
}
