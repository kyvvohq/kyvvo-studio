-- Coluna nova pra tela de Disparos mostrar o texto de fato enviado (com os
-- parâmetros já substituídos) — até aqui só se gravava o nome do template
-- (ex.: "studio_confirmar_agenda_2"), nunca o texto renderizado. A Meta só
-- recebe os parâmetros separados (enviarTemplate), nunca o texto montado,
-- então isso precisa ser reconstruído no nosso lado no momento do disparo
-- (lib/automacoes.js:renderizarCorpoTemplate) — não dá pra recuperar depois
-- se o template mudar na Meta. Nullable: linhas antigas ficam sem esse
-- texto (a tela mostra "—").
alter table whatsapp_disparos add column mensagem_texto text;

-- whatsapp_fila guarda o item entre "decidiu enfileirar" (fora do horário
-- comercial) e "processou de fato" (processarFilaWhatsapp) — precisa
-- carregar o texto já calculado no momento do enfileiramento, senão o
-- worker perderia essa informação na hora de gravar em whatsapp_disparos.
alter table whatsapp_fila add column mensagem_texto text;
