/* 진짜 앱을 띄워 처음부터 끝까지 한 번 돌린다.
   =========================================================================
   계산부만 따로 돌리는 시험(cuts·grab)은 빠르지만, 전선이 끊겨 있으면 못 잡는다.
   여기서는 실제 창을 띄우고 대기열에 영상을 넣어 추출까지 시킨 뒤,
   스타트 프레임도 만들어 본다.

   보는 것:
     · 계산부만 돌렸을 때와 같은 컷이 나오는가 (전선이 제대로 이어졌는가)
     · 분석 프레임과 스타트 프레임의 장수·번호·시각이 서로 맞는가
     · 스타트 프레임 파일이 실제로 디스크에 생겼는가

   쓰는 법:  npm run test:app     (창은 뜨지만 곧 스스로 닫힌다)
   ========================================================================= */
const { app, BrowserWindow } = require("electron");
const path = require("path");
const fs = require("fs");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(__dirname, "_생성물");
const VIDEO = path.join(OUT, "clip.mp4");

/* ★ 진짜 main.js 를 그대로 불러온다.
   창만 따로 만들면 ipcMain 손잡이(probe·scanFrames·grabPNGs...)가 하나도
   등록되지 않아 아무것도 못 한다. */
/* 시험은 진짜 앱데이터·기록을 건드리지 않는다 (test/_격리.js 설명 참고) */
const 시험방 = require("./_격리")(app, "app");
/* ★ 결과는 시험방 안에만 쌓는다 — 밖의 폴더를 비우면 남의 작업물이 날아간다 */
const SAVE = path.join(시험방.저장, "앱추출결과");
require(path.join(ROOT, "main.js"));

const waitWindow = () => new Promise(res => {
  const t = setInterval(() => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w && !w.webContents.isLoading()) { clearInterval(t); res(w); }
  }, 200);
});

app.whenReady().then(async () => {
  try {
    if (!fs.existsSync(VIDEO)) {
      fs.mkdirSync(OUT, { recursive: true });
      await require("./make-clip").make(VIDEO, false);
    }
    fs.rmSync(SAVE, { recursive: true, force: true });

    const win = await waitWindow();
    win.webContents.on("console-message", (_e, lvl, msg) => {
      if (lvl >= 2 && !/Content-Security-Policy/.test(msg)) console.log("  [화면 오류]", msg);
    });

    const r = await win.webContents.executeJavaScript(`(async()=>{
      await jobPut({id:OUTKEY, dir:${JSON.stringify(SAVE)}});
      const FILE=${JSON.stringify(VIDEO)};
      const p=await window.CG.probe(FILE);
      S.queue=[{name:"clip.mp4", path:FILE, duration:p.duration, fps:p.fps,
                w:p.width, h:p.height, size:p.size, type:"video/mp4", status:"wait"}];
      renderQueue();
      await startRun();
      if(!S.out) return {error:"추출 결과가 없습니다 · "+(statusEl.textContent||"")};
      const okStart=await buildStartShots();
      return {
        fps:S.fps, realTimes:S.realTimes, startOk:okStart,
        shots:S.out.shots.map(s=>({idx:s.idx,t:+s.t.toFixed(3),sT:+s.sT.toFixed(3)})),
        startShots:(S.out.startShots||[]).map(s=>({idx:s.idx,t:+s.t.toFixed(3),file:s.file})),
      };
    })()`, true);

    if (r.error) { console.log("실패 ", r.error); app.exit(1); return; }

    const meta = require("./make-clip");
    console.log(`초당 ${r.fps.toFixed(3)}장 · 진짜 시각 사용 ${r.realTimes ? "예" : "아니오"}`);
    console.log(`\n분석 프레임 ${r.shots.length}장`);
    r.shots.forEach(s => console.log(`  CUT${s.idx}  분석 ${s.t}s · 컷시작 ${s.sT}s`));
    console.log(`\n스타트 프레임 ${r.startShots.length}장 (만들기 ${r.startOk ? "성공" : "실패"})`);

    const fails = [];
    if (!r.realTimes) fails.push("ffmpeg 가 알려준 진짜 시각을 못 썼다 (계산한 값으로 되돌아갔다)");
    if (!r.startOk) fails.push("스타트 프레임을 만들지 못했다");
    if (r.shots.length !== r.startShots.length)
      fails.push(`분석 ${r.shots.length}장 / 스타트 ${r.startShots.length}장 — 장수가 다르다`);
    r.startShots.forEach((s, i) => {
      if (!fs.existsSync(s.file)) fails.push(`CUT${s.idx} 스타트 프레임 파일이 없다`);
      const a = r.shots[i];
      if (a && (a.idx !== s.idx || Math.abs(a.sT - s.t) > 1e-3))
        fails.push(`CUT${s.idx} 의 컷 시작이 분석 쪽(${a && a.sT}s)과 스타트 쪽(${s.t}s)에서 다르다`);
    });

    console.log(fails.length ? "\n실패" : "\n통과  분석·스타트가 같은 컷 목록에서 나왔고 파일도 모두 생겼다");
    fails.forEach(f => console.log("      " + f));
    app.exit(fails.length ? 1 : 0);
  } catch (e) {
    console.error("시험을 돌리지 못했습니다:", e && e.message);
    app.exit(1);
  }
});
