export const MATES = [
  { name: "DM에스앤피",       lat: 37.4812, lng: 126.8827 }, // 서울 금천구 가산디지털1로 128
  { name: "DM에스앤피",       lat: 37.5125, lng: 127.1025 }, // 서울 송파구 올림픽로 300
  { name: "DM대전둔산2",      lat: 36.3504, lng: 127.3845 }, // 대전 서구 대덕대로168번길 32
  { name: "DM오피스그룹",     lat: 37.5596, lng: 126.8321 }, // 서울 강서구 마곡동로10길 46
  { name: "DM프로젝트오피스", lat: 37.5745, lng: 126.9847 }, // 서울 종로구 인사동5길 42
  { name: "DM드림OC",         lat: 37.3935, lng: 127.1112 }, // 경기 성남시 수정구 대왕판교로 943
  { name: "DM부산센텀",       lat: 35.1690, lng: 129.1299 }, // 부산 해운대구 해운대로 195
  { name: "DM공간플러스",     lat: 37.5038, lng: 127.1219 }, // 서울 송파구 오금로 310
  { name: "DM공간플러스",     lat: 37.5577, lng: 126.9238 }, // 서울 마포구 동교로25길 54
  { name: "DM대구칠성",       lat: 35.8573, lng: 128.6272 }, // 대구 수성구 무학로 113
  { name: "DM대구칠성",       lat: 35.8680, lng: 128.6016 }, // 대구 중구 달구벌대로 2077
  { name: "DM송파문정",       lat: 37.5222, lng: 127.0394 }, // 서울 강남구 도산대로25길 21
  { name: "DM광주남구2",      lat: 35.1367, lng: 126.9103 }, // 광주 남구 봉선로 16
  { name: "DM더라이즈",       lat: 37.5568, lng: 126.9225 }, // 서울 마포구 양화로 78
];

// 지방 우선 매칭 규칙
const REGION_MATE_RULES: { keywords: string[]; mate: string }[] = [
  { keywords: ["부산", "경상남도", "경남", "울산"], mate: "DM부산센텀" },
  { keywords: ["대구", "경상북도", "경북"], mate: "DM대구칠성" },
  { keywords: ["대전", "충청", "충남", "충북", "세종"], mate: "DM대전둔산2" },
  { keywords: ["광주", "전라", "전남", "전북", "제주"], mate: "DM광주남구2" },
];

// 주소에서 지방 우선 매칭 MATE 반환 (없으면 null)
export function getRegionMate(address: string): string | null {
  for (const rule of REGION_MATE_RULES) {
    if (rule.keywords.some(k => address.includes(k))) return rule.mate;
  }
  return null;
}

export const REGION_COORDS: Record<string, [number, number]> = {
  "서울 강남구": [37.5172, 127.0473], "서울 서초구": [37.4837, 127.0324],
  "서울 송파구": [37.5145, 127.1059], "서울 마포구": [37.5622, 126.9015],
  "서울 금천구": [37.4604, 126.9004], "서울 강서구": [37.5573, 126.8298],
  "서울 종로구": [37.5735, 126.9793], "서울 중구":   [37.5639, 126.9975],
  "서울 영등포구": [37.5259, 126.8968], "서울 성동구": [37.5506, 127.0408],
  "서울 구로구": [37.4954, 126.8874], "서울 관악구": [37.4784, 126.9516],
  "서울 용산구": [37.5384, 126.9654], "서울 강동구": [37.5302, 127.1238],
  "서울 노원구": [37.6542, 127.0568], "서울 은평구": [37.6026, 126.9295],
  "서울 서대문구": [37.5791, 126.9368], "서울 동작구": [37.5124, 126.9393],
  "서울 광진구": [37.5388, 127.0822], "서울 동대문구": [37.5743, 127.0403],
  "서울 성북구": [37.6066, 127.0201], "서울 양천구": [37.5270, 126.8554],
  "서울 강북구": [37.6397, 127.0254], "서울 도봉구": [37.6688, 127.0469],
  "서울 중랑구": [37.5963, 127.0927],
  "경기 성남시 분당구": [37.3595, 127.1044], "경기 성남시 수정구": [37.4458, 127.1368],
  "경기 성남시 중원구": [37.4197, 127.1268], "경기 안산시 단원구": [37.3221, 126.8309],
  "경기 안양시 동안구": [37.3939, 126.9545], "경기 군포시": [37.3616, 126.9349],
  "경기 구리시": [37.5949, 127.1296], "경기 수원시": [37.2636, 127.0286],
  "경기 화성시": [37.1996, 126.8312], "경기 용인시": [37.2411, 127.1775],
  "경기 고양시": [37.6584, 126.8320], "경기 부천시": [37.5034, 126.7660],
  "경기 시흥시": [37.3800, 126.8030],
  "부산 해운대구": [35.1629, 129.1601], "부산 동래구": [35.1969, 129.0849],
  "부산 서구":     [35.0980, 129.0246], "부산 중구":   [35.1030, 129.0321],
  "대전 서구":     [36.3550, 127.3832], "대전 유성구": [36.3622, 127.3561],
  "대구 수성구":   [35.8581, 128.6300], "대구 중구":   [35.8701, 128.5980],
  "대구 달서구":   [35.8298, 128.5331],
  "광주 남구":     [35.1337, 126.9003], "광주 광산구": [35.1398, 126.7936],
  "인천 서구":     [37.5456, 126.6724], "인천 부평구": [37.5073, 126.7224],
  "인천 미추홀구": [37.4638, 126.6508], "인천 남동구": [37.4469, 126.7314],
  // 경남
  "경남 창원시": [35.2279, 128.6811], "경남 진주시": [35.1797, 128.1076],
  "경남 김해시": [35.2342, 128.8892], "경남 거제시": [34.8800, 128.6211],
  // 경북
  "경북 포항시": [36.0190, 129.3435], "경북 경주시": [35.8562, 129.2249],
  "경북 구미시": [36.1195, 128.3446], "경북 안동시": [36.5684, 128.7294],
  // 충청
  "충남 천안시": [36.8151, 127.1139], "충남 아산시": [36.7898, 127.0022],
  "충북 청주시": [36.6424, 127.4890], "충북 충주시": [36.9910, 127.9259],
  "세종": [36.4800, 127.2890],
  // 전라
  "전남 여수시": [34.7604, 127.6622], "전남 순천시": [34.9506, 127.4872],
  "전남 목포시": [34.8118, 126.3922],
  "전북 전주시": [35.8242, 127.1480], "전북 익산시": [35.9483, 126.9577],
  "전북 군산시": [35.9675, 126.7368],
  // 제주
  "제주": [33.4890, 126.4983], "제주시": [33.4996, 126.5312],
  "서귀포시": [33.2541, 126.5600],
  // 울산
  "울산 남구": [35.5384, 129.3114], "울산 중구": [35.5695, 129.3317],
  "울산 북구": [35.5823, 129.3610], "울산 동구": [35.5051, 129.4163],
};

function haversine(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180)
    * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function findNearestMate(lat: number, lng: number): string {
  let best = MATES[0], bestDist = Infinity;
  for (const m of MATES) {
    const d = haversine(lat, lng, m.lat, m.lng);
    if (d < bestDist) { bestDist = d; best = m; }
  }
  return best.name;
}

// 거리순 MATE 이름 목록 반환 (중복 이름 제거, 가까운 순)
// address가 주어지면 지방 우선 규칙 먼저 적용
export function findMatesByDistance(lat: number, lng: number, address = ""): string[] {
  // 지방 우선 매칭
  const regionMate = getRegionMate(address);

  const dists = MATES.map(m => ({ name: m.name, dist: haversine(lat, lng, m.lat, m.lng) }));
  dists.sort((a, b) => a.dist - b.dist);
  const seen = new Set<string>();
  const sorted = dists
    .filter(m => { if (seen.has(m.name)) return false; seen.add(m.name); return true; })
    .map(m => m.name);

  // 지방 규칙 있으면 해당 MATE를 맨 앞으로
  if (regionMate && sorted.includes(regionMate)) {
    return [regionMate, ...sorted.filter(n => n !== regionMate)];
  }
  return sorted;
}

export function coordsForRegion(region: string): [number, number] | null {
  if (!region) return null;
  if (REGION_COORDS[region]) return REGION_COORDS[region];
  for (const k of Object.keys(REGION_COORDS)) {
    if (region.startsWith(k) || k.startsWith(region)) return REGION_COORDS[k];
  }
  const parts = region.split(" ");
  for (let n = parts.length - 1; n >= 1; n--) {
    const sub = parts.slice(0, n).join(" ");
    for (const k of Object.keys(REGION_COORDS)) {
      if (k.startsWith(sub)) return REGION_COORDS[k];
    }
  }
  return null;
}

export function normalizeAddr(addr: string): string {
  return addr.trim()
    .replace(/^서울특별시\s*/, "서울 ").replace(/^서울시\s*/, "서울 ")
    .replace(/^경기도\s*/, "경기 ").replace(/^부산광역시\s*/, "부산 ")
    .replace(/^대전광역시\s*/, "대전 ").replace(/^대구광역시\s*/, "대구 ")
    .replace(/^광주광역시\s*/, "광주 ").replace(/^인천광역시\s*/, "인천 ")
    .replace(/^울산광역시\s*/, "울산 ").replace(/^세종특별자치시\s*/, "세종 ");
}

export function parseCSVText(text: string): string[][] {
  const lines = text.split(/\r?\n/);
  const rows: string[][] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    const row: string[] = [];
    let inQ = false, cell = "";
    for (let i = 0; i < line.length; i++) {
      if (line[i] === '"') inQ = !inQ;
      else if (line[i] === ',' && !inQ) { row.push(cell); cell = ""; }
      else cell += line[i];
    }
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

export function toCSVText(rows: string[][]): string {
  return rows.map(r =>
    r.map(c => {
      const s = String(c ?? "");
      return (s.includes(',') || s.includes('"') || s.includes('\n'))
        ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(",")
  ).join("\n");
}
