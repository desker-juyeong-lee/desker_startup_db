"use client";
import { useState, useRef, useCallback, useEffect } from "react";
import { parseCSVText, toCSVText } from "@/lib/utils";

type RowStatus = "wait"|"proc"|"done"|"error"|"cached"|"skip";
interface RowState { name:string; status:RowStatus; address?:string; hire_count?:number; mate?:string; error?:string; }
interface CacheEntry { address:string; hire_count:number; mate:string; date:string; }

const today = new Date().toISOString().slice(0,10);
const BATCH_SIZE = 10; // API 절약: 동시 10개로 줄임
const BATCH_DELAY = 2000; // 배치 간 2초 딜레이 (rate limit 방지)
const CACHE_KEY = "startup_db_cache";

const MATE_ORDER = ["DM에스앤피","DM대전둔산2","DM오피스그룹","DM프로젝트오피스","DM드림OC","DM부산센텀","DM공간플러스","DM대구칠성","DM송파문정","DM광주남구2"];
const MATE_COLORS:Record<string,string> = {
  "DM에스앤피":"#534AB7","DM대전둔산2":"#0F6E56","DM오피스그룹":"#993C1D","DM프로젝트오피스":"#185FA5",
  "DM드림OC":"#854F0B","DM부산센텀":"#993556","DM공간플러스":"#3B6D11","DM대구칠성":"#636058","DM송파문정":"#A32D2D","DM광주남구2":"#0C447C",
};

// 기업명 유효성 검증 + 이유 반환
function getSkipReason(name:string):string|null {
  if(!name||name.trim().length===0) return "빈 값";
  const n=name.trim();
  if(n.length<2) return "너무 짧음";
  if(n.length>50) return "너무 긴 텍스트 (칸 밀림)";
  if(n.includes(',')) return "쉼표 포함";
  if(/^\d+$/.test(n)) return "숫자만";
  if(/\d+\.?\d*(억원|만원|억|조)/.test(n)) return "금액 패턴";
  const stageKw=["seed","series","pre-ipo","ipo","pre-a","pre-b","비공개","series a","series b","series c","series d","series e"];
  if(stageKw.some(k=>n.toLowerCase()===k)) return "투자단계 키워드";
  if(/^\d+명$/.test(n)) return "인원수 패턴";
  return null;
}
function isValidCompanyName(name:string):boolean { return getSkipReason(name)===null; }

// 주소 상세도 확인 (동/로/길 없으면 불완전)
function isAddressIncomplete(addr:string):boolean {
  if(!addr||addr.trim().length===0) return true;
  return !/[동로길]/.test(addr);
}

function loadCache():Record<string,CacheEntry> { try{return JSON.parse(localStorage.getItem(CACHE_KEY)||"{}");}catch{return {};} }
function saveCache(c:Record<string,CacheEntry>) { try{localStorage.setItem(CACHE_KEY,JSON.stringify(c));}catch{} }

export default function Home() {
  const [rows,setRows]=useState<string[][]>([]);
  const [header,setHeader]=useState<string[]>([]);
  const [rowStates,setRowStates]=useState<RowState[]>([]);
  const [running,setRunning]=useState(false);
  const [paused,setPaused]=useState(false);
  const [logs,setLogs]=useState<{msg:string;type:string}[]>([]);
  const [doneCount,setDoneCount]=useState(0);
  const [errCount,setErrCount]=useState(0);
  const [cachedCount,setCachedCount]=useState(0);
  const [cacheSize,setCacheSize]=useState(0);
  const [mateCounts,setMateCounts]=useState<Record<string,number>>({});
  const [activeTab,setActiveTab]=useState<"table"|"dashboard"|"mate"|"cache">("table");
  const [skippedCount,setSkippedCount]=useState(0);
  const [apiCallCount,setApiCallCount]=useState(0);
  const [cacheSearch,setCacheSearch]=useState("");
  const [cacheEntries,setCacheEntries]=useState<[string,CacheEntry][]>([]);
  const [selectedMate,setSelectedMate]=useState<string|null>(null);
  const [analysisResult,setAnalysisResult]=useState<{
    total:number; valid:number; skipList:{name:string;reason:string}[];
    cacheHit:number; toFetch:number;
    duplicates:{name:string;count:number}[];
  }|null>(null);
  const [analysisConfirmed,setAnalysisConfirmed]=useState(false);
  const pauseRef=useRef(false);
  const stopRef=useRef(false);
  const rowsRef=useRef<string[][]>([]);
  const cacheRef=useRef<Record<string,CacheEntry>>({});
  const fileInputRef=useRef<HTMLInputElement>(null);

  useEffect(()=>{
    const c=loadCache();
    cacheRef.current=c;
    setCacheSize(Object.keys(c).length);
    setCacheEntries(Object.entries(c).sort((a,b)=>b[1].date.localeCompare(a[1].date)));
  },[]);

  function refreshCacheEntries(){
    const e=Object.entries(cacheRef.current).sort((a,b)=>b[1].date.localeCompare(a[1].date));
    setCacheEntries(e); setCacheSize(e.length);
  }

  function calcMateCounts(r:string[][]){
    const c:Record<string,number>={};
    for(const row of r){const m=(row[10]||"").trim();if(m)c[m]=(c[m]||0)+1;}
    setMateCounts(c);
  }

  const addLog=useCallback((msg:string,type="")=>{setLogs(l=>[...l.slice(-300),{msg,type}]);},[]);

  function processCSVText(text: string) {
    const parsed=parseCSVText(text);
    if(parsed.length<2) return;
    const hdr=[...parsed[0]];
    while(hdr.length<12)hdr.push("");
    hdr[8]=hdr[8]||"최근 1년 채용건수"; hdr[9]=hdr[9]||"본사 지역"; hdr[10]=hdr[10]||"MATE 매칭"; hdr[11]=hdr[11]||"업데이트 일자";
    setHeader(hdr);
    const dataRows=parsed.slice(1).map(r=>{while(r.length<12)r.push("");return r;});
    rowsRef.current=dataRows.map(r=>[...r]);
    const cache=cacheRef.current;

    // ── 분석 단계: 삭제/캐시/신규 분류 ──
    const skipList:{name:string;reason:string}[]=[];
    let cacheHit=0, toFetch=0;
    const initStates:RowState[]=dataRows.map((r,i)=>{
      const name=(r[0]||"").replace(/\n[\s\S]*/g,"").trim();
      const skipReason=getSkipReason(name);
      if(skipReason){skipList.push({name:name.slice(0,30)||"(빈값)",reason:skipReason});return{name,status:"skip"};}
      const wasError=(r[11]||"").includes("(오류)");
      if(wasError){toFetch++;return{name,status:"wait"};}
      const cached=cache[name];
      if(cached){
        rowsRef.current[i][8]=String(cached.hire_count);
        rowsRef.current[i][9]=cached.address;
        rowsRef.current[i][10]=cached.mate;
        rowsRef.current[i][11]=cached.date+"(캐시)";
        cacheHit++;
        return{name,status:"cached",address:cached.address,hire_count:cached.hire_count,mate:cached.mate};
      }
      toFetch++;
      return{name,status:"wait"};
    });

    // 중복 기업명 감지
    const nameCount:Record<string,number>={};
    initStates.forEach(s=>{if(s.status!=="skip"&&s.name)nameCount[s.name]=(nameCount[s.name]||0)+1;});
    const duplicates=Object.entries(nameCount).filter(([,c])=>c>1).map(([name,count])=>({name,count})).sort((a,b)=>b.count-a.count);

    // 중복 기업은 첫 번째만 남기고 나머지 skip 처리
    const seenNames=new Set<string>();
    const dedupedStates=initStates.map(s=>{
      if(s.status==="skip") return s;
      if(!s.name) return s;
      if(seenNames.has(s.name)) return{...s,status:"skip" as RowStatus};
      seenNames.add(s.name);
      return s;
    });
    const dupSkipCount=dedupedStates.filter((s,i)=>s.status==="skip"&&initStates[i].status!=="skip").length;

    setRows([...rowsRef.current]);
    setRowStates(dedupedStates);
    calcMateCounts(rowsRef.current);
    setLogs([]); setDoneCount(0); setErrCount(0); setCachedCount(cacheHit); setSkippedCount(skipList.length+dupSkipCount); setApiCallCount(0);
    setAnalysisConfirmed(false);
    setAnalysisResult({total:dataRows.length, valid:dataRows.length-skipList.length-dupSkipCount, skipList, cacheHit, toFetch:toFetch-dupSkipCount, duplicates});
    addLog(`분석 완료: 전체 ${dataRows.length}행 → 유효 ${dataRows.length-skipList.length-dupSkipCount}개 | 삭제 ${skipList.length}개 | 중복제거 ${dupSkipCount}개 | 캐시 ${cacheHit}개 | 신규조회 ${toFetch-dupSkipCount}개`,"ok");
  }

  function handleFile(file:File){
    // 1차: UTF-8 시도 → 한글 깨지면 EUC-KR로 재시도
    const tryRead = (encoding: string) => {
      const reader=new FileReader();
      reader.onload=(e)=>{
        const text=e.target?.result as string;
        // BOM 제거 후 깨짐 감지: 전체 텍스트에 replacement char(U+FFFD)가 많으면 인코딩 오류
        const clean = text.replace(/^\uFEFF/,"");
        const brokenRatio = (clean.match(/\uFFFD/g)||[]).length / Math.max(clean.length,1);
        if(encoding==="UTF-8" && brokenRatio > 0.01){
          // UTF-8 깨짐 → EUC-KR 재시도
          tryRead("EUC-KR");
          return;
        }
        processCSVText(clean);
      };
      reader.readAsText(file, encoding);
    };
    tryRead("UTF-8");
  }

  async function processOne(i:number,total:number,states:RowState[]):Promise<void>{
    const name=(rowsRef.current[i]?.[0]||"").replace(/\n[\s\S]*/g,"").trim();
    if(!name||!isValidCompanyName(name)) return;
    // 캐시 DB에 있는 기업 → 무조건 스킵, API 호출 없음
    if(states[i]?.status==="cached" || cacheRef.current[name]){
      setDoneCount(d=>d+1);
      return;
    }
    setRowStates(prev=>prev.map((s,idx)=>idx===i?{...s,status:"proc"}:s));
    const wasError=(rowsRef.current[i][11]||"").includes("(오류)");
    setApiCallCount(c=>c+1);
    addLog(`[${i+1}/${total}] ${name}${wasError?" (재조회)":""} 조회 중...`,"info");
    try{
      const res=await fetch("/api/process",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({companyName:name})});
      const data=await res.json();
      if(!res.ok||data.error) throw new Error(data.error||`HTTP ${res.status}`);

      // 채용 0건 → 삭제
      if(data.noHire){
        rowsRef.current[i][11]=today+"(채용없음-삭제)";
        setRows([...rowsRef.current]);
        setRowStates(prev=>prev.map((s,idx)=>idx===i?{...s,status:"skip",error:"채용 0건으로 삭제"}:s));
        addLog(`  🗑 ${name} — 채용 0건, 리스트에서 삭제`,"warn");
        setDoneCount(d=>d+1); return;
      }
      // 주소 미확인 → 삭제
      if(data.noAddress){
        rowsRef.current[i][11]=today+"(주소없음-삭제)";
        setRows([...rowsRef.current]);
        setRowStates(prev=>prev.map((s,idx)=>idx===i?{...s,status:"skip",error:"주소 미확인으로 삭제"}:s));
        addLog(`  🗑 ${name} — 주소 미확인, 리스트에서 삭제`,"warn");
        setDoneCount(d=>d+1); return;
      }

      rowsRef.current[i]=[...rowsRef.current[i]];
      if(data.hire_count!==undefined) rowsRef.current[i][8]=String(data.hire_count);
      if(data.address) rowsRef.current[i][9]=data.address;
      if(data.mate) rowsRef.current[i][10]=data.mate;
      rowsRef.current[i][11]=today;
      cacheRef.current[name]={address:data.address||"",hire_count:data.hire_count??0,mate:data.mate||"",date:today};
      saveCache(cacheRef.current); refreshCacheEntries();
      setRows([...rowsRef.current]); calcMateCounts(rowsRef.current);
      setRowStates(prev=>prev.map((s,idx)=>idx===i?{...s,status:"done",address:data.address,hire_count:data.hire_count,mate:data.mate}:s));
      addLog(`  ✅ ${name} | 📍${data.address||"주소없음"} | 💼${data.hire_count}건 | 🏢${data.mate||"-"}`,"ok");
      setDoneCount(d=>d+1);
    }catch(e:unknown){
      const errMsg=e instanceof Error?e.message:String(e);
      rowsRef.current[i]=[...rowsRef.current[i]]; rowsRef.current[i][11]=today+"(오류)";
      setRows([...rowsRef.current]);
      setRowStates(prev=>prev.map((s,idx)=>idx===i?{...s,status:"error",error:errMsg}:s));
      addLog(`  ❌ ${name} 오류: ${errMsg}`,"err"); setErrCount(c=>c+1);
    }
  }

  async function runAll(){
    setRunning(true); stopRef.current=false; pauseRef.current=false; setDoneCount(0); setApiCallCount(0);
    const total=rowsRef.current.length;
    const snapshot=[...rowStates];
    let i=0;
    while(i<total){
      if(stopRef.current) break;
      while(pauseRef.current){await new Promise(r=>setTimeout(r,300));if(stopRef.current)break;}
      const batchEnd=Math.min(i+BATCH_SIZE,total);
      const batch=Array.from({length:batchEnd-i},(_,k)=>i+k);
      const newBatch=batch.filter(idx=>{
        const name=(rowsRef.current[idx]?.[0]||"").replace(/\n[\s\S]*/g,"").trim();
        const isErr=(rowsRef.current[idx]?.[11]||"").includes("(오류)");
        return isValidCompanyName(name)&&(!cacheRef.current[name]||isErr);
      });
      if(newBatch.length>0) addLog(`── 배치 ${Math.floor(i/BATCH_SIZE)+1}: ${newBatch.length}개 조회 / ${batch.length-newBatch.length}개 캐시/스킵 ──`,"info");
      await Promise.all(batch.map(idx=>processOne(idx,total,snapshot)));
      i=batchEnd;
      // 배치 간 딜레이 — rate limit 방지
      if(i<total && newBatch.length>0) await new Promise(r=>setTimeout(r,BATCH_DELAY));
    }
    setRunning(false); setPaused(false); addLog("🎉 전체 완료!","ok");
  }

  function handlePause(){
    if(!paused){pauseRef.current=true;setPaused(true);addLog("⏸ 일시정지","warn");}
    else{pauseRef.current=false;setPaused(false);addLog("▶ 재개","info");}
  }
  function handleStop(){stopRef.current=true;setRunning(false);setPaused(false);addLog("⏹ 중지됨","warn");}

  // 주소없음 삭제 행 제외한 CSV 다운로드
  function handleDownload(){
    const exportRows=rowsRef.current.filter(r=>!(r[11]||"").includes("주소없음-삭제")&&!(r[11]||"").includes("채용없음-삭제")).map(r=>{
      const nr=[...r]; if(nr[11])nr[11]=nr[11].replace("(캐시)",""); return nr;
    });
    const csv="\uFEFF"+toCSVText([header,...exportRows]);
    const blob=new Blob([csv],{type:"text/csv;charset=utf-8;"});
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a");a.href=url;a.download="스타트업_투자_채용_현황_업데이트.csv";a.click();
    URL.revokeObjectURL(url);
  }

  function handleCacheDownload(){
    const hdr=["기업명","본사 지역","MATE 매칭","최근 1년 채용건수","업데이트 일자"];
    const dr=cacheEntries.map(([name,e])=>[name,e.address,e.mate,String(e.hire_count),e.date]);
    const csv="\uFEFF"+toCSVText([hdr,...dr]);
    const blob=new Blob([csv],{type:"text/csv;charset=utf-8;"});
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a");a.href=url;a.download="스타트업_캐시_DB.csv";a.click();
    URL.revokeObjectURL(url);
  }

  function handleDeleteCacheEntry(name:string){delete cacheRef.current[name];saveCache(cacheRef.current);refreshCacheEntries();}
  function handleClearCache(){if(!confirm(`캐시 ${cacheSize}개를 모두 삭제할까요?`))return;cacheRef.current={};saveCache({});refreshCacheEntries();addLog("🗑 캐시 초기화","warn");}

  const total=rows.length;
  const procCount=rowStates.filter(s=>s.status==="proc").length;
  const validTotal=total-skippedCount;
  const pct=validTotal>0?Math.round(((doneCount+cachedCount)/validTotal)*100):0;
  const totalMateMatched=Object.values(mateCounts).reduce((a,b)=>a+b,0);
  const maxMateCount=Math.max(...Object.values(mateCounts),1);
  const filteredCache=cacheSearch.trim()?cacheEntries.filter(([name,e])=>name.includes(cacheSearch)||e.address.includes(cacheSearch)||e.mate.includes(cacheSearch)):cacheEntries;
  const S=styles;

  // MATE별 구/동 분포 계산
  function getMateRegionBreakdown(mate:string){
    const companies=rows.filter(r=>(r[10]||"").trim()===mate&&!(r[11]||"").includes("주소없음"));
    const guCount:Record<string,string[]>={};
    const dongCount:Record<string,number>={};
    for(const r of companies){
      const addr=(r[9]||"").trim();
      const name=(r[0]||"").replace(/\n[\s\S]*/g,"").trim();
      // 구 추출
      const guMatch=addr.match(/([가-힣]+구)/);
      const gu=guMatch?guMatch[1]:"미분류";
      if(!guCount[gu])guCount[gu]=[];
      guCount[gu].push(name);
      // 동 추출
      const dongMatch=addr.match(/([가-힣]+동)/);
      const dong=dongMatch?dongMatch[1]:"";
      if(dong)dongCount[dong]=(dongCount[dong]||0)+1;
    }
    return{companies,guCount,dongCount};
  }

  return (
    <div style={S.page}>
      <div style={S.card}>
        {/* 헤더 */}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:"1.25rem"}}>
          <div>
            <h1 style={S.h1}>스타트업 DB 자동 업데이트</h1>
            <p style={S.sub}>비즈노 · 나이스 · 사람인 · 원티드 자동 조회 → I·J·K·L열 기입 | 20개 동시 처리</p>
          </div>
          <div style={{textAlign:"right"}}>
            <div style={{fontSize:11,color:"#888",marginBottom:2}}>로컬 캐시</div>
            <div style={{fontSize:18,fontWeight:600,color:"#534AB7",cursor:"pointer"}} onClick={()=>setActiveTab("cache")}>{cacheSize}개 →</div>
          </div>
        </div>

        {/* 업로드 */}
        <div style={S.dropZone} onClick={()=>fileInputRef.current?.click()} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();const f=e.dataTransfer.files[0];if(f)handleFile(f);}}>
          <div style={{fontSize:28,marginBottom:4}}>📂</div>
          <div style={{fontSize:14,color:"#666"}}>CSV 파일 드래그 또는 클릭하여 업로드</div>
          <input ref={fileInputRef} type="file" accept=".csv" style={{display:"none"}} onChange={e=>{const f=e.target.files?.[0];if(f)handleFile(f);}} />
        </div>

        {/* 통계 */}
        {total>0&&(
          <div style={{display:"grid",gridTemplateColumns:"repeat(6,1fr)",gap:8,marginBottom:"1rem"}}>
            {([["전체행",total,"#444"],["유효기업",validTotal,"#333"],["완료",doneCount,"#0a7c55"],["캐시",cachedCount,"#534AB7"],["API호출",apiCallCount,"#185FA5"],["오류",errCount,"#a02020"]] as [string,number,string][]).map(([label,val,color])=>(
              <div key={label} style={S.statCard}><div style={{fontSize:11,color:"#888"}}>{label}</div><div style={{fontSize:18,fontWeight:600,color}}>{val}</div></div>
            ))}
          </div>
        )}

        {/* ── 분석 결과 패널 ── */}
        {analysisResult&&!analysisConfirmed&&(
          <div style={{border:"1.5px solid #534AB7",borderRadius:12,overflow:"hidden",marginBottom:16}}>
            <div style={{background:"#534AB7",padding:"10px 16px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <span style={{color:"white",fontWeight:600,fontSize:14}}>📋 파일 분석 결과 — 검색 전 확인</span>
              <span style={{color:"rgba(255,255,255,0.8)",fontSize:12}}>총 {analysisResult.total}행</span>
            </div>
            <div style={{padding:"14px 16px",background:"white"}}>
              {/* 요약 카드 */}
              <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:14}}>
                {([
                  ["전체 행",analysisResult.total+"개","#444"],
                  ["유효 기업",analysisResult.valid+"개","#0a7c55"],
                  ["중복 제거",analysisResult.duplicates.length+"건","#993C1D"],
                  ["캐시(조회생략)",analysisResult.cacheHit+"개","#534AB7"],
                  ["신규 조회 필요",analysisResult.toFetch+"개","#854F0B"],
                ] as [string,string,string][]).map(([l,v,c])=>(
                  <div key={l} style={{background:"#f7f7f7",borderRadius:8,padding:"0.6rem 0.8rem"}}>
                    <div style={{fontSize:11,color:"#888"}}>{l}</div>
                    <div style={{fontSize:18,fontWeight:700,color:c}}>{v}</div>
                  </div>
                ))}
              </div>
              {/* 삭제 목록 */}
              {analysisResult.skipList.length>0&&(
                <div style={{marginBottom:14}}>
                  <div style={{fontSize:12,fontWeight:600,color:"#8a5200",marginBottom:8}}>
                    ⚠ 아래 {analysisResult.skipList.length}개 행은 삭제 규칙에 해당하여 조회에서 제외됩니다
                  </div>
                  <div style={{background:"#fffbe6",border:"1px solid #ffe58f",borderRadius:8,padding:"10px 12px",maxHeight:180,overflowY:"auto"}}>
                    <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                      <thead><tr>
                        <th style={{textAlign:"left",padding:"4px 8px",color:"#8a5200",fontWeight:500,borderBottom:"1px solid #ffe58f"}}>행 내용</th>
                        <th style={{textAlign:"left",padding:"4px 8px",color:"#8a5200",fontWeight:500,borderBottom:"1px solid #ffe58f",whiteSpace:"nowrap"}}>제외 이유</th>
                      </tr></thead>
                      <tbody>
                        {analysisResult.skipList.map((s,i)=>(
                          <tr key={i}>
                            <td style={{padding:"3px 8px",color:"#555",maxWidth:240,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{s.name||"(빈값)"}</td>
                            <td style={{padding:"3px 8px",whiteSpace:"nowrap"}}><span style={{background:"#f0e0b0",color:"#8a5200",borderRadius:4,padding:"1px 7px",fontSize:11}}>{s.reason}</span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              {/* 중복 목록 */}
              {analysisResult.duplicates.length>0&&(
                <div style={{marginBottom:14}}>
                  <div style={{fontSize:12,fontWeight:600,color:"#993C1D",marginBottom:8}}>
                    🔁 아래 {analysisResult.duplicates.length}개 기업명이 중복 — 첫 번째 행만 조회, 나머지는 제외
                  </div>
                  <div style={{background:"#fef2f0",border:"1px solid #fcc",borderRadius:8,padding:"10px 12px",maxHeight:140,overflowY:"auto"}}>
                    <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                      <thead><tr>
                        <th style={{textAlign:"left",padding:"4px 8px",color:"#993C1D",fontWeight:500,borderBottom:"1px solid #fcc"}}>중복 기업명</th>
                        <th style={{textAlign:"right",padding:"4px 8px",color:"#993C1D",fontWeight:500,borderBottom:"1px solid #fcc",whiteSpace:"nowrap"}}>중복 횟수</th>
                      </tr></thead>
                      <tbody>
                        {analysisResult.duplicates.map((d,i)=>(
                          <tr key={i}>
                            <td style={{padding:"3px 8px",color:"#555"}}>{d.name}</td>
                            <td style={{padding:"3px 8px",textAlign:"right"}}><span style={{background:"#fcc",color:"#993C1D",borderRadius:4,padding:"1px 8px",fontSize:11,fontWeight:600}}>{d.count}회</span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              {/* 확인 버튼 */}
              <div style={{display:"flex",gap:8,alignItems:"center"}}>
                <button style={{background:"#534AB7",color:"white",border:"none",borderRadius:8,padding:"0 1.4rem",height:38,fontSize:14,cursor:"pointer",fontWeight:600}} onClick={()=>setAnalysisConfirmed(true)}>
                  ✓ 확인 — 검색 시작 준비
                </button>
                <span style={{fontSize:12,color:"#888"}}>위 내용을 확인 후 클릭하세요</span>
              </div>
            </div>
          </div>
        )}
        {analysisResult&&analysisConfirmed&&analysisResult.skipList.length>0&&(
          <div style={{background:"#fffbe6",border:"1px solid #ffe58f",borderRadius:8,padding:"8px 14px",fontSize:12,color:"#8a5200",marginBottom:12}}>
            ⚠ {analysisResult.skipList.length}개 행 제외됨 (쉼표/칸밀림/숫자 등) — <button onClick={()=>setAnalysisConfirmed(false)} style={{background:"none",border:"none",color:"#534AB7",cursor:"pointer",fontSize:12,padding:0,textDecoration:"underline"}}>다시 보기</button>
          </div>
        )}

        {/* 진행바 */}
        {total>0&&(
          <div style={{marginBottom:14}}>
            <div style={{display:"flex",justifyContent:"space-between",fontSize:12,color:"#666",marginBottom:4}}>
              <span>{running?`처리 중 (${doneCount+cachedCount}/${validTotal})`:doneCount+cachedCount>=validTotal&&validTotal>0?"✅ 완료":"대기"}</span>
              <span>{pct}%</span>
            </div>
            <div style={S.progBar}><div style={{...S.progFill,width:pct+"%"}} /></div>
          </div>
        )}

        {/* 버튼 */}
        {total>0&&(
          <div style={S.btnRow}>
            {!running?(<button style={{...S.btnPrimary,opacity:analysisConfirmed?1:0.4,cursor:analysisConfirmed?"pointer":"not-allowed"}} onClick={()=>{if(analysisConfirmed)runAll();}} disabled={!analysisConfirmed}>▶ 검색 시작</button>):(
              <><button style={S.btnSecondary} onClick={handlePause}>{paused?"▶ 재개":"⏸ 일시정지"}</button>
              <button style={{...S.btnSecondary,color:"#a02020"}} onClick={handleStop}>⏹ 중지</button></>
            )}
            <button style={S.btnSecondary} onClick={handleDownload} disabled={total===0}>⬇ CSV 다운로드</button>
          </div>
        )}

        {/* 로그 */}
        {logs.length>0&&(
          <div style={S.logBox} ref={el=>{if(el)el.scrollTop=el.scrollHeight;}}>
            {logs.map((l,i)=><div key={i} style={{...S.logLine,color:l.type==="ok"?"#0a7c55":l.type==="err"?"#a02020":l.type==="warn"?"#8a5200":l.type==="info"?"#2a44a0":"#666"}}>{l.msg}</div>)}
          </div>
        )}

        {/* 탭 */}
        <div style={{display:"flex",gap:0,marginBottom:16,borderBottom:"1px solid #eee"}}>
          {([
            ["table","📋 기업 목록",total>0],
            ["dashboard","📊 MATE 현황",total>0],
            ["mate","🏢 MATE 상세",total>0],
            ["cache",`💾 캐시 DB (${cacheSize})`,true],
          ] as [string,string,boolean][]).map(([tab,label,show])=>show&&(
            <button key={tab} onClick={()=>setActiveTab(tab as "table"|"dashboard"|"mate"|"cache")} style={{
              background:"none",border:"none",borderBottom:activeTab===tab?"2px solid #534AB7":"2px solid transparent",
              color:activeTab===tab?"#534AB7":"#888",fontWeight:activeTab===tab?600:400,
              fontSize:13,padding:"8px 14px",cursor:"pointer",marginBottom:-1,whiteSpace:"nowrap",
            }}>{label}</button>
          ))}
        </div>

        {/* ── 탭1: 기업 목록 ── */}
        {activeTab==="table"&&total>0&&(
          <div style={S.tableWrap}>
            <table style={S.table}>
              <thead><tr>{["상태","기업명","채용건수(I)","본사지역(J)","MATE(K)","업데이트(L)","오류내용"].map(h=><th key={h} style={S.th}>{h}</th>)}</tr></thead>
              <tbody>
                {rows.map((row,i)=>{
                  const st=rowStates[i];
                  const name=(row[0]||"").replace(/\n[\s\S]*/g,"").trim();
                  const isSkip=st?.status==="skip"||!isValidCompanyName(name);
                  const isCached=st?.status==="cached",isDone=st?.status==="done",isErr=st?.status==="error",isProc=st?.status==="proc";
                  const isDeleted=(row[11]||"").includes("주소없음-삭제")||(row[11]||"").includes("채용없음-삭제");
                  const bg=isDeleted?"#fff0f0":isSkip?"#f9f9f9":isDone?"#f0faf5":isCached?"#f3f0ff":isErr?"#fff5f5":isProc?"#fffbe6":"white";
                  const color=isDeleted?"#a02020":isSkip?"#ccc":isDone?"#0a7c55":isCached?"#534AB7":isErr?"#a02020":isProc?"#8a5200":"#999";
                  const label=isDeleted?"🗑 삭제":isSkip?"⏭ 스킵":isDone?"✅ 완료":isCached?"💾 캐시":isErr?"❌ 오류":isProc?"⏳ 처리중":"⬜ 대기";
                  const mateColor=MATE_COLORS[row[10]]||"#888";
                  return(
                    <tr key={i} style={{background:bg,opacity:isSkip&&!isDeleted?0.45:1}}>
                      <td style={{...S.td,color,fontWeight:500,whiteSpace:"nowrap"}}>{label}</td>
                      <td style={{...S.td,maxWidth:140}}>{name.slice(0,20)}</td>
                      <td style={{...S.td,textAlign:"center"}}>{row[8]||"-"}</td>
                      <td style={{...S.td,maxWidth:160}}>{row[9]||"-"}</td>
                      <td style={{...S.td,maxWidth:130}}>{row[10]?<span style={{background:mateColor+"18",color:mateColor,borderRadius:99,padding:"1px 8px",fontSize:11,fontWeight:500}}>{row[10]}</span>:"-"}</td>
                      <td style={{...S.td,whiteSpace:"nowrap"}}>{(row[11]||"-").replace("(캐시)","")}</td>
                      <td style={{...S.td,maxWidth:220,color:"#a02020",fontSize:11}}>{isErr?(st?.error||"-"):isDeleted?((row[11]||"").includes("채용없음")?"채용 0건":"주소 미확인"):"-"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* ── 탭2: MATE 현황 (바 차트) ── */}
        {activeTab==="dashboard"&&total>0&&(
          <div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10,marginBottom:20}}>
              {([["전체 기업",total+"개","#444"],["MATE 매칭",totalMateMatched+"개","#0a7c55"],["미매칭",(validTotal-totalMateMatched)+"개","#8a5200"]] as [string,string,string][]).map(([l,v,c])=>(
                <div key={l} style={{background:"#f7f7f7",borderRadius:10,padding:"1rem"}}><div style={{fontSize:12,color:"#888",marginBottom:4}}>{l}</div><div style={{fontSize:24,fontWeight:700,color:c}}>{v}</div></div>
              ))}
            </div>
            <div style={{background:"#fafafa",borderRadius:10,padding:"1.25rem",border:"1px solid #eee",marginBottom:20}}>
              <div style={{fontSize:13,fontWeight:600,color:"#333",marginBottom:16}}>MATE별 매칭 기업 수</div>
              <div style={{display:"flex",flexDirection:"column",gap:10}}>
                {MATE_ORDER.map(mate=>{
                  const count=mateCounts[mate]||0;
                  const barPct=Math.round((count/maxMateCount)*100);
                  const color=MATE_COLORS[mate]||"#888";
                  return(
                    <div key={mate} style={{cursor:"pointer"}} onClick={()=>{setSelectedMate(mate);setActiveTab("mate");}}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
                        <span style={{fontSize:12,color:"#444",fontWeight:500,minWidth:150}}>{mate}</span>
                        <span style={{fontSize:13,fontWeight:700,color,minWidth:32,textAlign:"right"}}>{count}개</span>
                      </div>
                      <div style={{height:10,background:"#eee",borderRadius:5,overflow:"hidden"}}>
                        <div style={{height:"100%",width:count>0?Math.max(barPct,2)+"%":"0%",background:color,borderRadius:5,transition:"width .4s"}} />
                      </div>
                    </div>
                  );
                })}
              </div>
              <div style={{fontSize:11,color:"#aaa",marginTop:12}}>바 클릭 시 상세 보기로 이동</div>
            </div>
          </div>
        )}

        {/* ── 탭3: MATE 상세 ── */}
        {activeTab==="mate"&&total>0&&(
          <div>
            {/* MATE 선택 버튼 */}
            <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:16}}>
              <button onClick={()=>setSelectedMate(null)} style={{...S.btnSecondary,background:selectedMate===null?"#534AB7":"white",color:selectedMate===null?"white":"#333",fontSize:12,height:30,padding:"0 12px"}}>전체</button>
              {MATE_ORDER.filter(m=>mateCounts[m]>0).map(m=>{
                const color=MATE_COLORS[m]||"#888";
                const active=selectedMate===m;
                return(
                  <button key={m} onClick={()=>setSelectedMate(active?null:m)} style={{background:active?color:"white",color:active?"white":color,border:`1px solid ${color}`,borderRadius:8,fontSize:12,height:30,padding:"0 12px",cursor:"pointer",fontWeight:active?600:400}}>
                    {m} ({mateCounts[m]||0})
                  </button>
                );
              })}
            </div>

            {/* 선택된 MATE 또는 전체 */}
            {(selectedMate?[selectedMate]:MATE_ORDER.filter(m=>mateCounts[m]>0)).map(mate=>{
              const color=MATE_COLORS[mate]||"#888";
              const {companies,guCount}=getMateRegionBreakdown(mate);
              if(companies.length===0) return null;
              return(
                <div key={mate} style={{marginBottom:24,border:"1px solid #eee",borderRadius:12,overflow:"hidden"}}>
                  {/* MATE 헤더 */}
                  <div style={{background:color,padding:"12px 16px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                    <span style={{color:"white",fontWeight:600,fontSize:15}}>{mate}</span>
                    <span style={{background:"rgba(255,255,255,0.25)",color:"white",borderRadius:99,padding:"2px 12px",fontSize:13,fontWeight:700}}>{companies.length}개 기업</span>
                  </div>

                  {/* 구별 분포 */}
                  <div style={{padding:"12px 16px",background:"#fafafa",borderBottom:"1px solid #eee"}}>
                    <div style={{fontSize:12,fontWeight:500,color:"#666",marginBottom:8}}>구별 분포</div>
                    <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                      {Object.entries(guCount).sort((a,b)=>b[1].length-a[1].length).map(([gu,names])=>(
                        <div key={gu} style={{background:color+"15",border:`1px solid ${color}40`,borderRadius:8,padding:"4px 10px",fontSize:12}}>
                          <span style={{color,fontWeight:600}}>{gu}</span>
                          <span style={{color:"#666",marginLeft:4}}>{names.length}개</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* 기업 테이블 */}
                  <table style={{...S.table,fontSize:12}}>
                    <thead><tr>
                      {["기업명","본사 지역","최근 1년 채용건수","업데이트 일자"].map(h=><th key={h} style={S.th}>{h}</th>)}
                    </tr></thead>
                    <tbody>
                      {companies.map((r,ci)=>{
                        const name=(r[0]||"").replace(/\n[\s\S]*/g,"").trim();
                        return(
                          <tr key={ci} style={{background:ci%2===0?"white":"#fafafa"}}>
                            <td style={{...S.td,fontWeight:500,maxWidth:160}}>{name}</td>
                            <td style={{...S.td,maxWidth:180}}>{r[9]||"-"}</td>
                            <td style={{...S.td,textAlign:"center"}}>
                              <span style={{background:"#e8f5e9",color:"#2e7d32",borderRadius:99,padding:"1px 10px",fontSize:11,fontWeight:600}}>{r[8]||"0"}건</span>
                            </td>
                            <td style={{...S.td,whiteSpace:"nowrap",color:"#888",fontSize:11}}>{(r[11]||"-").replace("(캐시)","")}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              );
            })}
          </div>
        )}

        {/* ── 탭4: 캐시 DB ── */}
        {activeTab==="cache"&&(
          <div>
            <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:14,flexWrap:"wrap"}}>
              <input type="text" placeholder="기업명 · 지역 · MATE 검색..." value={cacheSearch} onChange={e=>setCacheSearch(e.target.value)}
                style={{flex:1,minWidth:200,height:34,border:"1px solid #ddd",borderRadius:8,padding:"0 12px",fontSize:13,outline:"none"}} />
              <button style={S.btnSecondary} onClick={handleCacheDownload} disabled={cacheEntries.length===0}>⬇ 캐시 CSV</button>
              {cacheSize>0&&<button style={{...S.btnSecondary,color:"#a02020"}} onClick={handleClearCache}>🗑 전체 초기화</button>}
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginBottom:14}}>
              {([["저장된 기업",cacheSize+"개","#534AB7"],["오늘 업데이트",cacheEntries.filter(([,e])=>e.date===today).length+"개","#0a7c55"],["검색 결과",filteredCache.length+"개","#444"]] as [string,string,string][]).map(([l,v,c])=>(
                <div key={l} style={S.statCard}><div style={{fontSize:11,color:"#888"}}>{l}</div><div style={{fontSize:18,fontWeight:600,color:c}}>{v}</div></div>
              ))}
            </div>
            {cacheEntries.length===0?(
              <div style={{textAlign:"center",padding:"3rem",color:"#aaa",fontSize:14}}><div style={{fontSize:36,marginBottom:8}}>💾</div>아직 캐시된 데이터가 없습니다.</div>
            ):(
              <div style={S.tableWrap}>
                <table style={S.table}>
                  <thead><tr>{["기업명","본사 지역","MATE 매칭","최근 1년 채용건수","업데이트 일자",""].map(h=><th key={h} style={S.th}>{h}</th>)}</tr></thead>
                  <tbody>
                    {filteredCache.map(([name,entry])=>{
                      const mateColor=MATE_COLORS[entry.mate]||"#888";
                      const isToday=entry.date===today;
                      return(
                        <tr key={name} style={{background:isToday?"#f0faf5":"white"}}>
                          <td style={{...S.td,fontWeight:500,maxWidth:160}}>{name}</td>
                          <td style={{...S.td,maxWidth:180}}>{entry.address||"-"}</td>
                          <td style={{...S.td,maxWidth:140}}>{entry.mate?<span style={{background:mateColor+"18",color:mateColor,borderRadius:99,padding:"1px 8px",fontSize:11,fontWeight:500}}>{entry.mate}</span>:"-"}</td>
                          <td style={{...S.td,textAlign:"center"}}><span style={{background:"#f0faf5",color:"#0a7c55",borderRadius:99,padding:"1px 10px",fontSize:12,fontWeight:600}}>{entry.hire_count}건</span></td>
                          <td style={{...S.td,whiteSpace:"nowrap"}}><span style={{color:isToday?"#0a7c55":"#888",fontSize:12}}>{isToday?"🟢 오늘":entry.date}</span></td>
                          <td style={{...S.td,textAlign:"center"}}><button onClick={()=>handleDeleteCacheEntry(name)} style={{background:"none",border:"none",cursor:"pointer",color:"#ccc",fontSize:14,padding:"0 4px"}} title="삭제">✕</button></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const styles:Record<string,React.CSSProperties>={
  page:{minHeight:"100vh",padding:"2rem 1rem",background:"#f5f5f5"},
  card:{maxWidth:980,margin:"0 auto",background:"white",borderRadius:12,padding:"2rem",boxShadow:"0 1px 4px rgba(0,0,0,.08)"},
  h1:{fontSize:22,fontWeight:600,margin:"0 0 4px"},
  sub:{fontSize:13,color:"#888",margin:0},
  dropZone:{border:"1.5px dashed #ccc",borderRadius:10,padding:"1.25rem",textAlign:"center",cursor:"pointer",background:"#fafafa",marginBottom:"1.25rem"},
  statCard:{background:"#f7f7f7",borderRadius:8,padding:"0.6rem 0.8rem"},
  progBar:{height:4,background:"#eee",borderRadius:2,overflow:"hidden"},
  progFill:{height:"100%",background:"#534AB7",borderRadius:2,transition:"width .3s"},
  btnRow:{display:"flex",gap:8,marginBottom:"1rem",flexWrap:"wrap"},
  btnPrimary:{background:"#534AB7",color:"white",border:"none",borderRadius:8,padding:"0 1.2rem",height:36,fontSize:13,cursor:"pointer",fontWeight:500},
  btnSecondary:{background:"white",color:"#333",border:"1px solid #ddd",borderRadius:8,padding:"0 1.1rem",height:36,fontSize:13,cursor:"pointer"},
  logBox:{background:"#f7f7f7",border:"1px solid #eee",borderRadius:8,padding:"0.75rem",maxHeight:160,overflowY:"auto",marginBottom:"1rem",fontFamily:"monospace"},
  logLine:{fontSize:12,lineHeight:1.9},
  tableWrap:{overflowX:"auto",border:"1px solid #eee",borderRadius:8},
  table:{width:"100%",borderCollapse:"collapse",fontSize:12},
  th:{background:"#f7f7f7",padding:"7px 10px",textAlign:"left",borderBottom:"1px solid #eee",fontWeight:500,fontSize:11,color:"#666",whiteSpace:"nowrap"},
  td:{padding:"6px 10px",borderBottom:"1px solid #f0f0f0",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"},
};
