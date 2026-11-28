const express = require('express');
const prisma = require('../prismaClient');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth } = require('../middleware/auth');
const { MODULES, requireRoleOrPermission } = require('../utils/permissions');
const DEFAULTS = require('../data/instituteDefaults');

// Institute Data: the school's own profile (name, address, contacts,
// management committee) plus its logo and the principal's signature.
// Everyone logged in can read the short "public" version (name, logo,
// signature) because printouts need it. Reading the full record and every
// change needs ADMIN or the INSTITUTE_DATA module.
const router = express.Router();
router.use(requireAuth);
const canEdit = requireRoleOrPermission(['ADMIN'], MODULES.INSTITUTE_DATA);

const TEXT_FIELDS = [
  'status', 'name', 'shortName', 'emisCode', 'nisNumber', 'institutionType', 'educationSector', 'addressType', 'sector',
  'address', 'designatedFor', 'academicLevel', 'academicLevelClasses', 'medium', 'workingShift', 'buildingOwnership',
  'hoiName', 'hoiBps', 'principalPhoneRes', 'principalMobile', 'hoiPostingDate', 'postingCategory',
  'phone1', 'phone2', 'fax', 'email', 'webUrl',
];
const REQUIRED = {
  status: 'Status',
  name: 'Institution name',
  shortName: 'Short name / abbreviation',
  emisCode: 'EMIS code',
  institutionType: 'Institution type',
  educationSector: 'Education sector',
  addressType: 'Address type',
  sector: 'Sector',
  designatedFor: 'Designated for',
  academicLevel: 'Academic level (highest)',
  academicLevelClasses: 'Academic level classes',
  medium: 'Medium',
  workingShift: 'Working shift',
  buildingOwnership: 'Building ownership',
  hoiName: 'Name of HOI',
  hoiBps: 'BPS',
  principalMobile: 'Mobile phone (WhatsApp)',
  hoiPostingDate: 'Date of posting as HOI in present institution',
  postingCategory: 'Posting category',
  phone1: 'Phone # 1',
  phone2: 'Phone # 2',
  email: 'E-mail',
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ---- files ----
const FILE_RULES = {
  logo: { label: 'School logo', mimes: ['image/png', 'image/jpeg', 'image/webp'], maxBytes: 300 * 1024 },
  signature: { label: "Principal's signature", mimes: ['image/png', 'image/jpeg', 'image/webp'], maxBytes: 300 * 1024 },
  ownership: { label: 'Ownership document', mimes: ['application/pdf', 'image/png', 'image/jpeg'], maxBytes: 3 * 1024 * 1024 },
};

function parseDataUrl(dataUrl) {
  const m = /^data:([\w.+/-]+);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m) return null;
  return { mime: m[1], bytes: Math.floor((m[2].length * 3) / 4) - (m[2].endsWith('==') ? 2 : m[2].endsWith('=') ? 1 : 0) };
}

async function fileMeta() {
  const rows = await prisma.instituteFile.findMany({ select: { kind: true, fileName: true, mimeType: true, size: true, updatedAt: true } });
  const out = { logo: null, signature: null, ownership: null };
  for (const r of rows) out[r.kind] = { fileName: r.fileName, mimeType: r.mimeType, size: r.size, updatedAt: r.updatedAt };
  return out;
}

function shape(inst) {
  const out = {};
  for (const k of TEXT_FIELDS) out[k] = inst[k] ?? '';
  out.latitude = inst.latitude ?? '';
  out.longitude = inst.longitude ?? '';
  out.establishedYear = inst.establishedYear ?? '';
  out.smcExists = inst.smcExists;
  out.smcFunctional = inst.smcFunctional;
  out.smcBankAccount = inst.smcBankAccount;
  return out;
}

// GET /api/institute  - the whole profile, for the Institute Data page
router.get(
  '/',
  canEdit,
  asyncHandler(async (req, res) => {
    const [inst, members, meetings, files] = await Promise.all([
      prisma.institute.findUnique({ where: { id: 1 } }),
      prisma.instituteCommitteeMember.findMany({ orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] }),
      prisma.instituteMeeting.findMany({ orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] }),
      fileMeta(),
    ]);
    if (!inst) {
      // nothing saved yet: offer the values from the FEMIS record to review and save
      return res.json({ saved: false, fields: DEFAULTS.fields, members: DEFAULTS.members, meetings: DEFAULTS.meetings, files });
    }
    res.json({
      saved: true,
      fields: shape(inst),
      members: members.map((m) => ({ memberType: m.memberType, name: m.name, contact: m.contact, gender: m.gender })),
      meetings: meetings.map((m) => ({
        meetingType: m.meetingType,
        meetingDate: m.meetingDate,
        meetingTime: m.meetingTime,
        venue: m.venue,
        minutesIssued: m.minutesIssued,
      })),
      files,
    });
  })
);

// GET /api/institute/public  - what printouts need; open to every logged-in user
router.get(
  '/public',
  asyncHandler(async (req, res) => {
    const [inst, logo, signature] = await Promise.all([
      prisma.institute.findUnique({ where: { id: 1 } }),
      prisma.instituteFile.findUnique({ where: { kind: 'logo' } }),
      prisma.instituteFile.findUnique({ where: { kind: 'signature' } }),
    ]);
    res.json({
      configured: Boolean(inst),
      name: inst?.name || '',
      shortName: inst?.shortName || '',
      address: inst?.address || '',
      phone1: inst?.phone1 || '',
      email: inst?.email || '',
      webUrl: inst?.webUrl || '',
      hoiName: inst?.hoiName || '',
      logoDataUrl: logo?.dataUrl || '',
      signatureDataUrl: signature?.dataUrl || '',
    });
  })
);

// PUT /api/institute  { fields, members }
router.put(
  '/',
  canEdit,
  asyncHandler(async (req, res) => {
    const f = req.body.fields || {};
    const members = Array.isArray(req.body.members) ? req.body.members : [];
    const meetings = Array.isArray(req.body.meetings) ? req.body.meetings : [];

    const text = (k) => String(f[k] ?? '').trim();
    const missing = Object.entries(REQUIRED).filter(([k]) => !text(k)).map(([, label]) => label);
    if (missing.length) return res.status(400).json({ error: `Please fill in: ${missing.join(', ')}.` });

    if (!DATE_RE.test(text('hoiPostingDate'))) return res.status(400).json({ error: 'Enter the date of posting as HOI as a valid date.' });

    const num = (k, label, min, max) => {
      const raw = String(f[k] ?? '').trim();
      if (raw === '') return { ok: true, value: null };
      const n = Number(raw);
      if (!Number.isFinite(n) || n < min || n > max) return { ok: false, error: `${label} is not a valid number.` };
      return { ok: true, value: n };
    };
    const lat = num('latitude', 'Latitude', -90, 90);
    const lng = num('longitude', 'Longitude', -180, 180);
    const year = num('establishedYear', 'Established year', 1800, 2100);
    for (const r of [lat, lng, year]) if (!r.ok) return res.status(400).json({ error: r.error });

    const smcExists = f.smcExists !== false;
    const smcFunctional = f.smcFunctional !== false;

    const cleanMembers = [];
    for (let i = 0; i < members.length; i += 1) {
      const m = members[i] || {};
      const row = {
        memberType: String(m.memberType || '').trim(),
        name: String(m.name || '').trim(),
        contact: String(m.contact || '').trim(),
        gender: String(m.gender || '').trim(),
        sortOrder: i,
      };
      if (!row.memberType || !row.name || !row.contact || !row.gender) {
        return res.status(400).json({ error: `Committee member ${i + 1}: member type, name, contact number and gender are all required.` });
      }
      cleanMembers.push(row);
    }
    if (smcExists && cleanMembers.length === 0) {
      return res.status(400).json({ error: 'Add at least one committee member, or set the committee status to No.' });
    }

    const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
    const cleanMeetings = [];
    for (let i = 0; i < meetings.length; i += 1) {
      const m = meetings[i] || {};
      const row = {
        meetingType: String(m.meetingType || '').trim(),
        meetingDate: String(m.meetingDate || '').trim(),
        meetingTime: String(m.meetingTime || '').trim(),
        venue: String(m.venue || '').trim(),
        minutesIssued: m.minutesIssued === true,
        sortOrder: i,
      };
      if (!row.meetingType || !row.meetingDate || !row.meetingTime || !row.venue) {
        return res.status(400).json({ error: `Meeting record ${i + 1}: meeting type, date, time and venue are all required.` });
      }
      if (!DATE_RE.test(row.meetingDate) || !TIME_RE.test(row.meetingTime)) {
        return res.status(400).json({ error: `Meeting record ${i + 1}: enter a valid date and time.` });
      }
      cleanMeetings.push(row);
    }

    const data = {};
    for (const k of TEXT_FIELDS) {
      const v = text(k);
      data[k] = REQUIRED[k] ? v : v || null;
    }
    data.latitude = lat.value;
    data.longitude = lng.value;
    data.establishedYear = year.value === null ? null : Math.round(year.value);
    data.smcExists = smcExists;
    data.smcFunctional = smcFunctional;
    data.smcBankAccount = f.smcBankAccount === true;

    await prisma.$transaction([
      prisma.institute.upsert({ where: { id: 1 }, update: data, create: { id: 1, ...data } }),
      prisma.instituteCommitteeMember.deleteMany({}),
      ...(cleanMembers.length ? [prisma.instituteCommitteeMember.createMany({ data: cleanMembers })] : []),
      prisma.instituteMeeting.deleteMany({}),
      ...(cleanMeetings.length ? [prisma.instituteMeeting.createMany({ data: cleanMeetings })] : []),
    ]);
    res.json({ saved: true });
  })
);

// PUT /api/institute/files/:kind  { fileName, dataUrl }
router.put(
  '/files/:kind',
  canEdit,
  asyncHandler(async (req, res) => {
    const rule = FILE_RULES[req.params.kind];
    if (!rule) return res.status(404).json({ error: 'Unknown file type.' });
    const parsed = parseDataUrl(req.body.dataUrl);
    if (!parsed) return res.status(400).json({ error: 'The file could not be read. Choose it again.' });
    if (!rule.mimes.includes(parsed.mime)) {
      return res.status(400).json({ error: `${rule.label} must be ${rule.mimes.map((m) => m.split('/')[1].toUpperCase()).join(', ')}.` });
    }
    if (parsed.bytes > rule.maxBytes) {
      return res.status(400).json({ error: `${rule.label} is too large (limit ${Math.round(rule.maxBytes / 1024)} KB).` });
    }
    const data = {
      fileName: String(req.body.fileName || req.params.kind).slice(0, 200),
      mimeType: parsed.mime,
      dataUrl: req.body.dataUrl,
      size: parsed.bytes,
    };
    await prisma.instituteFile.upsert({ where: { kind: req.params.kind }, update: data, create: { kind: req.params.kind, ...data } });
    res.json({ ok: true, size: parsed.bytes });
  })
);

// GET /api/institute/files/:kind  - one stored file, e.g. to download the ownership document
router.get(
  '/files/:kind',
  canEdit,
  asyncHandler(async (req, res) => {
    const row = await prisma.instituteFile.findUnique({ where: { kind: req.params.kind } });
    if (!row) return res.status(404).json({ error: 'No file uploaded.' });
    res.json({ fileName: row.fileName, mimeType: row.mimeType, dataUrl: row.dataUrl });
  })
);

// DELETE /api/institute/files/:kind
router.delete(
  '/files/:kind',
  canEdit,
  asyncHandler(async (req, res) => {
    await prisma.instituteFile.deleteMany({ where: { kind: req.params.kind } });
    res.json({ ok: true });
  })
);

module.exports = router;
