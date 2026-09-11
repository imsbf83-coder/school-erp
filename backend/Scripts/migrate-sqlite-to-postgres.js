#!/usr/bin/env node
// One-time data copy: your local SQLite database (prisma/dev.db) -> the
// fresh Postgres database (Neon) your app will run on in the cloud.
//
// Run this AFTER, not before:
//   1. schema.prisma's datasource provider is "postgresql"
//   2. DATABASE_URL is set to your Neon connection string
//   3. `npx prisma migrate dev --name init` has been run against that
//      Neon database, so every table already exists there (empty)
//   4. `npx prisma generate` has been run, so @prisma/client reflects the
//      current (postgresql) schema
//
// Usage (from the backend/ folder):
//   npm install better-sqlite3 pg --no-save
//   node scripts/migrate-sqlite-to-postgres.js
//
// Why this can't just be done with Prisma directly: once schema.prisma
// says "postgresql", the generated Prisma Client can only talk to
// Postgres — there's no way to point one Prisma Client at two different
// database engines at once. So this script bypasses Prisma for the actual
// data movement: it reads rows straight out of the SQLite file with
// better-sqlite3, and writes them straight into Postgres with the `pg`
// driver. It still uses Prisma's own generated model metadata (the DMMF)
// to know each table's columns and types, so it can't drift out of sync
// with schema.prisma.
//
// Safe to re-run: it only INSERTs. If you need to start over, truncate
// the Postgres tables first (or drop and re-run `prisma migrate dev`).

const path = require('path');
const Database = require('better-sqlite3');
const { Client } = require('pg');
const { Prisma } = require('@prisma/client');

const SQLITE_PATH = path.join(__dirname, '..', 'prisma', 'dev.db');
const POSTGRES_URL = process.env.DATABASE_URL;

if (!POSTGRES_URL) {
  console.error('DATABASE_URL is not set. Set it to your Neon connection string and try again.');
  process.exit(1);
}

// Dependency order: every model appears only after every model it has a
// foreign key to, so inserts never hit a "referenced row doesn't exist
// yet" error. Derived by hand from schema.prisma's relations.
const MODEL_ORDER = [
  'User', 'Class', 'Vehicle', 'GradeScale', 'Exam',
  'Staff', 'TeacherClass', 'BusRoute', 'Student', 'Holiday',
  'Admission', 'AdmissionFormDetail', 'Withdrawal', 'AttendanceRecord',
  'ExamClass', 'ExamSubject', 'ExamResult', 'GradeBand',
  'BusPassenger', 'BusFeePayment', 'BusExpense',
];

function getModelColumns(modelName) {
  const model = Prisma.dmmf.datamodel.models.find((m) => m.name === modelName);
  if (!model) {
    throw new Error(
      `Model "${modelName}" not found in the generated client. ` +
      `Did you run "npx prisma generate" after switching schema.prisma to postgresql?`
    );
  }
  // Only real columns — relation fields (kind 'object') aren't stored
  // columns, they're Prisma's in-memory view of a foreign key.
  return model.fields.filter((f) => f.kind === 'scalar').map((f) => ({ name: f.name, type: f.type }));
}

function coerce(value, type) {
  if (value === null || value === undefined) return null;
  // SQLite has no real boolean type — Prisma stores it as 0/1.
  if (type === 'Boolean') return value === 1 || value === true;
  // SQLite stores DateTime as an ISO-ish text string; Postgres wants a
  // real Date/timestamp value, not the raw string.
  if (type === 'DateTime') return new Date(value);
  return value;
}

async function migrateModel(sqlite, pg, modelName) {
  const columns = getModelColumns(modelName);
  const colNames = columns.map((c) => c.name);

  let rows;
  try {
    rows = sqlite.prepare(`SELECT * FROM "${modelName}"`).all();
  } catch (err) {
    console.log(`  ${modelName}: no table in the source database, skipped (${err.message})`);
    return;
  }

  if (rows.length === 0) {
    console.log(`  ${modelName}: 0 rows`);
    return;
  }

  const colList = colNames.map((c) => `"${c}"`).join(', ');
  const placeholders = colNames.map((_, i) => `$${i + 1}`).join(', ');
  const insertSql = `INSERT INTO "${modelName}" (${colList}) VALUES (${placeholders})`;

  let inserted = 0;
  for (const row of rows) {
    const values = columns.map((c) => coerce(row[c.name], c.type));
    try {
      await pg.query(insertSql, values);
      inserted++;
    } catch (err) {
      console.error(`  ${modelName} row id=${row.id}: FAILED - ${err.message}`);
    }
  }
  console.log(`  ${modelName}: ${inserted}/${rows.length} rows copied`);

  // Every model uses an autoincrement `id`. Reset the sequence so the next
  // row the app creates doesn't collide with an id we just migrated in.
  await pg.query(
    `SELECT setval(pg_get_serial_sequence('"${modelName}"', 'id'), COALESCE((SELECT MAX(id) FROM "${modelName}"), 1))`
  );
}

async function main() {
  console.log(`Reading from ${SQLITE_PATH}`);
  const sqlite = new Database(SQLITE_PATH, { readonly: true });
  const pg = new Client({ connectionString: POSTGRES_URL });
  await pg.connect();
  console.log('Connected to Postgres.\n');

  for (const modelName of MODEL_ORDER) {
    await migrateModel(sqlite, pg, modelName);
  }

  await pg.end();
  sqlite.close();
  console.log('\nDone. Spot-check a few tables (e.g. Student, Admission) in Neon before pointing the live app at it.');
}

main().catch((err) => {
  console.error('\nMigration failed:', err);
  process.exit(1);
});
