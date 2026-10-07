# ETAIROS PV-MS Operations Tracker

A responsive tracker for photovoltaic (PV) and mounting system (MS) project records. It includes account verification and approval, role-based access, server-side SQLite storage, import preview and merge, location matching, reports, Google Drive reading, and JSON backup/restore.

## Project structure

- `public/` contains the browser app and its CSS/JavaScript assets.
- `routes/`, `controllers/`, `middleware/`, and `database/` contain the server API and storage code.
- `server.js`, `package.json`, and `.env.example` stay at the project root.
- `data/` is created automatically for the SQLite database and is excluded from version control.

## Requirements

- Node.js 22 or later
- npm

## Install and run

1. Install dependencies:

   ```sh
   npm install
   ```

2. Copy `.env.example` to `.env`. Set `JWT_SECRET` to a long random value and set `BOOTSTRAP_ADMIN_EMAIL` to the Gmail address that will administer the workspace.

   PowerShell can generate a secret with:

   ```powershell
   node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
   ```

3. Start the server:

   ```sh
   npm start
   ```

   For development with automatic server restarts:

   ```sh
   npm run dev
   ```

4. Open `http://localhost:3000`. Register the `BOOTSTRAP_ADMIN_EMAIL` address, verify it, and sign in. The initial administrator is approved automatically. Other registrations wait for administrator approval.

The database is created at `data/etairos.sqlite` by default and starts with **zero PV records, zero MS records, and zero merged locations**. No workbook is loaded at startup. Change `DATABASE_PATH` to store the database somewhere else.

## Email verification

The development server can display a one-time verification code on screen when SMTP is not configured. That behavior is disabled in production. For delivered email, set:

- `SMTP_HOST=smtp.gmail.com`
- `SMTP_PORT=587`
- `SMTP_USER` to the sending Gmail address
- `SMTP_PASS` to a Google App Password
- `MAIL_FROM` to the sender name and address

Do not use your regular Gmail password. In production, configure a long `JWT_SECRET` and SMTP before starting the server.

## Google Sign-In and Drive

Create a Google OAuth **Web application** client ID. Add the app origin (for local use, `http://localhost:3000`) to its authorized JavaScript origins, then set `GOOGLE_CLIENT_ID` in `.env` and restart the server. Enable the Google Drive API in the associated Google Cloud project for Drive browsing.

Google Sign-In verifies the Gmail identity. New Google accounts still need administrator approval, except the configured bootstrap administrator. Drive uses a read-only user access token in the browser; selected spreadsheets are parsed locally and sent to the same server-side preview and merge endpoints used for uploaded files.

## Excel import format

Upload `.xlsx` or `.xls` workbooks with worksheets named `PV` and `MS` (case-insensitive). Common header variants are recognized, including:

| PV worksheet | MS worksheet |
| --- | --- |
| Date | Date |
| Site | Location/Block |
| Location/Block | Table Type |
| Table Type | MS Planned |
| PV % Complete | MS Installed |
| Manpower / PV Manpower | MS % Complete |
| Remarks | MS Installed By |
|  | Inspection Status / Inspection Date |
|  | Billed Date / Payment Status |
|  | Remarks / Notes / ADAWSHAT / GenCon / GenCon 2 / OE |

The import preview validates each row and identifies duplicates with the key `database type + normalized Location/Block + Date`. Use Excel date cells or ISO dates (`YYYY-MM-DD`) to avoid ambiguity. Only valid new rows are sent to merge. Existing records are kept, and duplicate records are skipped. A later import follows the same process.

Required data: PV rows need Date, Site, and Location/Block. MS rows need Date and Location/Block. PV and MS completion must be from 0 to 100. MS Installed is blank or from 0 to 100. Rows that fail validation are counted as invalid and are not imported.

## Overall status and matching

The merged tracker groups records by normalized Location/Block and shows the latest PV and latest MS record for each location. A location remains in the tracker when only one database has a record. Complete locations progress through `COMPLETED`, `FOR BILLING`, `BILLED`, or `PAID`; all payment values are informational and the system does not process payments.

## Roles

- **ADMIN** — approve/reject users, assign roles, manage records, import, export, and restore backups.
- **SUPERVISOR** — add/edit records, import, view, and export reports/backups.
- **STAFF** — add/edit records and import; cannot delete or export.
- **VIEWER** — view dashboard, databases, merged tracker, and reports.

The first verified account matching `BOOTSTRAP_ADMIN_EMAIL` becomes the initial administrator. Do not leave this value set to a placeholder in a deployed environment.

## Reports and backup

Reports can be exported as CSV. The full Excel workbook contains `PV`, `MS`, `Merged Tracker`, and `Reports` sheets. Admins and supervisors can download a JSON data backup. JSON restore is admin-only: merge adds new keys and skips existing ones; replace deletes current PV/MS records before restoring and requires an explicit confirmation. User accounts and authentication secrets are not included in backups.

## Storage and deployment

SQLite stores records, password hashes, account approvals, and short-lived verification-code hashes on the server. Excel upload contents are held in memory for parsing and are not saved as uploaded files. Use HTTPS behind a production web server, set `NODE_ENV=production`, and provide a persistent writable `DATABASE_PATH`. The SQLite setup is intended for a single application host; multi-instance deployments should use a shared database and session strategy.

Keep `.env`, the `data/` directory, and database backups private. The example environment file contains placeholders only.
