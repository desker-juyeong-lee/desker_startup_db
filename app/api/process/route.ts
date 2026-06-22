import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { normalizeAddr, coordsForRegion, findNearestMate } from "@/lib/utils";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
export const maxDuration = 60;

function isAddressIncomplete(addr: string): boolean {
  if (!addr || addr.trim().length === 0) return true;
  return !/[동로길]/.test(addr);
}

async function callClaude(prompt: string): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const msg = await (client.messages.create as any)({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    tools: [{ type: "web_search_20250305", name: "web_search" }],
    messages: [{ role: "user", content: prompt }],
  });
  return (msg.content as Array<{ type: string; text?: string }>)
    .filter(b => b.type === "text").map(b => b.text ?? "").join("\n")
    .replace(/```json|```/g, "").trim();
}

function extractJSON(text: string) {
  const m = text.match(/\{[\s\S]*?\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

export async function POST(req: NextRequest) {
  const { companyName } = await req.json();
  if (!companyName) return NextResponse.json({ error: "companyName 필요" }, { status: 400 });

  const oneYearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  // 1차 조회: 비즈노 + 나이스 + 채용
  const prompt1 = `한국 스타트업 "${companyName}"의 정보를 조회해주세요.

[1] 본사 주소 (동/로/길 단위까지):
 - 1순위: https://bizno.net/?query=${encodeURIComponent(companyName)}&gb=1 → 본사/본점 기준
 - 2순위: https://www.niceamc.co.kr 검색
 - 반드시 동/로/길 단위까지 포함

[2] 최근 1년(${oneYearAgo} 이후) 채용 공고 수:
 - 사람인: https://www.saramin.co.kr/zf_user/search/recruit?searchword=${encodeURIComponent(companyName)}&recruitPage=1&recruitPageCount=100
 - 원티드: https://www.wanted.co.kr/search?query=${encodeURIComponent(companyName)}&tab=job
 - 두 사이트 합산, 동일 제목 1건

JSON만 반환:
{"address":"서울 강남구 테헤란로 OO","hire_count":5,"source":"bizno"}`;

  try {
    const text1 = await callClaude(prompt1);
    const result1 = extractJSON(text1);

    let address = result1?.address?.trim() || "";
    let normalizedAddr = address ? normalizeAddr(address) : "";
    const hireCount = typeof result1?.hire_count === "number" ? result1.hire_count : 0;
    let source = result1?.source || "not_found";

    // 2차: 주소 불완전하면 구글 검색
    if (isAddressIncomplete(normalizedAddr)) {
      try {
        const text2 = await callClaude(
          `구글에서 "${companyName} 본사 주소"를 검색해서 정확한 도로명 주소(동/로/길 포함)를 찾아주세요.\nJSON만 반환: {"address":"서울 강남구 테헤란로 123"}`
        );
        const result2 = extractJSON(text2);
        if (result2?.address && !isAddressIncomplete(normalizeAddr(result2.address))) {
          normalizedAddr = normalizeAddr(result2.address);
          source = "google";
        }
      } catch { /* 구글 실패시 기존 유지 */ }
    }

    // 주소 끝내 확인 불가 → noAddress 플래그
    if (isAddressIncomplete(normalizedAddr)) {
      return NextResponse.json({ noAddress: true, hire_count: hireCount });
    }

    const coords = coordsForRegion(normalizedAddr);
    const mate = coords ? findNearestMate(coords[0], coords[1]) : "";

    return NextResponse.json({ address: normalizedAddr, hire_count: hireCount, mate, source });

  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `API 오류: ${msg}` }, { status: 500 });
  }
}
