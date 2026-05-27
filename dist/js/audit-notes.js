/* Shared notes + follow-up module */
(function(){
  window.SN = window.SN || {
    enabled:false,
    pollTs:0,
    pollTimer:null,
    activeDate:null,
  };

  function fuKey(){return `audit_followups_${S.zoneData?.date||'unknown'}`;}
  function loadFollowups(){
    try{S.followups=JSON.parse(localStorage.getItem(fuKey())||'{}');}
    catch{S.followups={};}
    if(SN.enabled&&S.zoneData?.date)snLoad(S.zoneData.date);
  }
  function saveFollowups(){
    try{localStorage.setItem(fuKey(),JSON.stringify(S.followups));}catch{}
  }
  function getFu(issueId){return S.followups[issueId]||{status:'pending',note:''};}
  function followupHasContent(fu){
    return !!(String(fu?.note||'').trim() || (fu?.status&&fu.status!=='pending'));
  }
  function setFollowupEdit(issueId,on){
    S.followupUi.edit[issueId]=!!on;
  }
  function setFollowupStatusOpen(issueId,on){
    S.followupUi.statusOpen[issueId]=!!on;
  }
  function isFollowupEditing(issueId){
    return !!S.followupUi.edit[issueId];
  }
  function isFollowupStatusOpen(issueId){
    return !!S.followupUi.statusOpen[issueId];
  }
  function setFu(issueId,patch){
    if(!S.auditor){
      $('identityGate')?.classList.add('show');
      if(typeof trapFocus==='function')trapFocus(document.querySelector('.identity-card'));
      return Promise.resolve({ok:false,localOnly:true,missingAuditor:true});
    }
    S.followups[issueId]={...getFu(issueId),...patch,auditor:S.auditor,updatedAt:new Date().toISOString()};
    saveFollowups();
    if(SN.enabled&&S.zoneData?.date)return snSave(S.zoneData.date,issueId,S.followups[issueId]);
    return Promise.resolve({ok:true,localOnly:true});
  }
  function routeHasFollowup(route){
    return (route.issues||[]).some(i=>{
      const fu=S.followups[i.id];
      return fu&&followupHasContent(fu);
    });
  }
  function routeAllResolved(route){
    const actionIssues=(route.issues||[]).filter(i=>ACTION_TYPES.has(i.type));
    if(!actionIssues.length)return false;
    return actionIssues.every(i=>{
      const fu=S.followups[i.id];
      return fu&&(fu.status==='clarified'||fu.status==='escalated'||fu.status==='invalid');
    });
  }

  function snUrl(date){return`/api/notes/${date}`;}

  async function snCheck(){
    // Read config/sync.json first. If enabled:false, skip the probe entirely —
    // this prevents a red 404 in the console when running on a plain static server.
    try{
      const cfg=await fetch('config/sync.json',{cache:'no-store',signal:AbortSignal.timeout(1000)});
      if(cfg.ok){
        const json=await cfg.json();
        if(!json.enabled){SN.enabled=false;snSetStatus('offline');return;}
      }
    }catch{/* config unreadable → fall through and probe normally */}

    try{
      const date=$('dateSelect')?.value||'2000-01-01';
      const r=await fetch(snUrl(date),{method:'GET',signal:AbortSignal.timeout(1500)});
      if(r.ok){
        SN.enabled=true;
        snSetStatus('online');
        if(S.zoneData?.date)await snLoad(S.zoneData.date);
      }else{
        SN.enabled=false;
        snSetStatus('offline');
      }
    }catch{
      SN.enabled=false;
      snSetStatus('offline');
    }
  }

  function snSetStatus(state){
    const dot=$('syncDot'),lbl=$('syncLabel');
    if(!dot||!lbl)return;
    const cfg={
      online:{color:'var(--ok)',text:'Terhubung'},
      syncing:{color:'var(--warn)',text:'Menyimpan...'},
      offline:{color:'var(--muted)',text:'Offline'},
      error:{color:'var(--danger)',text:'Error sync'},
    };
    const c=cfg[state]||cfg.offline;
    dot.style.background=c.color;
    lbl.textContent=c.text;
  }

  async function snLoad(date){
    if(!SN.enabled)return;
    SN.activeDate=date;
    try{
      const r=await fetch(snUrl(date));
      if(!r.ok)return;
      const data=await r.json();
      let changed=false;
      Object.entries(data).forEach(([id,fu])=>{
        const existing=S.followups[id];
        if(!existing||JSON.stringify(existing)!==JSON.stringify(fu)){
          S.followups[id]=fu;changed=true;
        }
      });
      if(changed){
        saveFollowups();
        const r=routeById(S.selectedRouteId);
        if(r)renderEvidence(r);
        renderRouteList();
      }
      SN.pollTs=Date.now()/1000;
      snPoll(date);
    }catch(e){snSetStatus('error');}
  }

  async function snSave(date,issueId,fu){
    if(!SN.enabled)return{ok:true,localOnly:true};
    snSetStatus('syncing');
    try{
      const r=await fetch(snUrl(date),{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({[issueId]:fu})
      });
      if(r.ok){snSetStatus('online');return{ok:true,localOnly:false};}
      snSetStatus('error');
      return{ok:false,localOnly:false};
    }catch{
      snSetStatus('error');
      return{ok:false,localOnly:false};
    }
  }

  function snPoll(date){
    if(SN.pollTimer)clearTimeout(SN.pollTimer);
    if(!SN.enabled)return;
    SN.pollTimer=setTimeout(async()=>{
      if(SN.activeDate!==date)return;
      try{
        const r=await fetch(`${snUrl(date)}/poll?since=${SN.pollTs}`,{signal:AbortSignal.timeout(30000)});
        if(!r.ok)return snPoll(date);
        if(SN.activeDate!==date)return;
        const data=await r.json();
        if(data.updated&&data.notes){
          let changed=false;
          Object.entries(data.notes).forEach(([id,fu])=>{
            const ex=S.followups[id];
            if(!ex||JSON.stringify(ex)!==JSON.stringify(fu)){
              S.followups[id]=fu;changed=true;
            }
          });
          if(changed){
            saveFollowups();
            const route=routeById(S.selectedRouteId);
            if(route)renderEvidence(route);
            renderRouteList();
            toast('Notes diperbarui oleh anggota tim.');
          }
          SN.pollTs=data.ts||Date.now()/1000;
        }
      }catch{}
      snPoll(date);
    },1000);
  }

  function renderFollowupControls(issueId){
    const fu=getFu(issueId);
    const hasData=followupHasContent(fu);
    const editing=isFollowupEditing(issueId);
    const statusOpen=isFollowupStatusOpen(issueId);
    const statuses=[
      {value:'pending',label:'Belum',title:'Belum ditindaklanjuti',pill:'neutral'},
      {value:'clarified',label:'Selesai',title:'Sudah diklarifikasi',pill:'normal'},
      {value:'escalated',label:'Eskalasi',title:'Dieskalasi',pill:'medium'},
      {value:'invalid',label:'Invalid',title:'Tidak valid',pill:'neutral'},
    ];
    const activeStatus=statuses.find(s=>s.value===fu.status)||statuses[0];
    if(!editing){
      const noteText=String(fu.note||'').trim();
      return `<div class="fi-followup fi-followup-view">
        <div class="fi-followup-summary">
          <div class="fi-followup-summary-status">
            <span class="fi-followup-summary-label">Catatan Audit</span>
            <button class="fi-edit-btn" type="button" data-fu-edit="${esc(issueId)}">${hasData?'Ubah':'Isi'}</button>
          </div>
          <div class="fi-followup-summary-state">${esc(activeStatus.title)}</div>
          ${noteText?`<div class="fi-followup-summary-note">${esc(noteText)}</div>`:'<div class="fi-followup-summary-empty">Belum ada catatan.</div>'}
          ${fu.auditor?`<div class="fi-followup-summary-byline">Ditulis oleh ${esc(fu.auditor)}${fu.updatedAt?` · ${new Date(fu.updatedAt).toLocaleString('id-ID',{dateStyle:'medium',timeStyle:'short'})}`:''}</div>`:''}
        </div>
      </div>`;
    }
    const chips=statuses.map(s=>`<button class="fi-status-chip ${esc(s.value)} ${fu.status===s.value?'active':''}" type="button" data-fu-status="${esc(issueId)}" data-status-value="${esc(s.value)}" title="${esc(s.title)}">${esc(s.label)}</button>`).join('');
    return `<div class="fi-followup">
        <div class="fi-followup-top">
          <span class="fi-followup-summary-label">Catatan Audit</span>
          <span class="fi-save-badge" id="save-${esc(issueId)}">Tersimpan</span>
        </div>
        <div class="fi-followup-note">
          <textarea data-fu-note="${esc(issueId)}" placeholder="Tulis catatan audit...">${esc(fu.note||'')}</textarea>
        </div>
        <div class="fi-followup-status ${statusOpen?'open':''}" data-fu-status-wrap="${esc(issueId)}">
          <div class="fi-status-label">Status</div>
          <div class="fi-status-chips">${chips}</div>
        </div>
      </div>`;
  }

  function bucketFindings(route){
    const issues=route.issues||[];
    const actionable=issues.filter(i=>ACTION_TYPES.has(i.type));
    const dataIssues=issues.filter(i=>NOISE_TYPES.has(i.type));
    const other=issues.filter(i=>!ACTION_TYPES.has(i.type)&&!NOISE_TYPES.has(i.type));
    return {actionable,dataIssues,other};
  }

  window.fuKey=fuKey;
  window.loadFollowups=loadFollowups;
  window.saveFollowups=saveFollowups;
  window.getFu=getFu;
  window.followupHasContent=followupHasContent;
  window.setFollowupEdit=setFollowupEdit;
  window.setFollowupStatusOpen=setFollowupStatusOpen;
  window.isFollowupEditing=isFollowupEditing;
  window.isFollowupStatusOpen=isFollowupStatusOpen;
  window.setFu=setFu;
  window.routeHasFollowup=routeHasFollowup;
  window.routeAllResolved=routeAllResolved;
  window.snUrl=snUrl;
  window.snCheck=snCheck;
  window.snSetStatus=snSetStatus;
  window.snLoad=snLoad;
  window.snSave=snSave;
  window.snPoll=snPoll;
  window.renderFollowupControls=renderFollowupControls;
  window.bucketFindings=bucketFindings;
})();
