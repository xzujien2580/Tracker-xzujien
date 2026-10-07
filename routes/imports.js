const express = require('express');
const multer = require('multer');
const { db, createRecord, recordRows } = require('../database/db');
const { authenticate, requireRoles } = require('../middleware/auth');
const { parseUploadedWorkbook, previewRows } = require('../controllers/excel');
const { normalizeRecord } = require('./records');
const { normalizeLocation } = require('../controllers/tracker');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 1 } });
const importer = requireRoles('ADMIN', 'SUPERVISOR', 'STAFF');
const admin = requireRoles('ADMIN');
const mergeMany = db.transaction((collections) => {
  const result = { newPV: 0, newMS: 0, duplicatePV: 0, duplicateMS: 0, invalid: 0 };
  for (const type of ['PV', 'MS']) {
    const set = new Set(recordRows(type).map(row => `${normalizeLocation(row.location)}|${row.date}`));
    for (const input of collections[type.toLowerCase()] || []) {
      try {
        const record = normalizeRecord(type, input);
        const key = `${normalizeLocation(record.location)}|${record.date}`;
        if (set.has(key)) { result[type === 'PV' ? 'duplicatePV' : 'duplicateMS']++; continue; }
        set.add(key); createRecord(type, record); result[type === 'PV' ? 'newPV' : 'newMS']++;
      } catch { result.invalid++; }
    }
  }
  return result;
});

router.post('/preview', authenticate, importer, upload.single('workbook'), (req, res) => {
  try {
    const preview = req.file ? parseUploadedWorkbook(req.file.buffer) : previewRows(req.body.rows || {});
    res.json({
      summary: {
        pv: { found: preview.pv.found, newRecords: preview.pv.newRecords, duplicates: preview.pv.duplicates, invalid: preview.pv.invalid },
        ms: { found: preview.ms.found, newRecords: preview.ms.newRecords, duplicates: preview.ms.duplicates, invalid: preview.ms.invalid }
      },
      entries: { pv: preview.pv.entries, ms: preview.ms.entries }
    });
  } catch (error) {
    const message = error.code === 'LIMIT_FILE_SIZE' ? 'Workbook is too large. Maximum file size is 25 MB.' : error.message || 'Unable to import workbook.';
    res.status(400).json({ error: message });
  }
});
router.post('/merge', authenticate, importer, (req, res) => {
  try {
    const result = mergeMany(req.body.entries || {});
    res.json({ ...result, message: 'Successfully merged into tracker.' });
  } catch (error) {
    console.error('Import merge failed:', error.message);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});
router.get('/backup', authenticate, requireRoles('ADMIN','SUPERVISOR'), (req, res) => {
  const pv = recordRows('PV'), ms = recordRows('MS');
  res.json({ format: 'etairos-pv-ms-backup', version: 1, exportedAt: new Date().toISOString(), records: { pv, ms } });
});
router.post('/backup/restore', authenticate, admin, (req, res) => {
  const backup = req.body.backup;
  if (!backup || !['pv','ms'].every(key => Array.isArray(backup.records?.[key]))) return res.status(400).json({ error: 'This is not a valid ETAIROS JSON backup.' });
  const mode = req.body.mode === 'replace' ? 'replace' : 'merge';
  try {
    const restore = db.transaction(() => {
      if (mode === 'replace') db.prepare('DELETE FROM records').run();
      return mergeMany(backup.records);
    });
    const result = restore();
    res.json({ ...result, mode, message: mode === 'replace' ? 'Backup restored.' : 'Backup records merged.' });
  } catch (error) { console.error('Backup restore failed:', error.message); res.status(400).json({ error: 'Unable to restore this backup file.' }); }
});

module.exports = router;
