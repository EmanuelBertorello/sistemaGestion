const fs = require('fs');
fs.copyFileSync('dist/my-app/browser/index.csr.html', 'dist/my-app/browser/index.html');
console.log('index.html copiado correctamente.');
