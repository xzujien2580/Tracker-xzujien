const express = require('express');
const { db, listUsers } = require('../database/db');
const { authenticate, requireRoles } = require('../middleware/auth');
const router = express.Router();
router.use(authenticate, requireRoles('ADMIN'));

router.get('/users', (req, res) => res.json({ users: listUsers() }));
router.patch('/users/:id', (req, res) => {
  const id = Number(req.params.id), status = String(req.body.status || '').toUpperCase(), role = String(req.body.role || '').toUpperCase();
  const user = db.prepare('SELECT id,email FROM users WHERE id=?').get(id);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  if (status && !['PENDING','APPROVED','REJECTED'].includes(status)) return res.status(400).json({ error: 'Choose a valid account status.' });
  if (role && !['ADMIN','SUPERVISOR','STAFF','VIEWER'].includes(role)) return res.status(400).json({ error: 'Choose a valid user role.' });
  const current = db.prepare('SELECT role,status FROM users WHERE id=?').get(id);
  if (user.id === req.user.id && ((status && status !== 'APPROVED') || (role && role !== 'ADMIN'))) return res.status(400).json({ error: 'You cannot remove your own administrator access.' });
  if (current.role === 'ADMIN' && current.status === 'APPROVED' && ((status && status !== 'APPROVED') || (role && role !== 'ADMIN'))) {
    const activeAdmins = db.prepare("SELECT COUNT(*) AS count FROM users WHERE role='ADMIN' AND status='APPROVED' AND verified=1").get().count;
    if (activeAdmins <= 1) return res.status(409).json({ error: 'The workspace must keep at least one approved administrator.' });
  }
  db.prepare(`UPDATE users SET status=COALESCE(?,status),role=COALESCE(?,role),updated_at=CURRENT_TIMESTAMP WHERE id=?`)
    .run(status || null, role || null, id);
  res.json({ users: listUsers() });
});
module.exports = router;
