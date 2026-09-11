# Section dropdowns + bus fee discount

Four changes:

1. **Attendance** — a Section dropdown beside the Class picker, so marking
   9-B shows only 9-B. The Attendance % report on the Reports page has the
   same filter.
2. **Examinations** — an exam can now cover *specific sections* of a class
   instead of always the whole class, and the result sheet has a Section
   dropdown to narrow the marks entry list.
3. **Admission** — Class and Section dropdowns on the admission form.
   Saving the admission **moves the student** to that class/section; both
   tables gained a Section column.
4. **Bus Fee Collection** — bus fee **discounts**, with a reason
   (sibling / paid in advance / orphan / other). Each rider can have a
   standing discount that pre-fills the payment form, and any single
   month can be overridden without disturbing it.

## Files changed (drop-in replace over your existing project)

**Backend**

- `backend/prisma/schema.prisma` — `ExamClass.sections`;
  `BusFeePayment.grossFee` / `.discount` / `.discountReason`;
  `busFeeDiscount` + `busFeeDiscountReason` on both `Student` and
  `BusPassenger`
- `backend/prisma/migrations/20260830090000_catch_up_drift/migration.sql`
  — **new**. `TeacherClass.section` and `Staff.category` are both in
  schema.prisma and both exist in your dev.db, but no migration ever
  created them (the folder named `add_staff_category` actually rebuilds
  the Holiday table — it never touches Staff). Without this, a fresh
  deploy against an empty database is missing both columns and Teacher
  Access + Staff break. See the note below before running anything.
- `backend/prisma/migrations/20260830090100_sections_and_bus_discount/migration.sql`
  — **new**, the seven columns above. All nullable or defaulted, so
  existing rows keep working: a NULL `ExamClass.sections` means "whole
  class" (how every exam behaved before), and `discount = 0` with a NULL
  `grossFee` is exactly a pre-discount payment.
- `backend/prisma/dev.db` — your **existing** database, with both
  migrations already applied, so all your current data is intact: 175
  students (146 REGULAR), your staff, classes, bus routes, fee records
  and login accounts, unchanged. Both new migrations are recorded in its
  ledger, so `migrate status` reports it clean. If you'd rather migrate
  your own copy instead of using this file, see the note below.
- `backend/src/routes/attendance.js` — `GET /` and `GET /report` accept
  `?section=`. In the report it's applied to *both* halves of the
  percentage so they can't disagree.
- `backend/src/routes/exams.js` — `POST /` accepts an optional
  `sectionsByClassId` map (`{ "14": ["A","B"] }`); `GET /:id/results`
  builds a per-class `OR` from the stored scopes instead of one flat
  class list, then applies `?section=` on top as a view filter.
- `backend/src/routes/admissions.js` — `POST /` accepts optional
  `classId` + `section` and updates the student's placement in the same
  transaction. Also switched `create` → `upsert`: `studentId` is unique,
  so re-recording an admission used to return a bare 500.
- `backend/src/routes/bus.js` — **new** `POST /riders/discount` (ADMIN,
  ACCOUNTANT) sets a rider's standing discount; `GET /riders` and
  `GET /dues` now return fee / discount / net payable per rider (`/dues`
  also totals `totalExpected`); `POST /payments` accepts `grossFee`,
  `discount`, `discountReason` and rejects a discount above the fee;
  `GET /expenses/summary` and `GET /fleet-summary` report
  `discountsGiven`.

**Frontend**

- `frontend/src/utils/sections.js` — **new**. `sectionsFor()` (moved out
  of TeacherAccess.jsx) and `sectionsForMany()` for the pages that pick
  several classes at once. The CSV→list logic was already duplicated in
  two places and five more call sites needed it.
- `frontend/src/pages/Attendance.jsx` — Section dropdown; hidden when the
  class defines no sections, and cleared when the class changes
- `frontend/src/pages/Exams.jsx` — section checkboxes under each ticked
  class in the create form (none ticked = whole class), a Section filter
  on the result sheet, and sections shown in the exam label / Class
  column (e.g. `9 — A, B`)
- `frontend/src/pages/Admissions.jsx` — Class + Section selects,
  pre-filled from the student's current placement; Section column in both
  tables
- `frontend/src/pages/BusFees.jsx` — Discount column and a "Set
  discount" action in the rider table; the payment form gained Route fee
  (read-only), Discount, Reason and a live net payable; a third
  "Discounts given" stat tile
- `frontend/src/pages/Reports.jsx` — Section filter on the Attendance %
  report
- `frontend/src/pages/TeacherAccess.jsx`, `frontend/src/pages/Students.jsx`
  — import-only: they now use `utils/sections.js`. No behaviour change.

## After copying these files in

Because `dev.db` is included with both migrations already applied, there
is **no migration to run**. Just regenerate the Prisma client so it knows
about the new fields:

```
cd backend
npx prisma generate
npm run dev
```

### If you'd rather migrate your own dev.db instead

Don't copy `backend/prisma/dev.db` in, and run this instead. Your
database already has `TeacherClass.section` and `Staff.category`, and
SQLite has no `ADD COLUMN IF NOT EXISTS` — so the catch-up migration has
to be *marked* applied rather than executed, or it errors on a duplicate
column:

```
cd backend
npx prisma migrate resolve --applied 20260830090000_catch_up_drift
npx prisma migrate deploy
npx prisma generate
npm run dev
```

On a **fresh, empty** database, skip the `resolve` line — there
`migrate deploy` should genuinely run the catch-up migration, which is
the whole point of adding it.

Either way, use `migrate deploy`, **not `migrate dev`**: `migrate dev`
notices the drift those two columns represent and offers to reset the
database, which would delete your 175 student records.

`npx prisma migrate status` should report no pending migrations and no
drift.

## How it behaves now

- **Sections come from the class**, exactly as on the Students page — a
  class's `sections` field (`"A, B, C"`) drives every new dropdown, so
  there's nothing extra to configure. Classes with no sections defined
  simply don't show the filter.
- Changing the class **clears** the selected section, since section A of
  class 9 and section A of class 8 aren't the same group.
- Every new filter defaults to **whole class**, so all five pages behave
  exactly as before until a section is chosen.
- **Attendance** and the **Attendance % report** only ever list REGULAR
  students, so the section counts are of currently-enrolled students —
  struck-off, SLC and passout students aren't shown in either.
- **Exams**: an exam covering "class 9 whole + class 8 section A" gives a
  result sheet of class 9's students plus only 8-A. Filtering that sheet
  to section B correctly returns class 9's B students and nothing from
  class 8, because class 8 is scoped to A. Existing exams have no
  section scope stored and so still cover whole classes.
- **Admission** is confirm-or-change, not a blank form: picking a student
  pre-fills their current class and section, so saving never silently
  wipes a section. Leaving Class on "Leave unchanged" records the
  admission without moving the student. Re-recording an admission for the
  same student updates it instead of failing.
- **Bus discounts** are two separate things:
  - A **standing discount** on the rider (sibling discounts, typically) —
    set once, applies every month from then on, and pre-fills each
    payment. Set it to 0 to remove it.
  - The **discount on one month's payment**, pre-filled from the standing
    one but freely editable. Overriding a month leaves the standing
    discount untouched.
- `BusFeePayment.amount` still means **what was actually received** —
  i.e. already net of the discount. So the existing "fees collected" and
  net-income figures stay correct, and `discountsGiven` is reported
  *alongside* them rather than subtracted again. The amount field also
  stays editable after the discount is applied, so partial payments still
  work.
- A discount larger than the fee is rejected by the API, and the reason
  is shown on the form. A discount of 0 stores no reason.

## Known gap (pre-existing, not introduced here)

`backend/src/utils/classAccess.js` scopes teachers by **class only** — it
reads `TeacherClass.classId` and ignores `TeacherClass.section`. A
teacher assigned to 9-B can therefore still see and mark all of class 9,
including 9-A. The new section dropdowns are a *convenience* filter, not
a permission boundary. Worth a separate pass if teachers should be
section-restricted.

---

# Teacher Access changes

Two changes to the Teacher Access module:

1. Teacher login now uses **mobile number** instead of email.
2. Creating a teacher account **pulls name + mobile straight from an
   existing Staff record** — no more manual typing. Admin picks a teacher
   from a "Choose teacher" dropdown (only staff who don't already have a
   login account show up), and the account is created from that Staff row.

## Files changed (drop-in replace over your existing project)

- `backend/prisma/schema.prisma` — `User.email` is now optional, added
  `User.phone` (unique, used as the TEACHER login field)
- `backend/prisma/migrations/20260829120000_teacher_login_by_phone/migration.sql`
  — new migration for the above
- `backend/prisma/dev.db` — your **existing** dev database, with that
  migration already applied so your current data (including your two demo
  teacher accounts) still works. If you'd rather apply the migration
  yourself against your own dev.db instead of using this file, just run
  `npx prisma migrate deploy` after copying the schema + migration folder.
- `backend/src/routes/auth.js` — login now accepts `identifier` (email OR
  phone) instead of a hardcoded `email` field; `POST /auth/users` builds
  TEACHER accounts from `staffId` instead of typed name/email
- `backend/src/routes/staff.js` — `GET /staff` supports
  `?availableForLogin=true` (staff with no linked login account yet) for
  the "Choose teacher" dropdown
- `frontend/src/pages/TeacherAccess.jsx` — rebuilt: staff picker instead
  of name/email inputs, table shows "Mobile" instead of "Email"
- `frontend/src/pages/Login.jsx` — field relabeled "Email or mobile
  number", accepts either
- `frontend/src/context/AuthContext.jsx` — `login()` now takes
  `identifier` instead of `email`

## After copying these files in

```
cd backend
npx prisma generate     # regenerate the Prisma client for the new `phone` field
npm run dev
```

## How it behaves now

- **Existing** ADMIN/ACCOUNTANT/STAFF accounts, and your two existing demo
  teacher accounts (which already had emails) — unaffected, still log in
  with email exactly as before.
- **New teacher accounts**: on the Teacher Access page, an admin picks a
  teacher from Staff (only those without an existing login show up), sets
  a temporary password, optionally assigns a class, and creates the
  account. That teacher then logs in with their **mobile number** (pulled
  from their Staff record) and that password.
- A staff member needs a phone number on file (in Staff) before an
  account can be created for them — if it's missing, the create button is
  disabled and the reason is shown in the mobile-number field.
- Once a Staff member has a login account, `Staff.userId` links back to
  their `User` row, so they no longer appear in the "Choose teacher"
  dropdown (each staff member gets one login).
