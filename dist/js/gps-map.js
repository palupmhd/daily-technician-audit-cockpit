/* GPS plate filter + map layer module */
(function(){
  const PLATE_COLORS=['#38bdf8','#a78bfa','#f472b6','#fbbf24','#34d399','#fb923c','#60a5fa','#f87171','#c084fc','#22d3ee'];

  function gpsStatusInfo(rawStatus){
    const raw=String(rawStatus||'').trim();
    const norm=raw.toLowerCase();
    const isOff=/\boff\b|offline|mati|nonaktif|tidak aktif|ada di basecamp/.test(norm)&&!norm.includes('tidak ada di basecamp');
    const isOn=/\bon\b|online|aktif|hidup|tidak ada di basecamp|beroperasi/.test(norm)&&!isOff;
    if(isOn)return{key:'on',label:'ON / Beroperasi',raw};
    if(isOff)return{key:'off',label:'OFF / Tidak beroperasi',raw};
    return{key:'unknown',label:raw||'Status tidak diketahui',raw};
  }

  function gpsPointStyle(statusInfo,plateColor,hover=false){
    if(statusInfo.key==='on'){
      return{
        radius:hover?6.2:4.6,color:'#ffffff',weight:hover?2.4:1.7,opacity:hover ? 1 : .9,
        fillColor:plateColor,fillOpacity:hover ? .94 : .82
      };
    }
    if(statusInfo.key==='off'){
      return{
        radius:hover?6.4:4.8,color:plateColor,weight:hover?3:2.3,opacity:hover ? 1 : .86,
        fillColor:'#ffffff',fillOpacity:hover ? .86 : .64
      };
    }
    return{
      radius:hover?6.2:4.6,color:'#b45309',weight:hover?2.6:1.9,opacity:hover ? 1 : .86,
      fillColor:'#facc15',fillOpacity:hover ? .82 : .58
    };
  }

  function plateColor(plate,idx){
    if(!S.gpsPlateColors[plate]){
      S.gpsPlateColors[plate]=PLATE_COLORS[idx%PLATE_COLORS.length];
    }
    return S.gpsPlateColors[plate];
  }

  function renderGpsPlateFilter(query=''){
    const vehicles=S.gpsData?.gpsLayer?.vehicles||[];
    if(!vehicles.length){$('gpsPlateList').innerHTML='<div style="color:var(--muted);font-size:11px">Tidak ada GPS untuk zona ini.</div>';return;}
    S.gpsPlateColors={};
    vehicles.forEach((v,i)=>plateColor(v.plate,i));

    const searchWrap=$('gpsSearchWrap');
    if(searchWrap)searchWrap.style.display=vehicles.length>8?'block':'none';

    const q=query.toLowerCase();
    const filtered=q?vehicles.filter(v=>v.plate.toLowerCase().includes(q)):vehicles;

    if(!filtered.length){
      $('gpsPlateList').innerHTML='<div style="color:var(--muted);font-size:11px;padding:4px 0">Tidak ditemukan.</div>';
      return;
    }

    $('gpsPlateList').innerHTML=filtered.map(v=>{
      const off=S.gpsPlateDisabled.has(v.plate)?'off':'';
      const color=S.gpsPlateColors[v.plate];
      return`<label class="gps-plate-row ${off}">
        <input type="checkbox" data-plate="${esc(v.plate)}" ${off?'':'checked'}>
        <div class="swatch" style="background:${color}"></div>
        <div class="plate">${esc(v.plate)}</div>
        <div class="count">${v.pointCount||0}</div>
      </label>`;
    }).join('');

    document.querySelectorAll('#gpsPlateList input[type=checkbox]').forEach(el=>{
      el.addEventListener('change',()=>{
        S.gpsFilterTouched=true;
        const plate=el.dataset.plate;
        if(el.checked)S.gpsPlateDisabled.delete(plate);
        else S.gpsPlateDisabled.add(plate);
        el.closest('.gps-plate-row').classList.toggle('off',!el.checked);
        const r=routeById(S.selectedRouteId);
        clearGpsLayer();renderGpsLayer(r);
        scheduleRenderMap({gpsOnly:true});
      });
    });
  }

  async function loadGpsData(){
    if(!S.zoneData?.gpsFile)return null;
    const key=S.zoneData.gpsFile;
    if(S.gpsCache[key]){S.gpsData=S.gpsCache[key];return S.gpsData;}
    S.gpsData=await fetchJson(key);
    S.gpsCache[key]=S.gpsData;
    return S.gpsData;
  }

  function clearGpsLayer(){
    S.gpsRenderToken++;
    S.layers.gps.clearLayers();
  }

  function autoFocusGpsPlates(route){
    if(!route||!S.gpsData||S.gpsFilterTouched)return;
    const vehicles=(S.gpsData?.gpsLayer?.vehicles||[]).filter(v=>(v.points||[]).length);
    if(vehicles.length<=1)return;
    const refs=(route.visits||[])
      .filter(v=>v.showOnMap&&v.type!=='branch_task'&&Number.isFinite(v.lat)&&Number.isFinite(v.lng))
      .map(v=>({lat:v.lat,lng:v.lng}));
    if(!refs.length)return;
    const relevant=new Set();
    vehicles.forEach(v=>{
      let best=Infinity;
      for(const p of (v.points||[])){
        if(!Number.isFinite(p[1])||!Number.isFinite(p[2]))continue;
        for(const r of refs){
          const d=haversineKm(p[1],p[2],r.lat,r.lng);
          if(d<best)best=d;
          if(best<=1.0)break;
        }
        if(best<=1.0)break;
      }
      if(best<=1.0)relevant.add(v.plate);
    });
    if(!relevant.size||relevant.size===vehicles.length)return;
    S.gpsPlateDisabled.clear();
    vehicles.forEach(v=>{if(!relevant.has(v.plate))S.gpsPlateDisabled.add(v.plate);});
    renderGpsPlateFilter($('gpsSearchInput')?.value||'');
  }

  function renderGpsLayer(route){
    clearGpsLayer();
    if(!route||!S.layerToggles.gps)return;
    if(!S.gpsData){
      loadGpsData().then(()=>{renderGpsPlateFilter();scheduleRenderMap({gpsOnly:true});}).catch(err=>toast(err.message));
      return;
    }
    autoFocusGpsPlates(route);

    const token=S.gpsRenderToken;
    const isStale=()=>token!==S.gpsRenderToken;
    const yieldFrame=()=>new Promise(resolve=>requestAnimationFrame(resolve));
    const routeEndMin=timeToMin(route?.endTime);
    const timeFilter=S.gpsTimeFilter;

    let vehicles=(S.gpsData?.gpsLayer?.vehicles||[]).filter(v=>(v.points||[]).length);
    vehicles=vehicles.filter(v=>!S.gpsPlateDisabled.has(v.plate));
    const GPS_MAX_PER_PLATE=700;
    const GPS_POINT_CHUNK=120;
    let gpsRendered=0;
    const pendingPointJobs=[];
    const endpointMarkers=[];

    function pointBucketKey(lat,lng,bucketPx=4){
      const pt=S.map?.latLngToLayerPoint([lat,lng]);
      return pt?`${Math.round(pt.x/bucketPx)},${Math.round(pt.y/bucketPx)}`:`${Number(lat).toFixed(5)},${Number(lng).toFixed(5)}`;
    }

    function radialOffset(idx,count,radius=5){
      if(count<=1)return null;
      if(count===2)return {x:idx===0?-radius:radius,y:0};
      const angle=(-Math.PI/2)+(idx*2*Math.PI/count);
      return {x:Math.round(Math.cos(angle)*radius),y:Math.round(Math.sin(angle)*radius)};
    }

    function offsetLatLng(lat,lng,offset){
      if(!offset||!S.map)return [lat,lng];
      const pt=S.map.latLngToLayerPoint([lat,lng]);
      return S.map.layerPointToLatLng(L.point(pt.x+offset.x,pt.y+offset.y));
    }

    vehicles.forEach((v,idx)=>{
      let raw=v.points||[];
      if(!raw.length)return;

      if(timeFilter==='after_route'&&routeEndMin>0){
        raw=raw.filter(p=>{
          const t=timeToMin(p[0]);
          return t<0||t>routeEndMin;
        });
        if(!raw.length)return;
      }

      const color=plateColor(v.plate,idx);

      let totalKmGps=0;
      for(let i=0;i<raw.length-1;i++){
        if(Number.isFinite(raw[i][1])&&Number.isFinite(raw[i+1][1])){
          totalKmGps+=haversineKm(raw[i][1],raw[i][2],raw[i+1][1],raw[i+1][2]);
        }
      }
      const totalKmStr=totalKmGps>0?`${totalKmGps.toFixed(1)} km`:'—';

      const onPts=raw.filter(p=>(p[3]||'').includes('Tidak ada'));
      let onDurMin=null;
      if(onPts.length>=2){
        const t0=timeToMin(onPts[0][0]),t1=timeToMin(onPts[onPts.length-1][0]);
        if(t0>0&&t1>t0)onDurMin=t1-t0;
      }

      const vis=downsample(raw,GPS_MAX_PER_PLATE);
      const ptsMeta=vis.map(p=>({time:p[0],lat:p[1],lng:p[2],note:p[3]||''}))
        .filter(p=>Number.isFinite(p.lat)&&Number.isFinite(p.lng));
      const pts=ptsMeta.map(p=>[p.lat,p.lng]);
      gpsRendered+=pts.length;

      if(pts.length>1){
        const tStart=raw[0]?.[0]||'—', tEnd=raw[raw.length-1]?.[0]||'—';

        L.polyline(pts,{color,weight:2,opacity:.38,renderer:S.renderers.gps})
          .bindPopup(`<div style="min-width:180px">
            <div style="font-weight:700;font-size:12px;margin-bottom:5px">GPS Track</div>
            <div style="display:grid;grid-template-columns:auto 1fr;gap:2px 10px;font-size:11px">
              <span style="color:var(--muted)">Plat</span><span style="font-family:'DM Mono',monospace;font-weight:600">${esc(v.plate)}</span>
              <span style="color:var(--muted)">Mulai</span><span style="font-family:'DM Mono',monospace">${esc(tStart)}</span>
              <span style="color:var(--muted)">Selesai</span><span style="font-family:'DM Mono',monospace">${esc(tEnd)}</span>
              <span style="color:var(--muted)">Jarak Tempuh</span><span style="color:var(--success-text);font-weight:600">${totalKmStr}</span>
              ${onDurMin!=null?`<span style="color:var(--muted)">Durasi Operasional</span><span style="color:var(--success-text);font-weight:600">${fmtMin(onDurMin)}</span>`:''}
              ${timeFilter==='after_route'?`<span style="color:var(--muted)">Filter</span><span style="color:var(--warn-text)">Setelah ${route.endTime}</span>`:''}
            </div>
          </div>`,{maxWidth:240})
          .bindTooltip(`${esc(v.plate)} · ${totalKmStr}${onDurMin!=null?' · '+fmtMin(onDurMin):''}`,{direction:'top',sticky:true})
          .addTo(S.layers.gps);

        const arrowInterval=Math.max(3,Math.floor(pts.length/6));
        for(let pi=arrowInterval;pi<pts.length;pi+=arrowInterval){
          const [la1,lo1]=pts[pi-1],[la2,lo2]=pts[pi];
          const dy=la2-la1,dx=(lo2-lo1)*Math.cos(la1*Math.PI/180);
          const bear=Math.atan2(dx,dy)*180/Math.PI;
          L.marker([(la1+la2)/2,(lo1+lo2)/2],{icon:L.divIcon({
            className:'',
            html:`<div style="width:0;height:0;border-left:4px solid transparent;border-right:4px solid transparent;border-bottom:8px solid ${color};transform:rotate(${bear}deg);transform-origin:center;opacity:.55;pointer-events:none"></div>`,
            iconAnchor:[4,4],
          }),interactive:false,zIndexOffset:-60}).addTo(S.layers.gps);
        }
      }

      if(S.layerToggles.gpsPoints){
        pendingPointJobs.push({v,color,raw});
      }

      const firstPt=raw[0],lastPt=raw[raw.length-1];
      const opDurStr=onDurMin!=null?fmtMin(onDurMin):'—';

      [[firstPt,'mgps','▶','Berangkat'],[lastPt,'mgps mgps-end','■','Kembali']].forEach(([p,cls,lbl,label],pi)=>{
        if(!p||!Number.isFinite(p[1])||!Number.isFinite(p[2]))return;
        const statusInfo=gpsStatusInfo(p[3]);
        const statusColor=statusInfo.key==='on'?'var(--success-text)':statusInfo.key==='off'?'var(--danger-text)':'var(--warn-text)';
        const statusLabel=statusInfo.label;
        endpointMarkers.push({p,cls,lbl,label,pi,statusColor,statusLabel,totalKmStr,opDurStr,v});
      });
    });

    if(endpointMarkers.length){
      const endpointGroups={};
      endpointMarkers.forEach(item=>{
        const pt=S.map?.latLngToLayerPoint([item.p[1],item.p[2]]);
        const key=pt?`${Math.round(pt.x/6)},${Math.round(pt.y/6)}`:`${Number(item.p[1]).toFixed(5)},${Number(item.p[2]).toFixed(5)}`;
        (endpointGroups[key]||(endpointGroups[key]=[])).push(item);
      });
      const endpointOffset=(idx,group)=>{
        if(group.length<=1)return null;
        if(group.length===2)return {x:idx===0?-6:6,y:0};
        const radius=7;
        const angle=(-Math.PI/2)+(idx*2*Math.PI/group.length);
        return {x:Math.round(Math.cos(angle)*radius),y:Math.round(Math.sin(angle)*radius)};
      };
      Object.values(endpointGroups).forEach(group=>{
        group.forEach((item,idx)=>{
          const {p,cls,lbl,label,pi,statusColor,statusLabel,totalKmStr,opDurStr,v}=item;
          L.marker([p[1],p[2]],{icon:mkIcon(lbl,cls,endpointOffset(idx,group)),zIndexOffset:160+idx})
          .bindPopup(`<div style="min-width:190px">
            <div style="font-weight:700;font-size:12px;margin-bottom:6px;padding-bottom:5px;border-bottom:1px solid var(--panel-line)">${label} · ${esc(v.plate)}</div>
            <div style="display:grid;grid-template-columns:auto 1fr;gap:3px 10px;font-size:11px">
              <span style="color:var(--muted)">Jam</span><span style="font-family:'DM Mono',monospace;font-weight:600">${esc(p[0]||'—')}</span>
              <span style="color:var(--muted)">Status</span><span style="color:${statusColor};font-weight:600">${statusLabel}</span>
              ${pi===1?`<span style="color:var(--muted)">Jarak Tempuh</span><span style="color:var(--success-text);font-weight:600">${totalKmStr}</span>`:''}
              ${pi===1?`<span style="color:var(--muted)">Durasi Operasional</span><span style="color:var(--success-text);font-weight:600">${opDurStr}</span>`:''}
            </div>
          </div>`,{maxWidth:260})
          .bindTooltip(`${lbl} ${esc(v.plate)} · ${esc(p[0]||'—')}`,{direction:'top',offset:[0,-12]})
          .addTo(S.layers.gps);
        });
      });
    }

    if(pendingPointJobs.length){
      (async()=>{
        for(const job of pendingPointJobs){
          if(isStale())return;
          const {v,color,raw}=job;
          const pointGroups={};
          raw.forEach((p,idx)=>{
            if(!Number.isFinite(p[1])||!Number.isFinite(p[2]))return;
            const key=pointBucketKey(p[1],p[2]);
            (pointGroups[key]||(pointGroups[key]=[])).push({p,idx,statusInfo:gpsStatusInfo(p[3])});
          });
          const renderItems=Object.values(pointGroups).flatMap(group=>{
            if(group.length<=4){
              return group.map((item,idx)=>({...item,offset:radialOffset(idx,group.length),groupSize:group.length,aggregate:false}));
            }
            return [{aggregate:true,group,groupSize:group.length}];
          });

          for(let i=0;i<renderItems.length;i+=GPS_POINT_CHUNK){
            if(isStale())return;
            const slice=renderItems.slice(i,i+GPS_POINT_CHUNK);
            for(const item of slice){
              if(item.aggregate){
                const group=item.group;
                const first=group[0]?.p;
                if(!first)continue;
                const counts=group.reduce((acc,it)=>{acc[it.statusInfo.key]=(acc[it.statusInfo.key]||0)+1;return acc;},{});
                const statusBits=[
                  counts.on?`${counts.on} ON`:null,
                  counts.off?`${counts.off} OFF`:null,
                  counts.unknown?`${counts.unknown} unknown`:null,
                ].filter(Boolean).join(' · ');
                const times=group.map(it=>it.p[0]).filter(Boolean);
                const marker=L.circleMarker([first[1],first[2]],{
                  radius:6.2,
                  color,
                  weight:2.6,
                  opacity:.9,
                  fillColor:'#ffffff',
                  fillOpacity:.72,
                  renderer:S.renderers.gps
                });
                marker
                  .on('mouseover',()=>{marker.setStyle({radius:7.4,weight:3.2,fillOpacity:.86});marker.bringToFront();})
                  .on('mouseout',()=>marker.setStyle({radius:6.2,weight:2.6,fillOpacity:.72}))
                  .bindTooltip(
                    `<strong>${esc(v.plate)}</strong><br>${group.length} titik di koordinat ini<br><span style="font-weight:700;color:${color}">${esc(statusBits||'Status tidak diketahui')}</span>${times.length?`<br><span style="color:var(--muted)">${esc(times[0])}${times.length>1?` - ${esc(times[times.length-1])}`:''}</span>`:''}<br><span style="font-family:monospace;font-size:10px">${Number(first[1]).toFixed(5)}, ${Number(first[2]).toFixed(5)}</span>`,
                    {direction:'top',offset:[0,-4]}
                  )
                  .addTo(S.layers.gps);
                continue;
              }

              const {p,statusInfo,offset,groupSize}=item;
              const visual=offsetLatLng(p[1],p[2],offset);
              const marker=L.circleMarker(visual,{
                ...gpsPointStyle(statusInfo,color,false),renderer:S.renderers.gps
              });
              marker
              .on('mouseover',()=>{marker.setStyle(gpsPointStyle(statusInfo,color,true));marker.bringToFront();})
              .on('mouseout',()=>marker.setStyle(gpsPointStyle(statusInfo,color,false)))
              .bindTooltip(
                `<strong>${esc(v.plate)}</strong><br>${esc(p[0]||'—')}<br><span style="font-weight:700;color:${statusInfo.key==='on'?color:statusInfo.key==='off'?'var(--muted)':'#ca8a04'}">${esc(statusInfo.label)}</span><br><span style="font-family:monospace;font-size:10px">${Number(p[1]).toFixed(5)}, ${Number(p[2]).toFixed(5)}</span>`,
                {direction:'top',offset:[0,-4]}
              )
              .addTo(S.layers.gps);
            }
            if(i+GPS_POINT_CHUNK<raw.length)await yieldFrame();
          }
        }
      })().catch(()=>{});
    }

    return gpsRendered;
  }

  window.gpsStatusInfo=gpsStatusInfo;
  window.gpsPointStyle=gpsPointStyle;
  window.plateColor=plateColor;
  window.renderGpsPlateFilter=renderGpsPlateFilter;
  window.loadGpsData=loadGpsData;
  window.clearGpsLayer=clearGpsLayer;
  window.autoFocusGpsPlates=autoFocusGpsPlates;
  window.renderGpsLayer=renderGpsLayer;
})();
