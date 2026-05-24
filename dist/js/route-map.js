/* Route map rendering + selection module */
(function(){
/* ── MAP CORE ── */
function invalidateSize(delays=[0]){
  if(!S.map)return;
  delays.forEach(d=>setTimeout(()=>S.map?.invalidateSize({pan:false,animate:false}),d));
}

function fitBounds(bounds){
  if(!S.map||!bounds?.length)return;
  S.map.fitBounds(bounds,{padding:[40,40],maxZoom:15,animate:false});
}

function initMap(){
  const el=$('map');
  S.map=L.map(el,{zoomControl:true,preferCanvas:true,zoomSnap:1,zoomDelta:1,updateWhenIdle:false,trackResize:true,renderer:L.canvas({padding:0.5})}).setView([-2.5,118],5);
  setLayer('carto_dark');
  S.renderers={route:L.canvas({padding:0.5}),gps:L.canvas({padding:0.45})};
  S.layers.route=L.layerGroup().addTo(S.map);
  S.layers.gps=L.layerGroup().addTo(S.map);
  S.layers.att=L.layerGroup().addTo(S.map);
  S.layers.hl=L.layerGroup().addTo(S.map);
  S.map.whenReady(()=>invalidateSize([0,200]));
  S.map.on('click mousedown',()=>{
    $('exportDropdown').classList.remove('open');
    $('gpsFilterPop').classList.remove('show');
    $('gpsFilterTog')?.classList.remove('active');
  });
  window.addEventListener('resize',debounce(()=>invalidateSize([0]),100));
  if('ResizeObserver' in window){
    const ro=new ResizeObserver(debounce(()=>invalidateSize([0]),100));
    ro.observe(el);
  }
}

function setLayer(style){
  if(!S.map)return;
  if(S.baseLayer){S.map.removeLayer(S.baseLayer);S.baseLayer=null;}
  const cfgs={
    osm_dark:{url:'https://tile.openstreetmap.org/{z}/{x}/{y}.png',opts:{maxZoom:19,keepBuffer:8,updateWhenIdle:false,updateWhenZooming:false,crossOrigin:true,className:'osm-dark-tile',attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'}},
    osm_soft:{url:'https://tile.openstreetmap.org/{z}/{x}/{y}.png',opts:{maxZoom:19,keepBuffer:8,updateWhenIdle:false,updateWhenZooming:false,crossOrigin:true,className:'osm-soft-tile',attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'}},
    carto_dark:{url:'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',opts:{subdomains:'abcd',maxZoom:20,keepBuffer:8,updateWhenIdle:false,updateWhenZooming:false,crossOrigin:true,attribution:'&copy; CARTO'}}
  };
  const cfg=cfgs[style]||cfgs.osm_dark;
  S.baseLayer=L.tileLayer(cfg.url,cfg.opts).addTo(S.map);
  S.baseLayer.on('tileerror',()=>{if(style!=='osm_soft'){toast('Tile error, fallback OSM Soft.');setLayer('osm_soft');$('mapStyleSelect').value='osm_soft';}});
  S.baseLayer.bringToBack();
}

/* ── MAP RENDER ── */
function clearRouteLayer(){
  S.layers.route.clearLayers();
  S.layers.att.clearLayers();
  S.layers.hl.clearLayers();
  if(S.clusterGroup){S.map.removeLayer(S.clusterGroup);S.clusterGroup=null;}
}
function clearAllMapLayers(){
  clearRouteLayer();
  clearGpsLayer();
}

// Build distance lookup from route.distancePairs keyed by toVisitId
function buildDistLookup(route){
  const lookup={};
  const pairs=route.distancePairs||[];
  const allVisits=route.visits||[];

  // Build name lookup for exact match
  const visitsByName={};
  allVisits.forEach(v=>{
    const key=(v.locationName||'').trim();
    if(key)visitsByName[key]=v;
  });

  // Store-only visits in sequence order (excludes travel_event)
  const storeVisits=allVisits.filter(v=>v.type!=='travel_event');

  pairs.forEach((dp,idx)=>{
    const toLabel=(dp.toLabel||'').trim();
    // 1. Exact name match
    const byName=visitsByName[toLabel];
    if(byName&&!lookup[byName.visitId]){lookup[byName.visitId]=dp;return;}
    // 2. Sequence fallback: pair[0]=attendance→store[0], pair[1]=store[0]→store[1], etc.
    // idx=0 targets storeVisits[0], idx=1 targets storeVisits[1], etc.
    const target=storeVisits[idx];
    if(target&&!lookup[target.visitId])lookup[target.visitId]=dp;
  });
  return lookup;
}

function renderMap(route=null,{gpsOnly=false}={}){
  if(!gpsOnly)clearRouteLayer();
  clearGpsLayer();
  const bounds=[];
  if(!route){$('mapOverlay').innerHTML='<span class="map-pill">Pilih route untuk lihat evidence map.</span>';return;}

  // Check if this route has any mappable content at all
  const hasMappableVisits=(route.visits||[]).some(v=>v.showOnMap);
  const hasMappableAtt=(route.attendance||[]).some(a=>a.isMappable);
  if(!hasMappableVisits&&!hasMappableAtt&&!gpsOnly){
    $('mapOverlay').innerHTML=`
      <span class="map-pill">⚠ Tidak ada koordinat valid untuk route ini</span>
      <span class="map-pill warn">Cek data koordinat toko di sumber</span>`;
    return;
  }


  /* visit markers */
  const showBranch=S.layerToggles.branch;
  const showIssues=S.layerToggles.issues;
  const mappable=(route.visits||[]).filter(v=>v.showOnMap&&(showBranch||v.type!=='branch_task'));
  const routePts=[];
  const useCluster=S.layerToggles.cluster&&mappable.length>1;

  if(!gpsOnly){
    if(useCluster){
      S.clusterGroup=L.markerClusterGroup({
        maxClusterRadius:35,spiderfyOnMaxZoom:true,spiderfyDistanceMultiplier:1.5,
        showCoverageOnHover:false,zoomToBoundsOnClick:true,
        iconCreateFunction:function(cluster){
          const markers=cluster.getAllChildMarkers();
          const sevs=markers.map(m=>m.options._sev||'normal');
          let cls='';
          if(sevs.includes('high'))cls='cluster-danger';
          else if(sevs.includes('medium'))cls='cluster-warn';
          return L.divIcon({html:`<div><span>${cluster.getChildCount()}</span></div>`,className:`marker-cluster ${cls}`,iconSize:[36,36]});
        }
      });
      S.map.addLayer(S.clusterGroup);
    }

    // Build distance lookup for this route
    const distLookup=buildDistLookup(route);

    mappable.forEach((v,vi)=>{
      const sev=showIssues?visitSev(route,v.visitId):'normal';
      const cls=v.type==='branch_task'?'mbranch':sev==='high'?'mdanger':sev==='medium'?'mwarn':'';
      const lbl=v.type==='branch_task'?'M':String(v.seq);
      const vIss=visitIss(route,v.visitId);
      const actionIss=vIss.filter(i=>!NOISE_TYPES.has(i.type));
      const sevColor=sev==='high'?'#fca5a5':sev==='medium'?'#fcd34d':sev==='low'?'#7dd3fc':'#34d399';
      const matchDot=v.matchStatus==='matched_by_name'||v.matchStatus==='matched'?'<span style="color:#34d399">✓</span>':'<span style="color:#fca5a5">✗</span>';
      const dp=distLookup[v.visitId];

      const jobsHtml=(v.jobs||[]).map(j=>{
        const b=j.benchmark||{};
        const actual=j.effectiveDurationMin;
        const lunch=j.lunchDeductionMin?` <span style="color:var(--muted);font-size:9px">(−${j.lunchDeductionMin}m lunch)</span>`:'';
        let benchHtml='';
        if(actual!=null&&b.expectedMin!=null){
          const under=actual<b.expectedMin,over=actual>b.expectedMax;
          const bColor=under?'#7dd3fc':over?'#fcd34d':'#34d399';
          benchHtml=`<div style="margin-top:3px;font-size:10px;color:${bColor}">${under?'▼ Terlalu cepat':over?'▲ Melebihi benchmark':'✓ Dalam benchmark'}: ${fmtMin(actual)} vs ${fmtMin(b.expectedMin)}–${fmtMin(b.expectedMax)}</div>`;
        }
        const notesHtml=j.notes&&j.notes!=='-'?`<div style="margin-top:3px;font-size:10px;color:var(--muted);font-style:italic">"${esc(j.notes.slice(0,80))}${j.notes.length>80?'…':''}"</div>`:'';
        const probHtml=j.problemNotes&&j.problemNotes!=='-'?`<div style="margin-top:3px;font-size:10px;color:#fcd34d">⚠ ${esc(j.problemNotes.slice(0,80))}</div>`:'';
        return `<div style="background:rgba(255,255,255,.05);border-radius:6px;padding:5px 7px;margin-top:5px">
          <div style="font-weight:600;font-size:11px">${esc(j.jobType)}${j.unitQty?` <span style="color:var(--muted)">×${j.unitQty}</span>`:''} <span style="float:right;color:${j.status==='done'?'#34d399':'#fcd34d'}">${j.status==='done'?'Selesai':'Ditunda'}</span></div>
          <div style="font-size:10px;color:var(--muted);margin-top:1px">Aktual ${fmtMin(actual)}${lunch}</div>
          ${benchHtml}${notesHtml}${probHtml}
        </div>`;
      }).join('');

      const issHtml=actionIss.map(i=>`
        <div style="margin-top:4px;padding:4px 7px;background:rgba(${sev==='high'?'239,68,68':'245,158,11'},.12);border-radius:5px;font-size:10px;color:${sevColor}">
          ⚑ ${esc(i.type.replace(/_/g,' '))} — ${esc(i.message.slice(0,70))}${i.message.length>70?'…':''}
        </div>`).join('');

      const distHtml=dp?.distanceKm!=null
        ?`<div style="margin-top:6px;padding-top:6px;border-top:1px solid rgba(255,255,255,.08);font-size:10px;color:var(--muted)">
            📍 Dari titik sebelumnya: <strong style="color:var(--text)">${dp.distanceKm} km</strong>${dp.durationMin!=null?` · ${fmtMin(dp.durationMin)}`:''}
          </div>`:'';

      const popupContent=`<div style="min-width:220px;max-width:280px">
        <div style="font-weight:700;font-size:12.5px;margin-bottom:2px">${esc(v.seq)}. ${esc(v.locationName)}</div>
        <div style="font-size:10px;color:var(--muted);margin-bottom:6px;padding-bottom:6px;border-bottom:1px solid rgba(255,255,255,.08)">
          ${esc(v.type.replace(/_/g,' '))} ${matchDot} ${esc(v.matchStatus||'')}
        </div>
        <div style="display:grid;grid-template-columns:auto 1fr;gap:2px 10px;font-size:11px;margin-bottom:4px">
          <span style="color:var(--muted)">Waktu</span>
          <span style="font-family:'DM Mono',monospace;font-weight:600">${esc(v.startTime)} – ${esc(v.endTime)}</span>
          <span style="color:var(--muted)">Status</span><span>${esc(v.statusSummary)}</span>
          ${v.lat?`<span style="color:var(--muted)">Koordinat</span><span style="font-family:'DM Mono',monospace;font-size:10px">${v.lat.toFixed(5)}, ${v.lng.toFixed(5)}</span>`:''}
        </div>
        ${jobsHtml}${issHtml}
        ${actionIss.length?'':'<div style="margin-top:6px;font-size:10px;color:#34d399">✓ Tidak ada issue</div>'}
        ${distHtml}
      </div>`;

      const tooltipContent=`<strong>${esc(v.seq)}. ${esc(v.locationName)}</strong><br>${esc(v.startTime)}–${esc(v.endTime)}${actionIss.length?`<br><span style="color:${sevColor}">⚑ ${actionIss.length} issue</span>`:''}`;

      const marker=L.marker([v.lat,v.lng],{icon:mkIcon(lbl,cls),_sev:sev})
        .bindPopup(popupContent,{maxWidth:300})
        .bindTooltip(tooltipContent,{direction:'top',offset:[0,-18]})
        .on('click',()=>scrollVisit(v.visitId));

      if(useCluster){S.clusterGroup.addLayer(marker);}
      else{marker.addTo(S.layers.route);}
      routePts.push({lat:v.lat,lng:v.lng,sev,visitId:v.visitId,seq:v.seq,dist:dp?.distanceKm,durMin:dp?.durationMin});
      bounds.push([v.lat,v.lng]);
    });

    // Helper: render one polyline segment with arrow + distance label
    function renderSegment(latA,lngA,latB,lngB,color,weight,opacity,dash,distKm,durMin,gapIssue){
      L.polyline([[latA,lngA],[latB,lngB]],{color,weight,opacity,dashArray:dash,renderer:S.renderers.route})
        .addTo(S.layers.route);
      // Distance label — only when toggle on AND distance ≥ 100m
      if(S.layerToggles.distance&&distKm!=null&&distKm>=0.1){
        const mLat=(latA+latB)/2,mLng=(lngA+lngB)/2;
        const distTxt=distKm>=1?`${distKm} km`:`${Math.round(distKm*1000)} m`;
        const durTxt=durMin!=null?`<div style="font-size:9px;color:${gapIssue?color:'#64748b'};margin-top:1px">${fmtMin(durMin)}${gapIssue?' ⚠':''}</div>`:'';
        L.marker([mLat,mLng],{icon:L.divIcon({
          className:'',
          html:`<div style="background:rgba(13,17,23,.88);border-radius:4px;padding:2px 6px;font-size:10px;font-family:'DM Mono',monospace;font-weight:600;color:${gapIssue?color:'#94a3b8'};white-space:nowrap;pointer-events:none;line-height:1.3">${distTxt}${durTxt}</div>`,
          iconAnchor:[0,0],
        }),interactive:false,zIndexOffset:-100}).addTo(S.layers.route);
      }
    }

    // Attendance → first store polyline
    if(S.layerToggles.att){
      const attIn=(route.attendance||[]).filter(a=>a.isMappable&&a.type==='in');
      const firstVisit=routePts[0];
      if(attIn.length&&firstVisit){
        const dp0=(route.distancePairs||[]).find(dp=>dp.fromType==='attendance_in');
        attIn.forEach(a=>{
          L.polyline([[a.lat,a.lng],[firstVisit.lat,firstVisit.lng]],{
            color:'#10b981',weight:2,opacity:.5,dashArray:'5 6',renderer:S.renderers.route
          }).addTo(S.layers.route);
          // Arrow + label (only when distance toggle on)
          if(S.layerToggles.distance&&dp0?.distanceKm!=null&&dp0.distanceKm>=0.1){
            const mLat=(a.lat+firstVisit.lat)/2, mLng=(a.lng+firstVisit.lng)/2;
            const distTxt=dp0.distanceKm>=1?`${dp0.distanceKm} km`:`${Math.round(dp0.distanceKm*1000)} m`;
            const durTxt=dp0.durationMin!=null?`<div style="font-size:9px;color:#4ade80;margin-top:1px">${fmtMin(dp0.durationMin)}</div>`:'';
            L.marker([mLat,mLng],{icon:L.divIcon({
              className:'',
              html:`<div style="background:rgba(13,17,23,.88);border-radius:4px;padding:2px 6px;font-size:10px;font-family:'DM Mono',monospace;font-weight:600;color:#6ee7b7;white-space:nowrap;pointer-events:none;line-height:1.3">${distTxt}${durTxt}</div>`,
              iconAnchor:[0,0],
            }),interactive:false,zIndexOffset:-100}).addTo(S.layers.route);
          }
        });
      }
    }

    // Route polylines with distance labels + directional arrows
    if(routePts.length>1){
      for(let i=0;i<routePts.length-1;i++){
        const a=routePts[i],b=routePts[i+1];
        const gapIssue=(route.issues||[]).find(iss=>iss.type==='travel_gap_too_long'&&iss.visitId===b.visitId);
        let color='#3b82f6',weight=3,opacity=.72,dash='7 6';
        if(gapIssue){
          color=gapIssue.severity==='high'?'#ef4444':gapIssue.severity==='medium'?'#f59e0b':'#fbbf24';
          weight=4;opacity=.85;dash='4 6';
        }
        renderSegment(a.lat,a.lng,b.lat,b.lng,color,weight,opacity,dash,b.dist,b.durMin,gapIssue);
      }
    }

    // Proximity cluster: att + visit markers within 60m → single group marker
    const CLUSTER_RADIUS_M=60;
    const haversineM=(la1,lo1,la2,lo2)=>{
      const R=6371000,dlat=(la2-la1)*Math.PI/180,dlon=(lo2-lo1)*Math.PI/180;
      const a=Math.sin(dlat/2)**2+Math.cos(la1*Math.PI/180)*Math.cos(la2*Math.PI/180)*Math.sin(dlon/2)**2;
      return R*2*Math.asin(Math.sqrt(a));
    };

    const usedAtt=new Set();
    const usedVisits=new Set();

    if(S.layerToggles.att){
      const attMarkers=(route.attendance||[]).filter(a=>a.isMappable);
      attMarkers.forEach((a,ai)=>{
        const nearby=mappable.filter(v=>!usedVisits.has(v.visitId)&&haversineM(a.lat,a.lng,v.lat,v.lng)<CLUSTER_RADIUS_M);
        if(nearby.length>0){
          usedAtt.add(ai);
          nearby.forEach(v=>usedVisits.add(v.visitId));
          // Group marker at visit position
          const items=[
            {icon:'▶',color:'#10b981',label:`Absen ${a.type==='in'?'Masuk':'Pulang'} — ${esc(a.employee)}`,sub:esc(a.time),onClick:null},
            ...nearby.map(v=>{
              const vSev=visitSev(route,v.visitId);
              const sevColor=vSev==='high'?'#fca5a5':vSev==='medium'?'#fcd34d':'#94a3b8';
              return{icon:String(v.seq),color:vSev==='high'?'#ef4444':vSev==='medium'?'#f59e0b':'#3b82f6',label:`${esc(v.seq)}. ${esc(v.locationName)}`,sub:`${esc(v.startTime)}–${esc(v.endTime)}`,sevColor,visitId:v.visitId,onClick:()=>scrollVisit(v.visitId)};
            })
          ];
          const listHtml=items.map(it=>`
            <div style="display:flex;align-items:flex-start;gap:8px;padding:6px 0;border-bottom:1px solid rgba(255,255,255,.06);cursor:${it.onClick?'pointer':'default'}" ${it.onClick?`data-visit-scroll="${it.visitId||''}"`:''}>
              <div style="width:22px;height:22px;border-radius:50%;background:${it.color};display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:800;flex-shrink:0;color:white">${it.icon}</div>
              <div>
                <div style="font-size:11px;font-weight:600;color:${it.sevColor||'var(--text)'}">${it.label}</div>
                <div style="font-size:10px;color:var(--muted)">${it.sub}</div>
              </div>
            </div>`).join('');
          const groupPopup=`<div style="min-width:220px;max-width:260px">
            <div style="font-weight:700;font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px">${items.length} titik di lokasi ini</div>
            ${listHtml}
          </div>`;
          const groupIcon=L.divIcon({
            className:'',
            html:`<div style="width:34px;height:34px;border-radius:50%;background:rgba(16,185,129,.2);border:2px solid #10b981;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:800;color:#6ee7b7;box-shadow:0 0 10px rgba(16,185,129,.4)">${items.length}</div>`,
            iconSize:[34,34],iconAnchor:[17,17],
          });
          const gm=L.marker([nearby[0].lat,nearby[0].lng],{icon:groupIcon,zIndexOffset:100});
          gm.bindPopup(groupPopup,{maxWidth:280});
          gm.on('popupopen',()=>{
            document.querySelectorAll('[data-visit-scroll]').forEach(el=>{
              if(el.dataset.visitScroll)el.addEventListener('click',()=>scrollVisit(el.dataset.visitScroll));
            });
          });
          if(useCluster)S.clusterGroup.addLayer(gm);
          else gm.addTo(S.layers.route);
          bounds.push([nearby[0].lat,nearby[0].lng]);
        }
      });

      // Render remaining att markers (not clustered)
      (route.attendance||[]).filter(a=>a.isMappable).forEach((a,ai)=>{
        if(usedAtt.has(ai))return;
        const cls=a.type==='in'?'matt-in':'matt-out';
        const lbl=a.type==='in'?'▶':'■';
        const pop=`<div style="min-width:180px">
          <div style="font-weight:700;font-size:12px;margin-bottom:6px;padding-bottom:5px;border-bottom:1px solid rgba(255,255,255,.1)">${a.type==='in'?'▶ Absen Masuk':'■ Absen Pulang'}</div>
          <div style="display:grid;grid-template-columns:auto 1fr;gap:3px 10px;font-size:11px">
            <span style="color:var(--muted)">Nama</span><span>${esc(a.employee)}</span>
            <span style="color:var(--muted)">Jam</span><span style="font-family:'DM Mono',monospace;font-weight:600">${esc(a.time)}</span>
            <span style="color:var(--muted)">Koordinat</span><span style="font-family:'DM Mono',monospace;font-size:10px">${a.lat?.toFixed(5)}, ${a.lng?.toFixed(5)}</span>
          </div>
        </div>`;
        L.marker([a.lat,a.lng],{icon:mkIcon(lbl,cls)})
          .bindPopup(pop,{maxWidth:260})
          .bindTooltip(`${a.type==='in'?'Masuk':'Pulang'} ${esc(a.employee)} ${esc(a.time)}`,{direction:'top',offset:[0,-12]})
          .addTo(S.layers.att);
        bounds.push([a.lat,a.lng]);
      });

      // Render visit markers not captured by cluster
      mappable.forEach(v=>{
        if(usedVisits.has(v.visitId))return;
        // Already rendered above in main loop — skip (already added to cluster/route layer)
      });
    } else {
      // att off — render all att-adjacent visits normally (they were already added)
    }

    // Nearest plate label — show plate name near first visit if any GPS track passes within 500m
    if(S.gpsData&&routePts.length){
      const vehicles2=(S.gpsData?.gpsLayer?.vehicles||[]).filter(v=>!S.gpsPlateDisabled.has(v.plate));
      const refPt=routePts[0]; // first visit as reference
      let bestDist=500, bestPlate=null, bestLat=refPt.lat, bestLng=refPt.lng;
      vehicles2.forEach(v=>{
        (v.points||[]).forEach(p=>{
          if(!Number.isFinite(p[1])||!Number.isFinite(p[2]))return;
          const d=haversineKm(refPt.lat,refPt.lng,p[1],p[2])*1000; // meters
          if(d<bestDist){bestDist=d;bestPlate=v.plate;bestLat=p[1];bestLng=p[2];}
        });
      });
      if(bestPlate){
        L.marker([bestLat,bestLng],{icon:L.divIcon({
          className:'',
          html:`<div style="background:rgba(13,17,23,.88);border:1px solid rgba(56,189,248,.4);border-radius:4px;padding:2px 7px;font-size:10px;font-family:'DM Mono',monospace;font-weight:600;color:#38bdf8;white-space:nowrap;pointer-events:none">${esc(bestPlate)}</div>`,
          iconAnchor:[0,-18],
        }),interactive:false,zIndexOffset:-80}).addTo(S.layers.route);
      }
    }

  }

  /* GPS layer */
  const gpsRendered=renderGpsLayer(route)||0;

  /* overlay — update GPS pill only when gpsOnly, full update otherwise */
  const gpsVehCount=S.gpsData?.gpsLayer?.vehicles?.length||0;
  const gpsActive=gpsVehCount-S.gpsPlateDisabled.size;
  const gpsPill=S.layerToggles.gps
    ?(S.gpsData?`<span class="map-pill action" id="gpsOverlayBtn">${gpsActive}/${gpsVehCount} GPS · ${gpsRendered} pts</span>`:'<span class="map-pill">GPS loading...</span>')
    :'';

  if(gpsOnly){
    // Only update the GPS pill, leave rest of overlay intact
    const existing=$('gpsOverlayBtn');
    if(existing){
      existing.outerHTML=gpsPill||'';
    } else if(gpsPill){
      $('mapOverlay').insertAdjacentHTML('beforeend',gpsPill);
    }
    const gob=$('gpsOverlayBtn');
    if(gob){gob.addEventListener('click',()=>{$('gpsFilterPop').classList.toggle('show');});}
    return;
  }

  const sev=routeSev(route);
  const actionable=(route.issues||[]).filter(i=>!NOISE_TYPES.has(i.type));
  const hi=actionable.filter(i=>i.severity==='high').length;
  const med=actionable.filter(i=>i.severity==='medium').length;
  const totalKm=((route.distancePairs||[]).reduce((s,dp)=>s+(dp.distanceKm||0),0)).toFixed(1);
  const teamDisplay=(()=>{
    const members=route.members||[];
    if(members.length<=2)return route.teamName;
    return `${members[0]} +${members.length-1}`;
  })();
  $('mapOverlay').innerHTML=`
    <span class="map-pill" style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(route.zone)} · ${esc(teamDisplay)}</span>
    <span class="map-pill ${sev==='high'?'danger':sev==='medium'?'warn':''}">Risk ${route.riskScore} · ${esc(route.riskLevel)}</span>
    <span class="map-pill">${mappable.length} titik</span>
    ${totalKm>0?`<span class="map-pill">~${totalKm} km total</span>`:''}
    ${hi?`<span class="map-pill danger">⚠ ${hi} High</span>`:''}
    ${med?`<span class="map-pill warn">▲ ${med} Med</span>`:''}
    ${gpsPill}`;

  const gob=$('gpsOverlayBtn');
  if(gob){gob.addEventListener('click',()=>{$('gpsFilterPop').classList.toggle('show');});}

  if(bounds.length)fitBounds(bounds);
}

function scheduleRenderMap({gpsOnly=false}={}){
  requestAnimationFrame(()=>renderMap(routeById(S.selectedRouteId),{gpsOnly}));
}

/* ── SELECTION ── */
function updateRouteHighlight(newId,oldId){
  // Update route card highlight without full rebuild
  if(oldId){
    const el=document.querySelector(`[data-route="${CSS.escape(oldId)}"]`);
    if(el)el.classList.remove('sel','sel-d','sel-w');
  }
  if(newId){
    const el=document.querySelector(`[data-route="${CSS.escape(newId)}"]`);
    if(el){
      const r=routeById(newId);
      const sev=routeSev(r);
      el.classList.add(sev==='high'?'sel-d':sev==='medium'?'sel-w':'sel');
      el.scrollIntoView({block:'nearest',behavior:'smooth'});
    }
  }
}

function updateIssueHighlight(newId,oldId){
  if(oldId){document.querySelector(`[data-issue="${CSS.escape(oldId)}"]`)?.classList.remove('sel-ic');}
  if(newId){
    const el=document.querySelector(`[data-issue="${CSS.escape(newId)}"]`);
    if(el){el.classList.add('sel-ic');el.scrollIntoView({block:'nearest',behavior:'smooth'});}
  }
}

function selectRoute(id){
  const prev=S.selectedRouteId;
  S.selectedRouteId=id;S.selectedIssueId=null;
  const r=routeById(id);
  updateRouteHighlight(id,prev);
  updateGpsTimeLabel(r);
  updateIssueHighlight(null,null);
  renderMap(r);
  renderEvidence(r);
}

function selectIssue(id){
  const issue=issueById(id);if(!issue)return;
  const prevRoute=S.selectedRouteId;
  const prevIssue=S.selectedIssueId;
  S.selectedIssueId=id;S.selectedRouteId=issue.routeId;
  const r=routeById(issue.routeId);
  if(prevRoute!==issue.routeId){
    // Route changed — need full map + evidence render
    updateRouteHighlight(issue.routeId,prevRoute);
    renderMap(r);
    renderEvidence(r);
  } else {
    // Same route — just update issue highlight, no map redraw
    updateIssueHighlight(id,prevIssue);
  }
  if(issue.visitId)setTimeout(()=>scrollVisit(issue.visitId),150);
}

function renderAll(){
  renderZoneStats();renderRouteList();renderIssueList();
  const route=routeById(S.selectedRouteId)||(S.zoneData?.routes||[])[0];
  if(route)S.selectedRouteId=route.routeId;
  renderMap(route);renderEvidence(route);
}


  window.invalidateSize=invalidateSize;
  window.fitBounds=fitBounds;
  window.initMap=initMap;
  window.setLayer=setLayer;
  window.clearRouteLayer=clearRouteLayer;
  window.clearAllMapLayers=clearAllMapLayers;
  window.buildDistLookup=buildDistLookup;
  window.renderMap=renderMap;
  window.scheduleRenderMap=scheduleRenderMap;
  window.updateRouteHighlight=updateRouteHighlight;
  window.updateIssueHighlight=updateIssueHighlight;
  window.selectRoute=selectRoute;
  window.selectIssue=selectIssue;
  window.renderAll=renderAll;
})();
