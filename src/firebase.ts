import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";
import { getAuth, GoogleAuthProvider } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyD6COF9ktfL4-fKpPEOBT5oi7CEJ6GryDQ",
  authDomain: "fir-neu01.firebaseapp.com",
  databaseURL: "https://fir-neu01-default-rtdb.firebaseio.com",
  projectId: "fir-neu01",
  storageBucket: "fir-neu01.firebasestorage.app",
  messagingSenderId: "177966018706",
  appId: "1:177966018706:web:9946a726ec3c7d13c6f64b"
};

const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
