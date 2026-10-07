(() => {
  'use strict';
  const API = window.ETAIROS_CONFIG?.apiBase || '/api';
  const state = {
    token: sessionStorage.getItem('etairos_token') || '', user: null, page: 'dashboard', config: {},
    records: { PV: [], MS: [], merged: [] }, users: [], importPreview: null, backup: null, driveToken: '', driveFiles: []
  };
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const pageContent = $('#pageContent');
  const pageNames = { dashboard: 'Dashboard', merged: 'Merged tracker', pv: 'PV database', ms: 'MS database', import: 'Excel import', reports: 'Reports', drive: 'Google Drive', backup: 'Data backup', users: 'User management', settings: 'Settings' };
  const manpowerOptions = ['SUBCON1','SUBCON2','SUBCON3','INHOUSE','Philip SUB4','SubCON4 all','JasperSUB4'];
  const inspectionOptions = ['NOT INSPECTED','FOR INSPECTION','INSPECTED'];
  const paymentOptions = ['NOT BILLED','BILLED','PAID'];
  const roleOptions = ['ADMIN','SUPERVISOR','STAFF','VIEWER'];

  function esc(value) { return String(value ?? '').replace(/[&<>"']/g, character => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[character]); }
  function isoToday() { const date=new Date(); return new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,10); }
  function niceDate(value) {
    if (!value) return '—';
    const date = new Date(`${value}T00:00:00`);
    if (Number.isNaN(date.getTime())) return esc(value);
    return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }
  function initials(name) { return String(name || 'User').trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase(); }
  function formatRole(role) { return String(role || 'STAFF').replace('_',' '); }
  function formatNumber(value) { return Number(value || 0).toLocaleString(); }
  function showToast(message, kind = '') {
    const toast = document.createElement('div'); toast.className = `toast ${kind}`; toast.textContent = message;
    $('#toastRoot').append(toast); setTimeout(() => toast.remove(), 3800);
  }
  function showAuthNotice(message, kind = '') {
    const notice = $('#authNotice'); notice.textContent = message; notice.className = `notice ${kind}`; notice.classList.remove('hidden');
  }
  function clearAuthNotice() { $('#authNotice').classList.add('hidden'); }
  async function api(path, options = {}) {
    const headers = new Headers(options.headers || {});
    if (state.token) headers.set('Authorization', `Bearer ${state.token}`);
    if (options.body && !(options.body instanceof FormData) && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    const response = await fetch(`${API}${path}`, { ...options, headers });
    let body = {};
    try { body = await response.json(); } catch { /* empty response */ }
    if (response.status === 401 && state.token) { clearSession(); showAuthNotice('Your session ended. Please sign in again.', 'error'); }
    if (!response.ok) throw new Error(body.error || `Request failed (${response.status}).`);
    return body;
  }
  function clearSession() { state.token = ''; state.user = null; sessionStorage.removeItem('etairos_token'); }
  function setSession(data) {
    state.token = data.token; state.user = data.user; sessionStorage.setItem('etairos_token', data.token);
    showApp();
  }
  function showAuth(mode = 'login') {
    $('#appShell').classList.add('hidden'); $('#authView').classList.remove('hidden');
    $('#loginForm').classList.toggle('hidden', mode !== 'login'); $('#signupForm').classList.toggle('hidden', mode !== 'signup');
    $('#authTitle').textContent = mode === 'login' ? 'Welcome back' : 'Create your account';
    $('#authSubtitle').textContent = mode === 'login' ? 'Sign in to continue to your workspace.' : 'Verify your Gmail to request tracker access.';
    $('#authSwitchCopy').textContent = mode === 'login' ? 'New to the tracker?' : 'Already have access?';
    $('#authSwitch').textContent = mode === 'login' ? 'Create an account' : 'Sign in';
    $('#authSwitch').dataset.mode = mode === 'login' ? 'signup' : 'login';
  }
  function showApp() {
    $('#authView').classList.add('hidden'); $('#appShell').classList.remove('hidden');
    $('#profileName').textContent = state.user?.name || 'User';
    $('#profileRole').textContent = formatRole(state.user?.role);
    $('#profileInitials').textContent = initials(state.user?.name);
    $('#adminNavGroup').classList.toggle('hidden', state.user?.role !== 'ADMIN');
    const viewerHidden = new Set(['pv','ms','import','drive','backup','settings']);
    $$('#sideNav [data-page]').forEach(button => { button.classList.toggle('hidden', state.user?.role === 'VIEWER' && viewerHidden.has(button.dataset.page)); });
    if (state.user?.role === 'ADMIN') refreshPendingBadge();
    $('#todayLabel').textContent = new Date().toLocaleDateString(undefined, { weekday:'short', month:'short', day:'numeric', year:'numeric' }).toUpperCase();
    setPage(state.page || 'dashboard');
  }
  function canWrite() { return ['ADMIN','SUPERVISOR','STAFF'].includes(state.user?.role); }
  function canDelete() { return ['ADMIN','SUPERVISOR'].includes(state.user?.role); }
  function canExport() { return ['ADMIN','SUPERVISOR'].includes(state.user?.role); }

  async function handleLogin(event) {
    event.preventDefault(); clearAuthNotice();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    try { setSession(await api('/auth/login', { method:'POST', body:JSON.stringify(data) })); }
    catch (error) { showAuthNotice(error.message, 'error'); }
  }
  async function requestCode() {
    clearAuthNotice(); const form = $('#signupForm'), data = Object.fromEntries(new FormData(form));
    if (data.password !== data.confirmPassword) return showAuthNotice('Passwords do not match.', 'error');
    const button = $('#requestCodeButton'); button.disabled = true; button.textContent = 'Sending code…';
    try {
      const result = await api('/auth/request-code', { method:'POST', body:JSON.stringify({ name:data.name, email:data.email, password:data.password }) });
      $('#verificationGroup').classList.remove('hidden'); $('#createAccountButton').classList.remove('hidden');
      ['name','email','password','confirmPassword'].forEach(name => { const input=$(`#signupForm [name="${name}"]`); if(input) input.readOnly=true; });
      $('#requestCodeButton').textContent = 'Resend verification code';
      showAuthNotice(result.developmentCode ? `${result.message} Your local development code is ${result.developmentCode}.` : result.message, 'success');
    } catch (error) { showAuthNotice(error.message, 'error'); }
    finally { button.disabled = false; }
  }
  async function handleSignup(event) {
    event.preventDefault(); clearAuthNotice(); const data = Object.fromEntries(new FormData(event.currentTarget));
    if (data.password !== data.confirmPassword) return showAuthNotice('Passwords do not match.', 'error');
    if (!data.code) return showAuthNotice('Request and enter your 6-digit verification code.', 'error');
    try {
      const result = await api('/auth/verify-code', { method:'POST', body:JSON.stringify({ email:data.email, code:data.code }) });
      $('#signupForm').reset(); ['name','email','password','confirmPassword'].forEach(name => { const input=$(`#signupForm [name="${name}"]`); if(input) input.readOnly=false; }); $('#verificationGroup').classList.add('hidden'); $('#createAccountButton').classList.add('hidden'); $('#requestCodeButton').textContent = 'Request verification code';
      showAuth('login'); showAuthNotice(result.message, result.status === 'APPROVED' ? 'success' : '');
    } catch (error) { showAuthNotice(error.message, 'error'); }
  }
  function loadGoogleIdentity() {
    if (!state.config.googleClientId) { $('#googleSignIn').title = 'Set GOOGLE_CLIENT_ID to enable Google Sign-In'; return; }
    const script = document.createElement('script'); script.src = 'https://accounts.google.com/gsi/client'; script.async = true; script.defer = true;
    script.onload = () => {
      if (!window.google?.accounts?.id) return;
      window.google.accounts.id.initialize({ client_id: state.config.googleClientId, callback: async response => {
        clearAuthNotice();
        try { setSession(await api('/auth/google', { method:'POST', body:JSON.stringify({ credential:response.credential }) })); }
        catch (error) { showAuthNotice(error.message, 'error'); }
      } });
      const holder = $('#googleSignIn'); holder.innerHTML = ''; window.google.accounts.id.renderButton(holder, { type:'standard', theme:'outline', size:'large', shape:'rectangular', text:'signin_with', width:String(Math.min(360,holder.clientWidth||360)) });
    };
    document.head.append(script);
  }
  async function signOut() {
    try { if (state.token) await api('/auth/logout', { method:'POST' }); } catch { /* local session still needs clearing */ }
    clearSession(); $('#profileMenu').classList.add('hidden'); showAuth('login');
  }

  async function setPage(page) {
    if (!pageNames[page] || (page === 'users' && state.user?.role !== 'ADMIN')) page = 'dashboard';
    if (state.user?.role === 'VIEWER' && ['pv','ms','import','drive','backup','settings','users'].includes(page)) page = 'dashboard';
    state.page = page;
    $$('#sideNav [data-page]').forEach(button => button.classList.toggle('active', button.dataset.page === page));
    $('#pageCrumb').textContent = pageNames[page];
    closeSidebar();
    const renderers = { dashboard:renderDashboard, merged:renderMerged, pv:() => renderDatabase('PV'), ms:() => renderDatabase('MS'), import:renderImport, reports:renderReports, drive:renderDrive, backup:renderBackup, users:renderUsers, settings:renderSettings };
    try { await renderers[page](); } catch (error) { pageContent.innerHTML = `<div class="panel empty-state"><strong>Unable to load this page</strong>${esc(error.message)}</div>`; }
  }
  function heading(title, description, action = '') {
    return `<div class="page-heading"><div><div class="heading-kicker">ETAIROS / OPERATIONS</div><h1>${title}</h1><p>${description}</p></div><div class="page-actions">${action}</div></div>`;
  }
  function button(label, action, kind = 'ghost', icon = '') { return `<button class="button ${kind}" data-page-action="${esc(action)}">${icon ? `<span>${icon}</span>` : ''}${label}</button>`; }
  function kpi(label, value, note, icon, accent = '') {
    return `<article class="kpi-card ${accent}"><div class="kpi-top"><span class="kpi-label">${label}</span><span class="kpi-icon">${icon}</span></div><div class="kpi-value">${formatNumber(value)}</div><div class="kpi-note">${note}</div></article>`;
  }
  function chartBars(title, subtitle, values, maxValue, green = false) {
    const rows = Object.entries(values);
    const body = rows.length ? `<div class="bar-chart">${rows.map(([label,value]) => `<div class="bar-row"><span class="bar-name">${esc(label)}</span><div class="bar-track"><div class="bar-fill ${green ? 'green' : ''}" style="width:${maxValue ? Math.max(Number(value) ? 3 : 0, Math.min(100, Number(value) / maxValue * 100)) : 0}%"></div></div><span class="bar-value">${formatNumber(value)}</span></div>`).join('')}</div>` : emptyState('No records yet', 'Add or import records to see progress here.');
    return `<section class="panel"><div class="panel-header"><div><div class="panel-title">${title}</div><div class="panel-subtitle">${subtitle}</div></div></div><div class="panel-body">${body}</div></section>`;
  }
  function statusRows(values) {
    const entries = Object.entries(values || {}).filter(([, count]) => count > 0).sort((a,b) => b[1]-a[1]);
    if (!entries.length) return emptyState('No status data yet', 'The status distribution will appear after records are added.');
    const palette = ['#3980dc','#41b88a','#d89a34','#976bd6','#e07065','#62a8bc'];
    return `<div class="status-list">${entries.map(([name,count], index) => `<div class="status-row"><span class="status-dot" style="background:${palette[index % palette.length]}"></span><span class="status-name">${esc(name)}</span><strong class="status-count">${formatNumber(count)}</strong></div>`).join('')}<div class="panel-footnote">${formatNumber(entries.reduce((sum,item)=>sum+item[1],0))} tracked locations</div></div>`;
  }
  function emptyState(title, description) { return `<div class="empty-state"><div class="empty-icon">⌁</div><strong>${title}</strong>${description}</div>`; }

  async function renderDashboard() {
    const { summary } = await api('/dashboard');
    const cards = [
      ['Total PV records',summary.totalPV,'PV database','P',''],['Total MS records',summary.totalMS,'MS database','M',''],['Merged locations',summary.totalMerged,'PV and MS combined','⇄',''],['Completed PV',summary.completedPV,'PV at 100%','✓','accent-green'],
      ['In progress',summary.inProgress,'Overall status','◷','accent-amber'],['For billing',summary.forBilling,'Inspected and complete','▤','accent-amber'],['Billed',summary.billed,'Billing recorded','↗',''],['Total paid',summary.paid,'Payment status marked paid','✓','accent-green'],
      ['Pending PV',summary.pendingPV,'Locations with PV remaining','P','accent-red'],['Pending MS',summary.pendingMS,'Locations with MS remaining','M','accent-red'],['MS installed',summary.totalMSInstalled,'Installed units recorded','▥',''],['PV complete',summary.totalPVComplete,'Records at 100%','✓','accent-green']
    ];
    const maxOverall = Math.max(1,...Object.values(summary.statuses || {}));
    const maxPv = Math.max(1,...Object.values(summary.pvProgress || {})), maxMs = Math.max(1,...Object.values(summary.msProgress || {}));
    pageContent.innerHTML = `${heading('Operations dashboard','Live project progress across PV and MS records.', canWrite() ? button('Add record','add-pv','primary','＋') : '')}
      <div class="kpi-grid">${cards.map(item => kpi(...item)).join('')}</div>
      <div class="dashboard-grid">
        <section class="panel"><div class="panel-header"><div><div class="panel-title">Overall status distribution</div><div class="panel-subtitle">Combined PV and MS progress by location</div></div><span class="status-total">${formatNumber(summary.totalMerged)} locations</span></div><div class="panel-body">${statusRows(summary.statuses)}</div></section>
        ${chartBars('PV progress','Completion across PV records',{ 'Complete':summary.pvProgress.complete,'In progress':summary.pvProgress.inProgress,'Not started':summary.pvProgress.notStarted },maxPv)}
        ${chartBars('MS progress','Completion across MS records',{ 'Complete':summary.msProgress.complete,'In progress':summary.msProgress.inProgress,'Not started':summary.msProgress.notStarted },maxMs,true)}
        ${chartBars('Billing status','Completed locations by billing stage',summary.billing,Math.max(1,...Object.values(summary.billing)))}
        ${chartBars('Payment status','Tracker status only; no payments are processed here.',summary.payment,Math.max(1,...Object.values(summary.payment)),true)}
        <section class="panel"><div class="panel-header"><div><div class="panel-title">Start with a clean tracker</div><div class="panel-subtitle">Records are added by your team or merged from Excel.</div></div></div><div class="panel-body"><p class="panel-footnote">Every new installation starts with zero PV and MS records. Import previews count duplicates and invalid rows before adding anything.</p>${button('Open Excel import','go-import','secondary','⇧')}</div></section>
      </div>`;
    bindPageActions({ 'add-pv':() => openRecordModal('PV'), 'go-import':() => setPage('import') });
  }

  function statusClass(value) {
    const status = String(value || '').toUpperCase();
    if (['COMPLETED','PAID','INSPECTED','APPROVED'].includes(status)) return 'green';
    if (['FOR BILLING','BILLED','FOR INSPECTION','PENDING'].includes(status)) return 'amber';
    if (status.includes('PENDING') || status.includes('PROGRESS')) return status.includes('PROGRESS') ? 'blue' : 'red';
    if (status === 'REJECTED' || status === 'NOT BILLED' || status === 'NOT INSPECTED') return 'red';
    return '';
  }
  function badge(value) { return `<span class="status-badge ${statusClass(value)}">${esc(value || '—')}</span>`; }
  function progress(value) {
    if (value == null || value === '') return `<span class="cell-sub">Missing</span>`;
    const number = Math.max(0,Math.min(100,Number(value)||0));
    return `<div class="progress-cell"><div class="progress-track"><div class="progress-fill ${number === 100 ? 'complete' : ''}" style="width:${number}%"></div></div><span class="progress-label">${number}%</span></div>`;
  }
  function recordActions(row, type) {
    const items = `<button class="row-action" title="View details" data-row-action="view" data-type="${type}" data-id="${row.id}">◉</button>` + (canWrite() ? `<button class="row-action" title="Edit record" data-row-action="edit" data-type="${type}" data-id="${row.id}">✎</button>` : '') + (canDelete() ? `<button class="row-action delete" title="Delete record" data-row-action="delete" data-type="${type}" data-id="${row.id}">×</button>` : '');
    return `<div class="row-actions">${items}</div>`;
  }
  function simpleColumns(type) {
    if (type === 'PV') return [
      ['Date',row => niceDate(row.date)],['Record ID',row => `<span class="record-id">${esc(row.recordId)}</span>`],['Site',row => esc(row.site || '—')],['Location / Block',row => `<span class="cell-main">${esc(row.location)}</span>`],
      ['Table',row => esc(row.tableType || '—')],['PV progress',row => progress(row.pvComplete)],['Manpower',row => esc(row.manpower || '—')],['Inspection',row => badge(row.inspectionStatus)],['Billed date',row => niceDate(row.billedDate)],['Payment',row => badge(row.paymentStatus)],['Actions',row => recordActions(row,type)]
    ];
    return [
      ['Date',row => niceDate(row.date)],['Record ID',row => `<span class="record-id">${esc(row.recordId)}</span>`],['Location / Block',row => `<span class="cell-main">${esc(row.location)}</span>`],['Table',row => esc(row.tableType || '—')],['MS planned',row => esc(row.msPlanned || '—')],['MS installed',row => esc(row.msInstalled === '' ? '—' : row.msInstalled)],['MS progress',row => progress(row.msComplete)],['Installed by',row => esc(row.msInstalledBy || '—')],['Inspection',row => badge(row.inspectionStatus)],['Payment',row => badge(row.paymentStatus)],['Actions',row => recordActions(row,type)]
    ];
  }
  function tableMarkup(rows, columns, emptyMessage = 'No records found.') {
    if (!rows.length) return emptyState(emptyMessage, 'Try changing the search or filters, or add a record.');
    return `<div class="table-scroll"><table class="data-table"><thead><tr>${columns.map(([name]) => `<th>${esc(name)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${columns.map(([,render]) => `<td>${render(row)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }
  function recordMatches(row, type, filters) {
    const searchable = Object.values(row).join(' ').toLowerCase();
    if (filters.search && !searchable.includes(filters.search.toLowerCase())) return false;
    if (filters.site && String(row.site || '').toLowerCase() !== filters.site.toLowerCase()) return false;
    const progressValue = Number(type === 'PV' ? row.pvComplete : row.msComplete) || 0;
    if (filters.progress === 'complete' && progressValue !== 100) return false;
    if (filters.progress === 'inprogress' && !(progressValue > 0 && progressValue < 100)) return false;
    if (filters.progress === 'notstarted' && progressValue !== 0) return false;
    if (filters.inspection && String(row.inspectionStatus || '') !== filters.inspection) return false;
    if (filters.payment && String(row.paymentStatus || '') !== filters.payment) return false;
    const billed = Boolean(row.billedDate) || ['BILLED','PAID'].includes(String(row.paymentStatus || '').toUpperCase());
    if (filters.billing === 'billed' && !billed) return false;
    if (filters.billing === 'notbilled' && billed) return false;
    if (filters.from && row.date < filters.from) return false;
    if (filters.to && row.date > filters.to) return false;
    return true;
  }
  function sortedRows(rows, sort, type) {
    const result = [...rows];
    const field = type === 'PV' ? 'pvComplete' : 'msComplete';
    result.sort((a,b) => {
      if (sort === 'az') return String(a.location).localeCompare(String(b.location));
      if (sort === 'za') return String(b.location).localeCompare(String(a.location));
      if (sort === 'oldest') return String(a.date).localeCompare(String(b.date));
      if (sort === 'progress-high') return Number(b[field] || 0) - Number(a[field] || 0);
      if (sort === 'progress-low') return Number(a[field] || 0) - Number(b[field] || 0);
      return String(b.date).localeCompare(String(a.date));
    });
    return result;
  }
  function databaseToolbar(type, sites) {
    return `<div class="toolbar"><div class="search-wrap"><input id="tableSearch" placeholder="Search ID, location, site, manpower, remarks…" /></div>
      ${sites.length ? `<select id="siteFilter"><option value="">All sites</option>${sites.map(site => `<option>${esc(site)}</option>`).join('')}</select>` : ''}
      <select id="progressFilter"><option value="">All progress</option><option value="complete">Complete</option><option value="inprogress">In progress</option><option value="notstarted">Not started</option></select>
      <select id="inspectionFilter"><option value="">All inspection</option>${inspectionOptions.map(item => `<option>${item}</option>`).join('')}</select>
      <select id="billingFilter"><option value="">All billing</option><option value="billed">Billed</option><option value="notbilled">Not billed</option></select>
      <select id="paymentFilter"><option value="">All payment</option>${paymentOptions.map(item => `<option>${item}</option>`).join('')}</select>
      <input type="date" id="dateFrom" aria-label="Date from" title="Date from" /><input type="date" id="dateTo" aria-label="Date to" title="Date to" />
      <select id="sortFilter"><option value="newest">Newest</option><option value="oldest">Oldest</option><option value="az">Location A–Z</option><option value="za">Location Z–A</option><option value="progress-high">Highest progress</option><option value="progress-low">Lowest progress</option></select>
      <span class="toolbar-spacer"></span>${canExport() ? `<button class="button ghost" data-page-action="export-current">Export CSV</button>` : ''}</div>`;
  }
  async function renderDatabase(type) {
    const { records } = await api(`/records/${type}`); state.records[type] = records;
    const sites = [...new Set(records.map(record => record.site).filter(Boolean))].sort();
    const totalProgress = records.length ? Math.round(records.reduce((sum,row) => sum + Number(type === 'PV' ? row.pvComplete : row.msComplete || 0),0) / records.length) : 0;
    const completed = records.filter(row => Number(type === 'PV' ? row.pvComplete : row.msComplete) === 100).length;
    const action = canWrite() ? button(`Add ${type}`,'add-record','primary','＋') : '';
    pageContent.innerHTML = `${heading(`${type} database`,type === 'PV' ? 'Manage photovoltaic progress, site activity, and billing readiness.' : 'Manage mounting system installation and project notes.',action)}
      <div class="summary-strip"><div class="summary-pill"><span>Total ${type} records</span><strong>${formatNumber(records.length)}</strong></div><div class="summary-pill"><span>Completed</span><strong>${formatNumber(completed)}</strong></div><div class="summary-pill"><span>Average progress</span><strong>${totalProgress}%</strong></div><div class="summary-pill"><span>Records in view</span><strong id="visibleCount">${formatNumber(records.length)}</strong></div></div>
      <section class="panel"><div class="panel-header"><div><div class="panel-title">${type} project records</div><div class="panel-subtitle">Search and filter the full ${type} database.</div></div><span class="status-total">${records.length ? 'Updated just now' : 'Empty database'}</span></div>${databaseToolbar(type,sites)}<div id="dataTableRoot"></div></section>`;
    const draw = () => {
      const filters = { search:$('#tableSearch').value.trim(), site:$('#siteFilter')?.value || '', progress:$('#progressFilter').value, inspection:$('#inspectionFilter').value, billing:$('#billingFilter').value, payment:$('#paymentFilter').value, from:$('#dateFrom').value, to:$('#dateTo').value };
      const rows = sortedRows(records.filter(row => recordMatches(row,type,filters)),$('#sortFilter').value,type);
      $('#visibleCount').textContent = formatNumber(rows.length);
      $('#dataTableRoot').innerHTML = tableMarkup(rows,simpleColumns(type),records.length ? 'No matching records.' : `No ${type} records yet.`);
      bindRowActions(type,records);
    };
    ['tableSearch','siteFilter','progressFilter','inspectionFilter','billingFilter','paymentFilter','dateFrom','dateTo','sortFilter'].forEach(id => $(`#${id}`)?.addEventListener('input',draw)); draw();
    bindPageActions({ 'add-record':() => openRecordModal(type), 'export-current':() => exportCsv(records,`${type.toLowerCase()}-records.csv`) });
  }

  function mergedColumns() {
    return [
      ['Record ID',row => `<span class="record-id">${esc(row.recordId)}</span>`],['Date',row => niceDate(row.date)],['Site',row => esc(row.site || '—')],['Location / Block',row => `<span class="cell-main">${esc(row.location)}</span>`],['Table',row => esc(row.tableType || '—')],
      ['PV %',row => progress(row.pvComplete)],['PV manpower',row => esc(row.pvManpower || '—')],['MS planned',row => esc(row.msPlanned || '—')],['MS installed',row => esc(row.msInstalled === '' ? '—' : row.msInstalled)],['MS %',row => progress(row.msComplete)],['MS installed by',row => esc(row.msInstalledBy || '—')],
      ['Inspection',row => badge(row.inspectionStatus)],['Inspection date',row => niceDate(row.inspectionDate)],['Billed date',row => niceDate(row.billedDate)],['Payment',row => badge(row.paymentStatus)],['Overall status',row => badge(row.overallStatus)],['Remarks',row => esc(row.remarks || '—')]
    ];
  }
  async function renderMerged() {
    const { records } = await api('/merged'); state.records.merged = records;
    const sites = [...new Set(records.map(row=>row.site).filter(Boolean))].sort();
    pageContent.innerHTML = `${heading('Merged tracker','PV and MS progress grouped by Location/Block. Locations remain visible when either record is missing.',canExport() ? button('Export CSV','export-merged','ghost','⇩') : '')}
      <div class="summary-strip"><div class="summary-pill"><span>Tracked locations</span><strong>${formatNumber(records.length)}</strong></div><div class="summary-pill"><span>Both complete</span><strong>${formatNumber(records.filter(row => ['COMPLETED','FOR BILLING','BILLED','PAID'].includes(row.overallStatus)).length)}</strong></div><div class="summary-pill"><span>PV data pending</span><strong>${formatNumber(records.filter(row => row.pvComplete == null).length)}</strong></div><div class="summary-pill"><span>MS data pending</span><strong>${formatNumber(records.filter(row => row.msComplete == null).length)}</strong></div></div>
      <section class="panel"><div class="panel-header"><div><div class="panel-title">Location overview</div><div class="panel-subtitle">Each location displays its latest PV and MS record.</div></div></div><div class="toolbar"><div class="search-wrap"><input id="mergedSearch" placeholder="Search location, site, manpower, status…" /></div><select id="mergedSite"><option value="">All sites</option>${sites.map(site=>`<option>${esc(site)}</option>`).join('')}</select><select id="mergedStatus"><option value="">All overall statuses</option>${['IN PROGRESS','PV IN PROGRESS','MS IN PROGRESS','MS DATA PENDING','PV DATA PENDING','COMPLETED','FOR BILLING','BILLED','PAID'].map(value=>`<option>${value}</option>`).join('')}</select><select id="mergedInspection"><option value="">All inspection</option>${inspectionOptions.map(item=>`<option>${item}</option>`).join('')}</select><select id="mergedBilling"><option value="">All billing</option><option value="billed">Billed</option><option value="notbilled">Not billed</option></select><select id="mergedPayment"><option value="">All payment</option>${paymentOptions.map(item=>`<option>${item}</option>`).join('')}</select><input type="date" id="mergedDateFrom" aria-label="Date from" title="Date from"/><input type="date" id="mergedDateTo" aria-label="Date to" title="Date to"/><select id="mergedSort"><option value="az">Location A–Z</option><option value="za">Location Z–A</option><option value="newest">Newest</option><option value="oldest">Oldest</option><option value="progress-high">Highest progress</option><option value="progress-low">Lowest progress</option></select></div><div id="mergedTableRoot"></div></section>`;
    const draw = () => {
      const query = $('#mergedSearch').value.toLowerCase(), status = $('#mergedStatus').value, sort = $('#mergedSort').value;
      const site=$('#mergedSite').value, inspection=$('#mergedInspection').value, billing=$('#mergedBilling').value, payment=$('#mergedPayment').value, from=$('#mergedDateFrom').value, to=$('#mergedDateTo').value;
      let rows = records.filter(row => {
        const isBilled=Boolean(row.billedDate)||['BILLED','PAID'].includes(String(row.paymentStatus||'').toUpperCase());
        return (!query || Object.values(row).join(' ').toLowerCase().includes(query)) && (!status || row.overallStatus === status) && (!site || row.site===site) && (!inspection || row.inspectionStatus===inspection) && (!payment || row.paymentStatus===payment) && (!billing || (billing==='billed'?isBilled:!isBilled)) && (!from || row.date>=from) && (!to || row.date<=to);
      });
      rows.sort((a,b) => {
        if (sort === 'za') return b.location.localeCompare(a.location);
        if (sort === 'newest') return String(b.date).localeCompare(String(a.date));
        if (sort === 'oldest') return String(a.date).localeCompare(String(b.date));
        const ap = Number(a.pvComplete || 0)+Number(a.msComplete || 0), bp = Number(b.pvComplete || 0)+Number(b.msComplete || 0);
        if (sort === 'progress-high') return bp-ap;
        if (sort === 'progress-low') return ap-bp;
        return a.location.localeCompare(b.location);
      });
      $('#mergedTableRoot').innerHTML = tableMarkup(rows,mergedColumns(),'No merged locations yet.');
    };
    ['mergedSearch','mergedSite','mergedStatus','mergedInspection','mergedBilling','mergedPayment','mergedDateFrom','mergedDateTo','mergedSort'].forEach(id => $(`#${id}`).addEventListener('input',draw)); draw();
    bindPageActions({ 'export-merged':() => exportCsv(records,'merged-tracker.csv') });
  }

  function options(items, selected, allowBlank = true) {
    const blank = allowBlank ? '<option value="">Select…</option>' : '';
    return blank + items.map(item => `<option value="${esc(item)}" ${String(selected || '').toUpperCase() === item.toUpperCase() ? 'selected' : ''}>${esc(item)}</option>`).join('');
  }
  function inputField(label,name,value='',type='text',extra='') { return `<label>${label}<input name="${name}" type="${type}" value="${esc(value)}" ${extra}></label>`; }
  function selectField(label,name,items,value='') { return `<label>${label}<select name="${name}">${options(items,value)}</select></label>`; }
  function textAreaField(label,name,value='',full=false) { return `<label class="${full?'full-span':''}">${label}<textarea name="${name}">${esc(value)}</textarea></label>`; }
  function openRecordModal(type, record = null, readOnly = false) {
    const isPv = type === 'PV', data = record || {};
    const title = readOnly ? `${type} record details` : `${record ? 'Edit' : 'Add'} ${type} record`;
    const rows = isPv ? [
      inputField('Date *','date',data.date || isoToday(),'date','required'),inputField('Site *','site',data.site || '','text','required maxlength="120"'),
      inputField('Location / Block *','location',data.location || '','text','required maxlength="160"'),selectField('Table type','tableType',['Long','Short'],data.tableType),
      inputField('PV % complete','pvComplete',data.pvComplete ?? 0,'number','min="0" max="100" step="1"'),
      `<label>PV manpower<input name="manpower" list="pvManpowerOptions" value="${esc(data.manpower || '')}" placeholder="Select or enter a name"/><datalist id="pvManpowerOptions">${manpowerOptions.map(item=>`<option value="${item}">`).join('')}</datalist></label>`,
      selectField('Inspection status','inspectionStatus',inspectionOptions,data.inspectionStatus),inputField('Inspection date (type manually)','inspectionDate',data.inspectionDate || '','text','placeholder="YYYY-MM-DD"'),
      inputField('Billed date','billedDate',data.billedDate || '','date'),selectField('Payment status','paymentStatus',paymentOptions,data.paymentStatus),textAreaField('Remarks','remarks',data.remarks,true)
    ] : [
      inputField('Date *','date',data.date || isoToday(),'date','required'),inputField('Location / Block *','location',data.location || '','text','required maxlength="160"'),
      selectField('Table type','tableType',['Long','Short'],data.tableType),inputField('MS planned','msPlanned',data.msPlanned || ''),
      inputField('MS installed','msInstalled',data.msInstalled ?? '','number','min="0" max="100" step="1"'),inputField('MS % complete','msComplete',data.msComplete ?? 0,'number','min="0" max="100" step="1"'),
      `<label>MS installed by<input name="msInstalledBy" list="msManpowerOptions" value="${esc(data.msInstalledBy || '')}" placeholder="Select or enter a name"/><datalist id="msManpowerOptions">${[...manpowerOptions,'Fr: Ma’am Cha.'].map(item=>`<option value="${item}">`).join('')}</datalist></label>`,
      selectField('Inspection status','inspectionStatus',inspectionOptions,data.inspectionStatus),inputField('Inspection date (type manually)','inspectionDate',data.inspectionDate || '','text','placeholder="YYYY-MM-DD"'),
      inputField('Billed date','billedDate',data.billedDate || '','date'),selectField('Payment status','paymentStatus',paymentOptions,data.paymentStatus),
      textAreaField('Remarks','remarks',data.remarks),textAreaField('Notes','notes',data.notes),inputField('ADAWSHAT','adawshat',data.adawshat || ''),
      inputField('GenCon','genCon',data.genCon || ''),inputField('GenCon 2','genCon2',data.genCon2 || ''),inputField('OE','oe',data.oe || '')
    ];
    $('#modalRoot').innerHTML = `<div class="modal-backdrop" data-close-modal><section class="modal" role="dialog" aria-modal="true" aria-labelledby="recordModalTitle"><header class="modal-header"><div><h2 id="recordModalTitle">${title}</h2><p>${record ? `${esc(data.recordId)} · ${esc(data.location)}` : 'Enter project details below.'}</p></div><button class="modal-close" data-close-modal aria-label="Close">×</button></header><form id="recordForm"><div class="modal-body"><div class="record-form">${rows.join('')}</div></div><footer class="modal-footer"><button class="button ghost" type="button" data-close-modal>Close</button>${readOnly ? '' : `<button class="button primary" type="submit">${record ? 'Save changes' : 'Save record'}</button>`}</footer></form></section></div>`;
    if (readOnly) $$('input,select,textarea','#recordForm').forEach(field => field.disabled = true);
    $('#modalRoot').onclick = event => { if (event.target.hasAttribute('data-close-modal')) closeModal(); };
    $('#recordForm').addEventListener('submit', async event => {
      event.preventDefault(); const values = Object.fromEntries(new FormData(event.currentTarget));
      values.pvComplete = values.pvComplete === '' ? 0 : Number(values.pvComplete); values.msComplete = values.msComplete === '' ? 0 : Number(values.msComplete);
      if (values.msInstalled !== '') values.msInstalled = Number(values.msInstalled);
      try {
        await api(record ? `/records/${type}/${record.id}` : `/records/${type}`, { method:record ? 'PUT' : 'POST', body:JSON.stringify(values) });
        closeModal(); showToast(`${type} record ${record ? 'updated' : 'added'}.`,'success'); await setPage(state.page);
      } catch (error) { showToast(error.message,'error'); }
    });
  }
  function closeModal() { $('#modalRoot').innerHTML = ''; }
  function bindRowActions(type, records) {
    $('#dataTableRoot').onclick = event => {
      const button = event.target.closest('[data-row-action]'); if (!button) return;
      const row = records.find(item => String(item.id) === button.dataset.id); if (!row) return;
      if (button.dataset.rowAction === 'view') return openRecordModal(type,row,true);
      if (button.dataset.rowAction === 'edit') return openRecordModal(type,row,false);
      if (button.dataset.rowAction === 'delete') return confirmDelete(type,row);
    };
  }
  function confirmDelete(type, record) {
    $('#modalRoot').innerHTML = `<div class="modal-backdrop" data-close-modal><section class="modal" role="alertdialog" aria-modal="true"><header class="modal-header"><div><h2>Delete ${type} record?</h2><p>This action cannot be undone.</p></div><button class="modal-close" data-close-modal>×</button></header><div class="modal-body"><p class="confirm-copy">Delete <strong>${esc(record.recordId)}</strong> for <strong>${esc(record.location)}</strong>? The other database and its records will remain intact.</p></div><footer class="modal-footer"><button class="button ghost" data-close-modal>Cancel</button><button class="button danger" id="confirmDelete">Delete record</button></footer></section></div>`;
    $$('[data-close-modal]',$('#modalRoot')).forEach(element => element.addEventListener('click', event => { if (event.target.hasAttribute('data-close-modal')) closeModal(); }));
    $('#confirmDelete').onclick = async () => { try { await api(`/records/${type}/${record.id}`,{method:'DELETE'}); closeModal(); showToast('Record deleted.','success'); await setPage(state.page); } catch(error) { showToast(error.message,'error'); } };
  }
  function bindPageActions(actions) {
    pageContent.onclick = event => {
      const action = event.target.closest('[data-page-action]')?.dataset.pageAction;
      if (action && actions[action]) actions[action]();
    };
  }

  function csvValue(value) { let text = String(value ?? ''); if (/^\s*[=+\-@]/.test(text)) text = `'${text}`; return `"${text.replace(/"/g,'""')}"`; }
  function exportCsv(rows, filename) {
    if (!canExport()) return showToast('Your role cannot export reports.','error');
    if (!rows.length) return showToast('There are no records to export.');
    const columns = [...new Set(rows.flatMap(row => Object.keys(row).filter(key => !['pv','ms'].includes(key))))];
    const csv = [columns.map(csvValue).join(','),...rows.map(row => columns.map(key => csvValue(typeof row[key] === 'object' && row[key] !== null ? JSON.stringify(row[key]) : row[key])).join(','))].join('\r\n');
    downloadBlob(new Blob(['\ufeff',csv],{type:'text/csv;charset=utf-8'}),filename); showToast('CSV report downloaded.','success');
  }
  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob), anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click(); setTimeout(() => URL.revokeObjectURL(url),1000);
  }
  async function fetchAllForWorkbook() {
    const [pv,ms,merged,dashboard] = await Promise.all([api('/records/PV'),api('/records/MS'),api('/merged'),api('/dashboard')]);
    return { pv:pv.records, ms:ms.records, merged:merged.records, dashboard:dashboard.summary };
  }
  function exportWorkbook(data, filename = 'etairos-pv-ms-reports.xlsx') {
    if (!canExport()) return showToast('Your role cannot export reports.','error');
    if (!window.XLSX) return showToast('Excel export library did not load. Refresh and try again.','error');
    const book = XLSX.utils.book_new();
    const mapFields = records => records.map(record => Object.fromEntries(Object.entries(record).filter(([key]) => !['id','type','pv','ms'].includes(key))));
    for (const [name,records] of [['PV',data.pv],['MS',data.ms],['Merged Tracker',data.merged]]) XLSX.utils.book_append_sheet(book,XLSX.utils.json_to_sheet(mapFields(records)),name);
    const reportRows = Object.entries(data.dashboard).filter(([,value]) => typeof value !== 'object').map(([metric,value]) => ({ Metric:metric, Value:value }));
    XLSX.utils.book_append_sheet(book,XLSX.utils.json_to_sheet(reportRows),'Reports'); XLSX.writeFile(book,filename); showToast('Excel workbook downloaded.','success');
  }

  async function renderImport() {
    pageContent.innerHTML = `${heading('Excel import','Preview your PV and MS worksheets before merging any data.')}
      <section class="panel"><div class="panel-header"><div><div class="panel-title">Upload workbook</div><div class="panel-subtitle">The system starts empty. Every import merges new records and skips duplicates.</div></div></div>
      <div id="dropZone" class="dropzone"><div class="drop-icon">⇧</div><strong>Drop your Excel workbook here</strong><p>or choose an .xlsx or .xls file (maximum 25 MB)</p><input id="workbookFile" type="file" accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" class="hidden"><button class="button secondary" id="browseWorkbook" type="button">Browse files</button><span id="selectedFile" class="panel-footnote"></span></div>
      <div class="import-hint"><strong>Expected worksheets:</strong> <code>PV</code> and <code>MS</code>. Recommended columns include Date, Site (PV), Location/Block, Table Type, progress, manpower, inspection, payment, and Remarks. Existing data is retained.</div>
      <div id="importPreviewRoot"></div></section>`;
    const zone = $('#dropZone'), fileInput = $('#workbookFile');
    $('#browseWorkbook').onclick = () => fileInput.click();
    fileInput.onchange = () => { const file = fileInput.files[0]; if (file) uploadWorkbook(file); };
    zone.ondragover = event => { event.preventDefault(); zone.classList.add('dragover'); };
    zone.ondragleave = () => zone.classList.remove('dragover');
    zone.ondrop = event => { event.preventDefault(); zone.classList.remove('dragover'); const file = event.dataTransfer.files[0]; if (file) uploadWorkbook(file); };
  }
  async function uploadWorkbook(file) {
    if (!/\.(xlsx|xls)$/i.test(file.name)) return showToast('Choose an .xlsx or .xls workbook.','error');
    $('#selectedFile').textContent = `${file.name} · ${(file.size/1024/1024).toFixed(2)} MB`;
    const data = new FormData(); data.append('workbook',file);
    try { await showImportPreview(await api('/import/preview',{method:'POST',body:data})); }
    catch(error) { showToast(error.message,'error'); $('#importPreviewRoot').innerHTML = ''; }
  }
  async function showImportPreview(preview) {
    state.importPreview = preview;
    const stats = (name,item) => `<div class="import-result"><h3>${name} worksheet</h3><div class="import-grid"><div class="import-stat"><span>Records found</span><strong>${formatNumber(item.found)}</strong></div><div class="import-stat"><span>New records</span><strong>${formatNumber(item.newRecords)}</strong></div><div class="import-stat"><span>Duplicates</span><strong>${formatNumber(item.duplicates)}</strong></div><div class="import-stat"><span>Invalid records</span><strong>${formatNumber(item.invalid)}</strong></div></div></div>`;
    $('#importPreviewRoot').innerHTML = `<div class="import-result"><h3>Import preview</h3><p class="panel-subtitle">No data has been saved yet. Select Merge Data to add the new valid records.</p></div>${stats('PV',preview.summary.pv)}${stats('MS',preview.summary.ms)}<div class="page-actions" style="padding:0 16px 16px">${button('Cancel','cancel-import','ghost')}${button('Merge data','merge-import','primary','⇄')}</div>`;
    bindPageActions({ 'cancel-import':() => { state.importPreview = null; $('#importPreviewRoot').innerHTML = ''; $('#selectedFile').textContent = ''; }, 'merge-import':mergeImport });
  }
  async function mergeImport() {
    if (!state.importPreview) return;
    const buttonEl = $('[data-page-action="merge-import"]'); if (buttonEl) { buttonEl.disabled = true; buttonEl.textContent = 'Merging…'; }
    try {
      const previewSummary = state.importPreview.summary;
      const result = await api('/import/merge',{method:'POST',body:JSON.stringify({entries:state.importPreview.entries})});
      state.importPreview = null;
      const duplicates = result.duplicatePV + result.duplicateMS + previewSummary.pv.duplicates + previewSummary.ms.duplicates;
      const invalid = result.invalid + previewSummary.pv.invalid + previewSummary.ms.invalid;
      $('#importPreviewRoot').innerHTML = `<div class="import-result"><h3>Excel import summary</h3><div class="import-grid"><div class="import-stat"><span>PV records found</span><strong>${formatNumber(previewSummary.pv.found)}</strong></div><div class="import-stat"><span>MS records found</span><strong>${formatNumber(previewSummary.ms.found)}</strong></div><div class="import-stat"><span>New PV records</span><strong>${formatNumber(result.newPV)}</strong></div><div class="import-stat"><span>New MS records</span><strong>${formatNumber(result.newMS)}</strong></div><div class="import-stat"><span>Duplicate records</span><strong>${formatNumber(duplicates)}</strong></div><div class="import-stat"><span>Invalid records</span><strong>${formatNumber(invalid)}</strong></div></div><p class="panel-footnote">Successfully merged into tracker. Dashboard and merged locations now reflect the new records.</p></div>`;
      showToast(result.message,'success');
    } catch(error) { showToast(error.message,'error'); if (buttonEl) { buttonEl.disabled = false; buttonEl.textContent = 'Merge data'; } }
  }

  async function renderReports() {
    pageContent.innerHTML = `${heading('Reports','Review current tracker totals and export operational records.',canExport() ? button('Export full Excel workbook','export-workbook','primary','⇩') : '')}<div id="reportsSummary" class="summary-strip"></div><div class="report-grid" id="reportGrid"></div>`;
    try {
      const data = await fetchAllForWorkbook(), summary = data.dashboard;
      $('#reportsSummary').innerHTML = `<div class="summary-pill"><span>PV records</span><strong>${formatNumber(summary.totalPV)}</strong></div><div class="summary-pill"><span>MS records</span><strong>${formatNumber(summary.totalMS)}</strong></div><div class="summary-pill"><span>Merged locations</span><strong>${formatNumber(summary.totalMerged)}</strong></div><div class="summary-pill"><span>Paid status</span><strong>${formatNumber(summary.paid)}</strong></div>`;
      const cards = [
        ['PV report','PV installation progress, manpower, inspections, and billing.','PV',data.pv],['MS report','MS planned and installed quantities, progress, and notes.','MS',data.ms],['Merged tracker report','Latest PV and MS record for every tracked location.','Merged Tracker',data.merged],
        ['Billing report','Locations ready for billing and their current billing stage.','Billing',data.merged.filter(row=>['FOR BILLING','BILLED','PAID'].includes(row.overallStatus))],['Payment status report','Displayed payment statuses recorded by the team.','Payment',data.merged.filter(row=>row.paymentStatus)],['Progress report','Combined completion and status for project locations.','Progress',data.merged]
      ];
      $('#reportGrid').innerHTML = cards.map(([title,desc,key,rows],index)=>`<article class="report-card"><div class="report-icon">${['P','M','⇄','▤','₱','◷'][index]}</div><strong>${title}</strong><p>${desc}</p><span class="panel-footnote">${formatNumber(rows.length)} rows</span><div style="display:flex;gap:6px;margin-top:10px">${canExport()?`<button class="button ghost" data-report-csv="${key}">Export CSV</button>`:''}<button class="button secondary" data-report-view="${key}">View report</button></div></article>`).join('');
      bindPageActions({ 'export-workbook':() => exportWorkbook(data) });
      $('#reportGrid').onclick = event => {
        const csvKey = event.target.closest('[data-report-csv]')?.dataset.reportCsv, viewKey = event.target.closest('[data-report-view]')?.dataset.reportView;
        if (!csvKey && !viewKey) return;
        const card = cards.find(item => item[2] === (csvKey || viewKey)); if (!card) return;
        if (csvKey) return exportCsv(card[3],`${csvKey.toLowerCase().replace(/\s/g,'-')}-report.csv`);
        openReportModal(card[0],card[3]);
      };
    } catch(error) { showToast(error.message,'error'); }
  }
  function openReportModal(title,rows) {
    const cols = rows.length ? [...new Set(rows.flatMap(row=>Object.keys(row)).filter(key=>!['pv','ms'].includes(key)))].slice(0,9) : [];
    const markup = rows.length ? `<div class="table-scroll"><table class="data-table"><thead><tr>${cols.map(col=>`<th>${esc(col)}</th>`).join('')}</tr></thead><tbody>${rows.slice(0,100).map(row=>`<tr>${cols.map(col=>`<td>${esc(typeof row[col] === 'object' ? (row[col]?.recordId || '') : row[col])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : emptyState('No report rows','There are no records for this report yet.');
    $('#modalRoot').innerHTML = `<div class="modal-backdrop" data-close-modal><section class="modal wide" role="dialog" aria-modal="true"><header class="modal-header"><div><h2>${esc(title)}</h2><p>${formatNumber(rows.length)} records · showing up to 100 rows</p></div><button class="modal-close" data-close-modal>×</button></header><div class="modal-body">${markup}</div><footer class="modal-footer"><button class="button ghost" data-close-modal>Close</button>${canExport()?`<button id="modalExportCsv" class="button primary">Export CSV</button>`:''}</footer></section></div>`;
    $$('[data-close-modal]',$('#modalRoot')).forEach(element=>element.addEventListener('click',event=>{if(event.target.hasAttribute('data-close-modal'))closeModal();}));
    $('#modalExportCsv')?.addEventListener('click',()=>exportCsv(rows,`${title.toLowerCase().replace(/\s/g,'-')}.csv`));
  }

  function loadDriveScript() {
    return new Promise((resolve,reject)=>{
      if (window.google?.accounts?.oauth2) return resolve();
      const existing = $('script[data-google-identity]'); if (existing) { existing.addEventListener('load',resolve,{once:true}); existing.addEventListener('error',reject,{once:true}); return; }
      const script = document.createElement('script'); script.dataset.googleIdentity='true'; script.src='https://accounts.google.com/gsi/client'; script.async=true; script.defer=true; script.onload=resolve; script.onerror=reject; document.head.append(script);
    });
  }
  async function renderDrive() {
    pageContent.innerHTML = `${heading('Google Drive','Browse Excel workbooks from your Drive and send their PV/MS sheets through the same merge preview.')}
      <section class="panel"><div class="drive-connection"><div class="drive-logo">△</div><div class="drive-connection-copy"><strong>Connect your Google Drive</strong><p>Read-only access. Select one or more Excel files to preview and merge.</p></div><button id="connectDrive" class="button primary">Connect Drive</button></div><div id="driveListRoot">${emptyState('Drive is not connected','Connect an authorized Google account to browse Excel files.')}</div></section>
      <div class="page-actions" style="justify-content:flex-end;margin-top:12px"><button id="importDriveFiles" class="button primary" disabled>Preview selected files</button></div>`;
    $('#connectDrive').onclick = async () => {
      if (!state.config.googleClientId) return showToast('Set GOOGLE_CLIENT_ID in .env to enable Drive access.','error');
      try {
        await loadDriveScript();
        const client = google.accounts.oauth2.initTokenClient({ client_id:state.config.googleClientId, scope:'https://www.googleapis.com/auth/drive.readonly', callback:async result=>{
          if (result.error) return showToast('Unable to connect Google Drive.','error');
          state.driveToken = result.access_token; await listDriveFiles();
        } });
        client.requestAccessToken({ prompt:state.driveToken ? '' : 'consent' });
      } catch { showToast('Google Identity Services could not be loaded.','error'); }
    };
    $('#importDriveFiles').onclick = importSelectedDriveFiles;
  }
  async function listDriveFiles() {
    const root = $('#driveListRoot'); root.innerHTML = `<div class="empty-state">Loading your Excel files…</div>`;
    try {
      const query = encodeURIComponent("trashed=false and (mimeType='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' or mimeType='application/vnd.ms-excel' or mimeType='application/vnd.google-apps.spreadsheet')");
      const response = await fetch(`https://www.googleapis.com/drive/v3/files?q=${query}&pageSize=100&orderBy=modifiedTime%20desc&fields=files(id,name,mimeType,modifiedTime,size)`,{headers:{Authorization:`Bearer ${state.driveToken}`}});
      const result = await response.json(); if (!response.ok) throw new Error(result.error?.message || 'Unable to list Drive files.');
      state.driveFiles = result.files || [];
      root.innerHTML = state.driveFiles.length ? state.driveFiles.map(file=>`<label class="drive-file"><input type="checkbox" data-drive-file="${esc(file.id)}"><span class="drive-file-name">${esc(file.name)}</span><small>${file.mimeType==='application/vnd.google-apps.spreadsheet'?'Google Sheet':niceDate((file.modifiedTime||'').slice(0,10))}</small></label>`).join('') : emptyState('No Excel files found','Upload an .xlsx/.xls file or Google Sheet to your Drive and refresh this list.');
      $$('#driveListRoot input[type=checkbox]').forEach(box=>box.onchange=()=>$('#importDriveFiles').disabled=!$('#driveListRoot input:checked'));
      showToast(`${state.driveFiles.length} workbook${state.driveFiles.length===1?'':'s'} found.`,'success');
    } catch(error) { root.innerHTML = emptyState('Could not read Drive files',esc(error.message)); showToast(error.message,'error'); }
  }
  async function importSelectedDriveFiles() {
    const selected = $$('#driveListRoot input:checked').map(input=>state.driveFiles.find(file=>file.id===input.dataset.driveFile)).filter(Boolean);
    if (!selected.length) return showToast('Select at least one workbook.');
    $('#importDriveFiles').disabled=true; $('#importDriveFiles').textContent='Reading files…';
    const rows={pv:[],ms:[]};
    try {
      for (const file of selected) {
        const googleSheet=file.mimeType==='application/vnd.google-apps.spreadsheet';
        const url=googleSheet?`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.id)}/export?mimeType=application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`:`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.id)}?alt=media`;
        const response=await fetch(url,{headers:{Authorization:`Bearer ${state.driveToken}`}}); if(!response.ok) throw new Error(`Unable to download ${file.name}.`);
        const buffer=await response.arrayBuffer(); const workbook=XLSX.read(buffer,{type:'array',cellDates:false});
        for(const type of ['pv','ms']) {
          const sheet=workbook.SheetNames.find(name=>name.trim().toLowerCase()===type);
          if(!sheet) throw new Error(`${file.name}: PV or MS worksheet was not found.`);
          rows[type].push(...XLSX.utils.sheet_to_json(workbook.Sheets[sheet],{defval:'',raw:false}));
        }
      }
      const preview=await api('/import/preview',{method:'POST',body:JSON.stringify({rows})}); state.page='import'; await setPage('import');
      $('#selectedFile').textContent=`${selected.length} Drive file${selected.length===1?'':'s'} selected`;
      await showImportPreview(preview); showToast('Drive workbooks are ready for preview.','success');
    } catch(error) { showToast(error.message,'error'); }
    finally { $('#importDriveFiles').disabled=false; $('#importDriveFiles').textContent='Preview selected files'; }
  }

  async function renderBackup() {
    pageContent.innerHTML = `${heading('Data backup','Export a JSON snapshot or restore one after an explicit confirmation.')}
      <div class="backup-actions"><article class="backup-card"><div class="report-icon">⇩</div><h3>Export JSON backup</h3><p>Create a portable backup of all PV and MS records. User accounts and secrets are not included.</p><button id="exportBackup" class="button primary" ${canExport()?'':'disabled'}>Download backup</button></article>
      <article class="backup-card"><div class="report-icon">▤</div><h3>Export full Excel workbook</h3><p>Download PV, MS, Merged Tracker, and Reports sheets in one workbook.</p><button id="exportBackupExcel" class="button secondary" ${canExport()?'':'disabled'}>Download Excel workbook</button></article>
      <article class="backup-card"><div class="report-icon">⇧</div><h3>Import JSON backup</h3><p>Choose merge to add only new records. Replace is available to administrators and requires a separate confirmation.</p><input id="backupFile" type="file" accept="application/json,.json" class="hidden"><button id="chooseBackup" class="button secondary" ${state.user?.role==='ADMIN'?'':'disabled'}>Choose backup file</button></article>
      ${state.user?.role==='ADMIN'?'<article class="backup-card"><div class="report-icon">⌫</div><h3>Start a new file</h3><p>Clear every PV and MS record to prepare an empty tracker. Accounts will remain. Download a backup first if you may need this data.</p><button id="clearAllRecords" class="button danger">Clear all PV &amp; MS data</button></article>':''}</div><div id="backupPreviewRoot" style="margin-top:14px"></div>
      <div class="import-hint" style="margin:14px 0 0"><strong>Current behavior:</strong> imports merge by Location/Block + Date + database type. Existing matching rows are skipped automatically.</div>`;
    $('#exportBackup').onclick = async () => {
      if(!canExport()) return showToast('Your role cannot export data.','error');
      try { const backup=await api('/backup'); downloadBlob(new Blob([JSON.stringify(backup,null,2)],{type:'application/json'}),`etairos-backup-${isoToday()}.json`); showToast('JSON backup downloaded.','success'); }
      catch(error) { showToast(error.message,'error'); }
    };
    $('#exportBackupExcel').onclick = async () => {
      if(!canExport()) return showToast('Your role cannot export data.','error');
      try { exportWorkbook(await fetchAllForWorkbook()); } catch(error) { showToast(error.message,'error'); }
    };
    $('#chooseBackup').onclick=()=>$('#backupFile').click();
    $('#clearAllRecords')?.addEventListener('click',confirmClearAllRecords);
    $('#backupFile').onchange=async()=>{
      const file=$('#backupFile').files[0]; if(!file)return;
      try {
        const backup=JSON.parse(await file.text());
        if(!backup.records||!Array.isArray(backup.records.pv)||!Array.isArray(backup.records.ms)) throw new Error('Choose a valid ETAIROS JSON backup.');
        state.backup=backup;
        $('#backupPreviewRoot').innerHTML=`<section class="panel"><div class="panel-header"><div><div class="panel-title">Backup preview</div><div class="panel-subtitle">${esc(file.name)} · exported ${esc(backup.exportedAt||'date unavailable')}</div></div></div><div class="panel-body"><div class="summary-strip"><div class="summary-pill"><span>PV records</span><strong>${formatNumber(backup.records.pv.length)}</strong></div><div class="summary-pill"><span>MS records</span><strong>${formatNumber(backup.records.ms.length)}</strong></div></div><div class="page-actions">${button('Cancel restore','cancel-backup','ghost')}${button('Merge backup','merge-backup','primary','⇄')}${state.user?.role==='ADMIN'?button('Replace all data','replace-backup','danger'):''}</div></div></section>`;
        bindPageActions({'cancel-backup':()=>{state.backup=null;$('#backupPreviewRoot').innerHTML='';},'merge-backup':()=>restoreBackup('merge'),'replace-backup':()=>confirmReplaceBackup()});
      }catch(error){showToast(error.message,'error');}
    };
  }
  async function restoreBackup(mode) {
    if(!state.backup)return;
    try { const result=await api('/backup/restore',{method:'POST',body:JSON.stringify({backup:state.backup,mode})}); state.backup=null; $('#backupPreviewRoot').innerHTML=`<div class="import-result"><h3>Backup ${mode==='replace'?'restored':'merged'}</h3><p class="panel-subtitle">New PV: ${result.newPV} · New MS: ${result.newMS} · Duplicates skipped: ${result.duplicatePV+result.duplicateMS}</p></div>`; showToast(result.message,'success'); }
    catch(error){showToast(error.message,'error');}
  }
  function confirmReplaceBackup() {
    $('#modalRoot').innerHTML=`<div class="modal-backdrop"><section class="modal" role="alertdialog" aria-modal="true"><header class="modal-header"><div><h2>Replace all tracker data?</h2><p>Restore backup as a replacement</p></div><button class="modal-close" data-close-modal>×</button></header><div class="modal-body"><p class="confirm-copy">This will delete all current PV and MS records and replace them with the selected backup. This cannot be undone. Continue only if this replacement is intentional.</p></div><footer class="modal-footer"><button class="button ghost" data-close-modal>Cancel</button><button id="confirmReplace" class="button danger">Replace records</button></footer></section></div>`;
    $$('[data-close-modal]',$('#modalRoot')).forEach(item=>item.onclick=closeModal); $('#confirmReplace').onclick=()=>{closeModal();restoreBackup('replace');};
  }
  function confirmClearAllRecords() {
    $('#modalRoot').innerHTML=`<div class="modal-backdrop" data-close-modal><section class="modal" role="alertdialog" aria-modal="true" aria-labelledby="clearRecordsTitle"><header class="modal-header"><div><h2 id="clearRecordsTitle">Clear all PV and MS data?</h2><p>Prepare an empty tracker for a new file</p></div><button class="modal-close" data-close-modal aria-label="Close">×</button></header><div class="modal-body"><p class="confirm-copy">This permanently deletes every PV and MS record. User accounts will remain. Download a backup first if you may need these records again.</p><label class="clear-confirm-label" for="clearAllConfirmation">Type <strong>DELETE</strong> to enable this action.</label><input id="clearAllConfirmation" class="clear-confirm-input" autocomplete="off" spellcheck="false" aria-label="Type DELETE to confirm"></div><footer class="modal-footer"><button class="button ghost" data-close-modal>Cancel</button><button id="confirmClearAll" class="button danger" disabled>Delete all records</button></footer></section></div>`;
    $$('[data-close-modal]',$('#modalRoot')).forEach(item=>item.addEventListener('click',event=>{if(event.target.hasAttribute('data-close-modal'))closeModal();}));
    const confirmation=$('#clearAllConfirmation'), confirmButton=$('#confirmClearAll');
    confirmation.focus();
    confirmation.addEventListener('input',()=>{confirmButton.disabled=confirmation.value.trim().toUpperCase()!=='DELETE';});
    confirmButton.addEventListener('click',async()=>{
      confirmButton.disabled=true;
      try {
        const result=await api('/records',{method:'DELETE'});
        closeModal(); showToast(`Cleared ${formatNumber(result.deletedPV)} PV and ${formatNumber(result.deletedMS)} MS records. The tracker is ready for a new file.`,'success');
      } catch(error) { confirmButton.disabled=false; showToast(error.message,'error'); }
    });
  }

  async function renderUsers() {
    if(state.user?.role!=='ADMIN')return setPage('dashboard');
    const {users}=await api('/admin/users'); state.users=users;
    const pending=users.filter(user=>user.status==='PENDING').length;
    $('#pendingBadge').textContent=String(pending); $('#pendingBadge').classList.toggle('hidden',!pending);
    const rows=users.map(user=>`<tr><td><span class="cell-main">${esc(user.name)}</span><div class="cell-sub">${esc(user.email)}</div></td><td>${badge(user.status)}</td><td><select class="user-role" data-user-id="${user.id}">${roleOptions.map(role=>`<option ${user.role===role?'selected':''}>${role}</option>`).join('')}</select></td><td>${user.verified?'Verified':'Unverified'}</td><td>${niceDate(String(user.created_at||'').slice(0,10))}</td><td><div class="row-actions">${user.status==='PENDING'?`<button class="button secondary" data-user-action="APPROVED" data-user-id="${user.id}">Approve</button><button class="button danger" data-user-action="REJECTED" data-user-id="${user.id}">Reject</button>`:''}</div></td></tr>`).join('');
    pageContent.innerHTML=`${heading('User management','Review registration requests and manage approved user roles.')}<div class="summary-strip"><div class="summary-pill"><span>Pending requests</span><strong>${pending}</strong></div><div class="summary-pill"><span>Approved users</span><strong>${users.filter(user=>user.status==='APPROVED').length}</strong></div><div class="summary-pill"><span>Rejected users</span><strong>${users.filter(user=>user.status==='REJECTED').length}</strong></div><div class="summary-pill"><span>Total accounts</span><strong>${users.length}</strong></div></div><section class="panel"><div class="panel-header"><div><div class="panel-title">Accounts</div><div class="panel-subtitle">Only verified and approved accounts can sign in.</div></div></div>${users.length?`<div class="table-scroll"><table class="data-table"><thead><tr><th>USER</th><th>STATUS</th><th>ROLE</th><th>EMAIL</th><th>CREATED</th><th>ACTION</th></tr></thead><tbody>${rows}</tbody></table></div>`:emptyState('No accounts yet','New account requests will appear here.')}</section>`;
    pageContent.onchange=async event=>{const select=event.target.closest('.user-role');if(!select)return;await updateUser(select.dataset.userId,{role:select.value});};
    pageContent.onclick=async event=>{const button=event.target.closest('[data-user-action]');if(button)await updateUser(button.dataset.userId,{status:button.dataset.userAction});};
  }
  async function refreshPendingBadge() {
    try {
      const {users}=await api('/admin/users'), pending=users.filter(user=>user.status==='PENDING').length;
      $('#pendingBadge').textContent=String(pending); $('#pendingBadge').classList.toggle('hidden',!pending);
    } catch { /* dashboard remains available if account management is temporarily unavailable */ }
  }
  async function updateUser(id,changes) { try{await api(`/admin/users/${id}`,{method:'PATCH',body:JSON.stringify(changes)});showToast('User account updated.','success');await renderUsers();}catch(error){showToast(error.message,'error');} }
  async function renderSettings() {
    const user=state.user||{};
    pageContent.innerHTML=`${heading('Settings','Workspace configuration and signed-in account details.')}<div class="settings-grid"><section class="panel"><div class="panel-header"><div><div class="panel-title">Signed-in account</div><div class="panel-subtitle">Your permissions are determined by the assigned role.</div></div></div><div class="panel-body"><div class="setting-row"><span>Name</span><strong>${esc(user.name)}</strong></div><div class="setting-row"><span>Gmail</span><strong>${esc(user.email)}</strong></div><div class="setting-row"><span>Role</span><strong>${esc(formatRole(user.role))}</strong></div><div class="setting-row"><span>Account status</span><strong>Approved and verified</strong></div></div></section><section class="panel"><div class="panel-header"><div><div class="panel-title">Service configuration</div><div class="panel-subtitle">Optional integrations activate when configured on the server.</div></div></div><div class="panel-body"><div class="setting-row"><span>Google Sign-In</span><strong>${state.config.googleClientId?'Configured':'Not configured'}</strong></div><div class="setting-row"><span>Google Drive</span><strong>${state.config.driveEnabled?'Configured':'Not configured'}</strong></div><div class="setting-row"><span>Gmail verification</span><strong>${state.config.smtpConfigured?'Configured':'Development code mode'}</strong></div><div class="setting-row"><span>Storage</span><strong>Server-side SQLite</strong></div></div></section></div>`;
    const serviceBody=$('.settings-grid .panel:last-child .panel-body');
    serviceBody?.insertAdjacentHTML('beforeend',`<div class="setting-row"><span>Initial admin</span><strong>${state.config.bootstrapAdminConfigured?'Configured':'Set BOOTSTRAP_ADMIN_EMAIL'}</strong></div>`);
    if(!state.config.smtpConfigured&&!state.config.developmentMode){
      const mailRow=$$('.setting-row',serviceBody).find(row=>row.querySelector('span')?.textContent==='Gmail verification');
      if(mailRow)mailRow.querySelector('strong').textContent='Not configured';
    }
  }

  function wireShell() {
    $('#loginForm').addEventListener('submit',handleLogin); $('#signupForm').addEventListener('submit',handleSignup);
    $('#requestCodeButton').addEventListener('click',requestCode);
    $('#authSwitch').addEventListener('click',event=>{clearAuthNotice();const mode=event.currentTarget.dataset.mode;showAuth(mode);});
    $$('.password-toggle').forEach(button=>button.addEventListener('click',()=>{const input=button.parentElement.querySelector('input');input.type=input.type==='password'?'text':'password';button.textContent=input.type==='password'?'Show':'Hide';}));
    $('#profileButton').addEventListener('click',()=>$('#profileMenu').classList.toggle('hidden'));
    $('#signOutButton').addEventListener('click',signOut);
    $('#sideNav').addEventListener('click',event=>{const button=event.target.closest('[data-page]');if(button)setPage(button.dataset.page);});
    $('#menuButton').addEventListener('click',openSidebar); $('#sidebarClose').addEventListener('click',closeSidebar); $('#sidebarScrim').addEventListener('click',closeSidebar);
    $('#googleSignIn').addEventListener('click',()=>{if(!state.config.googleClientId)showAuthNotice('Google Sign-In is not configured. Add GOOGLE_CLIENT_ID to your .env file.','error');});
  }
  function openSidebar(){ $('#sidebar').classList.add('open');$('#sidebarScrim').classList.add('visible'); }
  function closeSidebar(){ $('#sidebar').classList.remove('open');$('#sidebarScrim').classList.remove('visible'); }
  async function init() {
    wireShell();
    try { state.config=await fetch(`${API}/config`).then(response=>response.json()); } catch { state.config={}; }
    loadGoogleIdentity();
    if(state.token) {
      try { const data=await api('/auth/me');state.user=data.user;showApp();return; }
      catch { clearSession(); }
    }
    showAuth('login');
  }
  document.addEventListener('DOMContentLoaded',init);
})();
