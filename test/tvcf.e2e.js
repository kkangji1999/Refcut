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

  console.log(실패.length ? "\n실패" : "\n---------------- 결과 ----------------\n전부 통과");
  실패.forEach(x => console.log("  " + x));
  app.exit(실패.length ? 1 : 0);
 } catch (e) { console.log("시험 자체가 넘어졌다\n" + (e.stack || e)); app.exit(1); }
});
