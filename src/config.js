// Load a local .env file when present (Node 20.12+). Hosting platforms set real env vars instead.
try { if (require('fs').existsSync('.env')) process.loadEnvFile('.env'); } catch {}

// Central configuration. Every value can be overridden with an environment variable.
const env = process.env;

const config = {
  // local | uat | production. UAT and local show a banner on every page and allow wiping test data.
  appEnv: ['local', 'uat', 'production'].includes(env.APP_ENV) ? env.APP_ENV : 'production',
  port: Number(env.PORT || 3000),
  databaseUrl: env.DATABASE_URL || 'postgres://udaan:udaan@localhost:54329/udaan',
  dbSsl: env.DB_SSL === 'true' || /supabase|neon|render\.com/.test(env.DATABASE_URL || ''),
  // Public URL of the site, used inside QR codes and WhatsApp image links.
  publicBaseUrl: (env.PUBLIC_BASE_URL || `http://localhost:${env.PORT || 3000}`).replace(/\/$/, ''),
  sessionSecret: env.SESSION_SECRET || 'change-me-before-going-live',

  pins: {
    admin: env.ADMIN_PIN || '9999',
    gate: env.GATE_PIN || '1111',
    stage: env.STAGE_PIN || '2222',
  },

  event: {
    name: 'Udaan B2C Trade Fair',
    org: 'JITO Meerut',
    date: 'Wednesday, 21 October 2026',
    time: '12 PM – 9 PM',
    venue: 'Wheeler Club, Meerut',
    ticketPrefix: env.TICKET_PREFIX || 'UDN',
    defaultCountryCode: env.DEFAULT_COUNTRY_CODE || '91',
    rounds: Number(env.DRAW_ROUNDS || 5),
    gridSize: 100,
  },

  whatsapp: {
    token: env.WA_TOKEN || '',
    phoneNumberId: env.WA_PHONE_NUMBER_ID || '',
    apiVersion: env.WA_API_VERSION || 'v21.0',
    passTemplate: env.WA_TEMPLATE_PASS || 'udaan_entry_pass',
    winnerTemplate: env.WA_TEMPLATE_WINNER || 'udaan_lucky_draw_winner',
    lang: env.WA_TEMPLATE_LANG || 'en',
    mode: ['session', 'reply'].includes(env.WA_MODE) ? env.WA_MODE : 'template',
    passButton: env.WA_PASS_BUTTON === 'true',
    appSecret: env.WA_APP_SECRET || '',
    wabaId: env.WA_WABA_ID || '',
    // Your WhatsApp business number in international format, digits only (e.g. 919876543210). Used for "Message us" buttons.
    businessNumber: (env.WA_BUSINESS_NUMBER || '').replace(/\D/g, ''),
    concurrency: Number(env.WA_CONCURRENCY || 8),
    winnerDelayMs: Number(env.WA_WINNER_DELAY_MS || 12000),
  },

  // "Powered by DAILY LOOM by Tushar Jain" links to this WhatsApp number (digits with country code, e.g. 919876543210).
  poweredByWhatsapp: (env.POWERED_BY_WHATSAPP || '').replace(/\D/g, ''),

  sheetsWebhookUrl: env.SHEETS_WEBHOOK_URL || '',
  keepAliveUrl: env.KEEPALIVE_URL || '',
};

config.whatsapp.live = Boolean(config.whatsapp.token && config.whatsapp.phoneNumberId);

module.exports = config;
