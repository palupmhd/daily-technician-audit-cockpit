/* Shared browser utilities */
(function(){
  function $(id){
    return document.getElementById(id);
  }

  function esc(v){
    return String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  }

  function debounce(fn,wait=160){
    let t;
    return(...a)=>{clearTimeout(t);t=setTimeout(()=>fn(...a),wait);};
  }

  function fmtMin(m){
    if(m==null||m===''||isNaN(m))return'—';
    m=Math.round(m);
    if(m<60)return`${m}m`;
    const h=Math.floor(m/60),min=m%60;
    return min>0?`${h}j ${min}m`:`${h}j`;
  }

  async function fetchJson(path){
    const r=await fetch(path,{cache:'no-store'});
    if(!r.ok)throw new Error(`Gagal load ${path}: ${r.status}`);
    return r.json();
  }

  function toast(msg){
    const t=$('toast');
    t.textContent=msg;
    t.classList.add('show');
    setTimeout(()=>t.classList.remove('show'),2600);
  }

  function mkIcon(label,cls='',offset=null){
    let size=30;
    if(String(cls).includes('mdanger'))size=38;
    else if(String(cls).includes('mwarn'))size=34;
    else if(String(cls).includes('mgps'))size=14;
    const dx=offset?.x||0,dy=offset?.y||0;
    const shift=dx||dy?` style="transform:translate(${dx}px,${dy}px)"`:'';
    return L.divIcon({
      className:'',
      html:`<div class="marker-dot ${cls}"${shift}>${esc(label)}</div>`,
      iconSize:[size,size],
      iconAnchor:[size/2,size/2],
      popupAnchor:[dx,-size/2+dy]
    });
  }

  function bearing(lat1,lng1,lat2,lng2){
    const dy=lat2-lat1,dx=(lng2-lng1)*Math.cos(lat1*Math.PI/180);
    return Math.atan2(dx,dy)*180/Math.PI;
  }

  function haversineKm(lat1,lon1,lat2,lon2){
    const R=6371,dlat=(lat2-lat1)*Math.PI/180,dlon=(lon2-lon1)*Math.PI/180;
    const a=Math.sin(dlat/2)**2+Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dlon/2)**2;
    return R*2*Math.asin(Math.sqrt(a));
  }

  function timeToMin(t){
    if(!t)return-1;
    const m=String(t).match(/(\d+):(\d+)/);
    return m?parseInt(m[1])*60+parseInt(m[2]):-1;
  }

  function downsample(pts,max=700){
    if(!pts||pts.length<=max)return pts||[];
    const s=Math.ceil(pts.length/max),out=[];
    for(let i=0;i<pts.length;i+=s)out.push(pts[i]);
    const last=pts[pts.length-1];
    if(out[out.length-1]!==last)out.push(last);
    return out;
  }

  window.$=$;
  window.esc=esc;
  window.debounce=debounce;
  window.fmtMin=fmtMin;
  window.fetchJson=fetchJson;
  window.toast=toast;
  window.mkIcon=mkIcon;
  window.bearing=bearing;
  window.haversineKm=haversineKm;
  window.timeToMin=timeToMin;
  window.downsample=downsample;
})();
