/* 미리보기 사본 — 원본 화질을 지키는가, 옛 사본은 다시 만드는가
   =========================================================================
   보는 것:
     · 4K 원본이면 사본도 4K 로 나오는가 (줄이지 않는가)
     · 이미 있는 흐린 사본은 '있으니 그냥 쓴다' 하지 않고 다시 만드는가
     · 이미 기준을 채운 사본은 다시 만들지 않고 그대로 쓰는가 (헛수고 방지)
   쓰는 법:  npm run test:preview
   ========================================================================= */
const { app, BrowserWindow } = require("electron");
const path = require("path"); const fs = require("fs");
const { execFileSync } = require("child_process");
const ROOT = path.join(__dirname, "..");
/* 시험은 진짜 앱데이터·기록을 건드리지 않는다 (test/_격리.js 설명 참고) */
const 시험방 = require("./_격리")(app, "preview");
require(path.join(ROOT, "main.js"));
const FF = require(path.join(ROOT, "node_modules/ffmpeg-static"));
const OUT = path.join(시험방.방, "재료");

const waitWindow = () => new Promise(res => {
  const t = setInterval(() => { const w = BrowserWindow.getAllWindows()[0];
    if (w && !w.webContents.isLoading()) { clearInterval(t); res(w); } }, 200);
});
const 폭 = (f) => {
  /* ffmpeg -i 는 내보낼 파일을 안 주면 언제나 오류로 끝난다 —
     정보는 그 전에 stderr 로 찍히므로 거기서 가로 크기만 읽는다 */
  let t = "";
  try { execFileSync(FF, ["-hide_banner", "-i", f],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }); }
  catch (e) { t = String(e.stderr || ""); }
  const 줄 = t.split(String.fromCharCode(10)).find(x => x.indexOf("Video:") >= 0) || "";
  const m = 줄.match(/(\d{2,5})x(\d{2,5})/);
  return m ? parseInt(m[1], 10) : 0;
};
app.whenReady().then(async () => {
 try {
  fs.mkdirSync(OUT, { recursive: true });
  /* 4K ProRes + 소리 — 편집실 마스터와 같은 모양 */
  const SRC = path.join(OUT, "마스터4k.mov");
  if (!fs.existsSync(SRC)) execFileSync(FF, ["-v", "error", "-y",
    "-f", "lavfi", "-i", "testsrc=s=3840x2160:r=24:d=2",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
    "-c:v", "prores_ks", "-profile:v", "3", "-pix_fmt", "yuv422p10le",
    "-c:a", "pcm_s16le", SRC]);
  const DEST = path.join(OUT, "사본.mp4");
  fs.rmSync(DEST, { force: true });

  const win = await waitWindow();
  const 부르기 = (n) => win.webContents.executeJavaScript(
    "window.CG.makePreview(" + JSON.stringify(SRC) + "," +
    JSON.stringify(DEST) + ",'t" + n + "',()=>{})", true);

  const 실패 = [];
  const r1 = await 부르기(1);
  const w1 = 폭(DEST);
  console.log("\n① 처음 만들기      → " + (r1.ok ? "만듦" : "실패") + " · 가로 " + w1);
  if (!r1.ok || w1 !== 3840) 실패.push("4K 원본인데 사본이 4K 가 아니다 (" + w1 + ")");

  const r2 = await 부르기(2);
  console.log("② 그대로 다시 부르기 → " + (r2.reused ? "있는 것을 그대로 씀" : "★ 또 만듦"));
  if (!r2.reused) 실패.push("기준을 채운 사본인데 헛되이 다시 만들었다");

  /* 옛날 기준(720p)으로 만들어 둔 사본을 흉내 낸다 */
  execFileSync(FF, ["-v", "error", "-y", "-i", SRC, "-map", "0:v:0",
    "-vf", "scale=1280:-2", "-c:v", "libx264", "-crf", "28",
    "-pix_fmt", "yuv420p", "-an", "-f", "mp4", DEST]);
  console.log("③ 옛 720p 사본을 놓고 → 가로 " + 폭(DEST));
  const r3 = await 부르기(3);
  const w3 = 폭(DEST);
  console.log("   다시 부르기       → " + (r3.reused ? "★ 옛것을 그대로 씀" : "다시 만듦") +
    " · 가로 " + w3);
  if (r3.reused || w3 !== 3840) 실패.push("옛 흐린 사본을 그대로 썼다 (" + w3 + ")");

  console.log(실패.length ? "\n실패" : "\n통과  원본 화질을 지키고, 옛 사본은 다시 만든다");
  실패.forEach(f => console.log("      " + f));
  app.exit(실패.length ? 1 : 0);
 } catch (e) { console.error("시험을 돌리지 못했습니다:", e && e.stack); app.exit(1); }
});
