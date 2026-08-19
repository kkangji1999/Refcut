/* 초당 장수를 정확히 읽는가 — 진짜 앱에 23.976 영상을 물려 확인한다.
   =========================================================================
   방송·영화에서 실제로 쓰이는 값은 24000/1001 = 23.976023... 이다.
   그런데 프레임 시각은 그릇의 눈금(1/1000초 · 1/24000초 …)에 맞춰 반올림되어
   오기 때문에, 간격 하나만 재면 23.9751 이나 23.981 처럼 어긋난다.
   실제로 v26.8.2506 까지 정보창에 그렇게 떴다.

   여기서는 23.976 짜리 영상을 만들어 앱에 넣고,
     · 잰 값이 표준 초당 장수로 되돌아오는가
     · 정보창에 "23.976" 으로 뜨는가
   를 본다. 프레임 자체는 건드리지 않으므로(뽑는 시각은 진짜 pts 를 쓴다)
   여기서 보는 것은 '표시와 한 장씩 이동' 의 정확도다.

   쓰는 법:  npm run test:app     (창은 뜨지만 곧 스스로 닫힌다)
   ========================================================================= */
const { app, BrowserWindow } = require("electron");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");

require(path.join(__dirname, "..", "main.js"));

const OUT = path.join(__dirname, "_생성물");
const CLIP = path.join(OUT, "ntsc2398.mp4");
const NTSC = 24000 / 1001;

function ffmpegBin() {
  try { return require("ffmpeg-static"); }
  catch (e) { return process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg"; }
}
/* 23.976 짜리 8초 영상 하나 (내용은 아무래도 좋다 — 시각만 본다) */
const makeClip = () => new Promise((res, rej) => {
  fs.mkdirSync(OUT, { recursive: true });
  const ff = spawn(ffmpegBin(), [
    "-v", "error", "-y",
    "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=24000/1001:duration=8",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", "24000/1001", CLIP,
  ], { stdio: ["ignore", "ignore", "pipe"] });
  let err = "";
  ff.stderr.on("data", (d) => (err += d));
  ff.on("close", (c) => (c === 0 ? res() : rej(new Error(err.slice(0, 300)))));
  ff.on("error", rej);
});

const waitWindow = () => new Promise((res) => {
  const t = setInterval(() => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w && !w.webContents.isLoading()) { clearInterval(t); res(w); }
  }, 200);
});

app.whenReady().then(async () => {
  try {
    if (!fs.existsSync(CLIP)) await makeClip();
    const win = await waitWindow();
    win.webContents.on("console-message", (_e, lvl, msg) => {
      if (lvl >= 2 && !/Content-Security-Policy/.test(msg)) console.log("  [화면 오류]", msg);
    });

    const r = await win.webContents.executeJavaScript(`(async()=>{
      const FILE=${JSON.stringify(CLIP)};
      const p=await window.CG.probe(FILE);
      const item={name:"ntsc2398.mp4", path:FILE, duration:p.duration, fps:p.fps,
                  w:p.width, h:p.height, size:p.size, type:"video/mp4"};
      const F=await scanEl(item,"");
      const one=1/F._unit;                 // 예전 방식: 가운데 간격 하나
      const got=resolveFps(item.fps, F._rate);
      return { declared:p.fps, oldWay:one, measured:F._rate,
               fps:got.fps, src:got.src, shown:fmtFps(got.fps), frames:F.length };
    })()`);

    let fail = 0;
    const ok = (name, cond, extra) => {
      if (!cond) fail++;
      console.log((cond ? "통과  " : "실패  ") + name + (extra ? "\n      " + extra : ""));
    };
    console.log("\n=== 23.976 영상 (" + r.frames + "장) ===");
    console.log("파일 표기      " + r.declared);
    console.log("예전 방식      " + r.oldWay.toFixed(4) + "   (가운데 간격 하나)");
    console.log("전체 평균      " + r.measured.toFixed(4));
    console.log("최종           " + r.fps + "  (" + r.src + ")");
    console.log("정보창 표시    " + r.shown + " fps\n");

    ok("최종 값이 24000/1001 이다", Math.abs(r.fps - NTSC) < 1e-9,
       "나온 값 " + r.fps);
    ok('정보창에 "23.976" 으로 뜬다', r.shown === "23.976", "나온 값 " + r.shown);
    ok("예전 방식은 실제로 어긋났다 (고칠 값이 맞았다)",
       Math.abs(r.oldWay - NTSC) > 1e-6,
       "예전 방식도 정확하면 이 시험은 뜻이 없다");

    console.log("\n---------------- 결과 ----------------");
    console.log(fail ? fail + "개 실패" : "전부 통과");
    app.exit(fail ? 1 : 0);
  } catch (e) {
    console.log("터짐:", String((e && e.message) || e));
    app.exit(1);
  }
});
