/* 구간의 '소리만' 뽑는 길이 제대로 이어져 있는가.
   =========================================================================
   [구간 영상] 은 그림까지 다시 만드느라 무겁다. 소리만 필요할 때가 더 많아서
   소리만 뜨는 길을 따로 냈다. 여기서는 그 길을 본다.

     ① 원본 그대로 — 다시 만들지 않고 떠내는가 (담긴 방식에 맞는 그릇으로)
     ② WAV        — 압축 없이 나오는가
     ③ MP3        — 320k 로 나오는가
     ④ 잡은 구간만큼만 나오는가 (앞뒤가 더 붙지 않는가)
     ⑤ 그림이 안 들어갔는가 (소리만 뽑는 것이니 영상 줄이 있으면 안 된다)
     ⑥ 소리가 없는 영상이면 '왜 안 되는지' 를 말해주는가
     ⑦ 같은 구간을 또 뽑으면 먼저 것을 덮지 않는가

   쓰는 법:  npm run test:audio
   ========================================================================= */
const { app, BrowserWindow } = require("electron");
const path = require("path");
const fs = require("fs");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(__dirname, "_생성물", "음원");
const 시험방 = require("./_격리")(app, "audio");
require(path.join(ROOT, "main.js"));
const FF = require(path.join(ROOT, "node_modules/ffmpeg-static"));

/* 윈도우 경로의 구분자를 화면 쪽이 쓰는 모양으로 바꾼다 (역슬래시를 글에 섞지 않는다) */
const 슬래시 = (p) => p.split(path.sep).join("/");

const waitWindow = () => new Promise(res => {
  const t = setInterval(() => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w && !w.webContents.isLoading()) { clearInterval(t); res(w); }
  }, 200);
});

/* 소리가 든 6초짜리 시험 영상 (AAC) 과, 소리가 없는 것 하나 */
function 만들기(name, 소리있음) {
  const f = path.join(OUT, name);
  if (fs.existsSync(f)) return f;
  const args = ["-v", "error", "-y",
    "-f", "lavfi", "-i", "testsrc=s=320x180:r=24:d=6"];
  if (소리있음) args.push("-f", "lavfi", "-i", "sine=frequency=440:duration=6",
    "-c:a", "aac", "-b:a", "128k", "-ac", "2", "-ar", "48000");
  else args.push("-an");
  args.push("-c:v", "libx264", "-pix_fmt", "yuv420p", f);
  execFileSync(FF, args);
  return f;
}
/* 뽑힌 파일을 ffprobe 대신 ffmpeg 로 읽는다 (ffprobe 가 없는 컴퓨터도 있다) */
function 속내용(f) {
  let t = "";
  try { execFileSync(FF, ["-hide_banner", "-i", f], { stdio: ["ignore", "ignore", "pipe"] }); }
  catch (e) { t = String((e.stderr || "")); }
  const dur = t.match(/Duration:\s*(\d+):(\d\d):(\d\d(?:\.\d+)?)/);
  const a = t.match(/Stream #\d+:\d+.*: Audio: (\w+)[^\n]*/);
  return {
    duration: dur ? (+dur[1]) * 3600 + (+dur[2]) * 60 + parseFloat(dur[3]) : 0,
    audio: a ? a[1] : "",
    hasVideo: /Stream #\d+:\d+.*: Video: /.test(t),
    text: t,
  };
}

app.whenReady().then(async () => {
  try {
    fs.mkdirSync(OUT, { recursive: true });
    const 소리영상 = 만들기("소리있음.mp4", true);
    const 무음영상 = 만들기("소리없음.mp4", false);
    const 저장 = path.join(시험방.저장, "음원결과");
    fs.rmSync(저장, { recursive: true, force: true });
    fs.mkdirSync(저장, { recursive: true });

    const win = await waitWindow();
    const r = await win.webContents.executeJavaScript(`(async()=>{
      const 뽑기=(kind,src,name)=>window.CG.audioRange(
        {src, destNoExt:${JSON.stringify(슬래시(저장))}+"/"+name,
         start:1.5, dur:2, kind, jobId:"t"+Math.random()}, ()=>{});
      const out={};
      out.copy = await 뽑기("copy", ${JSON.stringify(슬래시(소리영상))}, "그대로");
      out.wav  = await 뽑기("wav",  ${JSON.stringify(슬래시(소리영상))}, "웨이브");
      out.mp3  = await 뽑기("mp3",  ${JSON.stringify(슬래시(소리영상))}, "엠피쓰리");
      out.또   = await 뽑기("copy", ${JSON.stringify(슬래시(소리영상))}, "그대로");
      out.무음 = await 뽑기("copy", ${JSON.stringify(슬래시(무음영상))}, "무음");
      return out;
    })()`, true);

    const f = [];
    const 봄 = {};

    for (const [k, 기대확장자] of [["copy", ".m4a"], ["wav", ".wav"], ["mp3", ".mp3"]]) {
      const x = r[k];
      if (!x || !x.ok) { f.push(`[${k}] 뽑지 못했다 — ${(x && x.error) || "응답 없음"}`); continue; }
      if (path.extname(x.path).toLowerCase() !== 기대확장자)
        f.push(`[${k}] 그릇이 ${path.extname(x.path)} 다 — ${기대확장자} 여야 한다`);
      if (!fs.existsSync(x.path)) { f.push(`[${k}] 파일이 실제로 없다`); continue; }
      if (!(x.size > 2000)) f.push(`[${k}] 파일이 ${x.size} 바이트뿐이다`);
      const p = 속내용(x.path); 봄[k] = p;
      /* ④ 잡은 구간(2초)만큼만 — 열쇠장까지 밀려 앞이 더 붙으면 안 된다 */
      if (Math.abs(p.duration - 2) > 0.25)
        f.push(`[${k}] 길이가 ${p.duration.toFixed(2)}초다 — 잡은 구간은 2초였다`);
      /* ⑤ 소리만 뽑는 것이니 그림 줄이 있으면 안 된다 */
      if (p.hasVideo) f.push(`[${k}] 그림이 함께 들어갔다`);
      if (!p.audio) f.push(`[${k}] 소리 줄이 없다`);
    }
    /* ① 원본 그대로는 다시 만들지 않았어야 한다 — 담긴 그대로 aac */
    if (봄.copy && 봄.copy.audio && 봄.copy.audio !== "aac")
      f.push(`[원본 그대로] 가 ${봄.copy.audio} 로 다시 만들어졌다 — 떠내기만 해야 한다`);
    if (r.copy && r.copy.ok && r.copy.kind !== "copy")
      f.push(`[원본 그대로] 가 ${r.copy.kind} 로 물러났다`);
    if (봄.wav && 봄.wav.audio && !/pcm/.test(봄.wav.audio))
      f.push(`[WAV] 속이 ${봄.wav.audio} 다`);
    if (봄.mp3 && 봄.mp3.audio && !/mp3/.test(봄.mp3.audio))
      f.push(`[MP3] 속이 ${봄.mp3.audio} 다`);

    /* ⑥ 소리가 없는 영상 */
    if (!r.무음 || r.무음.ok) f.push("소리가 없는 영상인데도 뽑았다고 답했다");
    else if (!/소리/.test(r.무음.error || ""))
      f.push(`소리가 없다는 것을 알려주지 않는다 — "${r.무음.error}"`);

    /* ⑦ 같은 자리를 또 뽑으면 먼저 것을 덮지 않는다 */
    if (r.또 && r.또.ok && r.copy && r.copy.ok && r.또.path === r.copy.path)
      f.push("같은 구간을 또 뽑았더니 먼저 받아둔 파일을 덮어썼다");

    console.log("");
    for (const k of ["copy", "wav", "mp3"]) {
      const x = r[k], p = 봄[k];
      console.log(`${k.padEnd(5)} ${x && x.ok ? path.basename(x.path) : "실패"}`
        + (p ? `  ${p.audio} · ${p.duration.toFixed(2)}초 · ${((x.size || 0) / 1024).toFixed(0)}KB` : ""));
    }
    console.log(`무음   ${(r.무음 && r.무음.error) || "(오류 없음?)"}`);
    console.log("");
    if (f.length) { console.log("실패"); f.forEach(x => console.log("      " + x)); }
    else console.log("통과  구간의 소리만 원하는 형태로 뽑힌다");
    app.exit(f.length ? 1 : 0);
  } catch (e) {
    console.log("실패 ", e && e.message ? e.message : e);
    app.exit(1);
  }
});
