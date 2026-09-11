# The Register — School Management System

A web-based school management system covering:

1. **Students** — complete records (personal, guardian, academic placement), CSV bulk import
2. **Attendance** — daily marking by class, per-student history
3. **Examinations** — exam setup, subject-wise marks entry, result sheets
4. **Admission / Withdrawal** — intake records and formal exit records
5. **Staff** — employee records, designation, department, employment type, CSV bulk import
6. **Bus Fee Collection** — routes, student & non-student passenger assignment, monthly fee tracking and dues
7. **Transport Maintenance & Repairs** — fuel, repair, servicing, and insurance expenses per bus, netted against fee collection

Built as two parts:
- `backend/` — Node.js + Express REST API, PostgreSQL database (via Prisma ORM), JWT authentication with roles (Admin, Teacher, Accountant, Staff)
- `frontend/` — React + Tailwind single-page app, responsive (works on phone browsers too)

---

## 1. How the pieces fit together

```
Browser (phone or desktop)
   │
   ▼
frontend (React)  ──HTTP──▶  backend (Express API)  ──▶  PostgreSQL database
```

Both parts are deployed separately. The frontend is a static site; the backend is a small server process; the database is a managed PostgreSQL instance. This is the standard, low-cost way to run something like this in the cloud.

---

## 2. Running it locally first (recommended before deploying)

You'll need [Node.js](https://nodejs.org) (v18+) installed on your computer.

### Backend

```bash
cd backend
cp .env.example .env
npm install
npx prisma migrate dev --name init   # creates the local database file and tables
npm run seed                         # creates a demo admin login and sample data
npm run dev                          # starts the API on http://localhost:4000
```

> Note: `npx prisma migrate dev` and `prisma generate` download a small database engine binary the first time you run them. This requires normal internet access — it will not work in a network-restricted sandbox, but works fine on your own computer or any cloud host.

Demo logins created by the seed script:
- **Admin:** `admin@school.edu` / `Admin@123`
- **Teacher:** `teacher@school.edu` / `Teacher@123`

**Change these passwords (or delete these accounts and create real ones) before putting this in front of real students' data.**

### Frontend

In a second terminal:

```bash
cd frontend
cp .env.example .env
npm install
npm run dev     # starts the app on http://localhost:5173
```

Open `http://localhost:5173` in your browser and sign in with the demo admin login above.

---

## 3. Deploying to the cloud

You have many options; here's a straightforward, low-cost path.

### Step A — Database (PostgreSQL)
Use a managed Postgres provider — e.g. **Railway**, **Render**, **Supabase**, or **Neon** all have free/low-cost tiers. Create a database and copy its connection string (looks like `postgresql://user:pass@host:5432/dbname`).

### Step B — Backend (API)
Deploy the `backend/` folder to **Railway** or **Render** (both support Node.js apps directly from a GitHub repo):
1. Push this project to a GitHub repository.
2. Create a new Web Service pointing at the `backend/` folder.
3. Set environment variables (from `.env.example`):
   - `DATABASE_URL` — your Postgres connection string from Step A
   - `JWT_SECRET` — a long random string (generate one, don't reuse the example)
   - `CORS_ORIGIN` — the URL your frontend will be hosted at (Step C)
4. Before first deploy, open `backend/prisma/schema.prisma` and change:
   ```
   provider = "sqlite"
   ```
   to
   ```
   provider = "postgresql"
   ```
5. Set the build command to `npm install && npx prisma generate && npx prisma migrate deploy`
   and the start command to `npm start`.
6. After the first successful deploy, run `npm run seed` once (via the platform's shell/console feature) to create your first admin login — or better, write your own seed with your real staff accounts.

### Step C — Frontend (static site)
Deploy the `frontend/` folder to **Vercel**, **Netlify**, or **Render Static Sites**:
1. Point it at the `frontend/` folder.
2. Build command: `npm run build`. Output directory: `dist`.
3. Set environment variable `VITE_API_URL` to your deployed backend's URL, e.g. `https://your-api.onrender.com/api`.

Once both are deployed, the frontend URL is what you share with staff — it works on any phone or desktop browser.

---

## 4. Student statuses

Every student has exactly one of four statuses:

| Status | Meaning | Appears in class list? |
|---|---|---|
| **Regular** | Currently enrolled, attending | Yes — this is the default view |
| **Struck Off** | Removed from rolls (e.g. non-payment, discipline, prolonged absence) | No — separate report |
| **SLC** | Left with a School Leaving Certificate (transferred elsewhere) | No — separate report |
| **Passout** | Completed and graduated | No — separate report |

The **Students** page always shows a status selector in the toolbar (defaults to Regular) and an inline status dropdown on every row, so you can switch views or change a student's status at any time — not only through the Admission/Withdrawal form. The **Reports** page gives each of the three non-regular statuses its own printable list. Changing status via Admission/Withdrawal also logs a reason and (optionally) transfer-certificate issuance for the record.

## 5. CSV bulk import

Both **Students** and **Staff** pages have an "Import CSV" button that:
1. Downloads a template with the exact column headers expected
2. Lets you upload a filled-in CSV (exported from Excel/Google Sheets as CSV)
3. Reports exactly which rows succeeded and which failed, with a reason for each failure (e.g. duplicate admission number, unrecognized class name)

For students, the CSV's `className` column must match an existing class name exactly (create classes first via the API or seed data). Nothing is silently guessed — mismatches are reported as errors so a spreadsheet typo can't quietly misfile a student.

## 6. Bus fee collection

The **Bus Fee Collection** page lets you:
- Create routes (name, vehicle number, driver, monthly fee)
- Assign **enrolled students** to a route from the **Students** page (inline dropdown, same pattern as status)
- Register **bus-only passengers** — riders who are NOT enrolled students, e.g. a junior-section child too young to be formally admitted, or a sibling who only rides the bus. These get their own lightweight record (name, guardian, pickup point) and are deliberately kept separate from the `Student` table so they never appear in class lists, attendance, or exam records — they only exist for billing.
- Record a payment per rider per month (works the same whether the rider is an enrolled student or a bus-only passenger)
- See, for any route and month, a combined dues list covering **everyone** riding that bus, not just enrolled students

## 7. Transport maintenance & repairs

The **Transport Maintenance & Repairs** page logs running costs per bus route: fuel, repairs, servicing, insurance, permits/tax, or other. Each entry records amount, date, vendor/workshop, and optionally an odometer reading. For any route and month it also shows a **net summary** — fees collected minus expenses — so you can see at a glance whether a route's fee is actually covering what it costs to run that bus.

## 8. User roles

| Role | Can do |
|---|---|
| **Admin** | Everything, including creating staff login accounts, staff records, and bus routes |
| **Teacher** | Manage students, attendance, exams/marks, admissions/withdrawals |
| **Accountant** | Manage students, attendance, admissions/withdrawals, bus routes and fee collection |
| **Staff** | Manage students, attendance, admissions/withdrawals, assign students to bus routes |

Only Admins can create new login accounts (`POST /api/auth/users`) and manage staff HR records. Only Admin/Accountant can create bus routes, record fee payments, and log transport expenses. Only Admins can delete a logged expense.

---

## 9. Project structure

```
school-erp/
├── backend/
│   ├── prisma/
│   │   ├── schema.prisma      ← database schema (all 5 modules)
│   │   └── seed.js            ← demo data + admin login
│   └── src/
│       ├── index.js           ← server entry point
│       ├── middleware/auth.js ← JWT + role checks
│       └── routes/            ← one file per module
│           ├── auth.js
│           ├── students.js
│           ├── classes.js
│           ├── admissions.js
│           ├── attendance.js
│           ├── exams.js
│           ├── staff.js
│           └── bus.js
└── frontend/
    └── src/
        ├── pages/              ← one page per module (incl. BusFees.jsx, Reports.jsx)
        ├── components/         ← Layout, PageHeader, ProtectedRoute, CSVImportPanel
        ├── utils/csv.js        ← CSV parsing + template download
        ├── context/AuthContext.jsx
        └── api/client.js       ← talks to the backend
```

---

## 9. Extending it further

Some natural next additions, in rough order of usefulness:
- **Report cards / PDF exports** for exam results and bus fee receipts
- **Fee management module** for tuition fees (separate from bus fees)
- **SMS/email notifications** to guardians for absences and bus fee dues
- **Photo uploads** for student/staff ID cards (the schema already has `photoUrl` fields ready for this)
- **Audit log** of who changed what (the schema already tracks who marked attendance)

If you want help with any of these, just ask.
