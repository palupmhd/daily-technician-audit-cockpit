/* App data loading + event bootstrap module */
(function(){
/* ── DATA LOADING ── */
async function loadDateIndex(date){
  const file=S.manifest.files[date]?.index;
  S.dateIndex=await fetchJson(file);
  const zones=zonesForActivePic(Object.keys(S.dateIndex.zones||{}).sort());
  $('zoneSelect').innerHTML='<option value="all">— Semua Zona —</option>'+zones.map(z=>{
    const zd=S.dateIndex.zones[z];
    return`<option value="${esc(z)}">${esc(z)}${zd.highIssues?` ⚠${zd.highIssues}`:''}</option>`;
  }).join('');
  if($('zoneSelect').value!=='all'&&!zones.includes($('zoneSelect').value))$('zoneSelect').value='all';
  S.allZonesData=null;  // invalidate cache on date change
}

async function loadAllZonesAggregated(){
  const date=$('dateSelect').value;
  if(!S.dateIndex)return;
  const zones=zonesForActivePic(Object.keys(S.dateIndex.zones||{}));
  $('routeList').innerHTML='<div class="empty-state">Memuat semua zona...</div>';
  $('issueList').innerHTML='<div class="empty-state">Memuat...</div>';
  $('zoneStats').innerHTML=`
    <div class="zstat"><div class="n">—</div><div class="l">Routes</div></div>
    <div class="zstat danger"><div class="n">—</div><div class="l">High</div></div>
    <div class="zstat warn"><div class="n">—</div><div class="l">Medium</div></div>
    <div class="zstat info"><div class="n">—</div><div class="l">GPS Pts</div></div>`;
  await new Promise(r=>setTimeout(r,0));
  const allRoutes=[],allIssues=[];
  const CONCURRENT=5;
  for(let i=0;i<zones.length;i+=CONCURRENT){
    await Promise.all(zones.slice(i,i+CONCURRENT).map(async z=>{
      const file=S.manifest.files[date]?.zones?.[z];
      if(!file)return;
      let data;
      if(S.dataCache[file]){data=S.dataCache[file];}
      else{try{data=await fetchJson(file);S.dataCache[file]=data;}catch{return;}}
      (data.routes||[]).forEach(r=>allRoutes.push({...r,_zone:z}));
      (data.issues||[]).forEach(i=>allIssues.push({...i,_zone:z}));
    }));
  }
  S.zoneData={routes:allRoutes,issues:allIssues,summary:{routeCount:allRoutes.length}};
  S.gpsData=null;
  S.selectedRouteId=null;S.selectedIssueId=null;
  S.followupUi={edit:{},statusOpen:{}};
  loadFollowups();
  renderZoneStats();renderRouteList();renderIssueList();renderEvidence(null);
  clearAllMapLayers();
  $('mapOverlay').innerHTML='<span class="map-pill">Pilih route untuk lihat peta zona spesifik.</span>';
}

async function loadZoneData(){
  const selectedZone=$('zoneSelect').value;
  if(selectedZone!=='all'&&!zoneAllowedByAuditPic(selectedZone))$('zoneSelect').value='all';
  if($('zoneSelect').value==='all'){await loadAllZonesAggregated();return;}
  const date=$('dateSelect').value,zone=$('zoneSelect').value;
  const file=S.manifest.files[date]?.zones?.[zone];
  if(!file){
    $('routeList').innerHTML='<div class="empty-state">File zona tidak ditemukan.</div>';
    return;
  }
  // Show loading immediately, yield to browser before heavy work
  $('routeList').innerHTML='<div class="empty-state">Memuat...</div>';
  $('zoneStats').innerHTML=`
    <div class="zstat"><div class="n">—</div><div class="l">Routes</div></div>
    <div class="zstat danger"><div class="n">—</div><div class="l">High</div></div>
    <div class="zstat warn"><div class="n">—</div><div class="l">Medium</div></div>
    <div class="zstat info"><div class="n">—</div><div class="l">GPS Pts</div></div>`;
  await new Promise(r=>setTimeout(r,0));
  try{
  if(S.dataCache[file]){S.zoneData=S.dataCache[file];}
  else{S.zoneData=await fetchJson(file);S.dataCache[file]=S.zoneData;}
  S.gpsData=null;
  S.gpsPlateDisabled.clear();
  S.gpsFilterTouched=false;
  $('gpsFilterPop').classList.remove('show');
  $('gpsFilterTog')?.classList.remove('active');
  const gk=S.zoneData.gpsFile;
  if(gk&&S.gpsCache[gk])S.gpsData=S.gpsCache[gk];
  S.selectedRouteId=null;S.selectedIssueId=null;
  S.followupUi={edit:{},statusOpen:{}};
  S.gpsTimeFilter='all';
  const gpsEl=$('gpsTimeAll');if(gpsEl)gpsEl.checked=true;
  if(S.qfHideResolved){S.qfHideResolved=false;$('qfHideResolved').classList.remove('on');}
  loadFollowups();
  // Render list immediately
  renderZoneStats();renderRouteList();renderIssueList();renderEvidence(null);
  // Defer map to next frame so list renders first
  requestAnimationFrame(()=>{
    clearAllMapLayers();
    $('mapOverlay').innerHTML='<span class="map-pill">Pilih route untuk lihat evidence map.</span>';
    const first=(S.zoneData?.routes||[])[0];
    if(first){
      S.selectedRouteId=first.routeId;
      renderMap(first);
      renderEvidence(first);
      updateRouteHighlight(first.routeId,null);
    }
  });
  if(!S.gpsData)loadGpsData().then(()=>{renderGpsPlateFilter();}).catch(()=>{});
  else renderGpsPlateFilter();
  }catch(err){
    console.error('loadZoneData error:',err);
    $('routeList').innerHTML=`<div class="empty-state">Gagal load zona: ${esc(err.message)}</div>`;
    toast('Gagal memuat data zona.');
  }
}

async function warmCache(){
  const date=$('dateSelect').value;
  if(!S.manifest||!S.dateIndex)return;
  const zones=zonesForActivePic(Object.keys(S.dateIndex.zones||{}));
  const currentZone=$('zoneSelect').value;
  for(const z of zones){
    if(z===currentZone)continue;
    const file=S.manifest.files[date]?.zones?.[z];
    if(file&&!S.dataCache[file]){
      await new Promise(r=>setTimeout(r,60));
      fetchJson(file).then(d=>{S.dataCache[file]=d;}).catch(()=>{});
    }
  }
  for(const z of zones){
    const file=S.manifest.files[date]?.zones?.[z];
    const data=file?S.dataCache[file]:null;
    if(!data?.gpsFile)continue;
    const gk=data.gpsFile;
    if(!S.gpsCache[gk]){
      await new Promise(r=>setTimeout(r,120));
      fetchJson(gk).then(d=>{S.gpsCache[gk]=d;}).catch(()=>{});
    }
  }
}

async function loadAuditors(){
  try{
    const cfg=await fetchJson('config/auditors.json');
    S.auditors=Array.isArray(cfg.auditors)?cfg.auditors:[];
  }catch{
    S.auditors=['Palupi','Diana','Wiwin'];
  }
  if(!S.auditors.length)S.auditors=['Palupi','Diana','Wiwin'];
}

async function loadAuditPicZones(){
  try{
    const cfg=await fetchJson('config/audit_pic_zones.json');
    S.auditPicZones=cfg?.pics&&typeof cfg.pics==='object'?cfg.pics:{};
  }catch{
    S.auditPicZones={};
  }
  const sel=$('auditPicSelect');
  if(!sel)return;
  const pics=Object.keys(S.auditPicZones);
  sel.innerHTML='<option value="all">Semua PIC</option>'+pics.map(p=>`<option value="${esc(p)}">${esc(p)}</option>`).join('');
  let saved='all';
  try{saved=localStorage.getItem('audit_pic_filter')||'all';}catch{}
  if(saved!=='all'&&!pics.includes(saved))saved='all';
  S.auditPic=saved;
  sel.value=saved;
}

function zonesForActivePic(zones){
  const pic=S.auditPic||'all';
  if(pic==='all')return [...zones].sort();
  const allowed=new Set(S.auditPicZones?.[pic]||[]);
  return [...zones].filter(z=>allowed.has(z)).sort();
}

function zoneAllowedByAuditPic(zone){
  return zonesForActivePic([zone]).length>0;
}

function activeTheme(){
  return document.documentElement.dataset.theme==='dark'?'dark':'light';
}

function setTheme(theme,{syncMap=true}={}){
  const next=theme==='dark'?'dark':'light';
  document.documentElement.dataset.theme=next;
  try{localStorage.setItem('audit_theme',next);}catch{}
  const isDark=next==='dark';
  $('themeToggleLabel').textContent=isDark?'Dark':'Light';
  $('themeIconSun').style.display=isDark?'none':'block';
  $('themeIconMoon').style.display=isDark?'block':'none';
  const style=isDark?'carto_dark':'carto_light';
  $('mapStyleSelect').value=style;
  document.querySelectorAll('[data-style]').forEach(e=>e.classList.toggle('on',e.dataset.style===style));
  if(syncMap&&typeof setLayer==='function'){
    $('mapStyleSelect').value=style;
    setLayer(style);
  }
}

function setAuditor(name){
  S.auditor=name||null;
  try{localStorage.setItem('audit_auditor_name',S.auditor||'');}catch{}
  $('auditorNameTop').textContent=S.auditor||'Auditor';
  $('auditorChip').style.display=S.auditor?'flex':'none';
  $('identityGate').classList.toggle('show',!S.auditor);
}

async function ensureAuditor(){
  await loadAuditors();
  const sel=$('auditorSelect');
  sel.innerHTML=S.auditors.map(n=>`<option value="${esc(n)}">${esc(n)}</option>`).join('');
  let saved='';
  try{saved=localStorage.getItem('audit_auditor_name')||'';}catch{}
  if(saved&&S.auditors.includes(saved)){
    sel.value=saved;
    setAuditor(saved);
  }else{
    sel.value=S.auditors[0];
    setAuditor(null);
  }
}

async function init(){
  setTheme(activeTheme(),{syncMap:false});
  initMap();
  try{
    await ensureAuditor();
    await loadAuditPicZones();
    S.manifest=await fetchJson('data/manifest.json');
    const s=S.manifest.stats||{};
    $('buildInfo').textContent=`${S.manifest.generatedAt} · ${s.routes||0} routes · ${s.issues||0} issues`;
    const dates=S.manifest.availableDates||[];
    if(!dates.length)throw new Error('Manifest kosong — jalankan build_data.py dulu.');
    const di=$('dateSelect');
    di.min=dates[dates.length-1];di.max=dates[0];di.value=dates[0];
    await loadDateIndex($('dateSelect').value);
    await loadZoneData();
    snCheck(); // probe server.py after data loaded (so dateSelect has value)
    warmCache();
  }catch(err){
    console.error(err);
    // Detect if opened directly from file system (no server)
    const isFile=location.protocol==='file:';
    const hint=isFile
      ?'Jangan buka langsung — jalankan: python server.py, lalu buka http://localhost:8787'
      :'Gagal load data — pastikan build_data.py sudah dijalankan dan server berjalan.';
    $('buildInfo').textContent=hint;
    $('routeList').innerHTML=`<div class="empty-state" style="padding:16px">
      <div style="font-weight:600;margin-bottom:8px;color:var(--danger)">⚠ Gagal memuat data</div>
      <div style="font-size:11px;color:var(--muted);line-height:1.6">${esc(err.message)}<br><br>${esc(hint)}</div>
    </div>`;
  }
}

/* ── EVENTS ── */
$('dateSelect').addEventListener('change',async()=>{
  const d=$('dateSelect').value;
  if(!(S.manifest.availableDates||[]).includes(d)){toast('Data tidak tersedia untuk tanggal ini.');$('dateSelect').value=S.manifest.availableDates?.[0]||d;return;}
  await loadDateIndex(d);await loadZoneData();
});
$('zoneSelect').addEventListener('change',loadZoneData);
$('auditPicSelect').addEventListener('change',async()=>{
  S.auditPic=$('auditPicSelect').value||'all';
  try{localStorage.setItem('audit_pic_filter',S.auditPic);}catch{}
  $('zoneSelect').value='all';
  if(S.dateIndex)await loadDateIndex($('dateSelect').value);
  await loadZoneData();
  warmCache();
});
$('searchInput').addEventListener('input',debounce(()=>{renderRouteList();renderIssueList();},180));

/* stats bar — clickable severity filter */
$('zoneStats').addEventListener('click',e=>{
  const stat=e.target.closest('[data-sev-filter]');
  if(!stat)return;
  const sev=stat.dataset.sevFilter;
  const current=$('severitySelect').value;
  const next=current===sev?'all':sev;
  $('severitySelect').value=next;
  document.querySelectorAll('[data-sev-filter]').forEach(s=>s.classList.toggle('sev-active',s.dataset.sevFilter===next&&next!=='all'));
  renderRouteList();renderIssueList();
});

/* map style — from legend */
document.querySelectorAll('[data-style]').forEach(el=>{
  el.addEventListener('click',()=>{
    const style=el.dataset.style;
    document.querySelectorAll('[data-style]').forEach(e=>e.classList.toggle('on',e.dataset.style===style));
    $('mapStyleSelect').value=style;
    setLayer(style);
  });
});

$('themeToggleBtn').addEventListener('click',()=>{
  setTheme(activeTheme()==='dark'?'light':'dark');
});

/* tabs */
document.querySelectorAll('.tab-btn').forEach(btn=>{
  btn.addEventListener('click',()=>{
    const tab=btn.dataset.tab;
    document.querySelectorAll('.tab-btn').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));
    document.querySelectorAll('.tab-content').forEach(c=>c.classList.toggle('active',c.id===`tabContent${tab.charAt(0).toUpperCase()+tab.slice(1)}`));
  });
});

/* quick filters */
function setupQfPill(id,stateKey,onChange){
  $(id).addEventListener('click',()=>{
    S[stateKey]=!S[stateKey];
    $(id).classList.toggle('on',S[stateKey]);
    if(onChange)onChange();
  });
}
setupQfPill('qfHideNoise','qfHideNoise',()=>renderRouteList());
setupQfPill('qfOnlyAction','qfOnlyAction',()=>renderRouteList());
setupQfPill('qfHideResolved','qfHideResolved',()=>renderRouteList());
setupQfPill('qfHideNoiseIssue','qfHideNoiseIssue',()=>renderIssueList());

/* layer toggles */
document.querySelectorAll('.leg-item').forEach(el=>{
  el.addEventListener('click',async()=>{
    const layer=el.dataset.layer;
    if(!layer)return;
    if(layer==='gpsFilter'){
      $('gpsFilterPop').classList.toggle('show');
      el.classList.toggle('active');
      return;
    }
    S.layerToggles[layer]=!S.layerToggles[layer];
    if(layer==='gpsPoints'&&S.layerToggles.gpsPoints){
      S.layerToggles.gps=true;
      document.querySelector('[data-layer="gps"]')?.classList.add('on');
    }
    el.classList.toggle('on',S.layerToggles[layer]);
    const isGpsLayer=layer==='gps'||layer==='gpsPoints';
    if(isGpsLayer&&S.layerToggles.gps&&!S.gpsData){
      try{await loadGpsData();renderGpsPlateFilter();}catch(err){toast(err.message);}
    }
    if(isGpsLayer){
      const r=routeById(S.selectedRouteId);
      clearGpsLayer();
      if(S.layerToggles.gps)renderGpsLayer(r);
      scheduleRenderMap({gpsOnly:true});
    }else{
      scheduleRenderMap();
    }
  });
});

/* GPS time filter radio */
document.querySelectorAll('input[name="gpsTimeFilter"]').forEach(el=>{
  el.addEventListener('change',()=>{
    S.gpsTimeFilter=el.value;
    const r=routeById(S.selectedRouteId);
    clearGpsLayer();renderGpsLayer(r);
    scheduleRenderMap({gpsOnly:true});
  });
});

function updateGpsTimeLabel(route){
  const val=$('gpsTimeAfterVal');
  if(!val)return;
  if(route?.endTime){
    val.textContent=`(>${route.endTime})`;
    $('gpsTimeAfterLabel')?.style.setProperty('opacity','1');
  } else {
    val.textContent='(tidak tersedia)';
    $('gpsTimeAfterLabel')?.style.setProperty('opacity','.4');
  }
}
$('gpsSelectAll').addEventListener('click',()=>{
  S.gpsFilterTouched=true;
  S.gpsPlateDisabled.clear();
  renderGpsPlateFilter($('gpsSearchInput')?.value||'');
  const r=routeById(S.selectedRouteId);
  clearGpsLayer();renderGpsLayer(r);
  scheduleRenderMap({gpsOnly:true});
});
$('gpsSelectNone').addEventListener('click',()=>{
  S.gpsFilterTouched=true;
  const vehicles=S.gpsData?.gpsLayer?.vehicles||[];
  vehicles.forEach(v=>S.gpsPlateDisabled.add(v.plate));
  renderGpsPlateFilter($('gpsSearchInput')?.value||'');
  clearGpsLayer();
  scheduleRenderMap({gpsOnly:true});
});

// GPS search input
document.addEventListener('input',(e)=>{
  if(e.target.id==='gpsSearchInput'){
    renderGpsPlateFilter(e.target.value);
  }
});

/* Close gps filter when clicking outside */
document.addEventListener('click',(e)=>{
  const pop=$('gpsFilterPop');
  const tog=$('gpsFilterTog');
  if(!pop.classList.contains('show'))return;
  if(pop.contains(e.target)||tog?.contains(e.target))return;
  if(e.target.closest('#gpsOverlayBtn'))return;
  pop.classList.remove('show');
  tog?.classList.remove('active');
});

/* Export dropdown */
$('exportBtn').addEventListener('click',(e)=>{
  e.stopPropagation();
  openExportModal();
});
document.addEventListener('click',(e)=>{
  if(!$('exportDropdown').contains(e.target))$('exportDropdown').classList.remove('open');
});

$('expFieldBtn').addEventListener('click',async()=>{await exportFieldReport();$('exportDropdown').classList.remove('open');});
$('expDataBtn').addEventListener('click',async()=>{await exportDataQuality();$('exportDropdown').classList.remove('open');});
$('expExecBtn').addEventListener('click',async()=>{await exportExecutiveSummary();$('exportDropdown').classList.remove('open');});
$('expSummaryBtn').addEventListener('click',()=>{exportSummaryRaw();$('exportDropdown').classList.remove('open');});
$('expIssueBtn').addEventListener('click',async()=>{await exportIssuesRaw();$('exportDropdown').classList.remove('open');});
$('expRouteBtn').addEventListener('click',()=>{exportRouteRaw();$('exportDropdown').classList.remove('open');});

function openExportModal(){
  if(typeof updateExportScopeText==='function')updateExportScopeText();
  $('exportDropdown').classList.remove('open');
  $('exportModal').classList.add('show');
}
function closeExportModal(){
  $('exportModal').classList.remove('show');
}
$('exportCloseBtn').addEventListener('click',closeExportModal);
$('exportModal').addEventListener('click',e=>{if(e.target.id==='exportModal')closeExportModal();});
document.querySelectorAll('[data-export-action]').forEach(btn=>{
  btn.addEventListener('click',async()=>{
    const action=btn.dataset.exportAction;
    btn.disabled=true;
    try{
      if(action==='field')await exportFieldReport();
      else if(action==='executive')await exportExecutiveSummary();
      else if(action==='data')await exportDataQuality();
      else if(action==='raw')await exportIssuesRaw();
      closeExportModal();
    }finally{
      btn.disabled=false;
    }
  });
});

$('printReportBtn').addEventListener('click',printReport);

$('auditorConfirmBtn').addEventListener('click',()=>{
  const name=$('auditorSelect').value;
  if(!name){toast('Pilih auditor dulu.');return;}
  setAuditor(name);
  toast(`Auditor aktif: ${name}`);
});
$('changeAuditorBtn').addEventListener('click',()=>{
  if(S.auditor)$('auditorSelect').value=S.auditor;
  $('identityGate').classList.add('show');
});


  window.loadDateIndex=loadDateIndex;
  window.loadAllZonesAggregated=loadAllZonesAggregated;
  window.loadZoneData=loadZoneData;
  window.warmCache=warmCache;
  window.loadAuditors=loadAuditors;
  window.loadAuditPicZones=loadAuditPicZones;
  window.zonesForActivePic=zonesForActivePic;
  window.zoneAllowedByAuditPic=zoneAllowedByAuditPic;
  window.activeTheme=activeTheme;
  window.setTheme=setTheme;
  window.setAuditor=setAuditor;
  window.ensureAuditor=ensureAuditor;
  window.init=init;
  window.setupQfPill=setupQfPill;
  window.updateGpsTimeLabel=updateGpsTimeLabel;
  window.openExportModal=openExportModal;
  window.closeExportModal=closeExportModal;

  init();
})();
