const express = require('express');
const { db, recordRows, getRecord, createRecord, updateRecord, deleteRecord } = require('../database/db');
const { authenticate, requireRoles } = require('../middleware/auth');
const { mergedRows, dashboardSummary } = require('../controllers/tracker');

const router = express.Router();
const writable = requireRoles('ADMIN', 'SUPERVISOR', 'STAFF');
const deletable = requireRoles('ADMIN');

function cleanText(value, max = 4000) { return String(value ?? '').trim().slice(0, max); }
function validIsoDate(value) {
  const parts = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!parts) return false;
  const year = Number(parts[1]), month = Number(parts[2]), day = Number(parts[3]);
  if (year < 1900) return false;
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}
function normalizeRecord(type, input) {
  const result = {};
  const common = ['date','location','tableType','inspectionStatus','inspectionDate','billedDate','paymentStatus','remarks'];
  const fields = type === 'PV' ? ['site','pvComplete','manpower',...common] : ['msPlanned','msInstalled','msComplete','msInstalledBy','notes','adawshat','genCon','genCon2','oe',...common];
  for (const field of fields) result[field] = cleanText(input[field], field === 'remarks' || field === 'notes' ? 4000 : 300);
  if (type === 'PV') {
    const progress = Number(String(input.pvComplete ?? 0).replace('%',''));
    if (!Number.isFinite(progress) || progress < 0 || progress > 100) throw new Error('PV % complete must be between 0 and 100.');
    result.pvComplete = progress;
  } else {
    const progress = Number(String(input.msComplete ?? 0).replace('%',''));
    const installed = input.msInstalled === '' || input.msInstalled == null ? '' : Number(input.msInstalled);
    if (!Number.isFinite(progress) || progress < 0 || progress > 100) throw new Error('MS % complete must be between 0 and 100.');
    if (installed !== '' && (!Number.isFinite(installed) || installed < 0 || installed > 100)) throw new Error('MS installed must be from 0 to 100, or left blank.');
    result.msComplete = progress; result.msInstalled = installed;
  }
  if (!validIsoDate(result.date)) throw new Error('Enter a valid date.');
  if (result.billedDate && !validIsoDate(result.billedDate)) throw new Error('Enter a valid billed date.');
  if (!result.location) throw new Error('Location/Block is required.');
  if (type === 'PV' && !result.site) throw new Error('Site is required for PV records.');
  return result;
}
function duplicateExists(type, record, ignoreId = null) {
  const sql = ignoreId
    ? 'SELECT id FROM records WHERE type=? AND location_key=? AND date_key=? AND id<>?'
    : 'SELECT id FROM records WHERE type=? AND location_key=? AND date_key=?';
  const params = ignoreId
    ? [type, record.location.trim().toLowerCase().replace(/\s+/g, ' '), record.date, Number(ignoreId)]
    : [type, record.location.trim().toLowerCase().replace(/\s+/g, ' '), record.date];
  return Boolean(db.prepare(sql).get(...params));
}

router.get('/records/:type', authenticate, (req, res) => {
  const type = String(req.params.type).toUpperCase();
  if (!['PV', 'MS'].includes(type)) return res.status(400).json({ error: 'Choose PV or MS records.' });
  res.json({ records: recordRows(type) });
});
router.get('/merged', authenticate, (req, res) => res.json({ records: mergedRows() }));
router.get('/dashboard', authenticate, (req, res) => res.json({ summary: dashboardSummary() }));

router.delete('/records', authenticate, deletable, (req, res) => {
  try {
    const clearRecords = db.transaction(() => {
      const counts = db.prepare('SELECT type, COUNT(*) AS count FROM records GROUP BY type').all();
      db.prepare('DELETE FROM records').run();
      db.prepare("DELETE FROM sqlite_sequence WHERE name='records'").run();
      return {
        deletedPV: counts.find(row => row.type === 'PV')?.count || 0,
        deletedMS: counts.find(row => row.type === 'MS')?.count || 0
      };
    });
    const result = clearRecords();
    res.json({ ...result, message: 'All PV and MS records were cleared.' });
  } catch (error) {
    console.error('Clear records failed:', error.message);
    res.status(500).json({ error: 'Unable to clear tracker records.' });
  }
});

router.post('/records/:type', authenticate, writable, (req, res) => {
  const type = String(req.params.type).toUpperCase();
  if (!['PV', 'MS'].includes(type)) return res.status(400).json({ error: 'Choose PV or MS records.' });
  try {
    const payload = normalizeRecord(type, req.body);
    if (duplicateExists(type, payload)) return res.status(409).json({ error: 'A record for this Location/Block and Date already exists.' });
    const created = createRecord(type, payload);
    res.status(201).json({ record: created });
  } catch (error) { res.status(error.message.includes('UNIQUE') ? 409 : 400).json({ error: error.message.includes('UNIQUE') ? 'Duplicate record detected.' : error.message }); }
});
router.put('/records/:type/:id', authenticate, writable, (req, res) => {
  const type = String(req.params.type).toUpperCase();
  if (!['PV', 'MS'].includes(type)) return res.status(400).json({ error: 'Choose PV or MS records.' });
  const existing = getRecord(req.params.id);
  if (!existing || existing.type !== type) return res.status(404).json({ error: 'Record not found.' });
  try {
    const payload = normalizeRecord(type, req.body);
    if (duplicateExists(type, payload, req.params.id)) return res.status(409).json({ error: 'A record for this Location/Block and Date already exists.' });
    const updated = updateRecord(req.params.id, type, payload);
    res.json({ record: updated });
  } catch (error) { res.status(error.message.includes('UNIQUE') ? 409 : 400).json({ error: error.message.includes('UNIQUE') ? 'Duplicate record detected.' : error.message }); }
});
router.delete('/records/:type/:id', authenticate, deletable, (req, res) => {
  const type = String(req.params.type).toUpperCase(), record = getRecord(req.params.id);
  if (!record || record.type !== type) return res.status(404).json({ error: 'Record not found.' });
  deleteRecord(req.params.id); res.json({ message: 'Record deleted.' });
});

module.exports = { router, normalizeRecord, duplicateExists };
