/* [⬇ 영상 / 📂 영상 위치] 단추가 '지금 보고 있는 기록' 을 가리키는지 본다.
   =========================================================================
   왜 필요한가 — 2026-08-28 사용자 보고:
     추출한 기록이 여러 개 쌓인 뒤 네 번째 기록을 열고 영상 단추를 눌렀는데
     두 번째 기록의 영상이 나왔다. 화면에 붙은 영상과 단추가 보는 영상이
     서로 달랐다 (기록을 열 때 아무도 S.playFile 을 고쳐 쓰지 않았다).
   덤으로 같이 보는 것:
     · Tab 정보창이 두 줄기로 반듯하게 서는가 · 배경이 새까맣지 않은가
     · 즐겨찾기 폴더 그림표를 골라 바꾸고 저장까지 되는가
   쓰는 법:  npm run test:vidbtn
   ========================================================================= */
const { app, BrowserWindow } = require("electron");
const path = require("path"); const fs = require("fs");
const { execFileSync } = require("child_process");
const ROOT = path.join(__dirname, "..");
const OUT = path.join(__dirname, "_생성물", "영상단추");
const 시험방 = require("./_격리")(app, "vidbtn");
const SAVE = path.join(시험방.저장, "결과");
require(path.join(ROOT, "main.js"));
const FF = require(path.join(ROOT, "node_modules/ffmpeg-static"));

const waitWindow = () => new Promise(res => {
  const t = setInterval(() => { const w = BrowserWindow.getAllWindows()[0];
    if (w && !w.webContents.isLoading()) { clearInterval(t); res(w); } }, 200);
});

/* 장면이 두 번 바뀌는 짧은 시험 영상 (단색이면 '빈 화면' 으로 걸러진다) */
function make(name, seed) {
  const f = path.join(OUT, name);
  if (fs.existsSync(f)) return f;
  execFileSync(FF, ["-v", "error", "-y",
    "-f", "lavfi", "-i", `testsrc=s=320x180:r=24:d=1:decimals=${seed}`,
    "-f", "lavfi", "-i", "smptebars=s=320x180:r=24:d=1",
    "-f", "lavfi", "-i", "testsrc2=s=320x180:r=24:d=1",
    "-filter_complex", "[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]",
    "-map", "[v]", "-c:v", "libx264", "-pix_fmt", "yuv420p", f]);
  return f;
}

app.whenReady().then(async () => {
 try {
  fs.mkdirSync(OUT, { recursive: true });
  fs.rmSync(SAVE, { recursive: true, force: true });
  /* 지난 시험의 기록도 지운다 — 안 그러면 돌릴 때마다 기록이 쌓여 세는 값이 어긋난다 */
  fs.rmSync(path.join(시험방.저장, "_기록"), { recursive: true, force: true });
  const 영상 = [1, 2, 3, 4].map(n => {
    const p = make(`시험영상${n}.mp4`, n);
    return { nm: path.basename(p), p };
  });

  const win = await waitWindow();
  win.webContents.on("console-message", (_e, lvl, msg) => {
    if (lvl >= 2 && !/Content-Security-Policy/.test(msg)) console.log("  [화면오류]", msg); });

  const 시나리오 = fs.readFileSync(path.join(__dirname, "vidbtn.renderer.js"), "utf8")
    .replace("__영상__", JSON.stringify(영상))
    .replace("__저장__", JSON.stringify(SAVE));
  const r = await win.webContents.executeJavaScript(시나리오, true);
  if (r.err) { console.log("시험 중 오류\n" + r.err); app.exit(1); return; }

  const 실패 = [];
  const 같은길 = (a, b) => path.normalize(String(a)).toLowerCase()
                      === path.normalize(String(b)).toLowerCase();

  console.log("\n=== 기록을 열면 그 기록의 영상이 붙는가 ===");
  for (const x of r.기록) {
    const ok = x.붙은것 && 같은길(x.원한것, x.붙은것);
    console.log("  " + x.이름.padEnd(16) + (ok ? "맞음" : "어긋남"));
    if (!ok) {
      console.log("      원한 것 " + x.원한것);
      console.log("      붙은 것 " + x.붙은것);
      실패.push(x.이름 + " — 다른 기록의 영상이 붙어 있다");
    }
  }
  if (r.기록.length !== 영상.length)
    실패.push(`기록이 ${영상.length}개여야 하는데 ${r.기록.length}개다`);

  console.log("\n=== Tab 정보창 ===");
  const i = r.정보창;
  console.log("  세로 줄기      " + i.display + " (이름칸 " + i.이름칸 + " · 값칸 " + i.값칸 + ")");
  console.log("  이름 줄맞음    " + (i.이름줄맞음 ? "O" : "X"));
  console.log("  값 줄맞음      " + (i.값줄맞음 ? "O" : "X"));
  console.log("  배경           " + i.배경 + "  흐림 " + (i.흐림 || "없음"));
  console.log("  첫 줄          " + i.첫줄);
  if (i.display !== "grid") 실패.push("정보창이 두 줄기로 서지 않는다");
  if (i.이름칸 < 9 || i.이름칸 !== i.값칸) 실패.push("정보창의 이름칸과 값칸 수가 맞지 않는다");
  if (!i.이름줄맞음 || !i.값줄맞음) 실패.push("정보창의 줄이 제각각이다");
  /* 배경이 얼마나 검은가 — 예전에는 rgba(0,0,0,.85) 라 뒤가 안 보였다 */
  const m = /rgba?\(([^)]+)\)/.exec(i.배경 || "");
  const 투명도 = m ? parseFloat((m[1].split(",")[3] || "1")) : 1;
  if (투명도 > 0.7) 실패.push("정보창 배경이 아직 너무 진하다 (" + 투명도 + ")");

  console.log("\n=== 즐겨찾기 폴더 그림표 ===");
  const f = r.폴더;
  console.log("  처음 그림      " + f.처음);
  console.log("  고르는 창      " + (f.창떴나 ? "떴다" : "안 떴다") + " · " + f.고른수 + "개");
  console.log("  바꾼 뒤 화면   " + f.화면);
  console.log("  다시 읽어도    " + (f.저장됨 || "안 남음"));
  if (!f.창떴나) 실패.push("폴더 그림 고르는 창이 뜨지 않는다");
  if (f.고른수 < 16) 실패.push("고를 수 있는 그림이 너무 적다");
  if (!f.저장됨 || f.저장됨 === f.처음) 실패.push("고른 그림이 저장되지 않는다");
  if (f.화면 !== f.저장됨) 실패.push("고른 그림이 화면에 곧바로 반영되지 않는다");

  console.log("\n=== 안내 문구 · 단추 이름 ===");
  console.log("  단추           " + r.단추.글자);
  console.log("  설명           " + r.단추.설명);
  console.log("  안내           " + r.안내);
  if (!/영상 위치/.test(r.단추.글자)) 실패.push("앱에서는 단추 이름이 [영상 위치] 여야 한다");
  if (!/1\/3.*분석 시간 소요/.test(r.안내)) 실패.push("안내 문구가 바뀌지 않았다");

  console.log(실패.length ? "\n실패" : "\n---------------- 결과 ----------------\n전부 통과");
  실패.forEach(x => console.log("  " + x));
  app.exit(실패.length ? 1 : 0);
 } catch (e) { console.log("시험 자체가 넘어졌다\n" + (e.stack || e)); app.exit(1); }
});
