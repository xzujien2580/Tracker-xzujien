const express = require('express');
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const { OAuth2Client } = require('google-auth-library');
const { db, userByEmail, userById, publicUser } = require('../database/db');
const { authenticate } = require('../middleware/auth');
const router = express.Router();
const gmailPattern = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@gmail\.com$/i;
const bootstrapEmail = () => String(process.env.BOOTSTRAP_ADMIN_EMAIL || '').trim().toLowerCase();
function validGmail(email) { return gmailPattern.test(String(email || '').trim()); }
function issueToken(user) { return jwt.sign({ sub: user.id, role: user.role, jti: crypto.randomUUID() }, process.env.JWT_SECRET, { expiresIn: '12h' }); }
function loginResponse(user) { return { token: issueToken(user), user: publicUser(user) }; }
function configuredMailer() {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) return null;
  return nodemailer.createTransport({ host: process.env.SMTP_HOST || 'smtp.gmail.com', port: Number(process.env.SMTP_PORT || 587), secure: Number(process.env.SMTP_PORT || 587) === 465, auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } });
}

router.post('/request-code', async (req, res) => {
  const name = String(req.body.name || '').trim(), email = String(req.body.email || '').trim().toLowerCase(), password = String(req.body.password || '');
  if (!name || name.length > 100) return res.status(400).json({ error: 'Enter your full name.' });
  if (!validGmail(email)) return res.status(400).json({ error: 'Use a valid Gmail address ending in @gmail.com.' });
  if (password.length < 8 || Buffer.byteLength(password, 'utf8') > 72) return res.status(400).json({ error: 'Password must be at least 8 characters and no more than 72 UTF-8 bytes.' });
  if (userByEmail.get(email)) return res.status(409).json({ error: 'An account with this Gmail address already exists.' });
  const code = String(crypto.randomInt(100000, 1000000));
  const passwordHash = await bcrypt.hash(password, 12), codeHash = await bcrypt.hash(code, 10);
  db.prepare(`INSERT INTO verification_codes(email,name,password_hash,code_hash,expires_at) VALUES(?,?,?,?,?)
    ON CONFLICT(email) DO UPDATE SET name=excluded.name,password_hash=excluded.password_hash,code_hash=excluded.code_hash,expires_at=excluded.expires_at,created_at=CURRENT_TIMESTAMP`)
    .run(email, name, passwordHash, codeHash, Date.now() + 10 * 60 * 1000);
  const mailer = configuredMailer();
  if (mailer) {
    try {
      await mailer.sendMail({ from: process.env.MAIL_FROM || process.env.SMTP_USER, to: email, subject: 'Your ETAIROS verification code',
        text: `Your ETAIROS PV-MS Operations Tracker verification code is ${code}. It expires in 10 minutes.`,
        html: `<div style="font-family:Arial,sans-serif;color:#17263e"><h2>Verify your email</h2><p>Enter this code to finish creating your ETAIROS account:</p><p style="font-size:30px;font-weight:700;letter-spacing:8px">${code}</p><p>This code expires in 10 minutes.</p></div>` });
      return res.json({ message: 'Verification code sent. Check your Gmail inbox.' });
    } catch (error) {
      console.error('SMTP send failed:', error.message); db.prepare('DELETE FROM verification_codes WHERE email=?').run(email);
      return res.status(503).json({ error: 'Unable to send verification code. Check SMTP configuration.' });
    }
  }
  if (process.env.NODE_ENV === 'production') {
    db.prepare('DELETE FROM verification_codes WHERE email=?').run(email);
    return res.status(503).json({ error: 'Unable to send verification code. Check SMTP configuration.' });
  }
  res.json({ message: 'Development verification code created. Configure SMTP to deliver email.', developmentCode: code });
});

router.post('/verify-code', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase(), code = String(req.body.code || '').trim();
  if (!validGmail(email) || !/^\d{6}$/.test(code)) return res.status(400).json({ error: 'Enter a valid Gmail address and 6-digit code.' });
  const pending = db.prepare('SELECT * FROM verification_codes WHERE email=? COLLATE NOCASE').get(email);
  if (!pending || pending.expires_at < Date.now()) { db.prepare('DELETE FROM verification_codes WHERE email=?').run(email); return res.status(400).json({ error: 'Verification code expired or not found. Request a new code.' }); }
  if (!(await bcrypt.compare(code, pending.code_hash))) return res.status(400).json({ error: 'That verification code is incorrect.' });
  if (userByEmail.get(email)) { db.prepare('DELETE FROM verification_codes WHERE email=?').run(email); return res.status(409).json({ error: 'An account with this Gmail address already exists.' }); }
  const isBootstrap = bootstrapEmail() === email;
  const inserted = db.prepare('INSERT INTO users(name,email,password_hash,role,status,verified) VALUES(?,?,?,?,?,1)')
    .run(pending.name, email, pending.password_hash, isBootstrap ? 'ADMIN' : 'STAFF', isBootstrap ? 'APPROVED' : 'PENDING');
  db.prepare('DELETE FROM verification_codes WHERE email=?').run(email);
  const user = userById.get(inserted.lastInsertRowid);
  res.status(201).json({ message: isBootstrap ? 'Account created. You can now sign in as the initial administrator.' : 'Email verified. Your account is waiting for administrator approval.', status: user.status, user: publicUser(user) });
});

router.post('/login', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase(), password = String(req.body.password || '');
  if (!validGmail(email)) return res.status(400).json({ error: 'Use a valid Gmail address.' });
  const user = userByEmail.get(email);
  if (!user || !user.password_hash || !(await bcrypt.compare(password, user.password_hash))) return res.status(401).json({ error: 'Email or password is incorrect.' });
  if (!user.verified) return res.status(403).json({ error: 'Verify your email before signing in.', pending: true });
  if (user.status === 'PENDING') return res.status(403).json({ error: 'Your account is awaiting administrator approval.', pending: true });
  if (user.status === 'REJECTED') return res.status(403).json({ error: 'This account request was not approved. Contact your administrator.' });
  res.json(loginResponse(user));
});

router.post('/google', async (req, res) => {
  const credential = String(req.body.credential || '');
  if (!process.env.GOOGLE_CLIENT_ID) return res.status(503).json({ error: 'Google sign-in is not configured yet.' });
  if (!credential) return res.status(400).json({ error: 'Google did not return an identity token.' });
  try {
    const ticket = await new OAuth2Client(process.env.GOOGLE_CLIENT_ID).verifyIdToken({ idToken: credential, audience: process.env.GOOGLE_CLIENT_ID });
    const profile = ticket.getPayload(), email = String(profile.email || '').toLowerCase();
    if (!profile.email_verified || !validGmail(email)) return res.status(403).json({ error: 'Sign in with a verified Gmail account.' });
    let user = userByEmail.get(email); const isBootstrap = bootstrapEmail() === email;
    if (!user) {
      const inserted = db.prepare('INSERT INTO users(name,email,google_sub,role,status,verified) VALUES(?,?,?,?,?,1)')
        .run(profile.name || email.split('@')[0], email, profile.sub, isBootstrap ? 'ADMIN' : 'STAFF', isBootstrap ? 'APPROVED' : 'PENDING');
      user = userById.get(inserted.lastInsertRowid);
    } else if (!user.google_sub) {
      db.prepare('UPDATE users SET google_sub=?,verified=1,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(profile.sub, user.id); user = userById.get(user.id);
    } else if (user.google_sub !== profile.sub) return res.status(403).json({ error: 'This Gmail address is linked to a different Google account.' });
    if (user.status === 'PENDING') return res.status(403).json({ error: 'Your account is waiting for administrator approval.', pending: true });
    if (user.status === 'REJECTED') return res.status(403).json({ error: 'This account request was not approved. Contact your administrator.' });
    res.json(loginResponse(user));
  } catch (error) { console.error('Google sign-in rejected:', error.message); res.status(401).json({ error: 'Google sign-in could not be verified.' }); }
});

router.get('/me', authenticate, (req, res) => res.json({ user: req.user }));
router.post('/logout', authenticate, (req, res) => {
  if (req.tokenId && req.tokenExpiresAt > Date.now()) db.prepare('INSERT OR IGNORE INTO revoked_tokens(jti,expires_at) VALUES(?,?)').run(req.tokenId, req.tokenExpiresAt);
  res.json({ message: 'Signed out.' });
});
module.exports = router;
