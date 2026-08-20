/* 유튜브 주소가 실제로 받아지는지 처음부터 끝까지 확인한다.
   =========================================================================
   2026 년부터 유튜브는 진짜 영상 주소를 자바스크립트로 뒤섞어 준다.
   실행기(quickjs)가 없거나 통로(player_client)를 잘못 고르면
   "목록은 읽히는데 받을 때 403" 으로 끊긴다 — 눈으로는 잘 안 보이는 실패다.
   그래서 화면 쪽 CG.ytInfo → CG.ytDownload 를 실제로 태워 파일까지 받아본다.

   쓰는 법:  npm run test:yt      (인터넷이 필요하다)
   ========================================================================= */
const { app, BrowserWindow } = require("electron");
const path = require("path");
const fs = require("fs");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(__dirname, "_생성물");
/* 시험은 진짜 앱데이터·기록을 건드리지 않는다 (test/_격리.js 설명 참고) */
const 시험방 = require("./_격리")(app, "yt");
require(path.join(ROOT, "main.js"));

const URL_ = process.argv[2] || "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
const DEST = path.join(OUT, "유튜브받기.mp4");

const waitWindow = () => new Promise((res) => {
  const t = setInterval(() => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w && !w.webContents.isLoading()) { clearInterval(t); res(w); }
  }, 200);
});

let bad = 0;
const ok = (name, cond, extra) => {
  console.log((cond ? "통과  " : "실패  ") + name + (extra ? "  — " + extra : ""));
  if (!cond) bad++;
};

app.whenReady().then(async () => {
  try {
    fs.mkdirSync(OUT, { recursive: true });
    fs.rmSync(DEST, { force: true });
    const win = await waitWindow();

    console.log("\n=== 주소 읽기 ===  " + URL_);
    const info = await win.webContents.executeJavaScript(
      `window.CG.ytInfo(${JSON.stringify(URL_)}, false, null)`);
    ok("정보를 읽었다", !!(info && info.ok), info && info.error);
    if (info && info.ok) {
      console.log("      제목 · " + info.title);
      console.log("      화질 · " + (info.heights || []).slice(0, 6).join(", "));
      console.log("      통로 · " + JSON.stringify(info.plan));
      ok("1080p 이상이 있다", (info.heights || []).some((h) => h >= 1080),
         "가장 높은 화질 " + ((info.heights || [])[0] || "?"));
    }

    console.log("\n=== 실제로 받기 (1080p 까지) ===");
    const r = await win.webContents.executeJavaScript(`
      window.CG.ytDownload(${JSON.stringify(URL_)}, ${JSON.stringify(DEST)}, 9001,
        {height:1080, plan:${JSON.stringify((info && info.plan) || null)}}, ()=>{})`);
    ok("받기 성공", !!(r && r.ok), r && r.error);
    const size = fs.existsSync(DEST) ? fs.statSync(DEST).size : 0;
    ok("파일이 생겼다", size > 1000000, (size / 1048576).toFixed(1) + " MB");

    console.log("\n---------------- 결과 ----------------");
    console.log(bad ? bad + " 가지 실패" : "전부 통과");
  } catch (e) {
    console.error("시험 자체가 멈췄습니다:", e);
    bad++;
  }
  app.exit(bad ? 1 : 0);
});
