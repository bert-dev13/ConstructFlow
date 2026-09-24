# ConstructFlow

Automated workflow database system for **email-based progress monitoring** at the Cagayan Provincial Engineer's Office.

## Contract features

| Feature | Status | Route / Location |
|---------|--------|------------------|
| PDM scheduling & critical path | Implemented (demo data) | `/pdm` |
| Bar chart schedule | Implemented (demo data) | `/bar-chart` |
| S-curve analysis | Implemented (demo data) | `/s-curve` |
| SWA / STEWA / Progress reports | UI + schema ready | `/reports` |
| Email approval workflow | PHP API + UI | `/workflow`, `api/reports.php` |
| QR document verification | UI + API | `/verify?qr=...` |
| Engineer I–IV + Contractor roles | Implemented | `/roles` |

## Quick start

**XAMPP (Apache):**
```bash
npm install
npm run build
```
The Next.js static export is written to `out/`. Apache serves it from
[http://localhost/ConstructFlow/](http://localhost/ConstructFlow/) alongside the PHP API.

**Development (hot reload):**
```bash
npm run dev
```
Open [http://localhost:3000/ConstructFlow/](http://localhost:3000/ConstructFlow/)

## Database (XAMPP)

1. Start Apache + MySQL in XAMPP
2. In phpMyAdmin, click **`peo_monitoring`** in the left sidebar
3. Import **`database/install.sql`** (one file — drops old tables and creates fresh)
4. PHP API: `http://localhost/ConstructFlow/api/`

If you only need to add missing tables without wiping data, use `database/schema.sql` instead.

## Accounts

See `DEMO_ACCOUNTS.md` for the full list of ConstructFlow accounts.

**New to the system?** Start with [`USER_GUIDE.md`](./USER_GUIDE.md) — what ConstructFlow is for, who uses it, and how to use each part.

- Contractors use password `contractor123`
- Engineers I-IV use password `engineer123`

## Approval workflow

1. **Engineer I** prepares and submits SWA / STEWA / Progress report
2. **Engineer II** receives email with Approve / Revise buttons
3. On approval → forwarded to **Engineer III** for final checking
4. **Approved** status visible on all accounts; contractor receives PDF copy with QR code

## Still needed for full contract delivery

- Client-provided SWA, STEWA, and Progress Report PDF templates
- PDF generation library (e.g. TCPDF/FPDF) with embedded QR codes
- SMTP configuration for production email (XAMPP `mail()` or PHPMailer)
- Connect frontend forms to PHP API (currently demo/mock data)
- Pilot testing and revision log per contract Section 4.7

## Stack

- **Frontend:** Next.js App Router, React, TypeScript, Tailwind CSS, Recharts
- **Backend:** PHP 8+, MySQL
- **Serve:** `npm run build` → Apache serves the static `out/` export under `/ConstructFlow/`
