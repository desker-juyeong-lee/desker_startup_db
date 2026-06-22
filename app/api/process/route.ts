import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { normalizeAddr, coordsForRegion, findNearestMate } from "@/lib/utils";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
export const maxDuration = 60;

function isAddressIncomplete(addr: string): boolean {
  if (!addr || addr.trim().length === 0) return true;
  return !/[동로길]/.test(addr);
}

function extractJSON(text: string) {
  const m = text.match(/\{[\s\S]*?\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function callHaiku(prompt: string): Promise<string> {
  const msg = await (client.messages.create as any)({
    model: "claude-haiku-4-5-20251001", // ← Haiku로 변경 (비용 ~1/5)
    max_tokens: 512,
    tools: [{ type: "web_search_20250305", name: "web_search" }],
    messages: [{ role: "user", content: prompt }],
  });
  return (msg.content as Array<{ type: string; text?: string }>)
    .filter(b => b.type === "text").map(b => b.text ?? "").join("\n")
    .replace(/```json|```/g, "").trim();
}

export async function POST(req: NextRequest) {
  const { companyName } = await req.json();
  if (!companyName) return NextResponse.json({ error: "companyName 필요" }, { status: 400 });

  const oneYearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  try {
    // ── STEP 1: 사람인 채용 먼저 검색 ──
    // 채용 0건이면 즉시 삭제 처리, 이후 주소 검색 불필요
    const saraminText = await callHaiku(
      `사람인에서 "${companyName}" 기업의 최근 1년(${oneYearAgo} 이후) 채용 공고 수를 확인하세요.
URL: https://www.saramin.co.kr/zf_user/search/recruit?searchword=${encodeURIComponent(companyName)}&recruitPage=1&recruitPageCount=100
공고 제목 목록을 확인하고 중복 제목 제거 후 카운트하세요.
JSON만 반환: {"hire_count":5}`
    );
    const saraminResult = extractJSON(saraminText);
    const hireCount = typeof saraminResult?.hire_count === "number" ? saraminResult.hire_count : 0;

    // 채용 0건 → 삭제
    if (hireCount === 0) {
      return NextResponse.json({ noHire: true });
    }

    // ── STEP 2: 비즈노에서 주소 검색 ──
    const biznoText = await callHaiku(
      `비즈노에서 "${companyName}" 기업의 본사 주소를 찾으세요.
URL: https://bizno.net/?query=${encodeURIComponent(companyName)}&gb=1
본사 또는 본점 기준으로 동/로/길 단위까지 주소를 추출하세요.
JSON만 반환: {"address":"서울 강남구 테헤란로 123"}`
    );
    const biznoResult = extractJSON(biznoText);
    let normalizedAddr = biznoResult?.address?.trim() ? normalizeAddr(biznoResult.address) : "";

    // 비즈노에서 상세 주소 나오면 STEP 3 스킵
    if (isAddressIncomplete(normalizedAddr)) {
      // ── STEP 3: 구글에서 주소 보완 (비즈노 실패시만) ──
      const googleText = await callHaiku(
        `구글에서 "${companyName} 본사 주소"를 검색해서 정확한 도로명 주소(동/로/길 포함)를 찾으세요.
JSON만 반환: {"address":"서울 강남구 테헤란로 123"}`
      );
      const googleResult = extractJSON(googleText);
      if (googleResult?.address?.trim()) {
        const ga = normalizeAddr(googleResult.address);
        if (!isAddressIncomplete(ga)) normalizedAddr = ga;
      }
    }

    // 주소 끝내 미확인 → 삭제
    if (isAddressIncomplete(normalizedAddr)) {
      return NextResponse.json({ noAddress: true, hire_count: hireCount });
    }

    const coords = coordsForRegion(normalizedAddr);
    const mate = coords ? findNearestMate(coords[0], coords[1]) : "";

    return NextResponse.json({ address: normalizedAddr, hire_count: hireCount, mate });

  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `API 오류: ${msg}` }, { status: 500 });
  }
}
