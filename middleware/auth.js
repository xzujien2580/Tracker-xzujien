const jwt = require('jsonwebtoken');
const { db, userById, publicUser } = require('../database/db');

function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return res.status(401).json({ error: 'Please sign in first.' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.jti && db.prepare('SELECT 1 FROM revoked_tokens WHERE jti=? AND expires_at>?').get(decoded.jti, Date.now())) {
      return res.status(401).json({ error: 'Please sign in first.' });
    }
    const user = userById.get(Number(decoded.sub));
    if (!user || !user.verified || user.status !== 'APPROVED') return res.status(401).json({ error: 'Your account is not approved for access.' });
    req.user = publicUser(user);
    req.tokenId = decoded.jti;
    req.tokenExpiresAt = Number(decoded.exp || 0) * 1000;
    next();
  } catch {
    return res.status(401).json({ error: 'Please sign in first.' });
  }
}

function requireRoles(...roles) {
  return (req, res, next) => roles.includes(req.user?.role)
    ? next()
    : res.status(403).json({ error: 'You do not have permission to perform this action.' });
}

module.exports = { authenticate, requireRoles };
