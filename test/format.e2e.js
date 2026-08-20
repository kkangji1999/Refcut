/* 여러 그릇(형식)이 대기열에 들어가고 · 추출되고 · 재생까지 되는지 본다.
   =========================================================================
   보는 것:
     · mp4 말고도 mov·mkv·avi·wmv·mpg·ts·m2ts·mxf·flv 가 대기열에 들어가는가
     · 추출이 끝까지 가는가
     · 크롬이 못 여는 형식(ProRes·AVI·WMV·MPG·TS…)도 재생 칸이 살아나는가
     · 영상이 아닌 파일은 '이유와 함께' 거절되는가 (조용히 사라지지 않는가)
   쓰는 법:  npm run test:format
   ========================================================================= */
const { app, BrowserWindow } = require("electron");
const path = require("path"); const fs = require("fs");
const { execFileSync } = require("child_process");
const ROOT = path.join(__dirname, "..");
const OUT = path.join(__dirname, "_생성물", "형식");
/* 시험은 진짜 앱데이터·기록을 건드리지 않는다 (test/_격리.js 설명 참고) */
const 시험방 = require("./_격리")(app, "format");
/* ★ 결과는 시험방 안에만 쌓는다 — 밖의 폴더를 비우면 남의 작업물이 날아간다 */
const SAVE = path.join(시험방.저장, "결과");
require(path.join(ROOT, "main.js"));
const FF = require(path.join(ROOT, "node_modules/ffmpeg-static"));

const waitWindow = () => new Promise(res => {
  const t = setInterval(() => { const w = BrowserWindow.getAllWindows()[0];
    if (w && !w.webContents.isLoading()) { clearInterval(t); res(w); } }, 200);
});

/* 장면이 두 번 바뀌는 4.5초짜리 시험 영상.
   ★ 단색으로 만들면 '빈 화면' 으로 걸러져 한 장도 안 나온다 — 무늬가 있어야 한다. */
function make(name, args) {
  const f = path.join(OUT, name);
  if (fs.existsSync(f)) return f;
  execFileSync(FF, ["-v", "error", "-y",
    "-f", "lavfi", "-i", "testsrc=s=640x360:r=24:d=1.5",
    "-f", "lavfi", "-i", "smptebars=s=640x360:r=24:d=1.5",
    "-f", "lavfi", "-i", "testsrc2=s=640x360:r=24:d=1.5",
    "-filter_complex", "[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]",
    "-map", "[v]", ...args, f]);
  return f;
}
/* ★ 소리가 들어 있는 ProRes.
   편집실에서 나오는 마스터 mov 가 대개 이 모양이다 (ProRes + PCM 소리).
   크롬은 소리를 읽을 수 있어서 '열었다' 고 답해 놓고 화면만 까맣게 둔다 —
   오류가 안 나므로, 오류만 보고 있으면 이 경우를 놓친다. */
function make소리(name, args) {
  const f = path.join(OUT, name);
  if (fs.existsSync(f)) return f;
  execFileSync(FF, ["-v", "error", "-y",
    "-f", "lavfi", "-i", "testsrc=s=640x360:r=24:d=1.5",
    "-f", "lavfi", "-i", "smptebars=s=640x360:r=24:d=1.5",
    "-f", "lavfi", "-i", "testsrc2=s=640x360:r=24:d=1.5",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=4.5",
    "-filter_complex", "[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]",
    "-map", "[v]", "-map", "3:a", "-c:a", "pcm_s16le", ...args, f]);
  return f;
}

app.whenReady().then(async () => {
 try {
  fs.mkdirSync(OUT, { recursive: true });
  fs.rmSync(SAVE, { recursive: true, force: true });
  const H264 = ["-c:v", "libx264", "-pix_fmt", "yuv420p"];
  const 영상 = [
    make("시험_mp4.mp4", H264),
    make("시험_mov.mov", H264),
    make("시험_프로레스.mov", ["-c:v", "prores_ks", "-profile:v", "2", "-pix_fmt", "yuv422p10le"]),
    make소리("시험_프로레스소리.mov",
      ["-c:v", "prores_ks", "-profile:v", "3", "-pix_fmt", "yuv422p10le"]),
    make("시험_mkv.mkv", H264),
    make("시험_avi.avi", ["-c:v", "mpeg4", "-q:v", "3"]),
    make("시험_webm.webm", ["-c:v", "libvpx", "-b:v", "800k"]),
    make("시험_wmv.wmv", ["-c:v", "msmpeg4v3", "-b:v", "800k"]),
    make("시험_mpg.mpg", ["-c:v", "mpeg2video", "-b:v", "1500k"]),
    make("시험_ts.ts", H264),
    make("시험_m2ts.m2ts", H264),
    make("시험_flv.flv", ["-c:v", "flv", "-b:v", "800k"]),
    make("시험_mxf.mxf", ["-c:v", "mpeg2video", "-b:v", "1500k"]),
  ].map(p => ({ nm: path.basename(p), p }));

  /* 영상이 아닌 것들 — 이유와 함께 거절되어야 한다 */
  const 아님 = [];
  const txt = path.join(OUT, "메모.txt");
  fs.writeFileSync(txt, "영상이 아닙니다"); 아님.push(txt);
  const mp3 = path.join(OUT, "소리.mp3");
  if (!fs.existsSync(mp3)) execFileSync(FF, ["-v", "error", "-y", "-f", "lavfi",
    "-i", "sine=frequency=440:duration=2", "-c:a", "libmp3lame", mp3]);
  아님.push(mp3);
  const 가짜 = path.join(OUT, "깨진영상.mov");
  fs.writeFileSync(가짜, Buffer.alloc(4096, 7)); 아님.push(가짜);
  const 아님목록 = 아님.map(p => ({ nm: path.basename(p), p }));

  const win = await waitWindow();
  win.webContents.on("console-message", (_e, lvl, msg) => {
    if (lvl >= 2 && !/Content-Security-Policy/.test(msg)) console.log("  [화면오류]", msg); });

  const 시나리오 = fs.readFileSync(path.join(__dirname, "format.renderer.js"), "utf8")
    .replace("__영상__", JSON.stringify(영상))
    .replace("__아님__", JSON.stringify(아님목록))
    .replace("__저장__", JSON.stringify(SAVE));
  const r = await win.webContents.executeJavaScript(시나리오, true);

  if (r.err) { console.log("시험 중 오류\n" + r.err); app.exit(1); return; }
  const 실패 = [];
  console.log("\n영상 그릇");
  for (const x of r.out) {
    console.log("  " + x.nm.padEnd(13) + " 대기열 " + (x.대기열 ? "O" : "X") +
      "  " + String(x.정보).padEnd(17) + " 추출 " + String(x.추출).padEnd(7) +
      " 재생 " + x.재생);
    if (!x.대기열) 실패.push(x.nm + " — 대기열에 들어가지 못했다");
    else if (!/장$/.test(String(x.추출))) 실패.push(x.nm + " — 추출 실패 (" + x.추출 + ")");
    else if (!/재생$/.test(String(x.재생))) 실패.push(x.nm + " — 재생 실패 (" + x.재생 + ")");
  }
  console.log("\n영상이 아닌 파일");
  for (const x of r.거절) {
    console.log("  " + x.nm.padEnd(13) + " 들어감 " + (x.들어감 ? "O" : "X") + "  안내: " + x.안내);
    if (x.들어감) 실패.push(x.nm + " — 영상이 아닌데 대기열에 들어갔다");
    else if (!x.안내) 실패.push(x.nm + " — 아무 말 없이 사라졌다");
  }
  /* ★ 같은 h264 로 담은 그릇들은 같은 자리에서 '똑같은 장' 이 나와야 한다.
     MPEG-TS 계열은 첫 장의 시각이 0 이 아니어서, 예전 방식으로는 다른 장면이
     나오거나 아예 한 장도 안 나왔다 (그리고 샷리스트에서 영영 멈췄다). */
  const crypto = require("crypto");
  const 프레임 = (base) => {
    const d = path.join(SAVE, base + "_CUTS", "분석 프레임");
    if (!fs.existsSync(d)) return null;
    return fs.readdirSync(d).sort().map(f =>
      crypto.createHash("md5").update(fs.readFileSync(path.join(d, f))).digest("hex"));
  };
  const 기준 = 프레임("시험_mp4");
  console.log("");
  console.log("같은 h264 그릇끼리 같은 장이 나오는가 (기준 mp4 "
    + (기준 ? 기준.length + "장" : "없음") + ")");
  for (const b of ["시험_mov", "시험_mkv", "시험_ts", "시험_m2ts"]) {
    const g = 프레임(b);
    const 같음 = 기준 && g && g.length === 기준.length && g.every((h, i) => h === 기준[i]);
    console.log("  " + b.padEnd(11) + (g ? g.length + "장" : "없음") + "  "
      + (같음 ? "같음" : "다름"));
    if (!같음) 실패.push(b + " — mp4 와 다른 장이 나왔다 (시각이 어긋난다)");
  }

  console.log(실패.length ? "\n실패"
    : "\n통과  모든 그릇이 들어가 추출·재생되고, 아닌 것은 이유가 뜬다");
  실패.forEach(f => console.log("      " + f));
  app.exit(실패.length ? 1 : 0);
 } catch (e) { console.error("시험을 돌리지 못했습니다:", e && e.stack); app.exit(1); }
});
