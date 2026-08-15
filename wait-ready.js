// wait-ready.js
const http = require('http');
const start = Date.now();
function check() {
  http.get('http://127.0.0.1:3000/api/levels', r => {
    console.log('ready in', Date.now() - start, 'ms, status:', r.statusCode);
    process.exit(0);
  }).on('error', () => {
    if (Date.now() - start > 5000) { console.log('timeout'); process.exit(1); }
    setTimeout(check, 200);
  });
}
check();
