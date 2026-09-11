// Avisos/anúncios do admin da Kyvvo (Produtos > Studio > Mensagens, ou
// "Kyvvo inteira") — extraído junto com lib/mensagens-admin.js. Autenticada
// (mesmo raciocínio do resto do painel: GET nunca é bloqueado por
// inadimplência, mas ainda exige sessão válida) — não é dado sensível, só
// não faz sentido mostrar antes do login.
const mensagensAdmin = require('../lib/mensagens-admin');

function registerMensagensRoutes(fastify) {
  fastify.get('/api/mensagens-ativas', { preHandler: [fastify.authenticate] }, async () => {
    const mensagens = await mensagensAdmin.buscarMensagensAtivas();
    return { mensagens };
  });
}

module.exports = { registerMensagensRoutes };
