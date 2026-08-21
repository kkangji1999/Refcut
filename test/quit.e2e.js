/* 앱이 꺼질 때 띄워둔 ffmpeg 를 데리고 나가는지 확인한다.
   =========================================================================
   ★ 2026-08-21, 동료 컴퓨터에서 v26.8.2511 설치가 통째로 실패했다.
         Reftown cannot be closed. please close it manually and click retry
         Failed to uninstall old application files ... :2
     옛 버전은 지워지고 새 버전은 안 들어와, 프로그램이 아예 안 켜졌다.

     ffmpeg 는 설치 폴더 안(resources\bin\ffmpeg.exe)에서 돌아간다.
     그런데 앱이 꺼져도 아무도 그것을 죽이지 않아 그대로 살아남았고,
     윈도우는 '돌고 있는 프로그램의 파일' 을 지우지 못하므로
     설치 프로그램이 옛 폴더를 지우다 실패한 것이다.
     백신(V3)이 파일을 붙잡고 있는 컴퓨터에서 유난히 잘 났다.

   여기서 확인하는 것:
     ① 앱이 일을 시키면 진짜로 ffmpeg 가 돌기 시작한다
     ② 꺼지는 길목(before-quit)을 지나면 그것이 하나도 남지 않는다

   쓰는 법:  npm run test:quit     (인터넷이 필요 없다 · 윈도우 전용)
   ========================================================================= */
const { app, BrowserWindow } = require("electron");
const path = require("path");
const fs = require("fs");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(__dirname, "_생성물");
/* ★ 짧은 영상은 우리가 확인하기도 전에 ffmpeg 가 끝나버린다.
     일부러 긴 것을 만들어 두고, 도중에 붙잡아 확인한다. */
const 긴영상 = path.join(OUT, "quit_긴영상.mp4");
const 시험방 = require("./_격리")(app, "quit");
require(path.join(ROOT, "main.js"));

let bad = 0;
const ok = (name, cond, extra) => {
  console.log((cond ? "통과  " : "실패  ") + name + (extra ? "  — " + extra : ""));
  if (!cond) bad++;
};
const 잠깐 = (ms) => new Promise((r) => setTimeout(r, ms));

const waitWindow = () => new Promise((res) => {
  const t = setInterval(() => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w && !w.webContents.isLoading()) { clearInterval(t); res(w); }
  }, 200);
});

/* 지금 돌고 있는 ffmpeg 들의 번호(pid). 이름으로 세면 다른 프로그램의
   ffmpeg 까지 섞이므로, 우리가 띄우기 '전후' 를 견주어 우리 것만 골라낸다. */
function ffmpeg들() {
  const r = spawnSync("tasklist",
    ["/fi", "imagename eq ffmpeg.exe", "/nh", "/fo", "csv"],
    { encoding: "utf8", windowsHide: true });
  const 목록 = new Set();
  for (const 줄 of String(r.stdout || "").split("\n")) {
    const m = 줄.match(/^"ffmpeg\.exe","(\d+)"/i);
    if (m) 목록.add(m[1]);
  }
  return 목록;
}
const 살아있나 = (pid) => ffmpeg들().has(pid);

/* 긴 시험용 영상 하나 — ffmpeg 가 스스로 그린다 (파일도 인터넷도 필요 없다) */
function 긴영상만들기() {
  if (fs.existsSync(긴영상) && fs.statSync(긴영상).size > 0) return;
  fs.mkdirSync(OUT, { recursive: true });
  const ff = require("ffmpeg-static");
  console.log("  긴 시험용 영상을 만드는 중...");
  spawnSync(ff, ["-y", "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=24",
                 "-t", "600", "-c:v", "libx264", "-preset", "ultrafast",
                 "-pix_fmt", "yuv420p", 긴영상],
            { windowsHide: true, stdio: "ignore" });
}

app.whenReady().then(async () => {
  try {
    if (process.platform !== "win32") {
      console.log("\n이 시험은 윈도우에서만 뜻이 있습니다 (tasklist 를 씁니다).");
      app.exit(0); return;
    }
    긴영상만들기();
    ok("긴 시험용 영상이 준비되었다",
       fs.existsSync(긴영상) && fs.statSync(긴영상).size > 0);

    const win = await waitWindow();

    console.log("\n=== 앱에게 오래 걸리는 일을 시킨다 ===");
    const 이전 = ffmpeg들();
    const dest = path.join(시험방.저장, "quit_미리보기.mp4");
    /* 끝나기를 기다리지 않는다 — 도중에 꺼지는 상황을 만드는 것이 목적이다 */
    win.webContents.executeJavaScript(
      `window.CG.makePreview(${JSON.stringify(긴영상)}, ${JSON.stringify(dest)},
                             "quit시험", null).catch(()=>{}); 0`);

    /* ffmpeg 가 실제로 뜰 때까지 기다린다 */
    let 우리것 = [];
    for (let i = 0; i < 100 && 우리것.length === 0; i++) {
      await 잠깐(100);
      우리것 = [...ffmpeg들()].filter((p) => !이전.has(p));
    }
    ok("앱이 ffmpeg 를 띄웠다", 우리것.length > 0, "pid " + (우리것.join(", ") || "없음"));
    if (우리것.length === 0) throw new Error("ffmpeg 가 뜨지 않아 더 볼 것이 없습니다");

    console.log("\n=== 꺼지는 길목을 지난다 ===");
    app.emit("before-quit");           // 실제로 끌 때 지나는 그 자리
    await 잠깐(1000);

    const 남은 = 우리것.filter(살아있나);
    ok("꺼질 때 ffmpeg 를 데리고 나갔다", 남은.length === 0,
       남은.length ? "아직 살아 있음 pid " + 남은.join(", ") : "하나도 안 남음");

    /* 남았다면 시험이 쓰레기를 남기지 않도록 여기서 치운다 */
    for (const pid of 남은)
      spawnSync("taskkill", ["/pid", pid, "/f", "/t"], { windowsHide: true, stdio: "ignore" });
    try { fs.rmSync(dest, { force: true }); } catch (e) {}
  } catch (e) {
    console.error("시험이 도중에 멈췄습니다:", e && e.message || e);
    bad++;
  }
  console.log("\n---------------- 결과 ----------------");
  console.log(bad ? bad + " 개 실패" : "전부 통과");
  app.exit(bad ? 1 : 0);
});
