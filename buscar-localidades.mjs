import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyCD6mhPkLrKJ85uyGj9p08jKC9lp84eJnY",
  authDomain: "bdcap-a3b7b.firebaseapp.com",
  projectId: "bdcap-a3b7b",
  storageBucket: "bdcap-a3b7b.firebasestorage.app",
  messagingSenderId: "740396452335",
  appId: "1:740396452335:web:b8d225f64b28557c950e1a"
};

const PALABRAS_CLAVE = [
  'bermude', 'beltran', 'timbue', 'puerto san martin', 'san martin',
  'san lorenzo', 'olivero', 'maciel', 'geronimo', 'santa fe'
];

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

console.log('Consultando Firestore...\n');

const snap = await getDocs(collection(db, 'BDmadre'));

const todas = new Set();
for (const d of snap.docs) {
  const loc = (d.data()['Localidad_Ocurrencia'] ?? '').toString().trim();
  if (loc) todas.add(loc);
}

console.log(`Total localidades únicas en BDmadre: ${todas.size}\n`);
console.log('--- Localidades que matchean las ciudades buscadas ---\n');

const coincidencias = new Map();
for (const loc of todas) {
  const locLower = loc.toLowerCase();
  for (const kw of PALABRAS_CLAVE) {
    if (locLower.includes(kw)) {
      if (!coincidencias.has(kw)) coincidencias.set(kw, []);
      coincidencias.get(kw).push(loc);
      break;
    }
  }
}

for (const [kw, locs] of coincidencias) {
  console.log(`[${kw}]`);
  for (const l of [...new Set(locs)].sort()) console.log(`  → "${l}"`);
}

if (coincidencias.size === 0) {
  console.log('No se encontraron coincidencias.');
  console.log('\nPrimeras 50 localidades disponibles:');
  [...todas].sort().slice(0, 50).forEach(l => console.log(`  "${l}"`));
}

process.exit(0);
