// CA01/CA03 (US15) — captura de erros em produção (Sentry). Sentry precisa
// ser exigido antes de qualquer outro módulo pra instrumentar chamadas
// HTTP/DB automaticamente (guia oficial do SDK Node). Só ativa se
// SENTRY_DSN estiver configurado no ambiente — sem DSN, a landing roda
// exatamente como hoje, mesmo raciocínio de "sem credencial, recurso fica
// inerte" já usado no POSTHOG_KEY (GET /config-publica acima).
const Sentry = require('@sentry/node');
// CA03 — nunca manda payload de erro com senha/token em texto puro. Duplicado
// intencionalmente do mesmo helper em server/panel/index.js — são deploys
// separados, sem módulo compartilhado entre landing e painel.
const CAMPOS_SENSIVEIS_SENTRY = /senha|password|token|jwt|authorization|cookie|cvv|numero_cartao|card_number/i;
function limparDadosSensiveisSentry(event) {
  const limpar = (obj) => {
    if (!obj || typeof obj !== 'object') return;
    for (const chave of Object.keys(obj)) {
      if (CAMPOS_SENSIVEIS_SENTRY.test(chave)) obj[chave] = '[redacted]';
      else if (obj[chave] && typeof obj[chave] === 'object') limpar(obj[chave]);
    }
  };
  if (event.request) {
    limpar(event.request.data);
    limpar(event.request.headers);
    delete event.request.cookies;
  }
  return event;
}
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',
    sendDefaultPii: false,
    beforeSend: limparDadosSensiveisSentry,
  });
}

const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public-studio')));

// Conexão com PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Criar tabela ao iniciar (se não existir)
async function initDB() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS lista_espera (
        id SERIAL PRIMARY KEY,
        nome TEXT NOT NULL,
        email TEXT NOT NULL,
        whatsapp TEXT,
        nicho TEXT,
        idioma TEXT DEFAULT 'pt',
        criado_em TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    console.log('✅ Tabela lista_espera pronta');

    await pool.query(`
      CREATE TABLE IF NOT EXISTS diagnosticos (
        id SERIAL PRIMARY KEY,
        nome TEXT NOT NULL,
        respostas JSONB NOT NULL,
        score INTEGER NOT NULL,
        plano_sugerido TEXT,
        criado_em TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    console.log('✅ Tabela diagnosticos pronta');
  } catch (err) {
    console.error('❌ Erro ao criar tabela:', err.message);
  }
}

// Rota principal — serve a landing page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public-studio', 'index.html'));
});

// GET /config-publica — expõe só a chave pública do PostHog pro front (US47),
// nunca a chave de servidor. Sem POSTHOG_KEY configurada no ambiente,
// analytics.js recebe posthogKey: null e não inicializa o tracking.
app.get('/config-publica', (req, res) => {
  res.json({
    posthogKey: process.env.POSTHOG_KEY || null,
    posthogHost: process.env.POSTHOG_HOST || 'https://us.i.posthog.com',
  });
});

// POST /waitlist — salva lead no banco
app.post('/waitlist', async (req, res) => {
  const { nome, email, whatsapp, nicho, idioma } = req.body;

  // Validação básica
  if (!nome || !nome.trim()) {
    return res.status(400).json({ error: 'Nome é obrigatório' });
  }
  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'E-mail inválido' });
  }

  try {
    // Verificar se e-mail já está na lista
    const existing = await pool.query(
      'SELECT id FROM lista_espera WHERE email = $1',
      [email.toLowerCase().trim()]
    );

    if (existing.rows.length > 0) {
      return res.status(200).json({
        success: true,
        message: 'already_registered'
      });
    }

    // Inserir novo lead
    await pool.query(
      `INSERT INTO lista_espera (nome, email, whatsapp, nicho, idioma)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        nome.trim(),
        email.toLowerCase().trim(),
        whatsapp ? whatsapp.trim() : null,
        nicho || null,
        idioma || 'pt'
      ]
    );

    console.log(`✅ Novo lead: ${email} — nicho: ${nicho}`);

    return res.status(201).json({
      success: true,
      message: 'registered'
    });

  } catch (err) {
    console.error('❌ Erro ao salvar lead:', err.message);
    return res.status(500).json({ error: 'Erro interno' });
  }
});

// POST /diagnostico — salva as respostas do quiz de diagnóstico (lead gen)
app.post('/diagnostico', async (req, res) => {
  const { nome, respostas, score, plano } = req.body;

  if (!nome || !nome.trim()) {
    return res.status(400).json({ error: 'Nome é obrigatório' });
  }
  if (typeof score !== 'number') {
    return res.status(400).json({ error: 'Score inválido' });
  }

  try {
    await pool.query(
      `INSERT INTO diagnosticos (nome, respostas, score, plano_sugerido)
       VALUES ($1, $2, $3, $4)`,
      [nome.trim(), JSON.stringify(respostas || {}), score, plano || null]
    );

    console.log(`✅ Novo diagnóstico: ${nome} — score: ${score}%`);

    return res.status(201).json({ success: true });
  } catch (err) {
    console.error('❌ Erro ao salvar diagnóstico:', err.message);
    return res.status(500).json({ error: 'Erro interno' });
  }
});

// GET /waitlist/count — contador público de inscritos
app.get('/waitlist/count', async (req, res) => {
  try {
    const result = await pool.query('SELECT COUNT(*) FROM lista_espera');
    return res.json({ count: parseInt(result.rows[0].count) });
  } catch (err) {
    return res.json({ count: 0 });
  }
});

// CA01 (US15) — precisa vir depois de todas as rotas (e antes de qualquer
// error handler customizado, que não existe aqui) — é o que faz exceções não
// tratadas em qualquer rota chegarem no Sentry, sem precisar de try/catch
// manual espalhado pelo código.
if (process.env.SENTRY_DSN) Sentry.setupExpressErrorHandler(app);

// Iniciar servidor
initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`🚀 Kyvvo landing page rodando na porta ${PORT}`);
  });
});
