import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import { getFunctions } from 'firebase/functions';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

function assertConfig() {
  if (!firebaseConfig.apiKey || !firebaseConfig.projectId) {
    throw new Error(
      'Firebase is not configured. Set NEXT_PUBLIC_FIREBASE_* values in .env.local',
    );
  }
}

export function getFirebaseApp() {
  assertConfig();
  return getApps().length ? getApp() : initializeApp(firebaseConfig);
}

export const app = typeof window !== 'undefined' ? getFirebaseApp() : null;
export const auth = typeof window !== 'undefined' ? getAuth(getFirebaseApp()) : (null as never);
export const db = typeof window !== 'undefined' ? getFirestore(getFirebaseApp()) : (null as never);
export const storage =
  typeof window !== 'undefined' ? getStorage(getFirebaseApp()) : (null as never);
export const functions =
  typeof window !== 'undefined' ? getFunctions(getFirebaseApp()) : (null as never);
