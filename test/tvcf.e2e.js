/* TVCF 주소로 넣기 — 재생 창을 거쳐 대기열까지 오는지 본다 (인터넷이 있어야 한다)
   =========================================================================
   왜 필요한가 — 2026-09-29, TVCF 해외 광고(ai…)를 넣었더니 재생 창에서
   영상이 저절로 재생되기만 하고 대기열에는 끝내 오르지 않았다.
   그 페이지는 TVCF 가 영상을 내주지 않고 유튜브 영상을 끼워(embed) 튼다.
   유튜브는 조각으로만 보내므로 재생 창이 잡을 영상 주소가 없었다.
   이제는 끼워진 유튜브를 알아보고 그 유튜브 원본 주소로 넘어가야 한다.
   보는 것:
     · 해외 광고 — 대기열에 유튜브 원본 주소로 오르는가 (TVCF 주소가 아니라)
     · 재생 창이 스스로 닫혔는가
   ★ 2026-10-01 — 문체부 IT'S THE KOREAN WAY(3분 8초)를 넣었더니 "유튜브에 똑같은
     영상은 없습니다" 가 떴다. 유튜브 검색 1등이 바로 그 영상이었다.
     대조는 앞 150초만 읽는데, 읽은 만큼을 영상 길이로 셈해서 150초가 넘는 광고는
     전부 길이가 안 맞는다고 걸러졌다. 긴 것과 짧은 것(30초 편)을 함께 본다:
     · 국내 광고 — 유튜브 짝 찾기 창에 그 유튜브 영상이 '같은 영상' 으로 뜨는가
   ★ 2026-10-02 — 네이버플러스 스토어 노크잇(30초)이 유튜브 네이버 채널에 그대로
     있는데 못 찾았다. 긴 검색어("…스토어 노크잇 열어보면 전부 내 취향, 노크잇")에
     유튜브가 16초짜리 하나만 돌려줬다. 광고 제목만으로 찾으면 1등이었다.
     또 후보 몇은 기본 통로 주소가 403 으로 막혀 화면을 못 읽고 0점이 됐다.
   쓰는 법:  npm run test:tvcf
   ========================================================================= */
const { app, BrowserWindow } = require("electron");
const path = require("path");
const ROOT = path.join(__dirname, "..");
require("./_격리")(app, "tvcf");
require(path.join(ROOT, "main.js"));

const waitWindow = () => new Promise(res => {
  const t = setInterval(() => { const w = BrowserWindow.getAllWindows()[0];
    if (w && !w.webContents.isLoading()) { clearInterval(t); res(w); } }, 200);
});
const 해외 = { page: "https://tvcf.co.kr/play/ai1949-1029594", yt: "0icZVfZjy3A" };
/* 관계 — 그 유튜브 영상이 어떤 사이로 설명돼야 하는가 (짝 찾기 창의 꼬리표 글) */
const 짝 = [
  { 이름: "긴 광고 3분 8초", page: "https://tvcf.co.kr/play/ai1661-1029766", yt: "WjwCSJX8hjQ", 관계: "같은 영상" },
  { 이름: "짧은 광고 30초",  page: "https://tvcf.co.kr/play/ai1683-1029768", yt: null },
  { 이름: "구구스 30초",     page: "https://tvcf.co.kr/play/ai1325-1029932", yt: "mPzud6w_X2A", 관계: "같은 영상" },
  { 이름: "노크잇 30초",     page: "https://tvcf.co.kr/play/bi1293-1026129", yt: "X7SrWiHo1yE", 관계: "같은 영상" },
  /* TVCF 20초 — 유튜브에는 장면이 더 들어간 31초 판만 있다 (끝 멈춤 화면이 아니다) */
  { 이름: "GH 20초 → 31초 판", page: "https://tvcf.co.kr/play/bi1977-1029997", yt: "pnpMaQdPKCQ", 관계: "더 긴 판" },
];
/* 재생 창을 거쳐 유튜브 짝 찾기가 결론을 낼 때까지 기다린다.
   고를 것이 나오면 창의 후보와 설명을 읽고, 첫 후보의 [장면 맞대 보기] 그림이 오는지도 본다.
   찾는 동안 그 TVCF 줄이 대기열에서 붙잡혀 있었는지(추출에 끌려가지 않는지)도 함께 본다. */
const 짝찾기 = (win, page) => win.webContents.executeJavaScript(`(async()=>{
  const 잠깐=ms=>new Promise(r=>setTimeout(r,ms));
  const P=${JSON.stringify(page)};
  if(TW.cur) 짝창닫기();
  S.queue=[]; TWIN.clear();
  addLink(P, null, "", null);
  let 붙잡힘=null;
  for(let i=0;i<240;i++){
    await 잠깐(500);
    const t=TWIN.get(P);
    const 줄=S.queue.find(x=>x.referer===P && !x.checking);
    if(줄 && t && !t.choice && 붙잡힘===null) 붙잡힘=짝붙잡힘(줄);
    if(t && t.choice) return { 결론:"없음", 붙잡힘 };
    if(t && t.state==="고르기"){
      if(TW.cur!==t){ if(TW.cur) 짝창닫기(); 짝창열기(t); }
      const 후보=[...document.querySelectorAll("#twBody .twCard")].map(l=>({
        id:l.dataset.id, 꼬리표:l.querySelector(".twTag").innerText, 설명:l.querySelector(".twDesc").innerText}));
      const 제목=$("twTitle").textContent;
      let 그림=-1;
      const b=document.querySelector('#twBody button[data-act="frames"]');
      if(b){ b.click();
        for(let k=0;k<80;k++){ await 잠깐(500);
          const box=document.getElementById("twFr"+b.dataset.i);
          if(box && box.dataset.html){ 그림=box.querySelectorAll("img").length; break; } } }
      t.choice="시험"; 짝창닫기();
      return { 결론:"있음", 제목, 후보, 그림, 붙잡힘 };
    }
  }
  return { 결론:"시간 초과", 붙잡힘 };
})()`, true);

app.whenReady().then(async () => {
 try {
  const win = await waitWindow();
  const r = await win.webContents.executeJavaScript(`(async()=>{
    const 잠깐=ms=>new Promise(r=>setTimeout(r,ms));
    const g=document.getElementById("gSkip"); if(g) g.click();
    S.queue=[];
    addLink(${JSON.stringify(해외.page)}, null, "", null);
    let q=null;
    for(let i=0;i<120;i++){
      await 잠깐(500);
      q=S.queue.find(x=>!x.checking && /youtube\\.com|youtu\\.be/.test(x.url||""));
      if(q) break;
    }
    return { 줄: S.queue.map(x=>({url:x.url, name:x.name, checking:!!x.checking})),
             유튜브: q ? {url:q.url, name:q.name, heights:q.heights||[]} : null };
  })()`, true);
  const 재생창남음 = BrowserWindow.getAllWindows().length > 1;

  const 실패 = [];
  console.log("\n=== TVCF 해외 광고 (유튜브를 끼워 둔 페이지) ===");
  console.log("  대기열         " + r.줄.map(x => `${x.name} <${x.url}>`).join(" · "));
  if (r.유튜브) console.log("  유튜브 원본    " + r.유튜브.url + " · 화질 [" + r.유튜브.heights.join(" ") + "]");
  console.log("  재생 창        " + (재생창남음 ? "남아 있다" : "스스로 닫혔다"));
  if (!r.유튜브) 실패.push("해외 광고가 대기열에 오르지 않았다");
  else if (!r.유튜브.url.includes(해외.yt)) 실패.push("끼워진 것과 다른 유튜브 영상이 올랐다");
  if (r.줄.some(x => x.url === 해외.page)) 실패.push("TVCF 주소 줄이 대기열에 남아 있다");
  if (재생창남음) 실패.push("재생 창이 닫히지 않았다");

  for (const c of 짝) {
    const m = await 짝찾기(win, c.page);
    console.log(`\n=== TVCF 국내 광고의 유튜브 짝 — ${c.이름} ===`);
    console.log("  결론           " + m.결론 + (m.제목 ? "  — " + m.제목 : ""));
    (m.후보 || []).forEach(x => console.log("  후보           " + x.id + " · [" + x.꼬리표 + "] " + x.설명));
    if (m.그림 >= 0) console.log("  장면 맞대 보기 그림 " + m.그림 + "장");
    console.log("  찾는 동안      TVCF 줄이 " + (m.붙잡힘 === null ? "대기열에 오기 전에 끝났다" : m.붙잡힘 ? "붙잡혀 있었다" : "붙잡히지 않았다"));
    if (m.결론 === "시간 초과") 실패.push(c.이름 + ": 짝 찾기가 끝나지 않았다");
    const 그것 = (m.후보 || []).find(x => x.id === c.yt);
    if (c.yt && !그것) 실패.push(c.이름 + ": 유튜브의 짝(" + c.yt + ")을 찾지 못했다");
    if (그것 && c.관계 && !그것.꼬리표.startsWith(c.관계))
      실패.push(c.이름 + ": '" + c.관계 + "' 이어야 하는데 '" + 그것.꼬리표 + "' 로 설명했다");
    if (m.결론 === "있음" && m.그림 === 0) 실패.push(c.이름 + ": 장면 맞대 보기 그림을 한 장도 못 떠 왔다");
    if (m.붙잡힘 === false) 실패.push(c.이름 + ": 찾는 동안 TVCF 줄이 붙잡히지 않았다 (추출에 끌려간다)");
  }

  /* ★ 연달아 넣기 — 둘을 쉬지 않고 넣고 추출까지 걸어 둔다.
       예전에는 뒤엣것의 "찾는 중" 이 앞엣것의 결과를 덮어 버리고, 추출이 TVCF 줄을
       곧바로 가져가서 유튜브에 있어도 워터마크 판을 받았다.
       · 두 짝 모두 결과가 남아 있어야 한다 (버려지지 않는다)
       · 고르기 전에는 두 TVCF 줄 모두 추출에 끌려가지 않아야 한다 */
  const 연달아 = await win.webContents.executeJavaScript(`(async()=>{
    const 잠깐=ms=>new Promise(r=>setTimeout(r,ms));
    const A=${JSON.stringify(짝[2].page)}, B=${JSON.stringify(짝[3].page)};
    if(TW.cur) 짝창닫기();
    S.queue=[]; TWIN.clear();
    addLink(A, null, "", null);
    await 잠깐(300);
    addLink(B, null, "", null);
    /* 두 TVCF 줄이 대기열에 오르면 바로 추출을 건다 */
    for(let i=0;i<120;i++){ await 잠깐(500);
      if(S.queue.filter(x=>x.referer && !x.checking).length>=2) break; }
    const 끌려감=[];
    let 걸었음=false;
    if(!S.running){ startRun(); 걸었음=true; }
    for(let i=0;i<240;i++){ await 잠깐(500);
      S.queue.filter(x=>x.referer && x.status!=="wait").forEach(x=>{ if(!끌려감.includes(x.referer)) 끌려감.push(x.referer); });
      const a=TWIN.get(A), b=TWIN.get(B);
      if(a && b && a.state!=="찾는중" && b.state!=="찾는중") break; }
    const 상태=[A,B].map(p=>{ const t=TWIN.get(p); return t ? {state:t.state, choice:t.choice, 수:(t.result&&t.result.list||[]).length} : null; });
    ABORT=true; await 잠깐(1200);
    if(TW.cur) 짝창닫기();
    TWIN.forEach(t=>{ if(!t.choice) t.choice="시험"; });
    return { 상태, 끌려감, 걸었음 };
  })()`, true);
  console.log("\n=== 연달아 넣고 곧바로 추출 걸기 ===");
  연달아.상태.forEach((x, i) => console.log("  " + (i ? "노크잇" : "구구스") + "         " + JSON.stringify(x)));
  console.log("  추출에 끌려간 TVCF 줄  " + (연달아.끌려감.length ? 연달아.끌려감.join(" · ") : "없음"));
  연달아.상태.forEach((x, i) => {
    if (!x || x.state !== "고르기" || !x.수) 실패.push("연달아: " + (i ? "노크잇" : "구구스") + " 의 짝 찾기 결과가 남아 있지 않다");
  });
  if (연달아.끌려감.length) 실패.push("연달아: 고르기 전에 TVCF 줄이 추출에 끌려갔다");

  console.log(실패.length ? "\n실패" : "\n---------------- 결과 ----------------\n전부 통과");
  실패.forEach(x => console.log("  " + x));
  app.exit(실패.length ? 1 : 0);
 } catch (e) { console.log("시험 자체가 넘어졌다\n" + (e.stack || e)); app.exit(1); }
});
