const http = require('http');
const fs = require('fs');
const path = require('path');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const PORT = process.env.PORT || 4173;
// Em produção o nginx serve /ds/ (tokens.css, components.css/js). Nos specs
// usamos o repositório irmão kyvvo-design-system (ou DS_DIR) — sem isso o JS do
// menu ⋯ (.ds-acoes), abas e switches não carrega e os cliques não fazem nada.
const DS_DIR = process.env.DS_DIR || path.join(__dirname, '..', '..', '..', '..', 'kyvvo-design-system');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
};

http
  .createServer((req, res) => {
    const urlPath = req.url.split('?')[0];
    // Espelha a rota dinâmica `/admin/tenants/:id` registrada no Fastify real
    // (US28/CA01) — aqui não existe arquivo físico com esse nome.
    const rota = /^\/admin\/tenants\/[^/]+$/.test(urlPath) ? '/admin/tenant-detalhe.html' : urlPath;
    const ehDs = rota.startsWith('/ds/') && fs.existsSync(DS_DIR);
    const filePath = ehDs
      ? path.join(DS_DIR, rota.slice('/ds/'.length))
      : path.join(PUBLIC_DIR, rota === '/' ? '/index.html' : rota);

    if (!filePath.startsWith(ehDs ? DS_DIR : PUBLIC_DIR)) {
      res.writeHead(403);
      return res.end('Forbidden');
    }

    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        return res.end('Not found');
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
      res.end(data);
    });
  })
  .listen(PORT, () => {
    console.log(`Static panel server ouvindo na porta ${PORT}`);
  });
