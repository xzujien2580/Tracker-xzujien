const { recordRows } = require('../database/db');

function normalizeLocation(value) { return String(value || '').trim().toLocaleLowerCase().replace(/\s+/g, ' '); }
function number(value) {
  if (value === '' || value == null) return 0;
  const parsed = Number(String(value).replace(/[%,$\s]/g, ''));
  return Number.isFinite(parsed) ? Math.max(0, Math.min(100, parsed)) : 0;
}
function overallStatus(pv, ms) {
  const pvProgress = pv ? number(pv.pvComplete) : null;
  const msProgress = ms ? number(ms.msComplete) : null;
  if (pvProgress === 100 && msProgress === 100) {
    const payments = [pv?.paymentStatus, ms?.paymentStatus].map(value => String(value || '').toUpperCase());
    const inspections = [pv?.inspectionStatus, ms?.inspectionStatus].map(value => String(value || '').toUpperCase());
    if (payments.includes('PAID')) return 'PAID';
    if (payments.includes('BILLED')) return 'BILLED';
    if (inspections.includes('INSPECTED')) return 'FOR BILLING';
    return 'COMPLETED';
  }
  if (pvProgress === 100 && msProgress == null) return 'MS DATA PENDING';
  if (msProgress === 100 && pvProgress == null) return 'PV DATA PENDING';
  if (pvProgress == null && msProgress == null) return 'DATA PENDING';
  if (pvProgress != null && pvProgress < 100 && msProgress === 100) return 'PV IN PROGRESS';
  if (pvProgress === 100 && msProgress != null && msProgress < 100) return 'MS IN PROGRESS';
  return 'IN PROGRESS';
}
function latestFirst(a, b) { return String(b.date || '').localeCompare(String(a.date || '')) || Number(b.id || 0) - Number(a.id || 0); }
function mergedRows() {
  const grouped = new Map();
  for (const type of ['PV', 'MS']) {
    const items = recordRows(type).sort(latestFirst);
    for (const record of items) {
      const key = normalizeLocation(record.location);
      if (!grouped.has(key)) grouped.set(key, { location: record.location, pv: null, ms: null });
      const group = grouped.get(key);
      if (!group[type.toLowerCase()]) group[type.toLowerCase()] = record;
    }
  }
  return [...grouped.values()].map(group => {
    const pv = group.pv, ms = group.ms;
    return {
      recordId: [pv?.recordId, ms?.recordId].filter(Boolean).join(' / ') || '—',
      date: [pv?.date, ms?.date].filter(Boolean).sort().at(-1) || '',
      site: pv?.site || ms?.site || '', location: pv?.location || ms?.location || group.location,
      tableType: pv?.tableType || ms?.tableType || '', pv, ms,
      pvComplete: pv ? number(pv.pvComplete) : null, pvManpower: pv?.manpower || '',
      msPlanned: ms?.msPlanned || '', msInstalled: ms?.msInstalled ?? '', msComplete: ms ? number(ms.msComplete) : null,
      msInstalledBy: ms?.msInstalledBy || '',
      inspectionStatus: [pv?.inspectionStatus, ms?.inspectionStatus].find(value => String(value || '').toUpperCase() === 'INSPECTED') || pv?.inspectionStatus || ms?.inspectionStatus || '', inspectionDate: pv?.inspectionDate || ms?.inspectionDate || '',
      billedDate: pv?.billedDate || ms?.billedDate || '', paymentStatus: [pv?.paymentStatus, ms?.paymentStatus].find(value => String(value || '').toUpperCase() === 'PAID') || [pv?.paymentStatus, ms?.paymentStatus].find(value => String(value || '').toUpperCase() === 'BILLED') || pv?.paymentStatus || ms?.paymentStatus || '',
      overallStatus: overallStatus(pv, ms), remarks: pv?.remarks || ms?.remarks || ''
    };
  }).sort((a, b) => a.location.localeCompare(b.location));
}
function dashboardSummary() {
  const pv = recordRows('PV'), ms = recordRows('MS'), merged = mergedRows();
  const counts = Object.create(null);
  for (const row of merged) counts[row.overallStatus] = (counts[row.overallStatus] || 0) + 1;
  const billed = merged.filter(row => ['BILLED', 'PAID'].includes(row.overallStatus)).length;
  const paid = merged.filter(row => row.overallStatus === 'PAID').length;
  return {
    totalPV: pv.length, totalMS: ms.length, totalMerged: merged.length,
    completedPV: pv.filter(row => number(row.pvComplete) === 100).length,
    inProgress: (counts['IN PROGRESS'] || 0) + (counts['PV IN PROGRESS'] || 0) + (counts['MS IN PROGRESS'] || 0),
    forBilling: counts['FOR BILLING'] || 0,
    billed, paid,
    pendingPV: merged.filter(row => row.pvComplete == null || row.pvComplete < 100).length,
    pendingMS: merged.filter(row => row.msComplete == null || row.msComplete < 100).length,
    totalMSInstalled: ms.reduce((sum, row) => sum + (Number(row.msInstalled) || 0), 0),
    totalPVComplete: pv.filter(row => number(row.pvComplete) === 100).length,
    statuses: counts,
    pvProgress: { complete: pv.filter(row => number(row.pvComplete) === 100).length, inProgress: pv.filter(row => number(row.pvComplete) > 0 && number(row.pvComplete) < 100).length, notStarted: pv.filter(row => number(row.pvComplete) === 0).length },
    msProgress: { complete: ms.filter(row => number(row.msComplete) === 100).length, inProgress: ms.filter(row => number(row.msComplete) > 0 && number(row.msComplete) < 100).length, notStarted: ms.filter(row => number(row.msComplete) === 0).length },
    billing: { forBilling: counts['FOR BILLING'] || 0, billed: counts.BILLED || 0, paid },
    payment: { billed: billed - paid, paid, notBilled: merged.filter(row => row.paymentStatus === 'NOT BILLED' || (!row.paymentStatus && row.overallStatus === 'COMPLETED')).length }
  };
}
module.exports = { mergedRows, dashboardSummary, overallStatus, normalizeLocation, number };
