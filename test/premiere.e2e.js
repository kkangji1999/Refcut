/* 프리미어가 못 여는 영상을 여는 사본으로 바꾸는가 · 뽑은 음원이 어디서나 열리는가.
   =========================================================================
   유튜브에서 최고 화질로 받은 영상은 속이 VP9 · opus 인 때가 많다.
   그래서 ① 구간 음원이 .opus 로 떠져서 기본 재생기·프리미어가 열지 못했고
          ② 영상 자체도 프리미어에 끌어다 놓으면 "지원하지 않는 형식" 이었다.

     ① opus 가 담긴 영상의 구간 음원은 WAV(PCM) 로 풀려 나오는가
     ② 프리미어가 그대로 여는 영상(H.264+AAC mp4)은 "그대로 된다" 고 답하는가
     ③ mkv 속 H.264+AAC 는 다시 만들지 않고 그릇만 mp4 로 바꾸는가
     ④ webm 속 VP9+opus 는 ProRes 422 HQ + PCM 이 든 mov 로 바뀌는가
     ⑥ 같은 webm 을 MP4 로 고르면 H.264 + AAC mp4 로 바뀌는가
     ⑤ 길이가 그대로인가 · 한 번 만든 것은 다시 쓰는가

   쓰는 법:  npm run test:premiere
   ========================================================================= */
const { app, BrowserWindow } = require("electron");
const path = require("path");
const fs = require("fs");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(__dirname, "_생성물", "프리미어");
const 시험방 = require("./_격리")(app, "premiere");
require(path.join(ROOT, "main.js"));
const FF = require(path.join(ROOT, "node_modules/ffmpeg-static"));

const 슬래시 = (p) => p.split(path.sep).join("/");

const waitWindow = () => new Promise(res => {
  const t = setInterval(() => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w && !w.webContents.isLoading()) { clearInterval(t); res(w); }
  }, 200);
});

/* 4초짜리 시험 영상 — 그림·소리 방식과 그릇을 바꿔 가며 */
function 만들기(name, v, a) {
  const f = path.join(OUT, name);
  if (fs.existsSync(f)) return f;
  execFileSync(FF, ["-v", "error", "-y",
    "-f", "lavfi", "-i", "testsrc=s=320x180:r=24:d=4",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=4",
    ...v, ...a, "-ac", "2", "-ar", "48000", "-shortest", f]);
  return f;
}
const H264 = ["-c:v", "libx264", "-pix_fmt", "yuv420p"];
const VP9 = ["-c:v", "libvpx-vp9", "-b:v", "300k", "-deadline", "realtime", "-cpu-used", "8"];
const AAC = ["-c:a", "aac", "-b:a", "128k"];
const OPUS = ["-c:a", "libopus", "-b:a", "96k"];

function 속내용(f) {
  let t = "";
  try { execFileSync(FF, ["-hide_banner", "-i", f], { stdio: ["ignore", "ignore", "pipe"] }); }
  catch (e) { t = String((e.stderr || "")); }
  const dur = t.match(/Duration:\s*(\d+):(\d\d):(\d\d(?:\.\d+)?)/);
  const v = t.match(/Stream #\d+:\d+.*: Video: (\w+)/);
  const a = t.match(/Stream #\d+:\d+.*: Audio: (\w+)/);
  return {
    duration: dur ? (+dur[1]) * 3600 + (+dur[2]) * 60 + parseFloat(dur[3]) : 0,
    video: v ? v[1] : "", audio: a ? a[1] : "",
  };
}

app.whenReady().then(async () => {
  try {
    fs.mkdirSync(OUT, { recursive: true });
    const 보통 = 만들기("보통.mp4", H264, AAC);
    const 엠케이 = 만들기("그릇만.mkv", H264, AAC);
    const 웹엠 = 만들기("유튜브식.webm", VP9, OPUS);
    const 저장 = path.join(시험방.저장, "프리미어결과");
    fs.rmSync(저장, { recursive: true, force: true });
    fs.mkdirSync(저장, { recursive: true });
    const 칸 = 슬래시(저장) + "/";

    const win = await waitWindow();
    const r = await win.webContents.executeJavaScript(`(async()=>{
      const CG=window.CG, out={};
      out.음원 = await CG.audioRange({src:${JSON.stringify(슬래시(웹엠))},
        destNoExt:${JSON.stringify(칸)}+"음원", start:1, dur:2, kind:"copy", jobId:"a1"}, ()=>{});
      out.보통 = await CG.premiereCheck(${JSON.stringify(슬래시(보통))});
      out.엠케이진단 = await CG.premiereCheck(${JSON.stringify(슬래시(엠케이))});
      out.웹엠진단 = await CG.premiereCheck(${JSON.stringify(슬래시(웹엠))});
      out.엠케이 = await CG.premiereMake({src:${JSON.stringify(슬래시(엠케이))},
        destNoExt:${JSON.stringify(칸)}+"엠케이_프리미어용", jobId:"p1", format:"mp4"}, ()=>{});
      out.웹엠 = await CG.premiereMake({src:${JSON.stringify(슬래시(웹엠))},
        destNoExt:${JSON.stringify(칸)}+"웹엠_프리미어용", jobId:"p2", format:"mov"}, ()=>{});
      out.또 = await CG.premiereMake({src:${JSON.stringify(슬래시(웹엠))},
        destNoExt:${JSON.stringify(칸)}+"웹엠_프리미어용", jobId:"p3", format:"mov"}, ()=>{});
      out.웹엠mp4 = await CG.premiereMake({src:${JSON.stringify(슬래시(웹엠))},
        destNoExt:${JSON.stringify(칸)}+"웹엠_프리미어용", jobId:"p4", format:"mp4"}, ()=>{});
      return out;
    })()`, true);

    const f = [];
    /* ① */
    if (!r.음원 || !r.음원.ok) f.push(`[음원] 뽑지 못했다 — ${(r.음원 && r.음원.error) || "응답 없음"}`);
    else {
      const p = 속내용(r.음원.path);
      if (path.extname(r.음원.path) !== ".wav") f.push(`[음원] opus 가 ${path.extname(r.음원.path)} 로 나왔다 — .wav 여야 한다`);
      if (!/pcm/.test(p.audio)) f.push(`[음원] 속이 ${p.audio} 다`);
      if (Math.abs(p.duration - 2) > 0.25) f.push(`[음원] 길이가 ${p.duration.toFixed(2)}초다`);
    }
    /* ② */
    if (!r.보통 || !r.보통.ok || r.보통.need) f.push("[보통 mp4] 프리미어가 여는 영상인데 바꿔야 한다고 답했다");
    if (!r.엠케이진단 || !r.엠케이진단.need) f.push("[mkv] 바꿔야 한다는 것을 알아채지 못했다");
    if (!r.웹엠진단 || !r.웹엠진단.need || !r.웹엠진단.plans || r.웹엠진단.plans.mov.remux) f.push("[webm] 그림까지 다시 만들어야 한다는 것을 알아채지 못했다");
    /* ③ */
    if (!r.엠케이 || !r.엠케이.ok) f.push(`[mkv] 만들지 못했다 — ${(r.엠케이 && r.엠케이.error) || ""}`);
    else {
      const p = 속내용(r.엠케이.path);
      if (path.extname(r.엠케이.path) !== ".mp4") f.push(`[mkv] 그릇이 ${path.extname(r.엠케이.path)} 다`);
      if (!r.엠케이.remux) f.push("[mkv] 그릇만 바꾸면 되는데 다시 만들었다");
      if (p.video !== "h264" || p.audio !== "aac") f.push(`[mkv] 속이 ${p.video}+${p.audio} 다`);
      if (Math.abs(p.duration - 4) > 0.3) f.push(`[mkv] 길이가 ${p.duration.toFixed(2)}초다`);
    }
    /* ④ */
    if (!r.웹엠 || !r.웹엠.ok) f.push(`[webm] 만들지 못했다 — ${(r.웹엠 && r.웹엠.error) || ""}`);
    else {
      const p = 속내용(r.웹엠.path);
      if (path.extname(r.웹엠.path) !== ".mov") f.push(`[webm] 그릇이 ${path.extname(r.웹엠.path)} 다`);
      if (p.video !== "prores") f.push(`[webm] 그림이 ${p.video} 다 — ProRes 여야 한다`);
      if (!/^pcm/.test(p.audio)) f.push(`[webm] 소리가 ${p.audio} 다`);
      if (Math.abs(p.duration - 4) > 0.3) f.push(`[webm] 길이가 ${p.duration.toFixed(2)}초다`);
    }
    /* ⑥ */
    if (!r.웹엠mp4 || !r.웹엠mp4.ok) f.push(`[webm→mp4] 만들지 못했다 — ${(r.웹엠mp4 && r.웹엠mp4.error) || ""}`);
    else {
      const p = 속내용(r.웹엠mp4.path);
      if (path.extname(r.웹엠mp4.path) !== ".mp4") f.push(`[webm→mp4] 그릇이 ${path.extname(r.웹엠mp4.path)} 다`);
      if (p.video !== "h264" || p.audio !== "aac") f.push(`[webm→mp4] 속이 ${p.video}+${p.audio} 다`);
      if (Math.abs(p.duration - 4) > 0.3) f.push(`[webm→mp4] 길이가 ${p.duration.toFixed(2)}초다`);
    }
    if (!r.웹엠진단 || !r.웹엠진단.plans || r.웹엠진단.plans.mov.video !== "ProRes 422 HQ")
      f.push("[webm] 변환 전 안내에 MOV 가 무엇으로 바뀌는지 나오지 않는다");
    /* ⑤ */
    if (!r.또 || !r.또.ok || !r.또.reused) f.push("[webm] 한 번 만든 사본을 다시 쓰지 않고 또 만들었다");

    console.log("");
    for (const k of ["음원", "엠케이", "웹엠", "웹엠mp4"]) {
      const x = r[k];
      const p = x && x.ok ? 속내용(x.path) : null;
      console.log(`${k.padEnd(4)} ${x && x.ok ? path.basename(x.path) : "실패"}`
        + (p ? `  ${p.video || "-"}+${p.audio} · ${p.duration.toFixed(2)}초` : ""));
    }
    console.log("");
    if (f.length) { console.log("실패"); f.forEach(x => console.log("      " + x)); }
    else console.log("통과  프리미어가 못 여는 영상은 여는 사본으로, 음원은 어디서나 열리게 나온다");
    app.exit(f.length ? 1 : 0);
  } catch (e) {
    console.log("실패 ", e && e.message ? e.message : e);
    app.exit(1);
  }
});
