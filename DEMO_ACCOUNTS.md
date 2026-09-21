# ConstructFlow Demo Accounts

One account per role. Password for all:

**Password:** `engineer123`

---

| Role | Email | Password |
|------|-------|----------|
| Engineer I | `engineer1@gmail.com` | `engineer123` |
| Engineer II | `engineer2@gmail.com` | `engineer123` |
| Engineer III | `engineer3@gmail.com` | `engineer123` |
| Engineer IV | `engineer4@gmail.com` | `engineer123` |
| Contractor | `contractor@gmail.com` | `engineer123` |

---

## Quick copy

```
engineer1@gmail.com
engineer2@gmail.com
engineer3@gmail.com
engineer4@gmail.com
contractor@gmail.com
```

Sign in at `/login` — role is loaded from Firestore after login.

## Reseed

```bash
npm run seed:firebase
```
