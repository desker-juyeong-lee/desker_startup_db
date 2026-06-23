import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { normalizeAddr, coordsForRegion, findMatesByDistance, getRegionMate } from "@/lib/utils";

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

  const oneYearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  try {
    // ── STEP 1: 사람인 채용 검색 (0건이면 즉시 삭제) ──
    const saraminText = await callHaiku(
      `사람인에서 "${companyName}" 최근 1년(${oneYearAgo} 이후) 채용공고 수를 확인하세요.
웹 검색 1회만 사용하세요. 없으면 0 반환.
URL: https://www.saramin.co.kr/zf_user/search/recruit?searchword=${encodeURIComponent(companyName)}&recruitPage=1&recruitPageCount=100
중복 제목 제거 후 카운트. JSON만 반환: {"hire_count":5}`
    );
    const hireCount = extractJSON(saraminText)?.hire_count ?? 0;
    if (hireCount === 0) return NextResponse.json({ noHire: true });

    // ── STEP 2: 구글에서 주소 먼저 검색 (유연하게 찾음) ──
    const googleText = await callHaiku(
      `"${companyName} 본사 주소"를 검색하세요.
웹 검색 1회만 사용하세요. 못 찾으면 빈 문자열 반환.
동/로/길 단위까지 포함된 정확한 도로명 주소만 유효합니다.
JSON만 반환: {"address":"서울 강남구 테헤란로 123"}`
    );
    const googleAddr = extractJSON(googleText)?.address?.trim() ?? "";
    let normalizedAddr = googleAddr ? normalizeAddr(googleAddr) : "";

    // ── STEP 3: 구글 실패 시 비즈노로 보완 (정확한 법인명일 때 유효) ──
    if (isAddressIncomplete(normalizedAddr)) {
      const biznoText = await callHaiku(
        `비즈노에서 "${companyName}" 본사 주소를 찾으세요.
웹 검색 1회만 사용하세요. 못 찾으면 빈 문자열 반환.
URL: https://bizno.net/?query=${encodeURIComponent(companyName)}&gb=1
본사/본점 기준, 동/로/길 단위까지. JSON만 반환: {"address":"서울 강남구 테헤란로 123"}`
      );
      const biznoAddr = extractJSON(biznoText)?.address?.trim() ?? "";
      if (biznoAddr) {
        const ba = normalizeAddr(biznoAddr);
        if (!isAddressIncomplete(ba)) normalizedAddr = ba;
      }
    }

    // 주소 끝내 미확인 → 삭제
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
