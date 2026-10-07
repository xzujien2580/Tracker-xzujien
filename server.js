require('dotenv').config();
const crypto = require('node:crypto');
const path = require('node:path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const { db } = require('./database/db');
const authRoutes = require('./routes/auth');
const { router: recordRoutes } = require('./routes/records');
const importRoutes = require('./routes/imports');
const adminRoutes = require('./routes/admin');

if (!process.env.JWT_SECRET) {
  if (process.env.NODE_ENV === 'production') throw new Error('Set JWT_SECRET before starting in production.');
  process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex');
  console.warn('JWT_SECRET is unset. Using a temporary development secret; sessions end when the server restarts.');
}
if (process.env.NODE_ENV === 'production' && (process.env.JWT_SECRET.length < 32 || process.env.JWT_SECRET.includes('replace-with'))) throw new Error('Set a unique JWT_SECRET with at least 32 characters in production.');
if (String(process.env.BOOTSTRAP_ADMIN_EMAIL || '').trim() && !/^[^@\s]+@gmail\.com$/i.test(process.env.BOOTSTRAP_ADMIN_EMAIL.trim())) throw new Error('BOOTSTRAP_ADMIN_EMAIL must be a Gmail address.');
if (!String(process.env.BOOTSTRAP_ADMIN_EMAIL || '').trim()) console.warn('BOOTSTRAP_ADMIN_EMAIL is empty. New registrations will remain pending until an administrator account is configured.');

const app = express();
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || (process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1');
const publicDir = path.join(__dirname, 'public');
const corsOrigins = String(process.env.CORS_ORIGINS || '').split(',').map(item => item.trim()).filter(Boolean);

app.disable('x-powered-by');
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", 'https://accounts.google.com', 'https://apis.google.com'],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
      imgSrc: ["'self'", 'data:', 'https://lh3.googleusercontent.com'],
      connectSrc: ["'self'", 'https://accounts.google.com', 'https://www.googleapis.com', 'https://www.gstatic.com'],
      frameSrc: ['https://accounts.google.com'],
      objectSrc: ["'none'"],
      baseUri: ["'self'"]
    }
  }
}));
app.use(cors({ origin(origin, callback) {
  if (!origin) return callback(null, true);
  if (corsOrigins.includes(origin)) return callback(null, true);
  callback(null, false);
} }));
app.use(express.json({ limit: '35mb' }));
app.use(express.urlencoded({ extended: false, limit: '2mb' }));

const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 600, standardHeaders: 'draft-8', legacyHeaders: false });
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 25, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Too many sign-in attempts. Please wait and try again.' } });
app.use('/api', apiLimiter);
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api', recordRoutes);
app.use('/api/import', importRoutes);
app.use('/api/admin', adminRoutes);
app.get('/api/config', (_req, res) => res.json({ googleClientId: process.env.GOOGLE_CLIENT_ID || '', driveEnabled: Boolean(process.env.GOOGLE_CLIENT_ID), smtpConfigured: Boolean(process.env.SMTP_USER && process.env.SMTP_PASS), bootstrapAdminConfigured: Boolean(String(process.env.BOOTSTRAP_ADMIN_EMAIL || '').trim()), developmentMode: process.env.NODE_ENV !== 'production' }));
app.use('/vendor', express.static(path.join(__dirname, 'node_modules', 'xlsx', 'dist'), { maxAge: '1d', fallthrough: false }));
app.get('/', (_req, res) => res.sendFile(path.join(publicDir, 'index.html')));
app.get('/README.md', (_req, res) => res.sendFile(path.join(__dirname, 'README.md')));
for (const asset of ['styles.css','modal-scroll.css','layout-fixes.css','app.js','config.js']) {
  app.get(`/${asset}`, (_req, res) => res.sendFile(path.join(publicDir, asset)));
}
app.get('/{*splat}', (req, res, next) => {
  if (req.path === '/api' || req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(publicDir, 'index.html'));
});
app.use((req, res) => res.status(404).json({ error: req.path === '/api' || req.path.startsWith('/api/') ? 'API endpoint not found.' : 'Page not found.' }));
app.use((error, _req, res, _next) => {
  if (res.headersSent) return;
  console.error('Request failed:', error.message);
  if (error.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'Workbook is too large. Maximum file size is 25 MB.' });
  const status = error.status || error.statusCode || 500;
  res.status(status).json({ error: status >= 500 ? 'Something went wrong. Please try again.' : error.message });
});

db.prepare('DELETE FROM verification_codes WHERE expires_at < ?').run(Date.now());
db.prepare('DELETE FROM revoked_tokens WHERE expires_at < ?').run(Date.now());
app.listen(port, host, () => console.log(`ETAIROS PV-MS Operations Tracker running at http://${host}:${port}`));
