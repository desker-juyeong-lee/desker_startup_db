import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { normalizeAddr, coordsForRegion, findNearestMate } from "@/lib/utils";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const { companyName } = await req.json();
  if (!companyName) {
    return NextResponse.json({ error: "companyName 필요" }, { status: 400 });
  }

  const oneYearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000)
    .toISOString().slice(0, 10);

  const prompt = `한국 스타트업 "${companyName}"의 정보를 조회해주세요.

[1] 본사 주소 (시·군·구·동까지):
 - 비즈노(https://bizno.net/?query=${encodeURIComponent(companyName)}&gb=1) 먼저 검색
 - 없으면 나이스신용정보(https://www.niceamc.co.kr) 검색
 - "본사" 또는 "본점" 기준 주소 추출

[2] 최근 1년(${oneYearAgo} 이후) 채용 공고 수:
 - 사람인: https://www.saramin.co.kr/zf_user/search/recruit?searchword=${encodeURIComponent(companyName)}&recruitPage=1&recruitPageCount=100
 - 원티드: https://www.wanted.co.kr/search?query=${encodeURIComponent(companyName)}&tab=job
 - 두 사이트 공고 제목 합산, 동일 제목은 1건으로 카운트

아래 JSON만 반환 (다른 텍스트 없이):
{"address":"서울 강남구 테헤란로 OO","hire_count":5,"source":"bizno"}
- address: 주소 (없으면 "")
- hire_count: 숫자 (없으면 0)
- source: "bizno" | "nice" | "not_found"`;

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
    if (!match) throw new Error("JSON 파싱 실패: " + text.slice(0, 100));

    const result = JSON.parse(match[0]);

    let mate = "";
    let normalizedAddr = "";
    if (result.address?.trim()) {
      normalizedAddr = normalizeAddr(result.address);
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
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}