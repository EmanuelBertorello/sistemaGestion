import { initializeApp } from 'firebase/app';
import { getFirestore, collection, query, where, getDocs, updateDoc, arrayUnion } from 'firebase/firestore';

const app = initializeApp({
  apiKey: "AIzaSyCD6mhPkLrKJ85uyGj9p08jKC9lp84eJnY",
  authDomain: "bdcap-a3b7b.firebaseapp.com",
  projectId: "bdcap-a3b7b",
});

const db = getFirestore(app);

const snap = await getDocs(query(collection(db, 'BDmadre'), where('CUIL', '==', '27258511714')));

if (snap.empty) {
  console.log('No encontrado por CUIL. Probando CUIL_Definitiva...');
  const snap2 = await getDocs(query(collection(db, 'BDmadre'), where('CUIL_Definitiva', '==', '27258511714')));
  if (snap2.empty) { console.log('No encontrado.'); process.exit(1); }
}

for (const d of snap.docs) {
  const data = d.data();
  console.log(`Encontrado: ${data.Trabajador} | estado actual: ${data.estado}`);
  await updateDoc(d.ref, {
    estado: 'acepto',
    historialEstados: arrayUnion({
      estado: 'acepto',
      timestamp: new Date().toISOString(),
      por: 'admin',
      apodo: 'Admin'
    })
  });
  console.log('✓ Estado cambiado a acepto');
}

process.exit(0);
