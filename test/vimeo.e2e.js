/* 비메오 — 영상 페이지도 심는 주소도 막힌 영상을 끝까지 뽑아내는가 (인터넷이 있어야 한다)
   =========================================================================
   왜 필요한가 — 2026-09-29, vimeo.com/1174710579 를 넣었더니 추출 실패 창에
   "could not find corresponding trex …" 같은 영어가 가득 떴다.
     · 영상 페이지 → "로그인해야 한다", 심는 주소(player.vimeo.com) → 401
       (링크 ①~⑥ 이 모두 막혀 재생 창으로 넘어간다)
     · 재생 창이 /v2/range/…&range=986-77040 같은 77KB 조각 하나를 영상으로 잡았다
   이제는 조각을 거르고, 페이지가 부르는 설정(config)에서 온전한 HLS 목록을 꺼낸다.
   보는 것:
     · 대기열에 비메오가 올라 추출까지 끝나는가 (컷이 나오는가)
     · 이름이 비메오에 적힌 제목인가 (조각 파일 이름 · "Vimeo의 동영상" 꼬리가 아니라)
     · 받은 화질이 1080p 인가 (조각은 한 화질의 한 토막이었다)
   쓰는 법:  npm run test:vimeo
   ========================================================================= */
const { app, BrowserWindow } = require("electron");
const path = require("path");
const ROOT = path.join(__dirname, "..");
require("./_격리")(app, "vimeo");
require(path.join(ROOT, "main.js"));

const waitWindow = () => new Promise(res => {
  const t = setInterval(() => { const w = BrowserWindow.getAllWindows()[0];
    if (w && !w.webContents.isLoading()) { clearInterval(t); res(w); } }, 200);
});
const 대상 = { page: "https://vimeo.com/1174710579", 제목: "Coinbase" };

app.whenReady().then(async () => {
 try {
  const win = await waitWindow();
  const r = await win.webContents.executeJavaScript(`(async()=>{
    const 잠깐=ms=>new Promise(r=>setTimeout(r,ms));
    const g=document.getElementById("gSkip"); if(g) g.click();
    const 알림=[]; const 원래=window.appAlert;
    S.queue=[];
    addLink(${JSON.stringify(대상.page)}, null, "", null);
    let q=null;
    for(let i=0;i<180;i++){
      await 잠깐(500);
      q=S.queue.find(x=>!x.checking && x.isLink);
      if(q) break;
    }
    if(!q) return { 줄:S.queue.map(x=>x.name), 대기열:null };
    const 대기열={name:q.name, url:q.url, heights:q.heights||[], height:q.height};
    closeDlg(null);
    await startRun();
    await 잠깐(500);
    const 창=document.getElementById("dlg").classList.contains("on")
      ? document.getElementById("dlgTitle").textContent+" / "+document.getElementById("dlgBody").textContent.slice(0,300) : "";
    const j=HIST[0]||{};
    return { 대기열, 창, 기록:{name:j.name||"", 장:(j.shots||[]).length, w:(j.meta||{}).w||j.w||0, h:(j.meta||{}).h||j.h||0} };
  })()`, true);

  const 실패 = [];
  console.log("\n=== 비메오 (로그인 요구 · 퍼가기 제한) ===");
  if (!r.대기열) { console.log("  대기열         " + (r.줄 || []).join(" · ")); 실패.push("대기열에 오르지 않았다"); }
  else {
    console.log("  대기열         " + r.대기열.name + " · 화질 [" + r.대기열.heights.join(" ") + "] → " + r.대기열.height + "p");
    console.log("  받은 곳        " + r.대기열.url.slice(0, 90) + "…");
    console.log("  추출           " + (r.기록.장 ? `${r.기록.name} · ${r.기록.장}장` : "기록 없음")
                + (r.창 ? " · 창: " + r.창 : ""));
    if (/range=|\/range\//.test(r.대기열.url)) 실패.push("조각 주소를 영상으로 잡았다");
    if (!r.대기열.name.includes(대상.제목)) 실패.push("이름이 비메오 제목이 아니다: " + r.대기열.name);
    if (/Vimeo의|동영상 및 영화/.test(r.대기열.name)) 실패.push("이름에 사이트 꼬리가 붙었다");
    if (r.대기열.height !== 1080) 실패.push(`1080p 로 받지 않았다 (${r.대기열.height}p)`);
    if (!(r.기록.장 > 3)) 실패.push("추출이 끝나지 않았다");
    if (/trex|tfhd|deprecated/i.test(r.창 || "")) 실패.push("영어 오류가 떴다");
  }
  console.log(실패.length ? "\n실패" : "\n---------------- 결과 ----------------\n전부 통과");
  실패.forEach(x => console.log("  " + x));
  app.exit(실패.length ? 1 : 0);
 } catch (e) { console.log("시험 자체가 넘어졌다\n" + (e.stack || e)); app.exit(1); }
});
