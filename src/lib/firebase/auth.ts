import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  type User as FirebaseUser,
} from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { isValidRole, NO_ROLE_MESSAGE, type Role, type User } from '../../types';
import { COLLECTIONS } from './collections';
import { auth, db } from './config';
import { nowIso } from './ids';

export { NO_ROLE_MESSAGE };

export function mapUserDoc(uid: string, data: Record<string, unknown>): User | null {
  if (!isValidRole(data.role)) return null;
  return {
    id: uid,
    email: String(data.email ?? ''),
    role: data.role,
    name: String(data.fullName ?? data.name ?? ''),
  };
}

export async function fetchUserProfile(uid: string): Promise<User | null> {
  const snap = await getDoc(doc(db, COLLECTIONS.users, uid));
  if (!snap.exists()) return null;
  return mapUserDoc(uid, snap.data() as Record<string, unknown>);
}

export async function ensureUserProfile(
  fbUser: FirebaseUser,
  profile: { role: Role; fullName: string },
): Promise<User> {
  const ref = doc(db, COLLECTIONS.users, fbUser.uid);
  const snap = await getDoc(ref);
  if (snap.exists()) {
    const mapped = mapUserDoc(fbUser.uid, snap.data() as Record<string, unknown>);
    if (!mapped) throw new Error(NO_ROLE_MESSAGE);
    return mapped;
  }
  const payload = {
    email: fbUser.email ?? '',
    fullName: profile.fullName,
    role: profile.role,
    isActive: true,
    createdAt: nowIso(),
  };
  await setDoc(ref, payload);
  const mapped = mapUserDoc(fbUser.uid, payload);
  if (!mapped) throw new Error(NO_ROLE_MESSAGE);
  return mapped;
}

/** Sign in with credentials only. Role comes from Firestore users/{uid}. */
export async function firebaseLogin(email: string, password: string): Promise<User> {
  const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
  const snap = await getDoc(doc(db, COLLECTIONS.users, cred.user.uid));
  if (!snap.exists()) {
    await signOut(auth);
    throw new Error(NO_ROLE_MESSAGE);
  }
  const data = snap.data() as Record<string, unknown>;
  if (data.isActive === false) {
    await signOut(auth);
    throw new Error('This account is inactive.');
  }
  const profile = mapUserDoc(cred.user.uid, data);
  if (!profile) {
    await signOut(auth);
    throw new Error(NO_ROLE_MESSAGE);
  }
  return profile;
}

export async function firebaseLogout() {
  await signOut(auth);
}

export function subscribeAuth(callback: (user: User | null) => void) {
  return onAuthStateChanged(auth, async (fbUser) => {
    if (!fbUser) {
      callback(null);
      return;
    }
    try {
      const profile = await fetchUserProfile(fbUser.uid);
      if (!profile) {
        await signOut(auth);
        callback(null);
        return;
      }
      callback(profile);
    } catch {
      callback(null);
    }
  });
}

/** Used by the seed script only — creates Auth user + Firestore profile. */
export async function seedAuthUser(input: {
  email: string;
  password: string;
  fullName: string;
  role: Role;
}) {
  let uid: string;
  try {
    const cred = await createUserWithEmailAndPassword(auth, input.email, input.password);
    uid = cred.user.uid;
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    if (code !== 'auth/email-already-in-use') throw err;
    const cred = await signInWithEmailAndPassword(auth, input.email, input.password);
    uid = cred.user.uid;
  }
  await setDoc(
    doc(db, COLLECTIONS.users, uid),
    {
      email: input.email,
      fullName: input.fullName,
      role: input.role,
      isActive: true,
      createdAt: nowIso(),
    },
    { merge: true },
  );
  return uid;
}
