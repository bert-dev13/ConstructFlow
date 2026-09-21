# Firebase setup (project: constructflow-c82cd)

## 1. Console prerequisites
1. Enable **Email/Password** in Firebase Authentication.
2. Create a **Firestore** database:  
   https://console.firebase.google.com/project/constructflow-c82cd/firestore  
   (Cloud Firestore API must be enabled — first-time Create Database.)
3. Enable **Storage**:  
   https://console.firebase.google.com/project/constructflow-c82cd/storage
4. Ensure `.env.local` has the web config (API key ends with `JVRN0`).

## 2. CLI access
The Firebase CLI account must be an Owner/Editor on `constructflow-c82cd`:

```bash
npx firebase login
npx firebase use constructflow-c82cd
npm run firebase:deploy:rules
```

If `firebase use` says the project is invalid, add your Google account under  
Firebase Console → Project settings → Users and permissions.

## 3. Seed demo accounts and projects
```bash
npm run seed:firebase
```
Demo password: `engineer123` (see `DEMO_ACCOUNTS.md`)

## 4. Optional Cloud Functions
```bash
cd functions && npm install && npm run build
cd .. && npx firebase deploy --only functions
```

## 5. Run the app
```bash
npm run dev
```
