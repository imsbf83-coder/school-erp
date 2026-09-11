import { useEffect, useState } from 'react';
import client from '../api/client';
import PageHeader from '../components/PageHeader';
import CSVImportPanel from '../components/CSVImportPanel';
import { sectionsFor } from '../utils/sections';

const emptyAdmissionForm = {
  studentId: '',
  academicYear: '2026-2027',
  classId: '',
  section: '',
  previousSchool: '',
  documentsReceived: '',
  remarks: '',
};

// Every FDE form field not already covered by the student record itself
// (name, gender, DOB, class/section, guardian/father info, religion,
// contact details, orphan status and student group all live on the
// student and are edited from the Students page).
const emptyFormDetail = {
  cnicOrFormAvailable: '', provinceOfBirth: '', districtOfBirth: '', receivingGirlsStipend: '',
  nationality: 'PAKISTANI', nationalityOther: '', domicileDistrict: '', domicileProvince: '',
  permanentAddressType: '', permanentAddressDetail: '', permanentHouseNo: '', permanentStreetNo: '', whatsappNumber: '',
  presentCity: '', presentAddressType: '', presentAddressDetail: '', presentHouseNo: '', presentStreetNo: '',
  motherLanguage: '', bloodGroup: '', isHafiz: '',
  fatherAlive: '', fatherLandline: '', fatherQualification: '', fatherProfession: '', fatherProfessionOther: '',
  fatherIncome: '', fatherBps: '', fatherDomicileProvince: '', fatherDomicileDistrict: '',
  motherName: '', motherAlive: '', motherCnic: '', motherContactNumber: '', motherLandline: '', motherEmail: '',
  motherQualification: '', motherProfession: '', motherProfessionOther: '', motherIncome: '', motherBps: '',
  orphanGuardianContact: '', orphanGuardianEmail: '', orphanGuardianQualification: '', orphanGuardianProfession: '',
  orphanGuardianProfessionOther: '', orphanGuardianIncome: '', orphanGuardianBps: '',
  classGroupFde: '', resultPercentageLastClass: '', lastInstitutionUnderFde: '', lastInstitutionOther: '',
  shift: '', availingMealProgram: '', mediumOfInstruction: '', yearsToCompletePrimary: '', modeOfStudy: '',
  totalSiblings: '', siblingsInOtherFdeInstitutions: '', siblingsInSameInstitution: '', siblingsInPrivateInstitutions: '',
  transportFacility: '', isScholarshipRecipient: '', scholarshipDetails: '', hasCoCurricularAchievement: '', achievementDetails: '',
  emergencyContactName: '', emergencyContactNumber: '', emergencyContactRelation: '', emergencyContactRelationOther: '',
  isRefugeeOrIdp: '', isRegisteredRefugee: '', idpStatus: '', refugeeCardNumber: '',
  hasMajorDisability: '', disabilityCertificateAttached: '', disabilityType: '',
  hasMentalDisability: '', mentalDisabilityType: '', otherMedicalConditions: '',
  isVisuallyFit6by6: '', wearsGlasses: '', difficultySeeingBoard: '',
  hasHearingDifficulty: '', usesHearingAid: '', hearingDifficultyDetails: '', difficultyListening: '',
  difficultyWalking: '', usesCrutchesOrWalker: '',
  difficultyReadingWriting: '', difficultyRemembering: '', difficultyConcentrating: '',
  basicVaccinationCompleted: '',
  hasDigitalDeviceAtHome: '', digitalDeviceType: '', hasInternetAtHome: '',
};

// value/label option sets, shared between the form's dropdowns and the CSV
// template example row below.
const PROVINCE_OPTIONS = [['PUNJAB', 'Punjab'], ['BALOCHISTAN', 'Balochistan'], ['SINDH', 'Sindh'], ['KPK', 'KPK'], ['ICT', 'ICT'], ['GILGIT_BALTISTAN', 'Gilgit Baltistan'], ['AJK', 'AJK']];
const NATIONALITY_OPTIONS = [['PAKISTANI', 'Pakistani'], ['OTHER', 'Others']];
const ADDRESS_TYPE_OPTIONS = [['SECTOR', 'Sector'], ['HOUSING_SOCIETY', 'Housing Society'], ['VILLAGE', 'Village'], ['OTHERS', 'Others']];
const LANGUAGE_OPTIONS = [['PASHTO', 'Pashto'], ['ENGLISH', 'English'], ['SARAIKI', 'Saraiki'], ['PUNJABI', 'Punjabi'], ['BALTI', 'Balti'], ['SHINA', 'Shina'], ['URDU', 'Urdu'], ['HINDKO', 'Hindko'], ['SINDHI', 'Sindhi'], ['BALOCHI', 'Balochi']];
const BLOOD_GROUP_OPTIONS = ['A+', 'A-', 'AB+', 'AB-', 'O+', 'O-'].map((v) => [v, v]);
const PROFESSION_OPTIONS = [['GOVT_EMPLOYEE', 'Govt Employee'], ['PRIVATE_EMPLOYEE', 'Private Employee'], ['BUSINESSMAN', 'Businessman'], ['FARMER', 'Farmer'], ['OVERSEAS', 'Overseas'], ['OTHER', 'Other']];
const SHIFT_OPTIONS = [['MORNING', 'Morning'], ['EVENING', 'Evening']];
const MEDIUM_OPTIONS = [['URDU', 'Urdu'], ['ENGLISH', 'English']];
const MODE_OF_STUDY_OPTIONS = [['DAY_SCHOLAR', 'Day Scholars'], ['BOARDER', 'Boarders']];
const TRANSPORT_OPTIONS = [['INSTITUTION_BUS', 'Institution Bus'], ['PRIVATE', 'Private'], ['NONE', 'None']];
const RELATION_OPTIONS = [['FATHER', 'Father'], ['MOTHER', 'Mother'], ['SISTER', 'Sister'], ['BROTHER', 'Brother'], ['AUNT', 'Aunt'], ['UNCLE', 'Uncle'], ['OTHER', 'Other']];
const DISABILITY_TYPE_OPTIONS = [['PHYSICAL', 'Physical'], ['VISUAL', 'Visual'], ['HEARING', 'Hearing'], ['INTELLECTUAL', 'Intellectual'], ['MULTIPLE', 'Multiple'], ['OTHER', 'Other']];
const MENTAL_DISABILITY_OPTIONS = [['AUTISM', 'Autism'], ['ADHD', 'ADHD'], ['OTHER', 'Other']];
const DIFFICULTY_OPTIONS = [['NO_DIFFICULTY', 'No Difficulty'], ['SOME_DIFFICULTY', 'Some Difficulty'], ['A_LOT_OF_DIFFICULTY', 'A Lot of Difficulty'], ['CANNOT_DO_AT_ALL', 'Cannot Do At All']];

// CSV import: [header, example value] pairs, kept together so the header
// row and example row can never drift out of alignment.
const IMPORT_FIELD_DEFS = [
  ['firstName', 'Ali'], ['lastName', 'Khan'], ['gender', 'MALE'], ['dateOfBirth', '2015-04-12'],
  ['className', 'Grade 6'], ['section', 'A'], ['admissionNumber', ''],
  ['guardianName', 'Ahmed Khan'], ['guardianPhone', '0300-1234567'], ['guardianEmail', ''], ['guardianRelation', 'Father'],
  ['fatherCnic', '37405-1234567-1'], ['bFormNumber', ''], ['religion', 'Muslim'],
  ['phone', ''], ['email', ''], ['address', ''], ['orphanStatus', 'NONE'], ['studentGroup', ''],
  ['academicYear', '2026-2027'], ['previousSchool', ''], ['documentsReceived', ''], ['remarks', ''],
  ['cnicOrFormAvailable', 'Yes'], ['provinceOfBirth', 'PUNJAB'], ['districtOfBirth', ''], ['receivingGirlsStipend', ''],
  ['nationality', 'PAKISTANI'], ['nationalityOther', ''], ['domicileDistrict', ''], ['domicileProvince', ''],
  ['permanentAddressType', ''], ['permanentAddressDetail', ''], ['permanentHouseNo', ''], ['permanentStreetNo', ''], ['whatsappNumber', ''],
  ['presentCity', ''], ['presentAddressType', ''], ['presentAddressDetail', ''], ['presentHouseNo', ''], ['presentStreetNo', ''],
  ['motherLanguage', 'URDU'], ['bloodGroup', ''], ['isHafiz', ''],
  ['fatherAlive', 'Yes'], ['fatherLandline', ''], ['fatherQualification', ''], ['fatherProfession', ''], ['fatherProfessionOther', ''],
  ['fatherIncome', ''], ['fatherBps', ''], ['fatherDomicileProvince', ''], ['fatherDomicileDistrict', ''],
  ['motherName', ''], ['motherAlive', ''], ['motherCnic', ''], ['motherContactNumber', ''], ['motherLandline', ''], ['motherEmail', ''],
  ['motherQualification', ''], ['motherProfession', ''], ['motherProfessionOther', ''], ['motherIncome', ''], ['motherBps', ''],
  ['orphanGuardianContact', ''], ['orphanGuardianEmail', ''], ['orphanGuardianQualification', ''], ['orphanGuardianProfession', ''],
  ['orphanGuardianProfessionOther', ''], ['orphanGuardianIncome', ''], ['orphanGuardianBps', ''],
  ['classGroupFde', ''], ['resultPercentageLastClass', ''], ['lastInstitutionUnderFde', ''], ['lastInstitutionOther', ''],
  ['shift', 'MORNING'], ['availingMealProgram', ''], ['mediumOfInstruction', 'ENGLISH'], ['yearsToCompletePrimary', ''], ['modeOfStudy', 'DAY_SCHOLAR'],
  ['totalSiblings', ''], ['siblingsInOtherFdeInstitutions', ''], ['siblingsInSameInstitution', ''], ['siblingsInPrivateInstitutions', ''],
  ['transportFacility', ''], ['isScholarshipRecipient', ''], ['scholarshipDetails', ''], ['hasCoCurricularAchievement', ''], ['achievementDetails', ''],
  ['emergencyContactName', ''], ['emergencyContactNumber', ''], ['emergencyContactRelation', ''], ['emergencyContactRelationOther', ''],
  ['isRefugeeOrIdp', ''], ['isRegisteredRefugee', ''], ['idpStatus', ''], ['refugeeCardNumber', ''],
  ['hasMajorDisability', ''], ['disabilityCertificateAttached', ''], ['disabilityType', ''],
  ['hasMentalDisability', ''], ['mentalDisabilityType', ''], ['otherMedicalConditions', ''],
  ['isVisuallyFit6by6', ''], ['wearsGlasses', ''], ['difficultySeeingBoard', ''],
  ['hasHearingDifficulty', ''], ['usesHearingAid', ''], ['hearingDifficultyDetails', ''], ['difficultyListening', ''],
  ['difficultyWalking', ''], ['usesCrutchesOrWalker', ''],
  ['difficultyReadingWriting', ''], ['difficultyRemembering', ''], ['difficultyConcentrating', ''],
  ['basicVaccinationCompleted', ''],
  ['hasDigitalDeviceAtHome', ''], ['digitalDeviceType', ''], ['hasInternetAtHome', ''],
];
const ADMISSION_TEMPLATE_HEADERS = IMPORT_FIELD_DEFS.map(([h]) => h);
const ADMISSION_TEMPLATE_EXAMPLE = IMPORT_FIELD_DEFS.map(([, ex]) => ex);

export default function Admissions() {
  const [tab, setTab] = useState('admissions');
  const [admissions, setAdmissions] = useState([]);
  const [withdrawals, setWithdrawals] = useState([]);
  const [students, setStudents] = useState([]);
  const [classes, setClasses] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [error, setError] = useState('');
  const [admissionForm, setAdmissionForm] = useState(emptyAdmissionForm);
  const [formDetail, setFormDetail] = useState(emptyFormDetail);
  const [withdrawalForm, setWithdrawalForm] = useState({ studentId: '', status: 'SLC', reason: '', transferCertIssued: false, remarks: '' });

  useEffect(() => {
    load();
    refreshStudents();
    client.get('/classes').then((res) => setClasses(res.data));
  }, []);

  async function load() {
    const [a, w] = await Promise.all([client.get('/admissions'), client.get('/admissions/withdrawals')]);
    setAdmissions(a.data);
    setWithdrawals(w.data);
  }

  function refreshStudents() {
    client.get('/students', { params: { pageSize: 500 } }).then((res) => setStudents(res.data.students));
  }

  const sectionOptions = sectionsFor(classes, admissionForm.classId);
  // Alphabetical by first name (then last name as a tiebreaker) — matches
  // the "First Last (admission no.)" order the dropdowns display.
  const sortedStudents = [...students].sort(
    (a, b) => a.firstName.localeCompare(b.firstName) || a.lastName.localeCompare(b.lastName)
  );

  function setDetail(key, value) {
    setFormDetail((f) => ({ ...f, [key]: value }));
  }

  // Pre-fill the placement from where the student currently sits, so these
  // fields read as "confirm or change", not as a blank that would silently
  // clear the section they already have.
  function pickStudent(studentId) {
    const student = students.find((s) => String(s.id) === String(studentId));
    setAdmissionForm((f) => ({
      ...f,
      studentId,
      classId: student?.classId ? String(student.classId) : '',
      section: student?.section || '',
    }));
  }

  // Sections are per-class, so a section from the old class can't carry over.
  function pickClass(classId) {
    setAdmissionForm((f) => ({ ...f, classId, section: '' }));
  }

  async function handleAdmit(e) {
    e.preventDefault();
    setError('');
    try {
      await client.post('/admissions', { ...admissionForm, formDetail });
      setAdmissionForm(emptyAdmissionForm);
      setFormDetail(emptyFormDetail);
      setShowForm(false);
      load();
      // The student's class/section may have just changed — refresh the
      // picker so a second admission pre-fills from the new placement.
      refreshStudents();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not record this admission.');
    }
  }

  async function handleWithdraw(e) {
    e.preventDefault();
    setError('');
    try {
      await client.post('/admissions/withdrawals', withdrawalForm);
      setWithdrawalForm({ studentId: '', status: 'SLC', reason: '', transferCertIssued: false, remarks: '' });
      setShowForm(false);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not record this exit.');
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="Module 04"
        title="Admission / Withdrawal"
        action={
          <div className="flex gap-2">
            {tab === 'admissions' && (
              <button
                onClick={() => { setShowImport((v) => !v); setShowForm(false); setError(''); }}
                className="text-sm px-4 py-2 rounded-md border border-ink/20 text-ink hover:bg-white"
              >
                {showImport ? 'Cancel import' : 'Import CSV'}
              </button>
            )}
            <button
              onClick={() => { setShowForm((v) => !v); setShowImport(false); }}
              className="text-sm px-4 py-2 rounded-md bg-ink text-paper hover:bg-ink-light"
            >
              {showForm ? 'Cancel' : `+ New ${tab === 'admissions' ? 'admission' : 'withdrawal'}`}
            </button>
          </div>
        }
      />

      <div className="flex gap-2 mb-6">
        <TabButton active={tab === 'admissions'} onClick={() => { setTab('admissions'); setShowForm(false); setShowImport(false); setError(''); }} label="Admissions" />
        <TabButton active={tab === 'withdrawals'} onClick={() => { setTab('withdrawals'); setShowForm(false); setShowImport(false); setError(''); }} label="Withdrawals" />
      </div>

      {showImport && tab === 'admissions' && (
        <CSVImportPanel
          title="Import admissions (FDE form) from CSV"
          templateFilename="admissions_fde_template.csv"
          templateHeaders={ADMISSION_TEMPLATE_HEADERS}
          templateExample={ADMISSION_TEMPLATE_EXAMPLE}
          onImport={async (rows) => {
            const { data } = await client.post('/admissions/import', { rows });
            load();
            refreshStudents();
            return data;
          }}
        />
      )}

      {showForm && tab === 'admissions' && (
        <form onSubmit={handleAdmit} className="bg-white border border-ink/10 rounded-lg p-6 mb-8 grid grid-cols-1 sm:grid-cols-2 gap-4">
          {error && <p className="text-absent text-sm sm:col-span-2">{error}</p>}

          <div>
            <label className="block text-sm text-slate2 mb-1">Student</label>
            <select required value={admissionForm.studentId} onChange={(e) => pickStudent(e.target.value)} className="w-full border border-ink/20 rounded-md px-3 py-2 bg-white">
              <option value="">Select student</option>
              {sortedStudents.map((s) => <option key={s.id} value={s.id}>{s.firstName} {s.lastName} ({s.admissionNumber})</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm text-slate2 mb-1">Academic year</label>
            <input required value={admissionForm.academicYear} onChange={(e) => setAdmissionForm({ ...admissionForm, academicYear: e.target.value })} className="w-full border border-ink/20 rounded-md px-3 py-2" />
          </div>
          <div>
            <label className="block text-sm text-slate2 mb-1">Class</label>
            <select value={admissionForm.classId} onChange={(e) => pickClass(e.target.value)} className="w-full border border-ink/20 rounded-md px-3 py-2 bg-white">
              <option value="">Leave unchanged</option>
              {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm text-slate2 mb-1">Section</label>
            <select
              value={admissionForm.section}
              onChange={(e) => setAdmissionForm({ ...admissionForm, section: e.target.value })}
              disabled={sectionOptions.length === 0}
              className="w-full border border-ink/20 rounded-md px-3 py-2 bg-white disabled:bg-paper disabled:text-slate2"
            >
              <option value="">{sectionOptions.length === 0 ? 'No sections on this class' : 'None'}</option>
              {sectionOptions.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <p className="text-xs text-slate2 sm:col-span-2 -mt-1">
            Class and section are the student's placement — saving this admission moves them there.
            They're pre-filled from where the student sits now.
          </p>
          <div>
            <label className="block text-sm text-slate2 mb-1">Previous school</label>
            <input value={admissionForm.previousSchool} onChange={(e) => setAdmissionForm({ ...admissionForm, previousSchool: e.target.value })} className="w-full border border-ink/20 rounded-md px-3 py-2" />
          </div>
          <div>
            <label className="block text-sm text-slate2 mb-1">Documents received</label>
            <input placeholder="Birth Certificate, Transfer Certificate" value={admissionForm.documentsReceived} onChange={(e) => setAdmissionForm({ ...admissionForm, documentsReceived: e.target.value })} className="w-full border border-ink/20 rounded-md px-3 py-2" />
          </div>

          <div className="sm:col-span-2 pt-2 border-t border-ink/10">
            <p className="text-xs text-slate2">
              The sections below are the FDE (Federal Directorate of Education) admission form — all optional.
              Name, gender, date of birth, guardian/father details, religion, contact info, orphan status and
              student group are already captured on the Students page and don't need to be re-entered here.
            </p>
          </div>

          <FormSection title="1. Personal Details">
            <SelectField label="CNIC / B-Form available?" value={formDetail.cnicOrFormAvailable} onChange={(v) => setDetail('cnicOrFormAvailable', v)} options={[['YES', 'Yes'], ['NO', 'No']]} />
            <SelectField label="Province of birth" value={formDetail.provinceOfBirth} onChange={(v) => setDetail('provinceOfBirth', v)} options={PROVINCE_OPTIONS} />
            <TextField label="District of birth" value={formDetail.districtOfBirth} onChange={(v) => setDetail('districtOfBirth', v)} />
            <SelectField label="Receiving girls stipend?" value={formDetail.receivingGirlsStipend} onChange={(v) => setDetail('receivingGirlsStipend', v)} options={[['YES', 'Yes'], ['NO', 'No']]} />
            <SelectField label="Nationality" value={formDetail.nationality} onChange={(v) => setDetail('nationality', v)} options={NATIONALITY_OPTIONS} />
            {formDetail.nationality === 'OTHER' && (
              <TextField label="Nationality (specify)" value={formDetail.nationalityOther} onChange={(v) => setDetail('nationalityOther', v)} />
            )}
            <TextField label="Domicile district (if Pakistani)" value={formDetail.domicileDistrict} onChange={(v) => setDetail('domicileDistrict', v)} />
            <SelectField label="Domicile province (if Pakistani)" value={formDetail.domicileProvince} onChange={(v) => setDetail('domicileProvince', v)} options={PROVINCE_OPTIONS} />

            <SelectField label="Permanent address type" value={formDetail.permanentAddressType} onChange={(v) => setDetail('permanentAddressType', v)} options={ADDRESS_TYPE_OPTIONS} />
            <TextField label="Sector / Housing Society / Village" value={formDetail.permanentAddressDetail} onChange={(v) => setDetail('permanentAddressDetail', v)} />
            <TextField label="House no." value={formDetail.permanentHouseNo} onChange={(v) => setDetail('permanentHouseNo', v)} />
            <TextField label="Street no." value={formDetail.permanentStreetNo} onChange={(v) => setDetail('permanentStreetNo', v)} />
            <TextField label="Contact number / WhatsApp" value={formDetail.whatsappNumber} onChange={(v) => setDetail('whatsappNumber', v)} />

            <TextField label="Present postal address — City" value={formDetail.presentCity} onChange={(v) => setDetail('presentCity', v)} />
            <SelectField label="Present address type" value={formDetail.presentAddressType} onChange={(v) => setDetail('presentAddressType', v)} options={ADDRESS_TYPE_OPTIONS} />
            <TextField label="Present: Sector / Housing Society / Village" value={formDetail.presentAddressDetail} onChange={(v) => setDetail('presentAddressDetail', v)} />
            <TextField label="Present house no." value={formDetail.presentHouseNo} onChange={(v) => setDetail('presentHouseNo', v)} />
            <TextField label="Present street no." value={formDetail.presentStreetNo} onChange={(v) => setDetail('presentStreetNo', v)} />

            <SelectField label="Mother language" value={formDetail.motherLanguage} onChange={(v) => setDetail('motherLanguage', v)} options={LANGUAGE_OPTIONS} />
            <SelectField label="Blood group" value={formDetail.bloodGroup} onChange={(v) => setDetail('bloodGroup', v)} options={BLOOD_GROUP_OPTIONS} />
            <SelectField label="Is Hafiz?" value={formDetail.isHafiz} onChange={(v) => setDetail('isHafiz', v)} options={[['YES', 'Yes'], ['NO', 'No']]} />
          </FormSection>

          <FormSection title="2. Parents / Guardians">
            <SelectField label="Is father alive?" value={formDetail.fatherAlive} onChange={(v) => setDetail('fatherAlive', v)} options={[['YES', 'Yes'], ['NO', 'No']]} />
            <TextField label="Father landline" value={formDetail.fatherLandline} onChange={(v) => setDetail('fatherLandline', v)} />
            <TextField label="Father qualification" value={formDetail.fatherQualification} onChange={(v) => setDetail('fatherQualification', v)} />
            <SelectField label="Father profession" value={formDetail.fatherProfession} onChange={(v) => setDetail('fatherProfession', v)} options={PROFESSION_OPTIONS} />
            {formDetail.fatherProfession === 'OTHER' && (
              <TextField label="Father profession (specify)" value={formDetail.fatherProfessionOther} onChange={(v) => setDetail('fatherProfessionOther', v)} />
            )}
            <TextField label="Father income (per month)" type="number" value={formDetail.fatherIncome} onChange={(v) => setDetail('fatherIncome', v)} />
            <TextField label="Father BPS (if Govt. employee)" value={formDetail.fatherBps} onChange={(v) => setDetail('fatherBps', v)} />
            <SelectField label="Father domicile — province" value={formDetail.fatherDomicileProvince} onChange={(v) => setDetail('fatherDomicileProvince', v)} options={PROVINCE_OPTIONS} />
            <TextField label="Father domicile — district" value={formDetail.fatherDomicileDistrict} onChange={(v) => setDetail('fatherDomicileDistrict', v)} />

            <TextField label="Mother's name" value={formDetail.motherName} onChange={(v) => setDetail('motherName', v)} />
            <SelectField label="Is mother alive?" value={formDetail.motherAlive} onChange={(v) => setDetail('motherAlive', v)} options={[['YES', 'Yes'], ['NO', 'No']]} />
            <TextField label="Mother CNIC" value={formDetail.motherCnic} onChange={(v) => setDetail('motherCnic', v)} />
            <TextField label="Mother contact / WhatsApp" value={formDetail.motherContactNumber} onChange={(v) => setDetail('motherContactNumber', v)} />
            <TextField label="Mother landline" value={formDetail.motherLandline} onChange={(v) => setDetail('motherLandline', v)} />
            <TextField label="Mother email" value={formDetail.motherEmail} onChange={(v) => setDetail('motherEmail', v)} />
            <TextField label="Mother qualification" value={formDetail.motherQualification} onChange={(v) => setDetail('motherQualification', v)} />
            <SelectField label="Mother profession" value={formDetail.motherProfession} onChange={(v) => setDetail('motherProfession', v)} options={PROFESSION_OPTIONS} />
            {formDetail.motherProfession === 'OTHER' && (
              <TextField label="Mother profession (specify)" value={formDetail.motherProfessionOther} onChange={(v) => setDetail('motherProfessionOther', v)} />
            )}
            <TextField label="Mother income (per month)" type="number" value={formDetail.motherIncome} onChange={(v) => setDetail('motherIncome', v)} />
            <TextField label="Mother BPS (if Govt. employee)" value={formDetail.motherBps} onChange={(v) => setDetail('motherBps', v)} />

            <p className="sm:col-span-2 text-xs text-slate2 -mb-2">If orphan (see Students page for Orphan Type), the responsible guardian's details:</p>
            <TextField label="Guardian contact / WhatsApp" value={formDetail.orphanGuardianContact} onChange={(v) => setDetail('orphanGuardianContact', v)} />
            <TextField label="Guardian email" value={formDetail.orphanGuardianEmail} onChange={(v) => setDetail('orphanGuardianEmail', v)} />
            <TextField label="Guardian qualification" value={formDetail.orphanGuardianQualification} onChange={(v) => setDetail('orphanGuardianQualification', v)} />
            <SelectField label="Guardian profession" value={formDetail.orphanGuardianProfession} onChange={(v) => setDetail('orphanGuardianProfession', v)} options={PROFESSION_OPTIONS} />
            {formDetail.orphanGuardianProfession === 'OTHER' && (
              <TextField label="Guardian profession (specify)" value={formDetail.orphanGuardianProfessionOther} onChange={(v) => setDetail('orphanGuardianProfessionOther', v)} />
            )}
            <TextField label="Guardian income (per month)" type="number" value={formDetail.orphanGuardianIncome} onChange={(v) => setDetail('orphanGuardianIncome', v)} />
            <TextField label="Guardian BPS (if Govt. employee)" value={formDetail.orphanGuardianBps} onChange={(v) => setDetail('orphanGuardianBps', v)} />
          </FormSection>

          <FormSection title="3. Educational Details">
            <TextField label="Class group (grades 9-12 only)" value={formDetail.classGroupFde} onChange={(v) => setDetail('classGroupFde', v)} />
            <TextField label="Result / % of last class passed" value={formDetail.resultPercentageLastClass} onChange={(v) => setDetail('resultPercentageLastClass', v)} />
            <TextField label="Last institution attended under FDE" value={formDetail.lastInstitutionUnderFde} onChange={(v) => setDetail('lastInstitutionUnderFde', v)} />
            <TextField label="Last institution attended (other than FDE)" value={formDetail.lastInstitutionOther} onChange={(v) => setDetail('lastInstitutionOther', v)} />
            <SelectField label="Shift" value={formDetail.shift} onChange={(v) => setDetail('shift', v)} options={SHIFT_OPTIONS} />
            <SelectField label="Availing institutional meal program?" value={formDetail.availingMealProgram} onChange={(v) => setDetail('availingMealProgram', v)} options={[['YES', 'Yes'], ['NO', 'No']]} />
            <SelectField label="Medium of instruction" value={formDetail.mediumOfInstruction} onChange={(v) => setDetail('mediumOfInstruction', v)} options={MEDIUM_OPTIONS} />
            <TextField label="Years spent completing primary (I-V)" type="number" value={formDetail.yearsToCompletePrimary} onChange={(v) => setDetail('yearsToCompletePrimary', v)} />
            <SelectField label="Mode of study" value={formDetail.modeOfStudy} onChange={(v) => setDetail('modeOfStudy', v)} options={MODE_OF_STUDY_OPTIONS} />

            <TextField label="Total number of siblings" type="number" value={formDetail.totalSiblings} onChange={(v) => setDetail('totalSiblings', v)} />
            <TextField label="Siblings in other FDE institutions" type="number" value={formDetail.siblingsInOtherFdeInstitutions} onChange={(v) => setDetail('siblingsInOtherFdeInstitutions', v)} />
            <TextField label="Siblings in same institution" type="number" value={formDetail.siblingsInSameInstitution} onChange={(v) => setDetail('siblingsInSameInstitution', v)} />
            <TextField label="Siblings in private institutions" type="number" value={formDetail.siblingsInPrivateInstitutions} onChange={(v) => setDetail('siblingsInPrivateInstitutions', v)} />

            <SelectField label="Transport facility" value={formDetail.transportFacility} onChange={(v) => setDetail('transportFacility', v)} options={TRANSPORT_OPTIONS} />
            <SelectField label="Recipient of scholarship?" value={formDetail.isScholarshipRecipient} onChange={(v) => setDetail('isScholarshipRecipient', v)} options={[['YES', 'Yes'], ['NO', 'No']]} />
            {formDetail.isScholarshipRecipient === 'YES' && (
              <TextField label="Scholarship details" value={formDetail.scholarshipDetails} onChange={(v) => setDetail('scholarshipDetails', v)} />
            )}
            <SelectField label="Special co-curricular achievement?" value={formDetail.hasCoCurricularAchievement} onChange={(v) => setDetail('hasCoCurricularAchievement', v)} options={[['YES', 'Yes'], ['NO', 'No']]} />
            {formDetail.hasCoCurricularAchievement === 'YES' && (
              <TextField label="Achievement details" value={formDetail.achievementDetails} onChange={(v) => setDetail('achievementDetails', v)} />
            )}
          </FormSection>

          <FormSection title="4. Emergency Contact">
            <TextField label="Name" value={formDetail.emergencyContactName} onChange={(v) => setDetail('emergencyContactName', v)} />
            <TextField label="Contact number" value={formDetail.emergencyContactNumber} onChange={(v) => setDetail('emergencyContactNumber', v)} />
            <SelectField label="Relation" value={formDetail.emergencyContactRelation} onChange={(v) => setDetail('emergencyContactRelation', v)} options={RELATION_OPTIONS} />
            {formDetail.emergencyContactRelation === 'OTHER' && (
              <TextField label="Relation (specify)" value={formDetail.emergencyContactRelationOther} onChange={(v) => setDetail('emergencyContactRelationOther', v)} />
            )}
          </FormSection>

          <FormSection title="5. IDP Details" defaultOpen={false}>
            <SelectField label="Is student a refugee / IDP?" value={formDetail.isRefugeeOrIdp} onChange={(v) => setDetail('isRefugeeOrIdp', v)} options={[['YES', 'Yes'], ['NO', 'No']]} />
            <SelectField label="Registered as refugee?" value={formDetail.isRegisteredRefugee} onChange={(v) => setDetail('isRegisteredRefugee', v)} options={[['YES', 'Yes'], ['NO', 'No']]} />
            <TextField label="IDP status" value={formDetail.idpStatus} onChange={(v) => setDetail('idpStatus', v)} />
            <TextField label="Refugee card number" value={formDetail.refugeeCardNumber} onChange={(v) => setDetail('refugeeCardNumber', v)} />
          </FormSection>

          <FormSection title="6. Health Details" defaultOpen={false}>
            <SelectField label="Any major disability?" value={formDetail.hasMajorDisability} onChange={(v) => setDetail('hasMajorDisability', v)} options={[['YES', 'Yes'], ['NO', 'No']]} />
            <SelectField label="Disability certificate attached?" value={formDetail.disabilityCertificateAttached} onChange={(v) => setDetail('disabilityCertificateAttached', v)} options={[['YES', 'Yes'], ['NO', 'No']]} />
            <SelectField label="Disability type" value={formDetail.disabilityType} onChange={(v) => setDetail('disabilityType', v)} options={DISABILITY_TYPE_OPTIONS} />

            <SelectField label="Any mental disability?" value={formDetail.hasMentalDisability} onChange={(v) => setDetail('hasMentalDisability', v)} options={[['YES', 'Yes'], ['NO', 'No']]} />
            <SelectField label="Mental disability type" value={formDetail.mentalDisabilityType} onChange={(v) => setDetail('mentalDisabilityType', v)} options={MENTAL_DISABILITY_OPTIONS} />
            <TextField label="Other medical conditions / remarks" value={formDetail.otherMedicalConditions} onChange={(v) => setDetail('otherMedicalConditions', v)} />

            <SelectField label="Visually fit 6x6?" value={formDetail.isVisuallyFit6by6} onChange={(v) => setDetail('isVisuallyFit6by6', v)} options={[['YES', 'Yes'], ['NO', 'No']]} />
            <SelectField label="Wears glasses / contact lenses?" value={formDetail.wearsGlasses} onChange={(v) => setDetail('wearsGlasses', v)} options={[['YES', 'Yes'], ['NO', 'No']]} />
            <SelectField label="Difficulty seeing board / reading textbook" value={formDetail.difficultySeeingBoard} onChange={(v) => setDetail('difficultySeeingBoard', v)} options={DIFFICULTY_OPTIONS} />

            <SelectField label="Has hearing difficulties?" value={formDetail.hasHearingDifficulty} onChange={(v) => setDetail('hasHearingDifficulty', v)} options={[['YES', 'Yes'], ['NO', 'No']]} />
            <SelectField label="Using hearing aid?" value={formDetail.usesHearingAid} onChange={(v) => setDetail('usesHearingAid', v)} options={[['YES', 'Yes'], ['NO', 'No']]} />
            <TextField label="Hearing difficulty details" value={formDetail.hearingDifficultyDetails} onChange={(v) => setDetail('hearingDifficultyDetails', v)} />
            <SelectField label="Difficulty listening?" value={formDetail.difficultyListening} onChange={(v) => setDetail('difficultyListening', v)} options={[['YES', 'Yes'], ['NO', 'No']]} />

            <SelectField label="Difficulty walking?" value={formDetail.difficultyWalking} onChange={(v) => setDetail('difficultyWalking', v)} options={[['YES', 'Yes'], ['NO', 'No']]} />
            <SelectField label="Uses crutches / walker?" value={formDetail.usesCrutchesOrWalker} onChange={(v) => setDetail('usesCrutchesOrWalker', v)} options={[['YES', 'Yes'], ['NO', 'No']]} />

            <SelectField label="Difficulty reading / writing" value={formDetail.difficultyReadingWriting} onChange={(v) => setDetail('difficultyReadingWriting', v)} options={DIFFICULTY_OPTIONS} />
            <SelectField label="Difficulty remembering" value={formDetail.difficultyRemembering} onChange={(v) => setDetail('difficultyRemembering', v)} options={DIFFICULTY_OPTIONS} />
            <SelectField label="Difficulty concentrating" value={formDetail.difficultyConcentrating} onChange={(v) => setDetail('difficultyConcentrating', v)} options={DIFFICULTY_OPTIONS} />

            <SelectField label="Basic vaccination completed?" value={formDetail.basicVaccinationCompleted} onChange={(v) => setDetail('basicVaccinationCompleted', v)} options={[['YES', 'Yes'], ['NO', 'No']]} />
          </FormSection>

          <FormSection title="7. Digital Access" defaultOpen={false}>
            <SelectField label="Access to digital device at home?" value={formDetail.hasDigitalDeviceAtHome} onChange={(v) => setDetail('hasDigitalDeviceAtHome', v)} options={[['YES', 'Yes'], ['NO', 'No']]} />
            <TextField label="Device type" value={formDetail.digitalDeviceType} onChange={(v) => setDetail('digitalDeviceType', v)} />
            <SelectField label="Internet access at home?" value={formDetail.hasInternetAtHome} onChange={(v) => setDetail('hasInternetAtHome', v)} options={[['YES', 'Yes'], ['NO', 'No']]} />
          </FormSection>

          <div className="sm:col-span-2">
            <button type="submit" className="text-sm px-4 py-2 rounded-md bg-present text-white hover:opacity-90">Record admission</button>
          </div>
        </form>
      )}

      {showForm && tab === 'withdrawals' && (
        <form onSubmit={handleWithdraw} className="bg-white border border-ink/10 rounded-lg p-6 mb-8 grid grid-cols-1 sm:grid-cols-2 gap-4">
          {error && <p className="text-absent text-sm sm:col-span-2">{error}</p>}
          <div>
            <label className="block text-sm text-slate2 mb-1">Student</label>
            <select required value={withdrawalForm.studentId} onChange={(e) => setWithdrawalForm({ ...withdrawalForm, studentId: e.target.value })} className="w-full border border-ink/20 rounded-md px-3 py-2 bg-white">
              <option value="">Select student</option>
              {sortedStudents.filter((s) => s.status === 'REGULAR').map((s) => <option key={s.id} value={s.id}>{s.firstName} {s.lastName} ({s.admissionNumber})</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm text-slate2 mb-1">New status</label>
            <select required value={withdrawalForm.status} onChange={(e) => setWithdrawalForm({ ...withdrawalForm, status: e.target.value })} className="w-full border border-ink/20 rounded-md px-3 py-2 bg-white">
              <option value="STRUCK_OFF">Struck Off</option>
              <option value="SLC">SLC (School Leaving Certificate)</option>
              <option value="PASSOUT">Passout</option>
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="block text-sm text-slate2 mb-1">Reason</label>
            <input required value={withdrawalForm.reason} onChange={(e) => setWithdrawalForm({ ...withdrawalForm, reason: e.target.value })} className="w-full border border-ink/20 rounded-md px-3 py-2" />
          </div>
          <label className="flex items-center gap-2 text-sm text-slate2">
            <input type="checkbox" checked={withdrawalForm.transferCertIssued} onChange={(e) => setWithdrawalForm({ ...withdrawalForm, transferCertIssued: e.target.checked })} />
            Transfer certificate issued
          </label>
          <div className="sm:col-span-2">
            <button type="submit" className="text-sm px-4 py-2 rounded-md bg-absent text-white hover:opacity-90">Record exit</button>
          </div>
        </form>
      )}

      {tab === 'admissions' ? (
        <RecordTable
          rows={admissions}
          columns={['Student', 'Admission No.', 'Class', 'Section', 'Academic Year', 'Date', 'Documents']}
          renderRow={(a) => (
            <>
              <td className="px-4 py-3">{a.student.firstName} {a.student.lastName}</td>
              <td className="px-4 py-3 text-slate2">{a.student.admissionNumber}</td>
              <td className="px-4 py-3 text-slate2">{a.student.class?.name}</td>
              <td className="px-4 py-3 text-slate2">{a.student.section || '—'}</td>
              <td className="px-4 py-3 text-slate2">{a.academicYear}</td>
              <td className="px-4 py-3 text-slate2">{new Date(a.admissionDate).toLocaleDateString()}</td>
              <td className="px-4 py-3 text-slate2 text-xs">{a.documentsReceived || '—'}</td>
            </>
          )}
        />
      ) : (
        <RecordTable
          rows={withdrawals}
          columns={['Student', 'Admission No.', 'Class', 'Section', 'New Status', 'Reason', 'Date', 'Transfer Cert.']}
          renderRow={(w) => (
            <>
              <td className="px-4 py-3">{w.student.firstName} {w.student.lastName}</td>
              <td className="px-4 py-3 text-slate2">{w.student.admissionNumber}</td>
              <td className="px-4 py-3 text-slate2">{w.student.class?.name}</td>
              <td className="px-4 py-3 text-slate2">{w.student.section || '—'}</td>
              <td className="px-4 py-3 text-slate2">{w.status.replace('_', ' ')}</td>
              <td className="px-4 py-3 text-slate2">{w.reason}</td>
              <td className="px-4 py-3 text-slate2">{new Date(w.withdrawalDate).toLocaleDateString()}</td>
              <td className="px-4 py-3 text-slate2">{w.transferCertIssued ? 'Issued' : 'Pending'}</td>
            </>
          )}
        />
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

function RecordTable({ rows, columns, renderRow }) {
  return (
    <div className="bg-white border border-ink/10 rounded-lg overflow-x-auto">
      <table className="register-table w-full text-sm">
        <thead>
          <tr className="border-b border-ink/10 text-left">
            {columns.map((c) => <th key={c} className="px-4 py-3">{c}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td className="px-4 py-6 text-slate2" colSpan={columns.length}>No records yet.</td></tr>
          ) : (
            rows.map((r) => <tr key={r.id} className="border-b border-ink/5 last:border-0">{renderRow(r)}</tr>)
          )}
        </tbody>
      </table>
    </div>
  );
}

// A collapsible group of fields — keeps the (long) FDE form navigable.
// Uses native <details> so it needs no state of its own.
function FormSection({ title, defaultOpen = true, children }) {
  return (
    <details open={defaultOpen} className="sm:col-span-2 border border-ink/10 rounded-md">
      <summary className="cursor-pointer select-none px-4 py-2 text-sm font-medium text-ink bg-paper rounded-md">
        {title}
      </summary>
      <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-4">{children}</div>
    </details>
  );
}

function TextField({ label, value, onChange, type = 'text', placeholder }) {
  return (
    <div>
      <label className="block text-sm text-slate2 mb-1">{label}</label>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full border border-ink/20 rounded-md px-3 py-2"
      />
    </div>
  );
}

// options: array of [value, label] pairs.
function SelectField({ label, value, onChange, options, placeholder = 'Not stated' }) {
  return (
    <div>
      <label className="block text-sm text-slate2 mb-1">{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="w-full border border-ink/20 rounded-md px-3 py-2 bg-white">
        <option value="">{placeholder}</option>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </div>
  );
}
