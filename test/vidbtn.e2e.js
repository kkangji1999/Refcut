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

  console.log("\n=== 보관함에서 영상을 두 번 눌렀을 때 ===");
  const v = r.영상크게 || {};
  console.log("  크게 열렸나    " + (v.크게열림 ? "열렸다" : "안 열렸다")
              + " · " + (v.영상모드 ? "영상으로" : "스틸로"));
  console.log("  영상           " + (v.영상붙음 ? "붙었다" : "안 붙었다")
              + " · 화면 " + v.그려짐 + "px · 길이 " + v.길이 + "초"
              + " · 열자마자 " + (v.돌고있나 ? "돌았다" : "멈춰 있었다"));
  console.log("  아래 컷 띠     " + (v.컷띠남음 ? "아직 있다" : "없앴다")
              + " · 재생 줄 " + v.재생줄);
  console.log("  미리보기       " + (v.미리보기.떴나 ? "떴다" : "안 떴다")
              + " · 그림 " + (v.미리보기.그림 ? "있다" : "없다")
              + " · " + (v.미리보기.글 || "").trim());
  console.log("  하트           " + v.하트.개수 + "개 (담아둔 것 " + v.하트.담은것 + "개)"
              + (v.하트.자리 == null ? "" : " · 자리 오차 " + v.하트.자리.toFixed(2) + "%"));
  if (v.건너뜀) console.log("  하트를 눌렀더니 " + v.건너뜀.목표 + "초 → " + v.건너뜀.실제 + "초");
  console.log("  줄을 눌렀더니  " + v.줄로이동.목표 + "초 → " + v.줄로이동.실제 + "초");
  console.log("  보관함         " + (v.보관함남음 ? "그대로 있다" : "닫혔다"));
  console.log("  단추           " + (v.이동단추 === "none" ? "이동 없다" : v.이동단추글자.trim())
              + " · 복사 " + (v.복사단추 === "none" ? "접힘" : "펴짐"));
  console.log("  닫은 뒤        " + (v.닫은뒤소리 ? "아직 돌고 있다" : "멈췄다")
              + " · " + (v.닫은뒤주소 ? "주소가 남았다" : "내려갔다"));
  if (!v.카드있나) 실패.push("보관함에 영상 카드가 없다 — 시험이 헐겁다");
  else {
    /* ★ 영상을 담아 둔 사람이 보고 싶은 것은 그 영상이지 첫 컷 스틸이 아니다 */
    if (!v.크게열림) 실패.push("보관함에서 영상을 두 번 눌러도 크게 보이지 않는다");
    if (!v.영상모드) 실패.push("영상을 두 번 눌렀는데 스틸로 떴다 — 영상이 돌아야 한다");
    if (!v.영상붙음) 실패.push("크게 보기에 원본 영상이 붙지 않았다");
    if (!(v.그려짐 > 0)) 실패.push("영상이 화면에 그려지지 않는다 (크기가 0 이다)");
    if (!(v.길이 > 0)) 실패.push("영상 길이를 읽지 못했다");
    if (!v.돌고있나) 실패.push("크게 보기를 열었는데 영상이 돌지 않는다");
    if (!v.보관함남음) 실패.push("영상을 크게 보려는데 보관함이 닫혀 버린다");
    /* ★ 재생하는 내내 표가 옮겨 다니는 컷 띠는 눈이 어지러워 걷어냈다 */
    if (v.컷띠남음) 실패.push("아래 컷 띠가 아직 남아 있다 (걷어내기로 했다)");
    if (v.재생줄 === "none") 실패.push("영상인데 재생 줄이 보이지 않는다");
    if (!v.미리보기.떴나) 실패.push("재생 줄에 커서를 올려도 화면 미리보기가 뜨지 않는다");
    if (!v.미리보기.그림) 실패.push("미리보기에 그림이 없다");
    if (!/CUT/.test(v.미리보기.글 || "")) 실패.push("미리보기에 어느 컷·몇 초인지 적혀 있지 않다");
    if (!(v.하트.담은것 > 0)) 실패.push("담아둔 순간을 세지 못했다 — 시험이 헐겁다");
    else if (v.하트.개수 !== v.하트.담은것)
      실패.push(`담아둔 순간은 ${v.하트.담은것}개인데 재생 줄의 하트는 ${v.하트.개수}개다`);
    if (v.하트.자리 != null && v.하트.자리 > 1.5)
      실패.push("하트가 그 순간이 아닌 엉뚱한 자리에 붙어 있다");
    if (v.건너뜀 && Math.abs(v.건너뜀.실제 - v.건너뜀.목표) > 0.6)
      실패.push(`하트를 눌렀는데 ${v.건너뜀.목표}초가 아니라 ${v.건너뜀.실제}초로 갔다`);
    if (Math.abs(v.줄로이동.실제 - v.줄로이동.목표) > 0.6)
      실패.push(`재생 줄을 눌렀는데 ${v.줄로이동.목표}초가 아니라 ${v.줄로이동.실제}초로 갔다`);
    if (v.이동단추 === "none") 실패.push("결과 화면으로 가는 길이 사라졌다 (남겨두기로 했다)");
    if (v.복사단추 !== "none") 실패.push("영상에는 담을 것이 없는데 [복사] 가 그대로 있다");
    if (v.닫은뒤소리) 실패.push("크게 보기를 닫았는데 영상이 계속 돌고 있다 (소리가 남는다)");
    if (v.닫은뒤주소) 실패.push("닫은 뒤에도 영상이 붙어 있다");
  }

  console.log("\n=== 영상을 보고 난 뒤에 스틸을 열면 ===");
  const st = r.스틸 || {};
  console.log("  크게 보기      " + (st.열림 ? "열렸다" : "안 열렸다")
              + " · " + (st.영상모드 ? "아직 영상 모드다" : "그림 모드다"));
  console.log("  그림           " + st.그림보임 + " · 재생 줄 " + st.재생줄
              + " · 영상 " + (st.영상붙음 ? "아직 붙어 있다" : "내려갔다"));
  console.log("  단추           " + st.이동단추글자.trim()
              + " · 복사 " + (st.복사단추 === "none" ? "접힘" : "펴짐"));
  if (!st.카드있나) 실패.push("보관함에 스틸 카드가 없다 — 시험이 헐겁다");
  else {
    if (!st.열림) 실패.push("스틸을 두 번 눌러도 크게 보이지 않는다");
    if (st.영상모드) 실패.push("영상을 보고 난 뒤라 스틸이 영상 모드로 열린다");
    if (st.그림보임 === "none") 실패.push("스틸을 열었는데 그림이 가려져 있다");
    if (st.영상붙음) 실패.push("스틸을 보는데 영상이 아직 붙어 있다");
    if (st.재생줄 !== "none") 실패.push("스틸을 보는데 재생 줄이 남아 있다");
    if (st.복사단추 === "none") 실패.push("스틸인데 [복사] 가 접혀 있다");
    if (!/이 컷으로 이동/.test(st.이동단추글자)) 실패.push("스틸인데 단추가 [이 컷으로 이동] 이 아니다");
  }

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
