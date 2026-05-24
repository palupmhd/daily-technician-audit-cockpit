/* Evidence panel + timeline module */
(function(){
/* ── EVIDENCE PANEL ── */
function renderBenchBar(actual,expMin,expMax){
  if(actual==null||expMin==null||expMax==null)return '';
  // Scale: 0 to max(expMax*1.5, actual*1.1)
  const scale=Math.max(expMax*1.5,actual*1.1,1);
  const rangeLeft=(expMin/scale)*100;
  const rangeWidth=((expMax-expMin)/scale)*100;
  const actualPos=Math.max(1.5,Math.min(100,(actual/scale)*100));
  let actCls='';
  if(actual<expMin)actCls='below';
  else if(actual>expMax*1.5)actCls='way-above';
  else if(actual>expMax)actCls='above';
  return `<div class="bench-bar">
    <div class="bench-bar-num">${actual}m</div>
    <div class="bench-bar-track">
      <div class="bench-bar-range" style="left:${rangeLeft}%;width:${rangeWidth}%"></div>
      <div class="bench-bar-actual ${actCls}" style="left:${actualPos}%"></div>
    </div>
    <div class="bench-bar-num" style="color:var(--muted)">${expMin}–${expMax}m</div>
  </div>`;
}

function renderEvidence(route){
  if(!route){
    $('evidenceTitle').textContent='Route Evidence';
    $('evidenceSub').textContent='Pilih route atau issue untuk lihat detail.';
    $('headerBadge').innerHTML='';
    $('kpiSection').style.display='none';
    $('findingsSection').style.display='none';
    $('timeline').innerHTML='<div class="empty-state">Belum ada route dipilih.</div>';
    $('timelineMeta').textContent='';
    return;
  }
  $('evidenceTitle').textContent=route.teamName||route.teamKey;
  $('evidenceSub').innerHTML=`${esc(route.date)} · <strong>${esc(route.zone)}</strong> · PIC: ${esc(route.lead||'—')}`;
  $('headerBadge').innerHTML=`<span class="rbadge ${rbClass(route.riskLevel)}">${esc(route.riskScore)} · ${esc(route.riskLevel)}</span>`;

  const actionable=(route.issues||[]).filter(i=>!NOISE_TYPES.has(i.type));
  const hi=actionable.filter(i=>i.severity==='high').length;
  const med=actionable.filter(i=>i.severity==='medium').length;
  $('kpiSection').style.display='block';
  $('routeKpis').innerHTML=`
    <div class="kpi ${hi?'kdanger':''}"><div class="n">${hi}</div><div class="l">High</div></div>
    <div class="kpi ${med?'kwarn':''}"><div class="n">${med}</div><div class="l">Medium</div></div>
    <div class="kpi"><div class="n">${route.visitCount}</div><div class="l">Lokasi</div></div>
    <div class="kpi kok"><div class="n" title="${route.doneCount||0} dari ${route.visitCount} lokasi selesai">${route.doneCount||0}/${route.visitCount}</div><div class="l">Selesai</div></div>`;

  // Bucket findings
  const buckets=bucketFindings(route);
  const totalIssues=buckets.actionable.length+buckets.dataIssues.length+buckets.other.length;
  if(!totalIssues){
    $('findingsSection').style.display='none';
  }else{
    $('findingsSection').style.display='block';
    let html='';

    // Selected issue first if any
    const selIss=S.selectedIssueId?issueById(S.selectedIssueId):null;

    if(buckets.actionable.length){
      const sorted=buckets.actionable.slice().sort((a,b)=>{
        if(S.selectedIssueId){
          if(a.id===S.selectedIssueId)return -1;
          if(b.id===S.selectedIssueId)return 1;
        }
        return (SEV[b.severity]||0)-(SEV[a.severity]||0);
      });
      html+=`<div class="fi-bucket action">
        <div class="fi-bucket-header" data-bucket="action">
          <svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg>
          <div class="fi-bucket-title">Perlu Klarifikasi</div>
          <div class="fi-bucket-count">${buckets.actionable.length}</div>
        </div>
        <div class="fi-bucket-body">
          ${sorted.map(i=>{
            const ctx=autoContext(route,i);
            const ctxHtml=ctx.length?ctx.map(c=>`<div class="fi-context">${c.icon} ${c.text}</div>`).join(''):'';
            // Add benchmark bar for duration issues
            let benchHtml='';
            if(i.metrics?.actualDurationMin!=null){
              benchHtml=renderBenchBar(i.metrics.actualDurationMin,i.metrics.expectedMin,i.metrics.expectedMax);
            }
            const typeLabel=typeof issueTypeName==='function'?issueTypeName(i.type):i.type.replace(/_/g,' ');
            return `<div class="fi-item ${i.severity} ${i.id===S.selectedIssueId?'selected':''}" data-issue-fi="${esc(i.id)}">
              <div class="fi-type">
                <span class="fi-type-text">${esc(typeLabel)}</span>
                <span class="pill ${i.severity} fi-sev-pill">${esc(severityLabel(i.severity))}</span>
              </div>
              <div class="fi-msg">${esc(i.message)}</div>
              ${benchHtml}
              ${i.recommendation?`<div class="fi-rec">→ ${esc(i.recommendation)}</div>`:''}
              ${ctxHtml}
              ${renderFollowupControls(i.id)}
            </div>`;
          }).join('')}
        </div>
      </div>`;
    }

    if(buckets.dataIssues.length){
      html+=`<div class="fi-bucket collapsed">
        <div class="fi-bucket-header" data-bucket="data">
          <svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg>
          <div class="fi-bucket-title">Data Issue (admin)</div>
          <div class="fi-bucket-count">${buckets.dataIssues.length}</div>
        </div>
        <div class="fi-bucket-body">
          ${buckets.dataIssues.map(i=>`<div class="fi-item ${i.severity}">
            <div class="fi-type">${esc(issueTypeName(i.type))} <span class="pill ${i.severity}" style="font-size:9px;padding:1px 5px">${esc(severityLabel(i.severity))}</span></div>
            <div class="fi-msg">${esc(i.message)}</div>
            ${i.recommendation?`<div class="fi-rec">→ ${esc(i.recommendation)}</div>`:''}
          </div>`).join('')}
        </div>
      </div>`;
    }

    if(buckets.other.length){
      html+=`<div class="fi-bucket">
        <div class="fi-bucket-header" data-bucket="other">
          <svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg>
          <div class="fi-bucket-title">Lain-lain</div>
          <div class="fi-bucket-count">${buckets.other.length}</div>
        </div>
        <div class="fi-bucket-body">
          ${buckets.other.map(i=>`<div class="fi-item ${i.severity}">
            <div class="fi-type">${esc(issueTypeName(i.type))} <span class="pill ${i.severity}" style="font-size:9px;padding:1px 5px">${esc(severityLabel(i.severity))}</span></div>
            <div class="fi-msg">${esc(i.message)}</div>
          </div>`).join('')}
        </div>
      </div>`;
    }

    $('findingsList').innerHTML=html;

    // Bucket collapse handlers
    document.querySelectorAll('.fi-bucket-header').forEach(h=>{
      h.addEventListener('click',()=>h.closest('.fi-bucket').classList.toggle('collapsed'));
    });

    // Followup handlers
    document.querySelectorAll('[data-fu-edit]').forEach(el=>{
      el.addEventListener('click',()=>{
        const id=el.dataset.fuEdit;
        setFollowupEdit(id,true);
        setFollowupStatusOpen(id,false);
        const route=routeById(S.selectedRouteId);
        if(route)renderEvidence(route);
        setTimeout(()=>{
          const ta=document.querySelector(`[data-fu-note="${CSS.escape(id)}"]`);
          ta?.focus();
        },0);
      });
    });

    document.querySelectorAll('[data-fu-status][data-status-value]').forEach(el=>{
      el.addEventListener('click',async()=>{
        const id=el.dataset.fuStatus;
        const status=el.dataset.statusValue;
        const badge=document.getElementById(`save-${id}`);
        if(badge){badge.textContent=SN.enabled?'Menyimpan...':'Tersimpan lokal';badge.classList.add('show');}
        const result=await setFu(id,{status});
        if(result.missingAuditor){
          if(badge)badge.classList.remove('show');
          return;
        }
        setFollowupEdit(id,false);
        setFollowupStatusOpen(id,false);
        if(badge){
          badge.textContent=result.ok?(result.localOnly?'Tersimpan lokal':'Tersimpan'):'Gagal sync';
          badge.style.color=result.ok?'var(--ok)':'var(--danger)';
          setTimeout(()=>badge.classList.remove('show'),2200);
        }
        const routeEl=document.querySelector(`[data-route="${CSS.escape(S.selectedRouteId)}"]`);
        const r=routeById(S.selectedRouteId);
        if(routeEl){routeEl.classList.toggle('has-followup',routeHasFollowup(r));}
        if(r)renderEvidence(r);
      });
    });
    document.querySelectorAll('[data-fu-note]').forEach(el=>{
      const id=el.dataset.fuNote;
      // Auto-resize on mount
      const resize=()=>{el.style.height='auto';el.style.height=Math.min(el.scrollHeight,120)+'px';};
      resize();
      el.addEventListener('input',()=>{
        resize();
      });
      el.addEventListener('keydown',async(e)=>{
        if(e.key==='Escape'){
          e.preventDefault();
          setFollowupEdit(id,false);
          setFollowupStatusOpen(id,false);
          const route=routeById(S.selectedRouteId);
          if(route)renderEvidence(route);
          return;
        }
        if(e.key!=='Enter'||e.shiftKey)return;
        e.preventDefault();
        const text=el.value.trim();
        if(!text)return;
        const badge=document.getElementById(`save-${id}`);
        if(badge){badge.textContent=SN.enabled?'Menyimpan...':'Tersimpan lokal';badge.classList.add('show');}
        const result=await setFu(id,{note:el.value});
        if(result.missingAuditor){
          if(badge)badge.classList.remove('show');
          return;
        }
        setFollowupStatusOpen(id,true);
        const route=routeById(S.selectedRouteId);
        if(route)renderEvidence(route);
        if(badge){
          badge.textContent=result.ok?(result.localOnly?'Tersimpan lokal':'Tersimpan'):'Gagal sync';
          badge.style.color=result.ok?'var(--ok)':'var(--danger)';
          setTimeout(()=>badge.classList.remove('show'),2200);
        }
        setTimeout(()=>{
          const sel=document.querySelector(`[data-fu-status="${CSS.escape(id)}"][data-status-value]:not([data-status-value="pending"])`);
          sel?.focus();
        },0);
      });
      el.addEventListener('input',debounce(async()=>{
        const badge=document.getElementById(`save-${id}`);
        if(badge){badge.textContent=SN.enabled?'Menyimpan...':'Tersimpan lokal';badge.style.color='var(--ok)';badge.classList.add('show');}
        const result=await setFu(id,{note:el.value});
        if(result.missingAuditor){
          if(badge)badge.classList.remove('show');
          return;
        }
        if(badge){
          badge.textContent=result.ok?(result.localOnly?'Tersimpan lokal':'Tersimpan'):'Gagal sync';
          badge.style.color=result.ok?'var(--ok)':'var(--danger)';
          setTimeout(()=>badge.classList.remove('show'),2200);
        }
      },400));
    });
  }

  // Timeline
  renderTimeline(route);
}

function renderTimeline(route){
  const atItems=(route.attendance||[]).map(a=>({
    sort:a.datetime||'',
    isVisit:false,
    html:`<div class="tl-item">
      <div class="tl-dot datt">${a.type==='in'?'▶':'■'}</div>
      <div class="tl-body">
        <div class="tl-time">${esc(a.time)}</div>
        <div class="tl-name">Absen ${a.type==='in'?'Masuk':'Pulang'} — ${esc(a.employee)}</div>
        <div class="tl-meta">${a.isMappable?`${a.lat?.toFixed(5)}, ${a.lng?.toFixed(5)}`:'⚠ Koordinat tidak valid'}</div>
      </div>
    </div>`
  }));

  const vItems=(route.visits||[]).map(v=>{
    const sev=visitSev(route,v.visitId);
    const vIss=visitIss(route,v.visitId).filter(i=>!NOISE_TYPES.has(i.type));
    let dotCls='dstore';
    if(v.type==='travel_event')dotCls='dtravel';
    else if(v.type==='branch_task')dotCls='';
    else if(sev==='high')dotCls='dhigh';
    else if(sev==='medium')dotCls='dwarn';
    const lbl=v.type==='branch_task'?'M':v.type==='travel_event'?'T':String(v.seq);
    const mapTxt=v.type==='travel_event'?'Timeline only':v.showOnMap?`${v.lat?.toFixed(5)}, ${v.lng?.toFixed(5)}`:'⚠ Koordinat hilang';
    const jobsH=(v.jobs||[]).map(j=>{
      const hasNotes=j.notes&&j.notes!=='-';
      const hasProblem=j.problemNotes&&j.problemNotes!=='-';
      const benchTxt=j.benchmark?` · Benchmark ${fmtMin(j.benchmark.expectedMin)}–${fmtMin(j.benchmark.expectedMax)}`:'';
      const benchBar=j.benchmark&&j.effectiveDurationMin!=null?renderBenchBar(j.effectiveDurationMin,j.benchmark.expectedMin,j.benchmark.expectedMax):'';
      return `<div class="tl-job">
        <strong>${esc(j.jobType)}</strong>${j.unitQty?` · ${j.unitQty} unit`:''} · ${j.status==='done'?'Selesai':j.status==='postponed'?'Ditunda':esc(j.status)}<br>
        Aktual ${fmtMin(j.effectiveDurationMin)}${j.lunchDeductionMin?` (lunch −${j.lunchDeductionMin}m)`:''}${benchTxt}
        ${benchBar}
        ${hasProblem?`<div class="tl-job-notes problem">⚠ ${esc(j.problemNotes)}</div>`:''}
        ${hasNotes?`<div class="tl-job-notes">📝 ${esc(j.notes)}</div>`:''}
      </div>`;
    }).join('');
    const flagsH=vIss.map(i=>`<div class="tl-flag ${i.severity}">⚑ ${esc(issueTypeName(i.type))} — ${esc(i.message)}</div>`).join('');
    return{
      sort:v.startIso||'',
      visitId:v.visitId,
      isVisit:true,
      visit:v,
      html:`<div class="tl-item" id="visit-${esc(v.visitId)}">
        <div class="tl-dot ${dotCls}">${esc(lbl)}</div>
        <div class="tl-body">
          <div class="tl-time">${esc(v.startTime)} – ${esc(v.endTime)}</div>
          <div class="tl-name">${v.type!=='branch_task'&&v.type!=='travel_event'?`${esc(String(v.seq))}. `:''}${esc(v.locationName)}</div>
          <div class="tl-meta">${esc(v.type.replace(/_/g,' '))} · ${esc(v.statusSummary)} · ${esc(mapTxt)}</div>
          ${jobsH?`<div class="tl-jobs">${jobsH}</div>`:''}
          ${flagsH}
        </div>
      </div>`
    };
  });

  const all=[...atItems,...vItems].sort((a,b)=>String(a.sort).localeCompare(String(b.sort)));

  // Inject travel gap badges between consecutive store visits
  const out=[];
  for(let i=0;i<all.length;i++){
    out.push(all[i]);
    if(i<all.length-1&&all[i].isVisit&&all[i+1].isVisit){
      const a=all[i].visit, b=all[i+1].visit;
      if(a.endIso&&b.startIso){
        const t1=new Date(a.endIso),t2=new Date(b.startIso);
        const gapMin=Math.round((t2-t1)/60000);
        if(gapMin>0){
          // Find travel gap issue for b
          const gapIssue=(route.issues||[]).find(iss=>iss.type==='travel_gap_too_long'&&iss.visitId===b.visitId);
          let cls='';
          if(gapIssue?.severity==='high')cls='critical';
          else if(gapIssue?.severity==='medium')cls='long';
          else if(gapMin>60)cls='long';
          const expected=gapIssue?.metrics?.expectedTravelMin;
          out.push({html:`<div class="tl-gap ${cls}">↓ jeda ${fmtMin(gapMin)}${expected?` (est. ${fmtMin(expected)})`:''}</div>`});
        }
      }
    }
  }

  $('timeline').innerHTML=out.map(x=>x.html).join('')||'<div class="empty-state">Timeline kosong.</div>';
  $('timelineMeta').textContent=`${route.visitCount} visit · ${route.jobCount} job`;
}

function scrollVisit(vid){
  const el=document.getElementById(`visit-${vid}`);
  if(el)el.scrollIntoView({behavior:'smooth',block:'center'});
}


  window.renderBenchBar=renderBenchBar;
  window.renderEvidence=renderEvidence;
  window.renderTimeline=renderTimeline;
  window.scrollVisit=scrollVisit;
})();
