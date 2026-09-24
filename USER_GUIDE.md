# ConstructFlow — Beginner’s Guide

A plain-language guide to what ConstructFlow is, who uses it, and how to use it day to day.

---

## What is ConstructFlow?

**ConstructFlow** is a project monitoring system for the **Provincial Engineer’s Office (PEO)** of Cagayan.

It helps the office:

- Track construction projects (roads, bridges, buildings, water, drainage, etc.)
- Build and view schedules (PDM network, bar chart, S-curve)
- Prepare official progress reports (**SWA**, **STEWA**, **IAR**)
- Send reports through an approval chain (Engineer I → II → III → IV)
- Let contractors confirm IAR reports
- Open finalized documents in an official printable layout

Think of it as a shared workspace: planners prepare schedules, field engineers submit progress, reviewers approve, and contractors confirm their side.

---

## Who uses it? (Roles)

| Role | Who they are | Main job in ConstructFlow |
|------|----------------|---------------------------|
| **Contractor** | The company doing the work | View their projects, prepare/confirm **IAR**, check schedules |
| **Engineer I** | Field / project engineer | Set up projects, PDM schedule, create **SWA / STEWA / IAR**, submit for review |
| **Engineer II** | First reviewer | Approve or request revision on submitted reports |
| **Engineer III** | Second reviewer | Check reports passed by Engineer II |
| **Engineer IV** | Final authority (Chief / Construction Division) | Final approval / finalize official documents |

**Important:** Each contractor and Engineer I/II only sees **projects they are assigned to**. Engineer III and IV can see more (often all projects). That is why different demo accounts show different lists of records.

---

## What are SWA, STEWA, and IAR?

These are the main official reports in the system.

### SWA — Statement of Work Accomplishment
- Detailed **pay-item table** (quantities, amounts, weight %, accomplishment)
- Shows how much work was done this period and to date
- Used for progress / payment support

### STEWA — Statement of Time Elapsed and Work Accomplished
- Time and progress summary (contract duration, days elapsed, % actual vs planned, slippage)
- Shorter narrative-style form than SWA

### IAR — Inspection Accomplishment Report
- Weekly inspection report (accomplishments, variation orders, manpower, equipment)
- Contractor usually helps prepare / must **confirm** before higher engineers finalize

After finalization, open any report with **View** to see the official form (letterhead, table, signature blocks).

---

## Main screens (sidebar)

Names change slightly by role, but these are the common areas:

| Menu | What it is for |
|------|----------------|
| **Dashboard** | Snapshot of your projects and report activity |
| **Projects** | Project list and details (Engineer I and some staff) |
| **Pay Item Master** | Master list of pay items (Engineer I / admin) |
| **Prepare Schedule / PDM Schedule** | Build the work sequence (activities + dependencies) |
| **Bar Chart** | Timeline bars from the schedule |
| **S-Curve** | Planned vs actual progress over time |
| **Reports / Documents** | List of reports; **View** opens the official document |
| **IAR** (contractor) | Create / manage IAR folders and drafts |
| **For Approval / My Submissions / Workflow** | Reports waiting for action or already submitted |

Always pick the right **project** in the project selector (top area) before editing schedules or charts.

---

## How the system fits together

```text
Projects
   └── Pay items / BOQ (bill of quantities)
   └── Schedule (PDM activities + dependencies)
         ├── Bar Chart (timeline view)
         └── S-Curve (progress curve)
   └── Reports (SWA / STEWA / IAR)
         └── Approval workflow
               └── Finalized document (View / Print)
```

1. A **project** is created and people are assigned (contractor + engineers).
2. **Pay items / BOQ** define what work can be billed.
3. **PDM** defines the sequence and duration of activities.
4. **Bar chart** and **S-curve** are derived from that schedule and updated by approved progress.
5. Engineers create **reports**; reviewers approve them.
6. Finalized reports appear under **Documents / Reports** for viewing and printing.

---

## Quick start — log in and explore

1. Open the app (local: usually `http://localhost:3000/` while `npm run dev` is running).
2. Go to **Login**.
3. Use an account from `DEMO_ACCOUNTS.md`.

**Suggested first try**

| Goal | Account | Password |
|------|---------|----------|
| See how a contractor works | `constructflow.contractor.1@gmail.com` | `contractor123` |
| Create reports & schedules | `constructflow.engineer1.1@gmail.com` | `engineer123` |
| Approve reports | `constructflow.engineer2.1@gmail.com` | `engineer123` |
| See all documents / final view | `constructflow.engineer4.1@gmail.com` | `engineer123` |

After login, ConstructFlow loads your **role automatically** — you do not pick the role yourself on each login.

---

## Beginner workflows

### A. Contractor — typical day

1. Log in as a contractor.
2. Open **Dashboard** — see your assigned projects only.
3. Open **IAR** to draft or continue an Inspection Accomplishment Report.
4. When asked to confirm, review the IAR and confirm (this unlocks the next engineer steps).
5. Open **Reports** to see finalized documents for your projects → click **View**.
6. Use **Bar Chart / S-Curve / PDM** to understand schedule status (read-focused for many contractor views).

### B. Engineer I — prepare schedule and reports

1. Log in as Engineer I.
2. Open **Projects** — pick or review your assigned project.
3. Open **Prepare Schedule** (or PDM):
   - Add activities (from BOQ / pay items when available)
   - Set durations and dependencies
   - Save — bar chart and S-curve update from this
4. Create a report:
   - Go to **Reports** → create **SWA**, **STEWA**, or **IAR** (or use the SWA/STEWA/IAR entry points)
   - Fill project fields, line items / accomplishment data, and signature names
   - **Save draft** while working
5. When ready:
   - For IAR: send to contractor for confirmation, then submit for Engineer II
   - For SWA/STEWA: submit according to the on-screen status buttons
6. Track status under **My Submissions / Workflow**.

### C. Engineer II / III / IV — review and finalize

1. Log in as Engineer II, III, or IV.
2. Open **For Approval (Workflow)** — reports waiting for your stage.
3. Open a report → review the data → **Approve** or **Request revision**.
4. When a report is fully finalized, open **Documents**:
   - Find the report in the register
   - Click **View** — official printable layout
   - Use **Print** if needed

Engineer IV is usually the last step that makes the document “final” for the register.

---

## Reading a finalized report

1. Go to **Documents** (or **Reports**).
2. Click **View** on a finalized SWA / STEWA / IAR.
3. You should see:
   - Provincial letterhead with **PGC** and **PEO** seals
   - Official title and project information
   - Tables / fields matching the report type
   - Signature blocks at the bottom (Prepared by, Checked by, etc.)
4. Use **Print** for a paper or PDF print dialog.

There is no separate “PDF / QR” button anymore for daily use — **View** is the report review page.

---

## Status words you will see

| Status | Meaning |
|--------|---------|
| **Draft** | Still being edited |
| **Pending contractor** | Waiting for contractor confirmation (often IAR) |
| **Contractor confirmed** | Contractor finished confirmation |
| **Pending review / With Engineer II–IV** | Moving through approval |
| **Revision requested** | Sent back for corrections |
| **Approved / Finalized / Generated** | Done — appears in Documents for viewing |

---

## Common questions

### Why do the 3 contractors see different records?
Each contractor is assigned to **different projects**. ConstructFlow only shows projects (and reports) that belong to that contractor. This matches real office practice.

### Why can’t I see another engineer’s project?
Same reason — access is limited to assigned projects (except higher roles like Engineer III/IV).

### Bar chart says missing permissions?
Usually you are logged in as a role that can **view** but not **edit** schedule settings. Viewing should still work; if it fails, try Engineer I on a project you are assigned to, or refresh after the latest fixes.

### Where do signature names come from?
They are entered on the report form (Prepared by, Checked by, etc.) before finalization. They are not invented by the View page.

### What project should I select?
Use the project dropdown. If charts look empty, you may be on a project with no schedule yet — open **Prepare Schedule / PDM** for that project first (as Engineer I).

---

## Suggested learning path (30–45 minutes)

1. Log in as **Engineer IV** → open **Documents** → **View** a few SWA / STEWA / IAR reports.  
   Goal: understand what a finished document looks like.
2. Log in as **Engineer I** → open **PDM / Schedule** for your project → look at activities.  
   Goal: see where the bar chart comes from.
3. Open **Bar Chart** and **S-Curve** for the same project.  
   Goal: connect schedule ↔ charts.
4. Log in as **Engineer II** → open **For Approval**.  
   Goal: see the review queue.
5. Log in as **Contractor 1** → open **Dashboard** and **IAR**.  
   Goal: see the contractor-limited project set.

---

## Demo accounts

Full list: see [`DEMO_ACCOUNTS.md`](./DEMO_ACCOUNTS.md).

- Contractors password: `contractor123`
- Engineers password: `engineer123`

To reset sample data (developers):

```bash
npm run seed:firebase
```

---

## One-sentence summary

**ConstructFlow** is the PEO’s digital workspace to plan construction schedules, submit SWA/STEWA/IAR progress reports, approve them by role, and view the official finalized documents — with each user only seeing the projects they are responsible for.
