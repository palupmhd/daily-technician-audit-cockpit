/* App data loading + event bootstrap module */
(function(){
/* ── DATA LOADING ── */
async function loadDateIndex(date){
  const file=S.manifest.files[date]?.index;
  S.dateIndex=await fetchJson(file);
  const zones=Object.keys(S.dateIndex.zones||{}).sort();
  $('zoneSelect').innerHTML=zones.map(z=>{
    const zd=S.dateIndex.zones[z];
    return`<option value="${esc(z)}">${esc(z)}${zd.highIssues?` ⚠${zd.highIssues}`:''}</option>`;
  }).join('');
  S.allZonesData=null;  // invalidate cache on date change
}

async function loadZoneData(){
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
  const zones=Object.keys(S.dateIndex.zones||{});
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

async function init(){
  initMap();
  try{
    S.manifest=await fetchJson('data/manifest.json');
    const s=S.manifest.stats||{};
    $('buildInfo').textContent=`${S.manifest.generatedAt} · ${s.routes||0} routes · ${s.issues||0} issues`;
    $('dateSelect').innerHTML=(S.manifest.availableDates||[]).map(d=>`<option value="${esc(d)}">${esc(d)}</option>`).join('');
    if(!S.manifest.availableDates?.length)throw new Error('Manifest kosong — jalankan build_data.py dulu.');
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
$('dateSelect').addEventListener('change',async()=>{await loadDateIndex($('dateSelect').value);await loadZoneData();});
$('zoneSelect').addEventListener('change',loadZoneData);
$('searchInput').addEventListener('input',debounce(()=>{renderRouteList();renderIssueList();},180));
$('severitySelect').addEventListener('change',()=>{renderRouteList();renderIssueList();});
$('mapStyleSelect').addEventListener('change',()=>setLayer($('mapStyleSelect').value));

/* tabs */
document.querySelectorAll('.tab-btn').forEach(btn=>{
  btn.addEventListener('click',()=>{
    const tab=btn.dataset.tab;
    document.querySelectorAll('.tab-btn').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));
    document.querySelectorAll('.tab-content').forEach(c=>c.classList.toggle('active',c.id===`tabContent${tab.charAt(0).toUpperCase()+tab.slice(1)}`));
    if(tab==='zones')renderZoneList();
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
  S.gpsPlateDisabled.clear();
  renderGpsPlateFilter($('gpsSearchInput')?.value||'');
  const r=routeById(S.selectedRouteId);
  clearGpsLayer();renderGpsLayer(r);
  scheduleRenderMap({gpsOnly:true});
});
$('gpsSelectNone').addEventListener('click',()=>{
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
  $('exportDropdown').classList.toggle('open');
});
document.addEventListener('click',(e)=>{
  if(!$('exportDropdown').contains(e.target))$('exportDropdown').classList.remove('open');
});

$('expFieldBtn').addEventListener('click',()=>{exportFieldReport();$('exportDropdown').classList.remove('open');});
$('expDataBtn').addEventListener('click',()=>{exportDataQuality();$('exportDropdown').classList.remove('open');});
$('expExecBtn').addEventListener('click',async()=>{await exportExecutiveSummary();$('exportDropdown').classList.remove('open');});
$('expSummaryBtn').addEventListener('click',()=>{exportSummaryRaw();$('exportDropdown').classList.remove('open');});
$('expIssueBtn').addEventListener('click',()=>{exportIssuesRaw();$('exportDropdown').classList.remove('open');});
$('expRouteBtn').addEventListener('click',()=>{exportRouteRaw();$('exportDropdown').classList.remove('open');});

$('printReportBtn').addEventListener('click',printReport);


  window.loadDateIndex=loadDateIndex;
  window.loadZoneData=loadZoneData;
  window.warmCache=warmCache;
  window.init=init;
  window.setupQfPill=setupQfPill;
  window.updateGpsTimeLabel=updateGpsTimeLabel;

  init();
})();
