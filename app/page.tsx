"use client";
import { useState, useRef, useCallback } from "react";
import { parseCSVText, toCSVText } from "@/lib/utils";

type RowStatus = "wait" | "proc" | "done" | "error";

interface RowState {
  name: string;
  status: RowStatus;
  address?: string;
  hire_count?: number;
  mate?: string;
  error?: string;
}

const today = new Date().toISOString().slice(0, 10);

export default function Home() {
  const [rows, setRows] = useState<string[][]>([]);
  const [header, setHeader] = useState<string[]>([]);
  const [rowStates, setRowStates] = useState<RowState[]>([]);
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [logs, setLogs] = useState<{ msg: string; type: string }[]>([]);
  const [done, setDone] = useState(0);
  const [errors, setErrors] = useState(0);
  const pauseRef = useRef(false);
  const stopRef = useRef(false);
  const curIdxRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addLog = useCallback((msg: string, type = "") => {
    setLogs(l => [...l.slice(-200), { msg, type }]);
  }, []);

  function handleFile(file: File) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const parsed = parseCSVText(text);
      if (parsed.length < 2) return;
      const hdr = [...parsed[0]];
      while (hdr.length < 12) hdr.push("");
      hdr[8]  = hdr[8]  || "최근 1년 채용건수";
      hdr[9]  = hdr[9]  || "본사 지역";
      hdr[10] = hdr[10] || "MATE 매칭";
      hdr[11] = hdr[11] || "업데이트 일자";
      setHeader(hdr);
      const dataRows = parsed.slice(1).map(r => { while (r.length < 12) r.push(""); return r; });
      setRows(dataRows);
      setRowStates(dataRows.map(r => ({
        name: (r[0] || "").replace(/\n[\s\S]*/g, "").trim(),
        status: "wait",
      })));
      setLogs([]);
      setDone(0);
      setErrors(0);
      curIdxRef.current = 0;
      addLog(`✅ 파일 로드: ${parsed.length - 1}개 기업`, "ok");
    };
    reader.readAsText(file, "UTF-8");
  }

  async function runAll() {
    setRunning(true);
    stopRef.current = false;
    pauseRef.current = false;

    const total = rows.length;

    for (let i = curIdxRef.current; i < total; i++) {
      if (stopRef.current) break;
      while (pauseRef.current) {
        await new Promise(r => setTimeout(r, 300));
        if (stopRef.current) break;
      }

      curIdxRef.current = i;
      const name = (rows[i][0] || "").replace(/\n[\s\S]*/g, "").trim();
      if (!name) continue;

      setRowStates(prev => prev.map((s, idx) => idx === i ? { ...s, status: "proc" } : s));
      addLog(`🔍 [${i + 1}/${total}] ${name} 조회 중...`, "info");

      try {
        const res = await fetch("/api/process", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ companyName: name }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (data.error) throw new Error(data.error);

        setRows(prev => {
          const next = prev.map((r, idx) => {
            if (idx !== i) return r;
            const nr = [...r];
            if (data.hire_count !== undefined) nr[8] = String(data.hire_count);
            if (data.address) nr[9] = data.address;
            if (data.mate) nr[10] = data.mate;
            nr[11] = today;
            return nr;
          });
          return next;
        });
        setRowStates(prev => prev.map((s, idx) =>
          idx === i ? { ...s, status: "done", address: data.address, hire_count: data.hire_count, mate: data.mate } : s
        ));
        addLog(`  📍 ${data.address || "주소없음"}  💼 ${data.hire_count}건  🏢 ${data.mate || "-"}`, "ok");
        setDone(d => d + 1);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        setRowStates(prev => prev.map((s, idx) =>
          idx === i ? { ...s, status: "error", error: msg } : s
        ));
        setRows(prev => prev.map((r, idx) => {
          if (idx !== i) return r;
          const nr = [...r]; nr[11] = today + "(오류)"; return nr;
        }));
        addLog(`  ❌ ${msg}`, "err");
        setErrors(e => e + 1);
      }

      await new Promise(r => setTimeout(r, 600));
    }

    curIdxRef.current = total;
    setRunning(false);
    setPaused(false);
    addLog(`\n🎉 완료! 성공 ${done + 1}건 / 오류 ${errors}건`, "ok");
  }

  function handlePause() {
    if (!paused) {
      pauseRef.current = true;
      setPaused(true);
      addLog("⏸ 일시정지", "warn");
    } else {
      pauseRef.current = false;
      setPaused(false);
      addLog("▶ 재개", "info");
    }
  }

  function handleStop() {
    stopRef.current = true;
    setRunning(false);
    setPaused(false);
    addLog("⏹ 중지됨", "warn");
  }

  function handleDownload() {
    const out = [header, ...rows];
    const csv = "\uFEFF" + toCSVText(out);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "스타트업_투자_채용_현황_업데이트.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  const total = rows.length;
  const doneCount = rowStates.filter(s => s.status === "done").length;
  const pct = total > 0 ? Math.round((doneCount / total) * 100) : 0;

  const S = styles;

  return (
    <div style={S.page}>
      <div style={S.card}>
        <h1 style={S.h1}>스타트업 DB 자동 업데이트</h1>
        <p style={S.sub}>비즈노 · 나이스 · 사람인 · 원티드 자동 조회 → I·J·K·L열 기입</p>

        {/* 업로드 */}
        <div
          style={S.dropZone}
          onClick={() => fileInputRef.current?.click()}
          onDragOver={e => e.preventDefault()}
          onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
        >
          <div style={{ fontSize: 32, marginBottom: 6 }}>📂</div>
          <div style={{ fontSize: 14, color: "#666" }}>CSV 파일 드래그 또는 클릭하여 업로드</div>
          <input ref={fileInputRef} type="file" accept=".csv" style={{ display: "none" }}
            onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
        </div>

        {/* 통계 */}
        {total > 0 && (
          <div style={S.statsRow}>
            {[["전체", total, "#444"], ["완료", doneCount, "#0a7c55"], ["처리중", rowStates.filter(s=>s.status==="proc").length, "#8a5200"], ["오류", errors, "#a02020"]].map(([label, val, color]) => (
              <div key={label as string} style={S.statCard}>
                <div style={{ fontSize: 11, color: "#888" }}>{label}</div>
                <div style={{ fontSize: 22, fontWeight: 600, color: color as string }}>{val}</div>
              </div>
            ))}
          </div>
        )}

        {/* 진행바 */}
        {total > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#666", marginBottom: 4 }}>
              <span>{running ? `처리 중 (${doneCount}/${total})` : doneCount === total && total > 0 ? "완료" : "대기"}</span>
              <span>{pct}%</span>
            </div>
            <div style={S.progBar}>
              <div style={{ ...S.progFill, width: pct + "%" }} />
            </div>
          </div>
        )}

        {/* 버튼 */}
        {total > 0 && (
          <div style={S.btnRow}>
            {!running ? (
              <button style={S.btnPrimary} onClick={runAll} disabled={total === 0}>
                ▶ 자동 채우기 실행
              </button>
            ) : (
              <>
                <button style={S.btnSecondary} onClick={handlePause}>
                  {paused ? "▶ 재개" : "⏸ 일시정지"}
                </button>
                <button style={{ ...S.btnSecondary, color: "#a02020" }} onClick={handleStop}>
                  ⏹ 중지
                </button>
              </>
            )}
            <button style={S.btnSecondary} onClick={handleDownload} disabled={total === 0}>
              ⬇ CSV 다운로드
            </button>
          </div>
        )}

        {/* 로그 */}
        {logs.length > 0 && (
          <div style={S.logBox}>
            {logs.map((l, i) => (
              <div key={i} style={{ ...S.logLine, color: l.type === "ok" ? "#0a7c55" : l.type === "err" ? "#a02020" : l.type === "warn" ? "#8a5200" : l.type === "info" ? "#2a44a0" : "#444" }}>
                {l.msg}
              </div>
            ))}
          </div>
        )}

        {/* 테이블 */}
        {total > 0 && (
          <div style={S.tableWrap}>
            <table style={S.table}>
              <thead>
                <tr>
                  {["상태", "기업명", "채용건수(I)", "본사지역(J)", "MATE(K)", "업데이트(L)"].map(h => (
                    <th key={h} style={S.th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => {
                  const st = rowStates[i];
                  const statusColor = st?.status === "done" ? "#0a7c55" : st?.status === "proc" ? "#8a5200" : st?.status === "error" ? "#a02020" : "#999";
                  const statusLabel = st?.status === "done" ? "✅ 완료" : st?.status === "proc" ? "⏳ 처리중" : st?.status === "error" ? "❌ 오류" : "⬜ 대기";
                  return (
                    <tr key={i} style={{ background: st?.status === "done" ? "#f0faf5" : st?.status === "proc" ? "#fffbe6" : "white" }}>
                      <td style={{ ...S.td, color: statusColor, fontWeight: 500, whiteSpace: "nowrap" }}>{statusLabel}</td>
                      <td style={{ ...S.td, maxWidth: 140 }}>{(row[0] || "").replace(/\n[\s\S]*/g, "").slice(0, 20)}</td>
                      <td style={{ ...S.td, textAlign: "center" }}>{row[8] || "-"}</td>
                      <td style={{ ...S.td, maxWidth: 160 }}>{row[9] || "-"}</td>
                      <td style={{ ...S.td, maxWidth: 120 }}>{row[10] || "-"}</td>
                      <td style={{ ...S.td, whiteSpace: "nowrap" }}>{row[11] || "-"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { minHeight: "100vh", padding: "2rem 1rem", background: "#f5f5f5" },
  card: { maxWidth: 860, margin: "0 auto", background: "white", borderRadius: 12, padding: "2rem", boxShadow: "0 1px 4px rgba(0,0,0,.08)" },
  h1: { fontSize: 22, fontWeight: 600, margin: "0 0 4px" },
  sub: { fontSize: 13, color: "#888", margin: "0 0 1.5rem" },
  dropZone: { border: "1.5px dashed #ccc", borderRadius: 10, padding: "1.5rem", textAlign: "center", cursor: "pointer", background: "#fafafa", marginBottom: "1.25rem" },
  statsRow: { display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8, marginBottom: "1rem" },
  statCard: { background: "#f7f7f7", borderRadius: 8, padding: "0.6rem 0.8rem" },
  progBar: { height: 4, background: "#eee", borderRadius: 2, overflow: "hidden" },
  progFill: { height: "100%", background: "#534AB7", borderRadius: 2, transition: "width .3s" },
  btnRow: { display: "flex", gap: 8, marginBottom: "1rem", flexWrap: "wrap" },
  btnPrimary: { background: "#534AB7", color: "white", border: "none", borderRadius: 8, padding: "0 1.2rem", height: 36, fontSize: 13, cursor: "pointer", fontWeight: 500 },
  btnSecondary: { background: "white", color: "#333", border: "1px solid #ddd", borderRadius: 8, padding: "0 1.1rem", height: 36, fontSize: 13, cursor: "pointer" },
  logBox: { background: "#f7f7f7", border: "1px solid #eee", borderRadius: 8, padding: "0.75rem", maxHeight: 160, overflowY: "auto", marginBottom: "1rem", fontFamily: "monospace" },
  logLine: { fontSize: 12, lineHeight: 1.9 },
  tableWrap: { overflowX: "auto", border: "1px solid #eee", borderRadius: 8 },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 12 },
  th: { background: "#f7f7f7", padding: "7px 10px", textAlign: "left", borderBottom: "1px solid #eee", fontWeight: 500, fontSize: 11, color: "#666", whiteSpace: "nowrap" },
  td: { padding: "6px 10px", borderBottom: "1px solid #f0f0f0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
};
