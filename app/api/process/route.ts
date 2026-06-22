import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { normalizeAddr, coordsForRegion, findNearestMate } from "@/lib/utils";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export const maxDuration = 60;

// 주소가 구/시 단위까지만 있는지 확인 (동/로/길 없음)
function isAddressIncomplete(addr: string): boolean {
  if (!addr) return true;
  // 동, 로, 길, 번길, 대로 등 상세 주소 키워드가 없으면 불완전
  return !/[동로길]/.test(addr);
}

export async function POST(req: NextRequest) {
  const { companyName } = await req.json();
  if (!companyName) {
    return NextResponse.json({ error: "companyName 필요" }, { status: 400 });
  }

  const oneYearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000)
    .toISOString().slice(0, 10);

  const prompt = `한국 스타트업 "${companyName}"의 정보를 조회해주세요.

[1] 본사 주소 (시·군·구·동·로까지 최대한 상세히):
 - 1순위: 비즈노(https://bizno.net/?query=${encodeURIComponent(companyName)}&gb=1) 검색 → "본사" 또는 "본점" 기준
 - 2순위: 나이스신용정보(https://www.niceamc.co.kr) 검색
 - 3순위: 위 두 곳에서 구/시 단위까지만 나오거나 주소 없으면 → 구글에서 "${companyName} 본사 주소" 검색하여 상세 주소 확인
 - 주소는 반드시 동/로/길 단위까지 포함할 것

[2] 최근 1년(${oneYearAgo} 이후) 채용 공고 수:
 - 사람인: https://www.saramin.co.kr/zf_user/search/recruit?searchword=${encodeURIComponent(companyName)}&recruitPage=1&recruitPageCount=100
 - 원티드: https://www.wanted.co.kr/search?query=${encodeURIComponent(companyName)}&tab=job
 - 두 사이트 공고 제목 합산, 동일 제목은 1건으로 카운트

아래 JSON만 반환 (다른 텍스트 없이):
{"address":"서울 강남구 테헤란로 OO","hire_count":5,"source":"bizno"}
- address: 주소 동/로/길 단위까지 (없으면 "")
- hire_count: 숫자 (없으면 0)
- source: "bizno" | "nice" | "google" | "not_found"`;

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const msg = await (client.messages.create as any)({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      tools: [{ type: "web_search_20250305", name: "web_search" }],
      messages: [{ role: "user", content: prompt }],
    });

    const text = (msg.content as Array<{type: string; text?: string}>)
      .filter(b => b.type === "text")
      .map(b => b.text ?? "")
      .join("\n")
      .replace(/```json|```/g, "")
      .trim();

    const match = text.match(/\{[\s\S]*?\}/);
    if (!match) {
      return NextResponse.json({ address: "", hire_count: 0, mate: "", source: "not_found" });
    }

    let result;
    try {
      result = JSON.parse(match[0]);
    } catch {
      return NextResponse.json({ address: "", hire_count: 0, mate: "", source: "not_found" });
    }

    let mate = "";
    let normalizedAddr = "";

    if (result.address?.trim()) {
      normalizedAddr = normalizeAddr(result.address);

      // 주소가 구 단위까지만 나온 경우 → 구글 추가 검색
      if (isAddressIncomplete(normalizedAddr)) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const msg2 = await (client.messages.create as any)({
            model: "claude-sonnet-4-6",
            max_tokens: 512,
            tools: [{ type: "web_search_20250305", name: "web_search" }],
            messages: [{
              role: "user",
              content: `구글에서 "${companyName} 본사 주소"를 검색해서 정확한 도로명 주소(동/로/길 포함)를 찾아주세요. JSON만 반환: {"address":"서울 강남구 테헤란로 123"}`
            }],
          });
          const text2 = (msg2.content as Array<{type: string; text?: string}>)
            .filter(b => b.type === "text").map(b => b.text ?? "").join("\n")
            .replace(/```json|```/g, "").trim();
          const m2 = text2.match(/\{[\s\S]*?\}/);
          if (m2) {
            const r2 = JSON.parse(m2[0]);
            if (r2.address && !isAddressIncomplete(normalizeAddr(r2.address))) {
              normalizedAddr = normalizeAddr(r2.address);
              result.source = "google";
            }
          }
        } catch { /* 구글 검색 실패해도 기존 주소 유지 */ }
      }

      const coords = coordsForRegion(normalizedAddr);
      if (coords) mate = findNearestMate(coords[0], coords[1]);
    }

    return NextResponse.json({
      address: normalizedAddr,
      hire_count: typeof result.hire_count === "number" ? result.hire_count : 0,
      mate,
      source: result.source ?? "not_found",
    });

  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `API 오류: ${msg}` }, { status: 500 });
  }
}
