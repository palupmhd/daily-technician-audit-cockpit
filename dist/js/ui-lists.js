/* Route, issue, and zone list module */
(function(){
/* ── DATA HELPERS ── */
function routeById(id){return(S.zoneData?.routes||[]).find(r=>r.routeId===id);}
function issueById(id){return(S.zoneData?.issues||[]).find(i=>i.id===id);}

function routeSev(route){
  const actionIssues=(route.issues||[]).filter(i=>!NOISE_TYPES.has(i.type));
  if(actionIssues.some(i=>i.severity==='high'))return'high';
  if(actionIssues.some(i=>i.severity==='medium'))return'medium';
  if(actionIssues.length)return'low';
  return'normal';
}

function visitIss(route,vid){return(route.issues||[]).filter(i=>i.visitId===vid);}
function visitSev(route,vid){
  const iss=visitIss(route,vid).filter(i=>!NOISE_TYPES.has(i.type));
  if(iss.some(i=>i.severity==='high'))return'high';
  if(iss.some(i=>i.severity==='medium'))return'medium';
  if(iss.length)return'low';
  return'normal';
}

function actionableIssueCount(route){
  return (route.issues||[]).filter(i=>!NOISE_TYPES.has(i.type)).length;
}

function filterRoutes(routes){
  const q=$('searchInput').value.trim().toLowerCase();
  const sev=S.severityFilter||'all';
  return routes.filter(r=>{
    // Quick filter: only routes that need clarification
    if(S.qfOnlyAction){
      const hi=(r.issues||[]).some(i=>!NOISE_TYPES.has(i.type)&&i.severity==='high');
      const med=(r.issues||[]).some(i=>!NOISE_TYPES.has(i.type)&&i.severity==='medium');
      if(!hi&&!med)return false;
    }
    if(S.qfHideResolved&&routeAllResolved(r))return false;
    // Severity filter — exclusive: high=only high, medium=only medium (not high), low=only low
    if(sev!=='all'){
      const pool=S.qfHideNoise?(r.issues||[]).filter(i=>!NOISE_TYPES.has(i.type)):(r.issues||[]);
      const mx=Math.max(0,...pool.map(i=>SEV[i.severity]||0));
      if(mx!==SEV[sev])return false;
    }
    if(!q)return true;
    const hay=[r.teamName,r.lead,r.zone,...(r.issues||[]).map(i=>`${i.type} ${i.message} ${i.locationName||''}`),...(r.visits||[]).map(v=>v.locationName)].join(' ').toLowerCase();
    return hay.includes(q);
  });
}

function rbClass(level){
  if(!level)return'Normal';
  const l=level.toLowerCase();
  if(l.includes('critical'))return'Critical';
  if(l.includes('needs'))return'NeedsReview';
  if(l.includes('watch'))return'Watch';
  return'Normal';
}
function riskLabel(level){
  if(!level)return'Normal';
  const l=level.toLowerCase();
  if(l.includes('critical'))return'Kritis';
  if(l.includes('needs')||l.includes('review'))return'Tinjau';
  if(l.includes('watch'))return'Pantau';
  return'Normal';
}

/* Auto-context: cari konteks untuk late_first_store / work_duration issues */
function autoContext(route,issue){
  const ctx=[];

  if(issue.type==='late_first_store'){
    // Cari travel_event sebelum visit pertama yang mappable
    const visits=route.visits||[];
    const firstMappable=visits.find(v=>v.showOnMap);
    if(firstMappable){
      const before=visits.filter(v=>v.seq<firstMappable.seq);
      const travelEvents=before.filter(v=>v.type==='travel_event');
      if(travelEvents.length){
        const te=travelEvents[travelEvents.length-1];
        const notes=(te.jobs||[]).map(j=>j.notes).filter(n=>n&&n!=='-');
        ctx.push({
          icon:'🚗',
          text:`Ada <strong>${esc(te.locationName)}</strong> ${esc(te.startTime)}–${esc(te.endTime)} sebelum toko pertama.${notes.length?` Catatan: "<strong>${esc(notes.join(' · '))}</strong>"`:''}`
        });
      }
    }
    // Cek absen masuk vs jam mulai toko
    const attIn=(route.attendance||[]).find(a=>a.type==='in');
    if(attIn){
      ctx.push({
        icon:'⏰',
        text:`Absen masuk <strong>${esc(attIn.time)}</strong> oleh ${esc(attIn.employee)}.`
      });
    }
  }

  if(issue.type==='work_duration_too_long'||issue.type==='work_duration_too_short'){
    // Cari notes & problemNotes di visit yang relevant
    const v=(route.visits||[]).find(v=>v.visitId===issue.visitId);
    if(v){
      const allNotes=[];
      const allProblems=[];
      (v.jobs||[]).forEach(j=>{
        if(j.notes&&j.notes!=='-')allNotes.push(j.notes);
        if(j.problemNotes&&j.problemNotes!=='-')allProblems.push(j.problemNotes);
      });
      if(allProblems.length){
        ctx.push({icon:'⚠',text:`Catatan masalah teknisi: "<strong>${esc(allProblems.join(' · '))}</strong>"`});
      }
      if(allNotes.length){
        ctx.push({icon:'📝',text:`Catatan teknisi: "${esc(allNotes.join(' · '))}"`});
      }
    }
  }

  return ctx;
}

/* ── RENDERS ── */
function renderZoneStats(){
  const s=S.zoneData?.summary||{};
  const allIssues=S.zoneData?.issues||[];
  const actionable=allIssues.filter(i=>!NOISE_TYPES.has(i.type));
  const high=actionable.filter(i=>i.severity==='high').length;
  const med=actionable.filter(i=>i.severity==='medium').length;
  const low=actionable.filter(i=>i.severity==='low').length;
  const cur=S.severityFilter||'all';
  const act=v=>cur===v&&v!=='all'?' sev-active':'';
  $('zoneStats').innerHTML=`
    <div class="zstat${act('all')}" data-sev-filter="all" title="Total rute · klik untuk tampilkan semua"><div class="n">${s.routeCount||0}</div><div class="l">Rute</div></div>
    <div class="zstat danger${act('high')}" data-sev-filter="high" title="Jumlah temuan severity tinggi · klik untuk filter rute"><div class="n">${high}</div><div class="l"><span class="l-ctx">isu</span>Tinggi</div></div>
    <div class="zstat warn${act('medium')}" data-sev-filter="medium" title="Jumlah temuan severity sedang · klik untuk filter rute"><div class="n">${med}</div><div class="l"><span class="l-ctx">isu</span>Sedang</div></div>
    <div class="zstat info${act('low')}" data-sev-filter="low" title="Jumlah temuan severity rendah · klik untuk filter rute"><div class="n">${low}</div><div class="l"><span class="l-ctx">isu</span>Rendah</div></div>`;
}

function renderRouteList(){
  const allFiltered=filterRoutes(S.zoneData?.routes||[]);
  const MAX_ROUTES=200;
  const routes=allFiltered.slice(0,MAX_ROUTES);
  if(!routes.length){$('routeList').innerHTML='<div class="empty-state">Tidak ada route sesuai filter.</div>';return;}
  const truncNote=allFiltered.length>MAX_ROUTES?`<div class="empty-state" style="color:var(--warn-text);font-size:11px;padding:8px 10px">Menampilkan ${MAX_ROUTES} dari ${allFiltered.length} route — gunakan filter untuk mempersempit.</div>`:'';
  const riskIcon=`<svg width="8" height="7" viewBox="0 0 10 8" fill="currentColor" aria-hidden="true"><rect x="0" y="4" width="2.5" height="4" rx=".5" opacity=".45"/><rect x="3.75" y="2" width="2.5" height="6" rx=".5" opacity=".7"/><rect x="7.5" y="0" width="2.5" height="8" rx=".5"/></svg>`;
  $('routeList').innerHTML=routes.map(r=>{
    const sev=routeSev(r);
    const actionable=(r.issues||[]).filter(i=>!NOISE_TYPES.has(i.type));
    const hi=actionable.filter(i=>i.severity==='high').length;
    const med=actionable.filter(i=>i.severity==='medium').length;
    const lo=actionable.filter(i=>i.severity==='low').length;
    const noise=(r.issues||[]).filter(i=>NOISE_TYPES.has(i.type)).length;
    const actionIssues=(r.issues||[]).filter(i=>ACTION_TYPES.has(i.type));
    const resolvedCount=actionIssues.filter(i=>{const fu=S.followups[i.id];return fu&&fu.status&&fu.status!=='pending';}).length;
    const notedCount=actionIssues.filter(i=>followupHasContent(S.followups[i.id])).length;
    const escalatedCount=actionIssues.filter(i=>S.followups[i.id]?.status==='escalated').length;
    const fuBadge=escalatedCount
      ?`<span class="pill medium fu-route-pill">${escalatedCount} dieskalasi</span>`
      :resolvedCount
        ?`<span class="pill normal fu-route-pill">${resolvedCount}/${actionIssues.length} audit</span>`
        :notedCount
          ?`<span class="pill low fu-route-pill">${notedCount} note</span>`
          :'';
    const topIssue=actionable.find(i=>i.severity==='high')||actionable.find(i=>i.severity==='medium');
    const topIssueName=topIssue?issueTypeName(topIssue.type):'';
    const topIssueText=topIssue?`${topIssueName}: ${topIssue.message}`:'Tidak ada masalah operasional utama';
    const topTypePill=topIssue?`<span class="pill neutral" style="font-size:9px">${esc(topIssueName.split(' ').slice(0,2).join(' '))}</span>`:'';
    const isAct=r.routeId===S.selectedRouteId;
    const actCls=isAct?(sev==='high'?'sel-d':sev==='medium'?'sel-w':'sel'):'';
    const hasFu=routeHasFollowup(r)?'has-followup':'';
    return`<div class="route-card ${actCls} ${hasFu}" data-route="${esc(r.routeId)}"${r._zone?` data-route-zone="${esc(r._zone)}"`:''}>
      <div class="rc-top">
        <div style="min-width:0">
          <div class="rc-name">${esc(r.teamName||r.teamKey)}</div>
          <div class="rc-meta">${r._zone?`<span style="color:var(--accent);font-weight:700;font-size:10px;letter-spacing:.03em">${esc(r._zone)}</span> · `:''}PIC: ${esc(r.lead||'—')} · ${r.visitCount} lokasi · ${r.jobCount} job</div>
          <div class="rc-primary ${topIssue?'':'clean'}">${esc(topIssueText)}</div>
        </div>
        <span class="rbadge ${rbClass(r.riskLevel)}" title="Skor risiko rute: ${esc(r.riskScore)}">${riskIcon}${esc(r.riskScore)} · ${esc(riskLabel(r.riskLevel))}</span>
      </div>
      <div class="rc-pills">
        ${hi?`<span class="pill high">▲ ${hi} tinggi</span>`:''}
        ${med?`<span class="pill medium">▲ ${med} sedang</span>`:''}
        ${lo?`<span class="pill low">▲ ${lo} rendah</span>`:''}
        ${topTypePill}
        ${!hi&&!med&&!lo&&!noise?`<span class="pill normal">✓ Bersih</span>`:''}
        ${fuBadge}
        <span class="pill neutral">${esc(r.startTime)}–${esc(r.endTime)}</span>
      </div>
    </div>`;
  }).join('')+truncNote;
  document.querySelectorAll('[data-route]').forEach(el=>el.addEventListener('click',async()=>{
    const zoneKey=el.dataset.routeZone;
    const currentZone=document.getElementById('zoneSelect').value;
    if(zoneKey && currentZone!=='all'){
      // Specific-zone view: switch zone and reload normally
      document.getElementById('zoneSelect').value=zoneKey;
      await loadZoneData();
      setTimeout(()=>selectRoute(el.dataset.route),150);
    }else{
      // All-zones mode: S.zoneData already has all route data.
      // Load GPS for this route's zone without changing the zone filter UI.
      if(zoneKey && typeof loadGpsForZone==='function') await loadGpsForZone(zoneKey);
      selectRoute(el.dataset.route);
    }
  }));
}

function renderIssueList(){
  let issues=S.zoneData?.issues||[];
  if(S.qfHideNoiseIssue){issues=issues.filter(i=>!NOISE_TYPES.has(i.type));}
  const q=$('searchInput').value.trim().toLowerCase();
  const sev=S.severityFilter||'all';
  if(sev!=='all'){issues=issues.filter(i=>i.severity===sev);}
  if(q)issues=issues.filter(i=>`${i.type} ${i.message} ${i.locationName||''}`.toLowerCase().includes(q));
  const allSorted=issues.slice().sort((a,b)=>(SEV[b.severity]||0)-(SEV[a.severity]||0));
  const MAX_ISSUES=300;
  issues=allSorted.slice(0,MAX_ISSUES);
  const truncNoteIss=allSorted.length>MAX_ISSUES?`<div class="empty-state" style="color:var(--warn-text);font-size:11px;padding:8px 10px">Menampilkan ${MAX_ISSUES} dari ${allSorted.length} temuan — gunakan filter untuk mempersempit.</div>`:'';
  if(!issues.length){$('issueList').innerHTML='<div class="empty-state">Tidak ada issue sesuai filter.</div>';return;}
  $('issueList').innerHTML=issues.map(i=>{
    const r=routeById(i.routeId);
    const fu=getFu(i.id);
    const fuBadge=fu.status==='clarified'?'<span class="pill normal" style="margin-left:6px">selesai</span>':fu.status==='escalated'?'<span class="pill medium" style="margin-left:6px">eskalasi</span>':'';
    const typeLabel=typeof issueTypeName==='function'?issueTypeName(i.type):i.type.replace(/_/g,' ');
    const isSelIc=i.id===S.selectedIssueId&&(!S.selectedIssueZone||i._zone===S.selectedIssueZone);
    return`<div class="issue-card sev-${esc(i.severity)}${isSelIc?' sel-ic':''}" data-issue="${esc(i.id)}"${i._zone?` data-issue-zone="${esc(i._zone)}"`:''}>

      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
        <div style="min-width:0">
          <div class="ic-type">${esc(typeLabel)}${fuBadge}</div>
          <div class="ic-msg">${esc(i.message)}</div>
        </div>
        <span class="pill ${esc(i.severity)}">${esc(severityLabel(i.severity))}</span>
      </div>
      <div class="ic-loc">
        <svg width="10" height="10" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
        ${esc(i.locationName||r?.teamName||'—')}
      </div>
    </div>`;
  }).join('')+truncNoteIss;
  document.querySelectorAll('[data-issue]').forEach(el=>el.addEventListener('click',async()=>{
    const zoneKey=el.dataset.issueZone;
    const currentZone=document.getElementById('zoneSelect').value;
    if(zoneKey && currentZone!=='all'){
      // Specific-zone view: switch zone and reload normally
      document.getElementById('zoneSelect').value=zoneKey;
      await loadZoneData();
      setTimeout(()=>selectIssue(el.dataset.issue),150);
    }else{
      // All-zones mode: load GPS for this issue's zone without changing the zone filter UI
      if(zoneKey && typeof loadGpsForZone==='function') await loadGpsForZone(zoneKey);
      selectIssue(el.dataset.issue);
    }
  }));
}

/* ── ALL ZONES VIEW ── */
async function loadAllZones(){
  if(S.allZonesData)return S.allZonesData;
  const date=$('dateSelect').value;
  if(!S.dateIndex)return null;
  const zones=zonesForActivePic(Object.keys(S.dateIndex.zones||{}));
  const results=[];
  // Load all zones in parallel (limit to ~5 concurrent)
  const CONCURRENT=5;
  for(let i=0;i<zones.length;i+=CONCURRENT){
    const batch=zones.slice(i,i+CONCURRENT);
    const promises=batch.map(async z=>{
      const file=S.manifest.files[date]?.zones?.[z];
      if(!file)return null;
      if(S.dataCache[file])return {zone:z,data:S.dataCache[file]};
      try{
        const d=await fetchJson(file);
        S.dataCache[file]=d;
        return {zone:z,data:d};
      }catch{return null;}
    });
    const batched=await Promise.all(promises);
    results.push(...batched.filter(Boolean));
  }
  S.allZonesData=results;
  return results;
}

async function renderZoneList(){
  if(!$('zoneList'))return;
  const date=$('dateSelect').value;
  if(!S.dateIndex)return;
  const zones=zonesForActivePic(Object.keys(S.dateIndex.zones||{}).sort());

  // Show High Issues section immediately from already-loaded caches
  function renderHighSection(){
    const highRoutes=[];
    zones.forEach(z=>{
      const file=S.manifest.files[date]?.zones?.[z];
      const data=file?S.dataCache[file]:null;
      if(!data)return;
      data.routes.forEach(r=>{
        const hi=(r.issues||[]).filter(i=>i.severity==='high'&&!NOISE_TYPES.has(i.type));
        if(hi.length)highRoutes.push({zone:z,route:r,hi});
      });
    });
    if(!highRoutes.length)return'';
    highRoutes.sort((a,b)=>b.hi.length-a.hi.length);
    return`<div style="margin-bottom:10px">
      <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--danger);margin-bottom:6px;display:flex;align-items:center;gap:6px">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/></svg>
        Temuan Tinggi — Semua Zona
      </div>
      ${highRoutes.map(({zone,route,hi})=>`
        <div class="route-card" data-zone-route="${esc(zone)}" data-route-id="${esc(route.routeId)}" style="margin-bottom:5px;border-left:3px solid var(--danger)">
          <div class="rc-top">
            <div style="min-width:0">
              <div class="rc-name">${esc(route.teamName)}</div>
              <div class="rc-meta">${esc(zone)} · ${hi.map(i=>esc(i.type.replace(/_/g,' '))).join(', ')}</div>
            </div>
            <span class="pill high">${hi.length} tinggi</span>
          </div>
        </div>`).join('')}
    </div>
    <div style="height:1px;background:var(--border);margin-bottom:10px"></div>`;
  }

  // Show skeleton
  $('zoneList').innerHTML=`<div id="highSection">${renderHighSection()}</div>`+zones.map(z=>`
    <div class="zone-card" style="opacity:.4" id="zcard-${esc(z)}">
      <div class="zone-card-top">
        <span class="zone-card-name">${esc(z)}</span>
        <span class="pill neutral">⏳</span>
      </div>
      <div class="zone-card-stats">
        <div class="zone-card-stat"><div class="n">—</div><div class="l">Rute</div></div>
        <div class="zone-card-stat"><div class="n">—</div><div class="l">Tinggi</div></div>
        <div class="zone-card-stat"><div class="n">—</div><div class="l">Sedang</div></div>
      </div>
    </div>`).join('');

  // Wire high-issue route clicks
  function wireHighClicks(){
    document.querySelectorAll('[data-zone-route]').forEach(el=>{
      el.addEventListener('click',async()=>{
        const z=el.dataset.zoneRoute;
        const rid=el.dataset.routeId;
        $('zoneSelect').value=z;
        await loadZoneData();
        // Wait for data then select specific route
        setTimeout(()=>{
          if(routeById(rid)){
            selectRoute(rid);
            document.querySelector('[data-tab="routes"]')?.click();
          }
        },150);
      });
    });
  }
  wireHighClicks();

  // Load zones in parallel batches, update each card as it loads
  const CONCURRENT=5;
  const summaries=[];

  const loadZone=async(z)=>{
    const file=S.manifest.files[date]?.zones?.[z];
    if(!file)return null;
    let data;
    if(S.dataCache[file]){data=S.dataCache[file];}
    else{
      try{data=await fetchJson(file);S.dataCache[file]=data;}
      catch{return null;}
    }
    const routes=data.routes||[];
    const actionable=(data.issues||[]).filter(i=>!NOISE_TYPES.has(i.type));
    const critical=routes.filter(r=>r.riskLevel?.toLowerCase().includes('critical'));
    const review=routes.filter(r=>r.riskLevel?.toLowerCase().includes('needs'));
    const hi=actionable.filter(i=>i.severity==='high').length;
    const med=actionable.filter(i=>i.severity==='medium').length;
    const lo=actionable.filter(i=>i.severity==='low').length;
    const summary={zone:z,routeCount:routes.length,high:hi,medium:med,low:lo,critical:critical.length,needsReview:review.length,riskScore:routes.reduce((s,r)=>s+(r.riskScore||0),0)};
    summaries.push(summary);

    // Update card in place
    const card=document.getElementById(`zcard-${z}`);
    if(card){
      card.style.opacity='1';
      card.dataset.high=summary.high;
      card.dataset.med=summary.medium;
      card.dataset.low=summary.low;
      card.innerHTML=`
        <div class="zone-card-top">
          <span class="zone-card-name">${esc(z)}</span>
          ${summary.critical?`<span class="pill high">${summary.critical} Kritis</span>`:summary.needsReview?`<span class="pill medium">${summary.needsReview} Tinjau</span>`:'<span class="pill normal">OK</span>'}
        </div>
        <div class="zone-card-stats">
          <div class="zone-card-stat"><div class="n">${summary.routeCount}</div><div class="l">Rute</div></div>
          <div class="zone-card-stat high"><div class="n">${summary.high}</div><div class="l"><span class="l-ctx">isu</span>Tinggi</div></div>
          <div class="zone-card-stat med"><div class="n">${summary.medium}</div><div class="l"><span class="l-ctx">isu</span>Sedang</div></div>
        </div>`;
      card.dataset.zoneJump=z;
      card.addEventListener('click',()=>jumpToZone(z));
    }
    return summary;
  };

  for(let i=0;i<zones.length;i+=CONCURRENT){
    await Promise.all(zones.slice(i,i+CONCURRENT).map(loadZone));
  }
  S.allZonesData=summaries.map(s=>({zone:s.zone,data:S.dataCache[S.manifest.files[date]?.zones?.[s.zone]]})).filter(x=>x.data);
}

function filterZoneCards(){
  const sev=S.qfZoneSev||'all';
  document.querySelectorAll('.zone-card[id^="zcard-"]').forEach(card=>{
    const hi=parseInt(card.dataset.high||0);
    const med=parseInt(card.dataset.med||0);
    const lo=parseInt(card.dataset.low||0);
    let show=true;
    if(sev==='high') show=hi>0;
    else if(sev==='med') show=hi>0||med>0;
    else if(sev==='clean') show=!hi&&!med&&!lo;
    card.style.display=show?'':'none';
  });
  // Hide the cross-zone high section when filtering to clean
  const highSec=document.getElementById('highSection');
  if(highSec) highSec.style.display=sev==='clean'?'none':'';
}

async function jumpToZone(zone){
  $('zoneSelect').value=zone;
  await loadZoneData();
  // Switch back to routes tab
  document.querySelector('[data-tab="routes"]').click();
}


  window.routeById=routeById;
  window.issueById=issueById;
  window.routeSev=routeSev;
  window.visitIss=visitIss;
  window.visitSev=visitSev;
  window.actionableIssueCount=actionableIssueCount;
  window.filterRoutes=filterRoutes;
  window.rbClass=rbClass;
  window.riskLabel=riskLabel;
  window.autoContext=autoContext;
  window.renderZoneStats=renderZoneStats;
  window.renderRouteList=renderRouteList;
  window.renderIssueList=renderIssueList;
  window.loadAllZones=loadAllZones;
  window.renderZoneList=renderZoneList;
  window.filterZoneCards=filterZoneCards;
  window.jumpToZone=jumpToZone;
})();
