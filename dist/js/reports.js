/* Print report + CSV export module */
(function(){
/* ── EXPORTS ── */
function csvEsc(v){const s=String(v??'');return/[",\n;]/.test(s)?`"${s.replace(/"/g,'""')}"`:s;}
function dlCSV(name,rows){
  if(!rows.length){toast('Tidak ada data untuk export.');return;}
  const h=Object.keys(rows[0]);
  const body=[h.join(','),...rows.map(r=>h.map(k=>csvEsc(r[k])).join(','))].join('\n');
  const a=Object.assign(document.createElement('a'),{href:URL.createObjectURL(new Blob(['\uFEFF'+body],{type:'text/csv;charset=utf-8'})),download:name});
  a.click();URL.revokeObjectURL(a.href);
}

function visitNotesString(visit){
  const notes=[];
  (visit.jobs||[]).forEach(j=>{
    if(j.notes&&j.notes!=='-')notes.push(j.notes);
    if(j.problemNotes&&j.problemNotes!=='-')notes.push(`[masalah] ${j.problemNotes}`);
  });
  return notes.join(' | ');
}

function fmtDate(d){
  // '2026-05-11' -> '11 Mei 2026'
  const months=['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
  const parts=(d||'').split('-');
  if(parts.length!==3)return d||'';
  return `${parseInt(parts[2])} ${months[parseInt(parts[1])-1]} ${parts[0]}`;
}

function severityLabel(s){
  return s==='high'?'TINGGI':s==='medium'?'SEDANG':'RENDAH';
}

function issueTypeName(t){
  const map={
    late_first_store:'Keterlambatan Toko Pertama',
    work_duration_too_short:'Durasi Pekerjaan Terlalu Cepat',
    work_duration_too_long:'Durasi Pekerjaan Terlalu Lama',
    travel_gap_too_long:'Jeda Perjalanan Terlalu Lama',
    missing_coordinate:'Koordinat Tidak Valid',
    missing_distance:'Data Jarak Belum Tersedia',
  };
  return map[t]||t.replace(/_/g,' ');
}

/* ── PRINT REPORT ── */
function printReport(){
  const r=routeById(S.selectedRouteId);
  if(!r){toast('Pilih route dulu.');return;}

  const actionable=(r.issues||[]).filter(i=>ACTION_TYPES.has(i.type))
    .sort((a,b)=>(SEV[b.severity]||0)-(SEV[a.severity]||0));
  const dataIssues=(r.issues||[]).filter(i=>NOISE_TYPES.has(i.type));
  const hi=actionable.filter(i=>i.severity==='high').length;
  const med=actionable.filter(i=>i.severity==='medium').length;

  const riskColor=r.riskLevel?.toLowerCase().includes('critical')?'#c0392b':
    r.riskLevel?.toLowerCase().includes('needs')?'#d68910':
    r.riskLevel?.toLowerCase().includes('watch')?'#1a5276':'#1e8449';

  // Build findings blocks — naratif bukan tabel
  function autoCtxPrint(issue){
    const ctx=[];
    if(issue.type==='late_first_store'){
      const visits=r.visits||[];
      const firstMappable=visits.find(v=>v.showOnMap);
      if(firstMappable){
        const before=visits.filter(v=>v.seq<firstMappable.seq);
        const te=before.filter(v=>v.type==='travel_event').pop();
        if(te){
          const notes=(te.jobs||[]).map(j=>j.notes).filter(n=>n&&n!=='-');
          ctx.push(`Terdapat aktivitas <strong>${esc(te.locationName)}</strong> pukul ${esc(te.startTime)}–${esc(te.endTime)} sebelum toko pertama.${notes.length?` Catatan: "${esc(notes[0])}"`:''}`);
        }
      }
    }
    return ctx;
  }

  const findingsHtml=actionable.length?actionable.map((i,idx)=>{
    const v=(r.visits||[]).find(v=>v.visitId===i.visitId);
    const fu=getFu(i.id);
    const notes=v?visitNotesString(v):'';
    const ctxLines=autoCtxPrint(i);
    const sevBg=i.severity==='high'?'#fdf2f2':i.severity==='medium'?'#fffbf0':'#f0f7ff';
    const sevBorder=i.severity==='high'?'#e74c3c':i.severity==='medium'?'#f39c12':'#3498db';
    const sevTxt=i.severity==='high'?'#c0392b':i.severity==='medium'?'#d68910':'#1a5276';

    // Metrics line
    let metricLine='';
    const m=i.metrics||{};
    if(i.type==='late_first_store'&&m.actualStart){
      metricLine=`Mulai pukul <strong>${esc(m.actualStart)}</strong>, seharusnya latest <strong>${esc(m.expectedLatest)}</strong>. Selisih <strong>${m.deltaMin} menit</strong>.`;
    } else if((i.type==='work_duration_too_short'||i.type==='work_duration_too_long')&&m.actualDurationMin!=null){
      metricLine=`Durasi aktual <strong>${m.actualDurationMin} menit</strong>, benchmark <strong>${m.expectedMin}–${m.expectedMax} menit</strong>${m.unitQty?` (${m.unitQty} unit)`:''}.${m.lunchDeductionMin?` Sudah dikurangi istirahat ${m.lunchDeductionMin} menit.`:''}`;
    } else if(i.type==='travel_gap_too_long'&&m.actualGapMin!=null){
      metricLine=`Jeda perjalanan <strong>${m.actualGapMin} menit</strong>, estimasi perjalanan <strong>${m.expectedTravelMin} menit</strong>.`;
    }

    return `<div style="margin-bottom:16px;border-left:4px solid ${sevBorder};background:${sevBg};border-radius:0 6px 6px 0;padding:12px 16px;page-break-inside:avoid">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px">
        <div style="font-weight:700;font-size:11pt;color:#111">${idx+1}. ${issueTypeName(i.type)}</div>
        <div style="font-size:8.5pt;font-weight:700;color:${sevTxt};background:white;border:1px solid ${sevBorder};border-radius:4px;padding:2px 8px;white-space:nowrap;margin-left:12px">${severityLabel(i.severity)}</div>
      </div>
      ${i.locationName?`<div style="font-size:9pt;color:#555;margin-bottom:6px">📍 ${esc(i.locationName)}</div>`:''}
      <div style="font-size:10pt;color:#222;line-height:1.6;margin-bottom:6px">${metricLine||esc(i.message)}</div>
      ${ctxLines.length?`<div style="font-size:9.5pt;color:#555;background:rgba(0,0,0,.04);border-radius:4px;padding:7px 10px;margin-bottom:6px;line-height:1.5">${ctxLines.map(c=>`ℹ️ ${c}`).join('<br>')}</div>`:''}
      ${notes?`<div style="font-size:9.5pt;color:#555;font-style:italic;margin-bottom:6px;padding:6px 10px;border-left:2px solid #ccc">"${esc(notes.slice(0,200))}${notes.length>200?'…':''}"</div>`:''}
      <div style="font-size:9pt;color:#555">→ <em>${esc(i.recommendation||'')}</em></div>
      ${fu.status!=='pending'?`<div style="margin-top:8px;font-size:9pt;padding:5px 10px;background:white;border-radius:4px;border:1px solid #ddd"><strong>Status tindak lanjut:</strong> ${esc(fu.status)}${fu.note?` — ${esc(fu.note)}`:''}</div>`:''}
    </div>`;
  }).join('')
  :'<div style="color:#555;font-style:italic;padding:12px 0">Tidak ada temuan yang memerlukan klarifikasi.</div>';

  // Timeline — compact version
  const tlHtml=(r.visits||[]).map(v=>{
    const vIss=(r.issues||[]).filter(i=>i.visitId===v.visitId&&ACTION_TYPES.has(i.type));
    const notes=visitNotesString(v);
    const hasFlag=vIss.length>0;
    return `<tr style="${hasFlag?'background:#fffbf0':''}">
      <td style="color:#888;font-size:9pt;white-space:nowrap">${v.type==='travel_event'?'—':v.seq}</td>
      <td style="font-size:9pt;white-space:nowrap;font-family:monospace">${esc(v.startTime)}–${esc(v.endTime)}</td>
      <td style="font-weight:600;font-size:9.5pt">${esc(v.locationName)}</td>
      <td style="font-size:9pt;color:#555">${(v.jobs||[]).map(j=>`${esc(j.jobType)}${j.unitQty?` ×${j.unitQty}`:''}`).join(', ')||'—'}</td>
      <td style="font-size:9pt">${esc(v.statusSummary)}</td>
      <td style="font-size:8.5pt;color:#555;font-style:italic">${notes?esc(notes.slice(0,80))+(notes.length>80?'…':''):'—'}</td>
      ${hasFlag?`<td style="font-size:8.5pt;color:#c0392b">${vIss.map(i=>issueTypeName(i.type)).join(', ')}</td>`:`<td style="color:#888">—</td>`}
    </tr>`;
  }).join('');

  const totalKm=((r.distancePairs||[]).reduce((s,dp)=>s+(dp.distanceKm||0),0)).toFixed(1);

  const w=window.open('','_blank');
  w.document.write(`<!doctype html><html lang="id"><head>
  <meta charset="utf-8">
  <title>Laporan Audit — ${esc(r.zone)} — ${fmtDate(r.date)}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Segoe UI',Arial,sans-serif;color:#111;font-size:10.5pt;line-height:1.5;background:#fff;}
    .page{max-width:820px;margin:0 auto;padding:32px 36px;}

    /* header strip */
    .doc-header{border-bottom:3px solid #111;padding-bottom:14px;margin-bottom:20px;}
    .doc-title{font-size:9pt;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#555;margin-bottom:4px;}
    .doc-h1{font-size:17pt;font-weight:800;color:#111;letter-spacing:-.01em;line-height:1.2;}
    .doc-sub{font-size:10pt;color:#555;margin-top:4px;}

    /* identity grid */
    .id-grid{display:flex;flex-wrap:wrap;gap:6px 32px;margin-bottom:16px;padding:10px 14px;background:#f5f5f5;border-radius:6px;font-size:9.5pt;}
    .id-row{display:flex;gap:6px;align-items:baseline;}
    .id-label{color:#888;font-size:8.5pt;white-space:nowrap;}
    .id-val{font-weight:600;color:#111;}

    /* risk strip */
    .risk-strip{display:flex;align-items:center;gap:10px;padding:12px 16px;border-radius:6px;margin-bottom:24px;border:1px solid #ddd;}
    .risk-badge{font-size:13pt;font-weight:800;padding:4px 14px;border-radius:6px;color:white;}
    .risk-detail{font-size:9pt;color:#555;line-height:1.6;}
    .risk-kpis{display:flex;gap:16px;margin-left:auto;}
    .kpi-box{text-align:center;min-width:44px;}
    .kpi-n{font-size:14pt;font-weight:800;}
    .kpi-l{font-size:8pt;color:#888;text-transform:uppercase;letter-spacing:.04em;}

    /* section heading */
    .sec{font-size:8.5pt;font-weight:800;text-transform:uppercase;letter-spacing:.1em;color:#888;margin:24px 0 10px;display:flex;align-items:center;gap:8px;}
    .sec::after{content:'';flex:1;height:1px;background:#ddd;}

    /* timeline table */
    table{border-collapse:collapse;width:100%;font-size:9.5pt;}
    th{background:#f0f0f0;font-weight:700;font-size:8.5pt;text-transform:uppercase;letter-spacing:.04em;padding:6px 8px;text-align:left;border-bottom:2px solid #ccc;}
    td{padding:6px 8px;border-bottom:1px solid #eee;vertical-align:top;}
    tr:last-child td{border-bottom:none;}

    /* data quality */
    .dq-box{margin-top:24px;padding:10px 14px;background:#fafafa;border:1px solid #e0e0e0;border-radius:6px;font-size:9pt;color:#666;}
    .dq-label{font-weight:700;font-size:8pt;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;color:#999;}
    .dq-item{padding:2px 0;}

    @media print{
      body{font-size:9.5pt;}
      .page{padding:20px 24px;max-width:100%;}
      .doc-h1{font-size:15pt;}
    }
  </style>
  </head><body><div class="page">

  <div class="doc-header">
    <div class="doc-title">Laporan Audit Harian</div>
    <div class="doc-h1">${esc(r.zone)} — ${fmtDate(r.date)}</div>
    <div class="doc-sub">Disiapkan oleh sistem audit otomatis · Dicetak ${new Date().toLocaleString('id-ID')}</div>
  </div>

  <div class="id-grid">
    <div class="id-row"><span class="id-label">Anggota</span><span class="id-val">${esc((r.members||[]).join(' · '))}</span></div>
    <div class="id-row"><span class="id-label">Jam Kerja</span><span class="id-val">${esc(r.startTime)} – ${esc(r.endTime)}</span></div>
    <div class="id-row"><span class="id-label">Total Jarak</span><span class="id-val">${totalKm>0?`~${totalKm} km`:'—'}</span></div>
    <div class="id-row"><span class="id-label">Tanggal</span><span class="id-val">${fmtDate(r.date)}</span></div>
  </div>

  <div class="risk-strip" style="background:${r.riskLevel?.toLowerCase().includes('critical')?'#fdf2f2':r.riskLevel?.toLowerCase().includes('needs')?'#fffbf0':'#f8fffe'}">
    <div>
      <div class="risk-badge" style="background:${riskColor}">${esc(r.riskLevel)}</div>
      <div class="risk-detail" style="margin-top:6px">Risk Score: <strong>${r.riskScore}</strong>
      ${hi?` · <span style="color:#c0392b;font-weight:700">${hi} Temuan Tinggi</span>`:''}
      ${med?` · <span style="color:#d68910;font-weight:700">${med} Temuan Sedang</span>`:''}
      </div>
    </div>
    <div class="risk-kpis">
      <div class="kpi-box"><div class="kpi-n">${r.visitCount}</div><div class="kpi-l">Lokasi</div></div>
      <div class="kpi-box"><div class="kpi-n">${r.jobCount}</div><div class="kpi-l">Pekerjaan</div></div>
      <div class="kpi-box"><div class="kpi-n" style="color:${(r.doneCount||0)===r.visitCount?'#1e8449':'#c0392b'}">${r.doneCount||0}/${r.visitCount}</div><div class="kpi-l">Selesai</div></div>
    </div>
  </div>

  <div class="sec">Temuan — Perlu Klarifikasi</div>
  ${findingsHtml}

  <div class="sec">Kronologi Kunjungan</div>
  <table>
    <thead><tr><th>#</th><th>Waktu</th><th>Lokasi</th><th>Pekerjaan</th><th>Status</th><th>Catatan Teknisi</th><th>Flag</th></tr></thead>
    <tbody>${tlHtml}</tbody>
  </table>

  ${dataIssues.length?`<div class="dq-box">
    <div class="dq-label">Catatan Data (untuk tim admin)</div>
    ${dataIssues.map(i=>`<div class="dq-item">· ${issueTypeName(i.type)}: ${esc(i.message)}</div>`).join('')}
  </div>`:''}

  </div></body></html>`);
  w.document.close();
  w.focus();
  setTimeout(()=>w.print(),400);
}

/* ── CSV EXPORTS ── */
function exportFieldReport(){
  const rows=[];
  (S.zoneData?.routes||[]).forEach(r=>{
    const actionIssues=(r.issues||[]).filter(i=>ACTION_TYPES.has(i.type))
      .sort((a,b)=>(SEV[b.severity]||0)-(SEV[a.severity]||0));
    if(!actionIssues.length)return;
    actionIssues.forEach(i=>{
      const v=(r.visits||[]).find(v=>v.visitId===i.visitId);
      const fu=getFu(i.id);
      const m=i.metrics||{};
      let keterangan='';
      if(i.type==='late_first_store'&&m.actualStart)
        keterangan=`Mulai ${m.actualStart}, seharusnya ${m.expectedLatest}, selisih ${m.deltaMin} menit`;
      else if(i.type==='work_duration_too_short'||i.type==='work_duration_too_long')
        keterangan=`Aktual ${m.actualDurationMin??'—'} mnt, benchmark ${m.expectedMin??'—'}–${m.expectedMax??'—'} mnt${m.unitQty?`, ${m.unitQty} unit`:''}`;
      else if(i.type==='travel_gap_too_long')
        keterangan=`Jeda ${m.actualGapMin??'—'} mnt, estimasi ${m.expectedTravelMin??'—'} mnt`;
      else keterangan=i.message;
      rows.push({
        Tanggal:fmtDate(r.date),
        Zona:r.zone,
        'PIC Aplikasi':r.lead||'—',
        'Nama Anggota':(r.members||[]).join(', '),
        'Jenis Temuan':issueTypeName(i.type),
        Prioritas:severityLabel(i.severity),
        Lokasi:i.locationName||'—',
        Keterangan:keterangan,
        'Catatan Teknisi':v?visitNotesString(v):'—',
        Rekomendasi:i.recommendation||'—',
        'Jam Mulai':r.startTime,
        'Jam Selesai':r.endTime,
        'Status Tindak Lanjut':fu.status==='pending'?'Belum ditindaklanjuti':fu.status==='clarified'?'Sudah diklarifikasi':fu.status==='escalated'?'Dieskalasi':'Tidak valid',
        'Catatan Auditor':fu.note||'—',
      });
    });
  });
  dlCSV(`laporan_lapangan_${S.zoneData?.date}_${S.zoneData?.zone}.csv`,rows);
}

function exportDataQuality(){
  const rows=[];
  (S.zoneData?.routes||[]).forEach(r=>{
    (r.issues||[]).filter(i=>NOISE_TYPES.has(i.type)).forEach(i=>{
      rows.push({
        Tanggal:fmtDate(r.date),
        Zona:r.zone,
        Team:r.teamName,
        'Jenis Masalah':issueTypeName(i.type),
        Lokasi:i.locationName||'—',
        Detail:i.message,
        'Tindakan':i.recommendation||'—',
        'PairId (teknis)':i.metrics?.pairId||'—',
      });
    });
  });
  dlCSV(`laporan_data_${S.zoneData?.date}_${S.zoneData?.zone}.csv`,rows);
}

async function exportExecutiveSummary(){
  const all=await loadAllZones();
  if(!all||!all.length){toast('Gagal load data zona.');return;}
  const rows=all.map(({zone,data})=>{
    const routes=data.routes||[];
    const actionable=(data.issues||[]).filter(i=>!NOISE_TYPES.has(i.type));
    const critical=routes.filter(r=>r.riskLevel?.toLowerCase().includes('critical'));
    const review=routes.filter(r=>r.riskLevel?.toLowerCase().includes('needs'));
    return{
      Tanggal:fmtDate(data.date),
      Zona:zone,
      'Total Team':routes.length,
      'Status Kritis':critical.length,
      'Perlu Ditinjau':review.length,
      'Temuan Tinggi':actionable.filter(i=>i.severity==='high').length,
      'Temuan Sedang':actionable.filter(i=>i.severity==='medium').length,
      'Team Kritis':critical.map(r=>r.lead||r.teamName).join('; ')||'—',
    };
  }).sort((a,b)=>b['Status Kritis']-a['Status Kritis']||b['Temuan Tinggi']-a['Temuan Tinggi']);
  dlCSV(`summary_eksekutif_${$('dateSelect').value}.csv`,rows);
}

function exportSummaryRaw(){
  dlCSV(`audit_summary_${S.zoneData?.date}_${S.zoneData?.zone}.csv`,
    (S.zoneData?.routes||[]).map(r=>({
      Tanggal:r.date,Zona:r.zone,Team:r.teamName,'PIC Aplikasi':r.lead,
      Visit:r.visitCount,Job:r.jobCount,Done:r.doneCount||0,
      High:(r.issues||[]).filter(i=>i.severity==='high').length,
      Medium:(r.issues||[]).filter(i=>i.severity==='medium').length,
      Low:(r.issues||[]).filter(i=>i.severity==='low').length,
      RiskScore:r.riskScore,RiskLevel:r.riskLevel,
    })));
}

function exportIssuesRaw(){
  dlCSV(`issue_evidence_${S.zoneData?.date}_${S.zoneData?.zone}.csv`,
    (S.zoneData?.issues||[]).map(i=>{
      const r=routeById(i.routeId)||{};
      const fu=getFu(i.id);
      return{
        Tanggal:r.date,Zona:r.zone||S.zoneData.zone,Team:r.teamName||'','PIC Aplikasi':r.lead||'',
        IssueType:i.type,Severity:i.severity,VisitSeq:i.visitSeq||'',Lokasi:i.locationName||'',
        Message:i.message||'',Recommendation:i.recommendation||'',
        Actual:i.metrics?.actualDurationMin??i.metrics?.actualGapMin??i.metrics?.actualStart??'',
        Expected:i.metrics?.expectedMin??i.metrics?.expectedTravelMin??i.metrics?.expectedLatest??'',
        DeltaMin:i.metrics?.deltaMin??'',
        FollowupStatus:fu.status,FollowupNote:fu.note||'',
      };
    }));
}

function exportRouteRaw(){
  const r=routeById(S.selectedRouteId);if(!r){toast('Pilih route dulu.');return;}
  const rows=[];
  (r.visits||[]).forEach(v=>{
    (v.jobs?.length?v.jobs:[null]).forEach(j=>rows.push({
      Tanggal:r.date,Zona:r.zone,Team:r.teamName,'PIC Aplikasi':r.lead,
      Seq:v.seq,TimeStart:v.startTime,TimeEnd:v.endTime,Type:v.type,Location:v.locationName,
      Lat:v.lat??'',Lng:v.lng??'',JobType:j?.jobType||'',UnitQty:j?.unitQty??'',Status:j?.status||'',
      ActualMin:j?.effectiveDurationMin??'',BenchmarkMin:j?.benchmark?.expectedMin??'',
      Notes:j?.notes||'',ProblemNotes:j?.problemNotes||'',
    }));
  });
  dlCSV(`route_${r.date}_${r.zone}_${r.routeId}.csv`,rows);
}


  window.csvEsc=csvEsc;
  window.dlCSV=dlCSV;
  window.visitNotesString=visitNotesString;
  window.fmtDate=fmtDate;
  window.severityLabel=severityLabel;
  window.issueTypeName=issueTypeName;
  window.printReport=printReport;
  window.exportFieldReport=exportFieldReport;
  window.exportDataQuality=exportDataQuality;
  window.exportExecutiveSummary=exportExecutiveSummary;
  window.exportSummaryRaw=exportSummaryRaw;
  window.exportIssuesRaw=exportIssuesRaw;
  window.exportRouteRaw=exportRouteRaw;
})();
