# 스타트업 DB 자동 업데이트 — Vercel 배포 가이드

## 1단계: GitHub에 올리기

```bash
git init
git add .
git commit -m "init"
# GitHub에서 새 repo 만든 후:
git remote add origin https://github.com/YOUR_ID/startup-autofill.git
git push -u origin main
```

## 2단계: Vercel에 배포

1. [vercel.com](https://vercel.com) → **Add New Project**
2. 방금 만든 GitHub repo 선택
3. Framework: **Next.js** (자동 감지됨)
4. **Environment Variables** 탭에서 추가:
   ```
   ANTHROPIC_API_KEY = sk-ant-xxxxxxxxxxxxxxxx
   ```
5. **Deploy** 클릭

배포 완료 후 `https://your-project.vercel.app` 접속하면 바로 사용 가능합니다.

---

## 로컬 테스트

```bash
npm install
ANTHROPIC_API_KEY=sk-ant-xxx npm run dev
# http://localhost:3000 접속
```

---

## 사용 방법

1. CSV 파일 업로드
2. **▶ 자동 채우기 실행** 클릭
3. 기업별 처리 현황 실시간 확인
4. 완료 후 **⬇ CSV 다운로드**

---

## 파일 구조

```
startup-autofill/
├── app/
│   ├── api/process/route.ts   ← Anthropic API 호출 (서버)
│   ├── page.tsx               ← 메인 UI
│   └── layout.tsx
├── lib/
│   └── utils.ts               ← CSV 파싱, MATE 거리 계산
├── package.json
└── next.config.js
```
