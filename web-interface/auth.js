/**
 * AttendX — auth.js  (fixed — no more auth swallowing timeout)
 */

import {
  onAuthStateChanged,
  signInWithPopup,
  GoogleAuthProvider,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
  signOut,
  setPersistence,
  browserLocalPersistence,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import { auth } from "./firebase-config.js";

// ── Public state ─────────────────────────────────────────────
export let currentUser = null;

// ── Set persistence once at module load ──────────────────────
setPersistence(auth, browserLocalPersistence).catch(err => {
  console.warn("[Auth] Could not set persistence:", err.code);
});

export function watchAuthState(onSignIn, onSignOut) {
  onAuthStateChanged(auth, (user) => {
    currentUser = user;
    if (user) {
      onSignIn(user);
    } else {
      onSignOut();
    }
  });
}

export async function loginWithGoogle() {
  const provider = new GoogleAuthProvider();
  try {
    await signInWithPopup(auth, provider);
  } catch (err) {
    return authErrorMessage(err.code);
  }
  return null;
}

export async function loginWithEmail(email, password) {
  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (err) {
    return authErrorMessage(err.code);
  }
  return null;
}

export async function registerWithEmail(email, password, displayName) {
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    if (displayName) {
      await updateProfile(cred.user, { displayName });
    }
  } catch (err) {
    return authErrorMessage(err.code);
  }
  return null;
}

export async function logout() {
  await signOut(auth);
}

function authErrorMessage(code) {
  const map = {
    "auth/invalid-email":           "Invalid email address.",
    "auth/user-not-found":          "No account found with this email.",
    "auth/wrong-password":          "Incorrect password.",
    "auth/email-already-in-use":    "An account already exists with this email.",
    "auth/weak-password":           "Password must be at least 6 characters.",
    "auth/too-many-requests":       "Too many attempts. Please try again later.",
    "auth/network-request-failed":  "Network error. Check your connection.",
    "auth/popup-closed-by-user":   "Sign-in popup was closed. Try again.",
    "auth/cancelled-popup-request": "Only one sign-in window at a time.",
    "auth/unauthorized-domain":     "This domain is not authorised for sign-in.",
    "auth/user-disabled":           "This account has been disabled.",
  };
  return map[code] || `Sign-in error: ${code}`;
}