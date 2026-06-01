import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey:            "AIzaSyC1JGXIYJQ4KG3Jt0QEPEvgGRnYN-5aqII",
  authDomain:        "drivers-eyes.firebaseapp.com",
  projectId:         "drivers-eyes",
  storageBucket:     "drivers-eyes.firebasestorage.app",
  messagingSenderId: "927214965437",
  appId:             "1:927214965437:web:6318775a4f7f718ae31dd4",
};

export const fbApp = initializeApp(firebaseConfig);
export const auth  = getAuth(fbApp);
export const db    = getFirestore(fbApp);
