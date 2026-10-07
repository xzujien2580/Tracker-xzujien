const XLSX = require('xlsx');
const { recordRows } = require('../database/db');
const { normalizeRecord } = require('../routes/records');
const { normalizeLocation } = require('./tracker');

function headerKey(value) { return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, ''); }
const aliases = {
  date: ['date','recorddate','workdate','datecompleted'], site: ['site','project','sitename'], location: ['locationblock','locationsblock','location','block','locationname','blocklocation'],
  tableType: ['tabletype','table','type'], pvComplete: ['pvcomplete','pvcompletion','pvpercentcomplete','pvcompletionpercent','pvprogress','pvpercent','pv'], manpower: ['manpower','pvmanpower','installedby'],
  msPlanned: ['msplanned','plannedms','plan'], msInstalled: ['msinstalled','installed','quantityinstalled'], msComplete: ['mscomplete','mscompletion','mspercentcomplete','mscompletionpercent','msprogress','mspercent','ms'],
  msInstalledBy: ['msinstalledby','installedby','manpower'], inspectionStatus: ['inspectionstatus','inspection'], inspectionDate: ['inspectiondate'],
  billedDate: ['billeddate','billingdate'], paymentStatus: ['paymentstatus','billingstatus','payment'], remarks: ['remarks','remark','comments'], notes: ['notes','note'],
  adawshat: ['adawshat'], genCon: ['gencon','generalcontractor'], genCon2: ['gencon2','generalcontractor2'], oe: ['oe','ownerengineer']
};
function parseDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return `${value.getFullYear()}-${String(value.getMonth()+1).padStart(2,'0')}-${String(value.getDate()).padStart(2,'0')}`;
  if (typeof value === 'number' && Number.isFinite(value)) {
    const parts = XLSX.SSF.parse_date_code(value);
    if (parts) return `${parts.y}-${String(parts.m).padStart(2,'0')}-${String(parts.d).padStart(2,'0')}`;
  }
  const text = String(value || '').trim();
  if (!text) return '';
  const slashDate = text.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/);
  if (slashDate) {
    let first = Number(slashDate[1]), second = Number(slashDate[2]), year = Number(slashDate[3]);
    if (year < 100) year += year < 50 ? 2000 : 1900;
    let month = first, day = second;
    if (first > 12) { day = first; month = second; }
    else if (second > 12) { month = first; day = second; }
    const candidate = new Date(Date.UTC(year, month - 1, day));
    if (candidate.getUTCFullYear() === year && candidate.getUTCMonth() === month - 1 && candidate.getUTCDate() === day) return candidate.toISOString().slice(0,10);
    return text;
  }
  if (/^\d{4}-\d{1,2}-\d{1,2}/.test(text)) {
    const match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    return `${match[1]}-${String(match[2]).padStart(2,'0')}-${String(match[3]).padStart(2,'0')}`;
  }
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? text : parsed.toISOString().slice(0, 10);
}
function mapRow(row, type) {
  const normalized = Object.create(null);
  for (const [key, value] of Object.entries(row || {})) normalized[headerKey(key)] = value;
  const result = {};
  for (const [field, choices] of Object.entries(aliases)) {
    for (const choice of choices) if (Object.hasOwn(normalized, choice)) { result[field] = normalized[choice]; break; }
  }
  result.date = parseDate(result.date);
  if (result.billedDate) result.billedDate = parseDate(result.billedDate);
  if (type === 'PV' && result.pvComplete != null) result.pvComplete = Number(String(result.pvComplete).replace('%',''));
  if (type === 'MS' && result.msComplete != null) result.msComplete = Number(String(result.msComplete).replace('%',''));
  if (type === 'MS' && result.msInstalled != null) result.msInstalled = String(result.msInstalled).replace(/,/g, '');
  if (result.tableType != null) {
    const tableType = String(result.tableType).trim().toLowerCase();
    result.tableType = tableType === 'long' ? 'Long' : tableType === 'short' ? 'Short' : String(result.tableType).trim();
  }
  return result;
}
function sheetRows(buffer, name) {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: false });
  const sheetName = workbook.SheetNames.find(item => item.trim().toLowerCase() === name.toLowerCase());
  if (!sheetName) return { missing: true, rows: [] };
  return { missing: false, rows: XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '', raw: false }) };
}
function uniqueKey(type, record) { return `${type}|${normalizeLocation(record.location)}|${record.date}`; }
function analyze(rows, type) {
  const found = rows.length, existing = new Set(recordRows(type).map(row => uniqueKey(type, row))), seen = new Set(existing);
  let duplicates = 0, invalid = 0;
  const entries = [];
  for (const source of rows) {
    try {
      const record = normalizeRecord(type, mapRow(source, type));
      const key = uniqueKey(type, record);
      if (seen.has(key)) { duplicates++; continue; }
      seen.add(key); entries.push(record);
    } catch { invalid++; }
  }
  return { found, newRecords: entries.length, duplicates, invalid, entries };
}
function parseUploadedWorkbook(buffer) {
  try {
    const pv = sheetRows(buffer, 'PV'), ms = sheetRows(buffer, 'MS');
    if (pv.missing || ms.missing) throw new Error('PV or MS worksheet was not found. Add worksheets named PV and MS, then try again.');
    return { pv: analyze(pv.rows, 'PV'), ms: analyze(ms.rows, 'MS') };
  } catch (error) {
    if (error.message.includes('worksheet was not found')) throw error;
    throw new Error('Unable to import workbook.');
  }
}
function previewRows(rows) {
  return { pv: analyze(Array.isArray(rows?.pv) ? rows.pv : [], 'PV'), ms: analyze(Array.isArray(rows?.ms) ? rows.ms : [], 'MS') };
}
module.exports = { parseUploadedWorkbook, previewRows, mapRow, analyze, uniqueKey };
