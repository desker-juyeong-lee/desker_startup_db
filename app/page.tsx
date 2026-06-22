"use client";
import { useState, useRef, useCallback, useEffect } from "react";
import { parseCSVText, toCSVText } from "@/lib/utils";

type RowStatus = "wait" | "proc" | "done" | "error" | "cached";
interface RowState { name: string; status: RowStatus; address?: string; hire_count?: number; mate?: string; error?: string; }
interface CacheEntry { address: string; hire_count: number; mate: string; date: string; }

const today = new Date().toISOString().slice(0, 10);
const BATCH_SIZE = 20;
const CACHE_KEY = "startup_db_cache";

const MATE_ORDER = [
  "DM에스앤피","DM대전둔산2","DM오피스그룹","DM프로젝트오피스",
  "DM드림OC","DM부산센텀","DM공간플러스","DM대구칠성","DM송파문정","DM광주남구2",
];
const MATE_COLORS: Record<string,string> = {
  "DM에스앤피":"#534AB7","DM대전둔산2":"#0F6E56","DM오피스그룹":"#993C1D",
  "DM프로젝트오피스":"#185FA5","DM드림OC":"#854F0B","DM부산센텀":"#993556",
  "DM공간플러스":"#3B6D11","DM대구칠성":"#636058","DM송파문정":"#A32D2D","DM광주남구2":"#0C447C",
};

// 유효한 기업명 검증 - 칸 밀림 필터링
function isValidCompanyName(name: string): boolean {
  if (!name || name.trim().length === 0) return false;
  const n = name.trim();
  // 너무 짧거나 너무 김
  if (n.length < 2 || n.length > 50) return false;
  // 숫자로만 이루어진 경우
  if (/^\d+$/.test(n)) return false;
  // 금액 패턴 (억원, 만원 등)
  if (/\d+\.?\d*(억원|만원|억|조)/.test(n)) return false;
  // 투자단계 키워드만 있는 경우
  const stageKeywords = ["seed","series","pre-ipo","ipo","pre-a","pre-b","비공개","series a","series b","series c","series d","series e"];
  if (stageKeywords.some(k => n.toLowerCase() === k)) return false;
  // 매출액/고용인원 패턴
  if (/^\d+명$/.test(n)) return false;
  // 카테고리/키워드 패턴 (쉼표 포함 짧은 텍스트)
  if (n.includes(',') && n.length < 20) return false;
  return true;
}

function loadCache(): Record<string, CacheEntry> {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) || "{}"); } catch { return {}; }
}
function saveCache(cache: Record<string, CacheEntry>) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch {}
}

export default function Home() {
  const [rows, setRows] = useState<string[][]>([]);
  const [header, setHeader] = useState<string[]>([]);
  const [rowStates, setRowStates] = useState<RowState[]>([]);
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [logs, setLogs] = useState<{ msg: string; type: string }[]>([]);
  const [doneCount, setDoneCount] = useState(0);
  const [errCount, setErrCount] = useState(0);
  const [cachedCount, setCachedCount] = useState(0);
  const [cacheSize, setCacheSize] = useState(0);
  const [mateCounts, setMateCounts] = useState<Record<string, number>>({});
  const [activeTab, setActiveTab] = useState<"table"|"dashboard">("table");
  const [skippedCount, setSkippedCount] = useState(0);
  const pauseRef = useRef(false);
  const stopRef = useRef(false);
  const rowsRef = useRef<string[][]>([]);
  const cacheRef = useRef<Record<string, CacheEntry>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    cacheRef.current = loadCache();
    setCacheSize(Object.keys(cacheRef.current).length);
  }, []);

  function calcMateCounts(r: string[][]) {
    const counts: Record<string, number> = {};
    for (const row of r) {
      const m = (row[10] || "").trim();
      if (m) counts[m] = (counts[m] || 0) + 1;
    }
    setMateCounts(counts);
  }

  const addLog = useCallback((msg: string, type = "") => {
    setLogs(l => [...l.slice(-300), { msg, type }]);
  }, []);

  function handleFile(file: File) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const parsed = parseCSVText(text);
      if (parsed.length < 2) return;
      const hdr = [...parsed[0]];
      while (hdr.length < 12) hdr.push("");
      hdr[8] = hdr[8] || "최근 1년 채용건수";
      hdr[9] = hdr[9] || "본사 지역";
      hdr[10] = hdr[10] || "MATE 매칭";
      hdr[11] = hdr[11] || "업데이트 일자";
      setHeader(hdr);
      const dataRows = parsed.slice(1).map(r => { while (r.length < 12) r.push(""); return r; });
      rowsRef.current = dataRows.map(r => [...r]);

      const cache = cacheRef.current;
      let preHit = 0, skipped = 0;
      const initialStates: RowState[] = dataRows.map((r, i) => {
        const name = (r[0] || "").replace(/\n[\s\S]*/g, "").trim();

        // 칸 밀림 필터링
        if (!isValidCompanyName(name)) {
          skipped++;
          return { name, status: "done" as RowStatus };
        }

        // 오류였던 건은 캐시 무시하고 재조회
        const prevDate = (r[11] || "");
        const wasError = prevDate.includes("(오류)");
        if (wasError) {
          return { name, status: "wait" as RowStatus };
        }

        // 캐시 적용
        const cached = cache[name];
        if (cached) {
          rowsRef.current[i][8] = String(cached.hire_count);
          rowsRef.current[i][9] = cached.address;
          rowsRef.current[i][10] = cached.mate;
          rowsRef.current[i][11] = cached.date + "(캐시)";
          preHit++;
          return { name, status: "cached" as RowStatus, address: cached.address, hire_count: cached.hire_count, mate: cached.mate };
        }
        return { name, status: "wait" as RowStatus };
      });

      setRows([...rowsRef.current]);
      setRowStates(initialStates);
      calcMateCounts(rowsRef.current);
      setLogs([]);
      setDoneCount(0);
      setErrCount(0);
      setCachedCount(preHit);
      setSkippedCount(skipped);
      addLog(`파일 로드: ${dataRows.length}개 행 | 유효 기업: ${dataRows.length - skipped}개 | 캐시: ${preHit}개 | 오류 재조회 포함 | 칸밀림 스킵: ${skipped}개`, "ok");
    };
    reader.readAsText(file, "UTF-8");
  }

  async function processOne(i: number, total: number, states: RowState[]): Promise<void> {
    const name = (rowsRef.current[i]?.[0] || "").replace(/\n[\s\S]*/g, "").trim();
    if (!name) return;

    // 칸 밀림 스킵
    if (!isValidCompanyName(name)) return;

    // 캐시 사용 (오류 제외 - 오류건은 항상 재조회)
    if (states[i]?.status === "cached") {
      setDoneCount(d => d + 1);
      return;
    }

    setRowStates(prev => prev.map((s, idx) => idx === i ? { ...s, status: "proc" } : s));
    const wasError = states[i]?.status === "error" || (rowsRef.current[i][11]||"").includes("(오류)");
    addLog(`[${i + 1}/${total}] ${name}${wasError ? " (오류 재조회)" : ""} 조회 중...`, "info");

    try {
      const res = await fetch("/api/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyName: name }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);

      rowsRef.current[i] = [...rowsRef.current[i]];
      if (data.hire_count !== undefined) rowsRef.current[i][8] = String(data.hire_count);
      if (data.address) rowsRef.current[i][9] = data.address;
      if (data.mate) rowsRef.current[i][10] = data.mate;
      rowsRef.current[i][11] = today;

      // 캐시 저장
      cacheRef.current[name] = { address: data.address || "", hire_count: data.hire_count ?? 0, mate: data.mate || "", date: today };
      saveCache(cacheRef.current);
      setCacheSize(Object.keys(cacheRef.current).length);

      setRows([...rowsRef.current]);
      calcMateCounts(rowsRef.current);
      setRowStates(prev => prev.map((s, idx) => idx === i ? { ...s, status: "done", address: data.address, hire_count: data.hire_count, mate: data.mate } : s));
      addLog(`  ✅ ${name} | 📍${data.address || "주소없음"} | 💼${data.hire_count}건 | 🏢${data.mate || "-"}`, "ok");
      setDoneCount(d => d + 1);
    } catch (e: unknown) {
      const errMsg = e instanceof Error ? e.message : String(e);
      rowsRef.current[i] = [...rowsRef.current[i]];
      rowsRef.current[i][11] = today + "(오류)";
      setRows([...rowsRef.current]);
      setRowStates(prev => prev.map((s, idx) => idx === i ? { ...s, status: "error", error: errMsg } : s));
      addLog(`  ❌ ${name} 오류: ${errMsg}`, "err");
      setErrCount(c => c + 1);
    }
  }

  async function runAll() {
    setRunning(true);
    stopRef.current = false;
    pauseRef.current = false;
    setDoneCount(0);
    const total = rowsRef.current.length;
    const snapshot = [...rowStates];
    let i = 0;

    while (i < total) {
      if (stopRef.current) break;
      while (pauseRef.current) {
        await new Promise(r => setTimeout(r, 300));
        if (stopRef.current) break;
      }
      const batchEnd = Math.min(i + BATCH_SIZE, total);
      const batch = Array.from({ length: batchEnd - i }, (_, k) => i + k);
      const newBatch = batch.filter(idx => {
        const name = (rowsRef.current[idx]?.[0] || "").replace(/\n[\s\S]*/g, "").trim();
        const isErr = (rowsRef.current[idx]?.[11] || "").includes("(오류)");
        return isValidCompanyName(name) && (!cacheRef.current[name] || isErr);
      });
      if (newBatch.length > 0) addLog(`── 배치 ${Math.floor(i/BATCH_SIZE)+1}: ${newBatch.length}개 신규/재조회 / ${batch.length-newBatch.length}개 캐시/스킵 ──`, "info");
      await Promise.all(batch.map(idx => processOne(idx, total, snapshot)));
      i = batchEnd;
    }

    setRunning(false);
    setPaused(false);
    addLog("🎉 전체 완료!", "ok");
  }

  function handlePause() {
    if (!paused) { pauseRef.current = true; setPaused(true); addLog("⏸ 일시정지", "warn"); }
    else { pauseRef.current = false; setPaused(false); addLog("▶ 재개", "info"); }
  }
  function handleStop() { stopRef.current = true; setRunning(false); setPaused(false); addLog("⏹ 중지됨", "warn"); }

  function handleDownload() {
    const exportRows = rowsRef.current.map(r => {
      const nr = [...r];
      if (nr[11]) nr[11] = nr[11].replace("(캐시)", "");
      return nr;
    });
    const csv = "\uFEFF" + toCSVText([header, ...exportRows]);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "스타트업_투자_채용_현황_업데이트.csv"; a.click();
    URL.revokeObjectURL(url);
  }

  function handleClearCache() {
    if (!confirm(`캐시 ${cacheSize}개를 모두 삭제할까요?`)) return;
    cacheRef.current = {}; saveCache({}); setCacheSize(0);
    addLog("🗑 캐시 초기화 완료", "warn");
  }

  const total = rows.length;
  const procCount = rowStates.filter(s => s.status === "proc").length;
  const validTotal = total - skippedCount;
  const pct = validTotal > 0 ? Math.round(((doneCount + cachedCount) / validTotal) * 100) : 0;
  const totalMateMatched = Object.values(mateCounts).reduce((a, b) => a + b, 0);
  const maxMateCount = Math.max(...Object.values(mateCounts), 1);
  const S = styles;

  return (
    <div style={S.page}>
      <div style={S.card}>
        {/* 헤더 */}
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:"1.25rem" }}>
          <div>
            <h1 style={S.h1}>스타트업 DB 자동 업데이트</h1>
            <p style={S.sub}>비즈노 · 나이스 · 사람인 · 원티드 자동 조회 → I·J·K·L열 기입 | 20개 동시 처리</p>
          </div>
          <div style={{ textAlign:"right" }}>
            <div style={{ fontSize:11, color:"#888", marginBottom:2 }}>로컬 캐시</div>
            <div style={{ fontSize:18, fontWeight:600, color:"#534AB7" }}>{cacheSize}개</div>
            {cacheSize > 0 && <button style={S.btnTiny} onClick={handleClearCache}>초기화</button>}
          </div>
        </div>

        {/* 업로드 */}
        <div style={S.dropZone} onClick={() => fileInputRef.current?.click()}
          onDragOver={e => e.preventDefault()}
          onDrop={e => { e.preventDefault(); const f=e.dataTransfer.files[0]; if(f) handleFile(f); }}>
          <div style={{ fontSize:28, marginBottom:4 }}>📂</div>
          <div style={{ fontSize:14, color:"#666" }}>CSV 파일 드래그 또는 클릭하여 업로드</div>
          <input ref={fileInputRef} type="file" accept=".csv" style={{ display:"none" }}
            onChange={e => { const f=e.target.files?.[0]; if(f) handleFile(f); }} />
        </div>

        {/* 통계 */}
        {total > 0 && (
          <div style={{ display:"grid", gridTemplateColumns:"repeat(6,1fr)", gap:8, marginBottom:"1rem" }}>
            {([
              ["전체행", total, "#444"],
              ["유효기업", validTotal, "#333"],
              ["완료", doneCount, "#0a7c55"],
              ["캐시", cachedCount, "#534AB7"],
              ["처리중", procCount, "#8a5200"],
              ["오류", errCount, "#a02020"],
            ] as [string,number,string][]).map(([label,val,color]) => (
              <div key={label} style={S.statCard}>
                <div style={{ fontSize:11, color:"#888" }}>{label}</div>
                <div style={{ fontSize:18, fontWeight:600, color }}>{val}</div>
              </div>
            ))}
          </div>
        )}

        {skippedCount > 0 && (
          <div style={{ background:"#fffbe6", border:"1px solid #ffe58f", borderRadius:8, padding:"8px 14px", fontSize:12, color:"#8a5200", marginBottom:12 }}>
            ⚠ 칸 밀림으로 인한 비정상 행 {skippedCount}개 감지 — 자동 스킵 처리됨
          </div>
        )}

        {/* 진행바 */}
        {total > 0 && (
          <div style={{ marginBottom:14 }}>
            <div style={{ display:"flex", justifyContent:"space-between", fontSize:12, color:"#666", marginBottom:4 }}>
              <span>{running ? `처리 중 (${doneCount+cachedCount}/${validTotal})` : doneCount+cachedCount>=validTotal&&validTotal>0 ? "✅ 완료" : "대기"}</span>
              <span>{pct}%</span>
            </div>
            <div style={S.progBar}><div style={{ ...S.progFill, width:pct+"%" }} /></div>
          </div>
        )}

        {/* 버튼 */}
        {total > 0 && (
          <div style={S.btnRow}>
            {!running ? (
              <button style={S.btnPrimary} onClick={runAll}>▶ 자동 채우기 실행</button>
            ) : (
              <>
                <button style={S.btnSecondary} onClick={handlePause}>{paused?"▶ 재개":"⏸ 일시정지"}</button>
                <button style={{ ...S.btnSecondary, color:"#a02020" }} onClick={handleStop}>⏹ 중지</button>
              </>
            )}
            <button style={S.btnSecondary} onClick={handleDownload} disabled={total===0}>⬇ CSV 다운로드</button>
          </div>
        )}

        {/* 로그 */}
        {logs.length > 0 && (
          <div style={S.logBox} ref={el => { if(el) el.scrollTop=el.scrollHeight; }}>
            {logs.map((l,i) => (
              <div key={i} style={{ ...S.logLine, color: l.type==="ok"?"#0a7c55":l.type==="err"?"#a02020":l.type==="warn"?"#8a5200":l.type==="info"?"#2a44a0":"#666" }}>
                {l.msg}
              </div>
            ))}
          </div>
        )}

        {/* 탭 */}
        {total > 0 && (
          <div style={{ display:"flex", gap:0, marginBottom:16, borderBottom:"1px solid #eee" }}>
            {(["table","dashboard"] as const).map(tab => (
              <button key={tab} onClick={() => setActiveTab(tab)} style={{
                background:"none", border:"none", borderBottom: activeTab===tab?"2px solid #534AB7":"2px solid transparent",
                color: activeTab===tab?"#534AB7":"#888", fontWeight: activeTab===tab?600:400,
                fontSize:13, padding:"8px 16px", cursor:"pointer", marginBottom:-1,
              }}>
                {tab==="table" ? "📋 기업 목록" : "📊 MATE 대시보드"}
              </button>
            ))}
          </div>
        )}

        {/* 기업 목록 테이블 */}
        {total > 0 && activeTab === "table" && (
          <div style={S.tableWrap}>
            <table style={S.table}>
              <thead>
                <tr>{["상태","기업명","채용건수(I)","본사지역(J)","MATE(K)","업데이트(L)","오류내용"].map(h=><th key={h} style={S.th}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {rows.map((row,i) => {
                  const st=rowStates[i];
                  const name=(row[0]||"").replace(/\n[\s\S]*/g,"").trim();
                  const invalid=!isValidCompanyName(name);
                  const isCached=st?.status==="cached", isDone=st?.status==="done", isErr=st?.status==="error", isProc=st?.status==="proc";
                  const bg=invalid?"#f9f9f9":isDone?"#f0faf5":isCached?"#f3f0ff":isErr?"#fff5f5":isProc?"#fffbe6":"white";
                  const color=invalid?"#ccc":isDone?"#0a7c55":isCached?"#534AB7":isErr?"#a02020":isProc?"#8a5200":"#999";
                  const label=invalid?"⏭ 스킵":isDone?"✅ 완료":isCached?"💾 캐시":isErr?"❌ 오류":isProc?"⏳ 처리중":"⬜ 대기";
                  const mateColor = MATE_COLORS[row[10]] || "#888";
                  return (
                    <tr key={i} style={{ background:bg, opacity:invalid?0.5:1 }}>
                      <td style={{ ...S.td, color, fontWeight:500, whiteSpace:"nowrap" }}>{label}</td>
                      <td style={{ ...S.td, maxWidth:140 }}>{name.slice(0,20)}</td>
                      <td style={{ ...S.td, textAlign:"center" }}>{row[8]||"-"}</td>
                      <td style={{ ...S.td, maxWidth:160 }}>{row[9]||"-"}</td>
                      <td style={{ ...S.td, maxWidth:130 }}>
                        {row[10] ? <span style={{ background:mateColor+"18", color:mateColor, borderRadius:99, padding:"1px 8px", fontSize:11, fontWeight:500 }}>{row[10]}</span> : "-"}
                      </td>
                      <td style={{ ...S.td, whiteSpace:"nowrap" }}>{(row[11]||"-").replace("(캐시)","")}</td>
                      <td style={{ ...S.td, maxWidth:220, color:"#a02020", fontSize:11 }}>{isErr?(st?.error||"-"):"-"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* MATE 대시보드 */}
        {total > 0 && activeTab === "dashboard" && (
          <div>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:10, marginBottom:20 }}>
              {([["전체 기업", total+"개","#444"],["MATE 매칭 완료", totalMateMatched+"개","#0a7c55"],["미매칭", (validTotal-totalMateMatched)+"개","#8a5200"]] as [string,string,string][]).map(([label,val,color])=>(
                <div key={label} style={{ background:"#f7f7f7", borderRadius:10, padding:"1rem" }}>
                  <div style={{ fontSize:12, color:"#888", marginBottom:4 }}>{label}</div>
                  <div style={{ fontSize:24, fontWeight:700, color }}>{val}</div>
                </div>
              ))}
            </div>

            <div style={{ background:"#fafafa", borderRadius:10, padding:"1.25rem", border:"1px solid #eee", marginBottom:20 }}>
              <div style={{ fontSize:13, fontWeight:600, color:"#333", marginBottom:16 }}>MATE별 매칭 기업 수</div>
              <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                {MATE_ORDER.map(mate => {
                  const count=mateCounts[mate]||0;
                  const barPct=Math.round((count/maxMateCount)*100);
                  const color=MATE_COLORS[mate]||"#888";
                  return (
                    <div key={mate}>
                      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:4 }}>
                        <span style={{ fontSize:12, color:"#444", fontWeight:500, minWidth:150 }}>{mate}</span>
                        <span style={{ fontSize:13, fontWeight:700, color, minWidth:32, textAlign:"right" }}>{count}</span>
                      </div>
                      <div style={{ height:10, background:"#eee", borderRadius:5, overflow:"hidden" }}>
                        <div style={{ height:"100%", width:count>0?Math.max(barPct,2)+"%":"0%", background:color, borderRadius:5, transition:"width .4s" }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div>
              <div style={{ fontSize:13, fontWeight:600, color:"#333", marginBottom:12 }}>MATE별 기업 목록</div>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(2,1fr)", gap:10 }}>
                {MATE_ORDER.filter(m=>mateCounts[m]>0).map(mate=>{
                  const color=MATE_COLORS[mate]||"#888";
                  const companies=rows.filter(r=>(r[10]||"").trim()===mate).map(r=>(r[0]||"").replace(/\n[\s\S]*/g,"").trim());
                  return (
                    <div key={mate} style={{ background:"white", border:"1px solid #eee", borderRadius:10, padding:"1rem", borderTop:`3px solid ${color}` }}>
                      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
                        <span style={{ fontSize:12, fontWeight:600, color }}>{mate}</span>
                        <span style={{ background:color+"18", color, fontSize:12, fontWeight:700, padding:"2px 10px", borderRadius:99 }}>{companies.length}개</span>
                      </div>
                      <div style={{ display:"flex", flexWrap:"wrap", gap:4 }}>
                        {companies.map(c=>(
                          <span key={c} style={{ fontSize:11, background:"#f5f5f5", color:"#555", borderRadius:4, padding:"2px 7px" }}>{c}</span>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { minHeight:"100vh", padding:"2rem 1rem", background:"#f5f5f5" },
  card: { maxWidth:980, margin:"0 auto", background:"white", borderRadius:12, padding:"2rem", boxShadow:"0 1px 4px rgba(0,0,0,.08)" },
  h1: { fontSize:22, fontWeight:600, margin:"0 0 4px" },
  sub: { fontSize:13, color:"#888", margin:0 },
  dropZone: { border:"1.5px dashed #ccc", borderRadius:10, padding:"1.25rem", textAlign:"center", cursor:"pointer", background:"#fafafa", marginBottom:"1.25rem" },
  statCard: { background:"#f7f7f7", borderRadius:8, padding:"0.6rem 0.8rem" },
  progBar: { height:4, background:"#eee", borderRadius:2, overflow:"hidden" },
  progFill: { height:"100%", background:"#534AB7", borderRadius:2, transition:"width .3s" },
  btnRow: { display:"flex", gap:8, marginBottom:"1rem", flexWrap:"wrap" },
  btnPrimary: { background:"#534AB7", color:"white", border:"none", borderRadius:8, padding:"0 1.2rem", height:36, fontSize:13, cursor:"pointer", fontWeight:500 },
  btnSecondary: { background:"white", color:"#333", border:"1px solid #ddd", borderRadius:8, padding:"0 1.1rem", height:36, fontSize:13, cursor:"pointer" },
  btnTiny: { background:"transparent", color:"#999", border:"1px solid #ddd", borderRadius:6, padding:"2px 8px", fontSize:11, cursor:"pointer", marginTop:4, display:"block" },
  logBox: { background:"#f7f7f7", border:"1px solid #eee", borderRadius:8, padding:"0.75rem", maxHeight:160, overflowY:"auto", marginBottom:"1rem", fontFamily:"monospace" },
  logLine: { fontSize:12, lineHeight:1.9 },
  tableWrap: { overflowX:"auto", border:"1px solid #eee", borderRadius:8 },
  table: { width:"100%", borderCollapse:"collapse", fontSize:12 },
  th: { background:"#f7f7f7", padding:"7px 10px", textAlign:"left", borderBottom:"1px solid #eee", fontWeight:500, fontSize:11, color:"#666", whiteSpace:"nowrap" },
  td: { padding:"6px 10px", borderBottom:"1px solid #f0f0f0", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" },
};
