import type { User } from '../types';
import { firebaseLogin, firebaseLogout, fetchUserProfile } from './firebase/auth';
import { auth } from './firebase/config';

export async function authMe() {
  const current = auth.currentUser;
  if (!current) return { user: null as User | null };
  const user = await fetchUserProfile(current.uid);
  return { user };
}

export async function authLogin(email: string, password: string) {
  const user = await firebaseLogin(email, password);
  return { user };
}

export async function authLogout() {
  await firebaseLogout();
  return { ok: true };
}
