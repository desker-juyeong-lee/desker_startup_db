import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { normalizeAddr, coordsForRegion, findMatesByDistance, getRegionMate } from "@/lib/utils";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
export const maxDuration = 60;

const currentYear = new Date().getFullYear();

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
    model: "claude-haiku-4-5-20251001",
    max_tokens: 512,
    tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 1 }],
    messages: [{ role: "user", content: prompt }],
  });
  return (msg.content as Array<{ type: string; text?: string }>)
    .filter(b => b.type === "text").map(b => b.text ?? "").join("\n")
    .replace(/```json|```/g, "").trim();
}

export async function POST(req: NextRequest) {
  const { companyName } = await req.json();
  if (!companyName) return NextResponse.json({ error: "companyName 필요" }, { status: 400 });

  try {
    // ── STEP 1: 구글로 채용건수 검색 ──
    // "회사명 채용 2025" 구글 검색 → 원티드·사람인·잡코리아 등 결과에서 건수 파악
    const hireText = await callHaiku(
      `구글에서 "${companyName} 채용 ${currentYear}" 검색 결과를 확인하세요.
웹 검색 1회만 사용하세요.
원티드, 사람인, 잡코리아, 잡플래닛, 리멤버 등 채용 플랫폼 검색 결과에서
"채용 N건", "공고 N건", "채용중인 포지션 N건" 등의 숫자를 찾으세요.
여러 플랫폼 중 가장 최신 건수 1개만 사용하세요 (중복 합산 금지).
결과가 없으면 0 반환.
JSON만 반환: {"hire_count":5,"source":"원티드"}`
    );
    const hireResult = extractJSON(hireText);
    let hireCount = typeof hireResult?.hire_count === "number" ? hireResult.hire_count : 0;

    // ── STEP 1-2: 구글에서 0건이면 사람인 직접 검색 (fallback) ──
    if (hireCount === 0) {
      const saraminText = await callHaiku(
        `사람인에서 "${companyName}" ${currentYear}년 채용공고 수를 확인하세요.
웹 검색 1회만 사용하세요.
URL: https://www.saramin.co.kr/zf_user/search/recruit?searchword=${encodeURIComponent(companyName)}&recruitPage=1&recruitPageCount=100
공고 수를 카운트하세요. 없으면 0 반환.
JSON만 반환: {"hire_count":3}`
      );
      const saraminResult = extractJSON(saraminText);
      hireCount = typeof saraminResult?.hire_count === "number" ? saraminResult.hire_count : 0;
    }

    // 채용 0건 → 삭제
    if (hireCount === 0) return NextResponse.json({ noHire: true });

    // ── STEP 2: 구글에서 주소 검색 ──
    const googleText = await callHaiku(
      `구글에서 "${companyName} 본사 주소"를 검색하세요.
웹 검색 1회만 사용하세요. 못 찾으면 빈 문자열 반환.
동/로/길 단위까지 포함된 도로명 주소만 유효합니다.
JSON만 반환: {"address":"서울 강남구 테헤란로 123"}`
    );
    const googleAddr = extractJSON(googleText)?.address?.trim() ?? "";
    let normalizedAddr = googleAddr ? normalizeAddr(googleAddr) : "";

    // ── STEP 3: 구글 실패 시 비즈노 보완 ──
    if (isAddressIncomplete(normalizedAddr)) {
      const biznoText = await callHaiku(
        `비즈노에서 "${companyName}" 본사 주소를 찾으세요.
웹 검색 1회만 사용하세요. 못 찾으면 빈 문자열 반환.
URL: https://bizno.net/?query=${encodeURIComponent(companyName)}&gb=1
본사/본점 기준, 동/로/길 단위까지.
JSON만 반환: {"address":"서울 강남구 테헤란로 123"}`
      );
      const biznoAddr = extractJSON(biznoText)?.address?.trim() ?? "";
      if (biznoAddr) {
        const ba = normalizeAddr(biznoAddr);
        if (!isAddressIncomplete(ba)) normalizedAddr = ba;
      }
    }

    // 주소 미확인 → 삭제
    if (isAddressIncomplete(normalizedAddr)) {
      return NextResponse.json({ noAddress: true, hire_count: hireCount });
    }

    const coords = coordsForRegion(normalizedAddr);
    const matesByDist = coords
      ? findMatesByDistance(coords[0], coords[1], normalizedAddr)
      : getRegionMate(normalizedAddr)
        ? [getRegionMate(normalizedAddr)!]
        : [];

    return NextResponse.json({ address: normalizedAddr, hire_count: hireCount, matesByDist });

  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `API 오류: ${msg}` }, { status: 500 });
  }
}
