/* 즐겨찾기 보관함(쭉 보기)과 저장 위치를 시험한다.
   =========================================================================
   왜 필요한가 — 2026-09-23 사용자 요청이 이어졌다:
     · "보관함에서 스페이스를 눌렀더니 뒤쪽 영상 소리가 난다 — 떼어달라"
     · "판(보드)·자유 배치·Ctrl+휠 확대는 다 애매하다. 없애고 그냥 쭈르륵
        보이게 해달라. 크기는 2 · 4 · 8 단위로만 바꾸면 된다"
     · "한 번 눌렀는데 아무 반응이 없는 게 아쉽다 — 바로 체크되게"
     · "새로 만든 폴더가 [전체] 에서 안 보인다"
     · "저장 공간에서는 지우지 말고, 번호와 미리보기로 알아보게만"
   그래서 보관함은 격자 하나로 돌아왔고, 지우는 일은 왼쪽 [추출 기록] 한 곳이다.
   크게 보기(더블클릭)의 기능은 그대로 두었다 — vidbtn 시험이 맡는다.
   쓰는 법:  npm run test:archive
   ========================================================================= */
const { app, BrowserWindow } = require("electron");
const path = require("path"); const fs = require("fs");
const { execFileSync } = require("child_process");
const ROOT = path.join(__dirname, "..");
const OUT = path.join(__dirname, "_생성물", "보관함");
const 시험방 = require("./_격리")(app, "archive");
const SAVE = path.join(시험방.저장, "결과");
require(path.join(ROOT, "main.js"));
const FF = require(path.join(ROOT, "node_modules/ffmpeg-static"));

const waitWindow = () => new Promise(res => {
  const t = setInterval(() => { const w = BrowserWindow.getAllWindows()[0];
    if (w && !w.webContents.isLoading()) { clearInterval(t); res(w); } }, 200);
});

/* 장면이 네 번 바뀌는 짧은 시험 영상 */
function make(name, seed) {
  const f = path.join(OUT, name);
  if (fs.existsSync(f)) return f;
  execFileSync(FF, ["-v", "error", "-y",
    "-f", "lavfi", "-i", `testsrc=s=320x180:r=24:d=1:decimals=${seed}`,
    "-f", "lavfi", "-i", "smptebars=s=320x180:r=24:d=1",
    "-f", "lavfi", "-i", "testsrc2=s=320x180:r=24:d=1",
    "-f", "lavfi", "-i", "rgbtestsrc=s=320x180:r=24:d=1",
    "-filter_complex", "[0:v][1:v][2:v][3:v]concat=n=4:v=1:a=0[v]",
    "-map", "[v]", "-c:v", "libx264", "-pix_fmt", "yuv420p", f]);
  return f;
}

app.whenReady().then(async () => {
 try {
  fs.mkdirSync(OUT, { recursive: true });
  fs.rmSync(SAVE, { recursive: true, force: true });
  fs.rmSync(path.join(시험방.저장, "_기록"), { recursive: true, force: true });

  const 영상 = [1, 2, 3, 4].map(n => {
    const p = make(`시험영상${n}.mp4`, n);
    return { nm: path.basename(p), p };
  });

  const win = await waitWindow();
  win.setSize(1400, 900);
  win.webContents.on("console-message", (_e, lvl, msg) => {
    if (lvl >= 2 && !/Content-Security-Policy/.test(msg)) console.log("  [화면오류]", msg); });

  const 시나리오 = fs.readFileSync(path.join(__dirname, "archive.renderer.js"), "utf8")
    .replace("__영상__", JSON.stringify(영상))
    .replace("__저장__", JSON.stringify(SAVE));
  const r = await win.webContents.executeJavaScript(시나리오, true);
  if (r.err) { console.log("시험 중 오류\n" + r.err); app.exit(1); return; }

  const 실패 = [];

  console.log("\n=== 보관함은 격자 하나다 ===");
  const b = r.보관함;
  console.log("  보관함         " + (b.열림 ? "열렸다" : "안 열렸다")
              + " · 격자 " + (b.격자 ? "있다" : "없다")
              + " · 판(보드) 자취 " + (b.판자취 ? "남았다" : "없앴다"));
  console.log("  카드           " + b.카드 + "개 (담긴 것 " + b.담긴것 + "개)"
              + " · 줄 " + b.줄 + "개 · 한 줄에 " + b.열수 + "장");
  console.log("  폴더 제목      [" + b.제목줄.join(" · ") + "]"
              + " · 왼쪽 미분류 " + (b.미분류칸 ? "아직 있다" : "없앴다"));
  console.log("  카드 겉면      이름표 " + b.이름표 + "개 (늘 보이는 것 " + b.늘보이는이름 + "개)"
              + " · 고름칸 진하기 " + b.고름칸);
  if (!b.열림) 실패.push("보관함이 열리지 않았다");
  if (!b.격자) 실패.push("격자(#arcGrid)가 없다");
  /* ★ 판·자유 배치·Ctrl+휠 확대는 걷어내기로 했다 */
  if (b.판자취) 실패.push("판(보드)의 자취가 남아 있다 — 격자 하나만 두기로 했다");
  if (b.카드 !== b.담긴것) 실패.push(`담긴 것은 ${b.담긴것}개인데 화면에는 ${b.카드}개가 깔렸다`);
  if (b.미분류칸) 실패.push("왼쪽에 '미분류' 칸이 아직 있다");
  ["인물", "조명"].forEach(nm => {
    if (!b.제목줄.includes(nm)) 실패.push(`'${nm}' 폴더 제목 줄이 없다`);
  });
  if (b.늘보이는이름 > 0) 실패.push("이름표가 늘 떠 있다 — 마우스를 올렸을 때만 보여야 한다");
  if (parseFloat(b.고름칸) > 0.01)
    실패.push("고름칸이 그냥도 떠 있다 — 마우스를 올리거나 골랐을 때만 보여야 한다");

  console.log("\n=== 보관함은 메인 화면과 떨어져 있다 ===");
  const snd = r.소리;
  console.log("  뒤쪽 영상      " + (snd.붙은영상 ? "붙어 있다" : "없다")
              + " · 들어올 때 " + (snd.들어올때멈췄나 ? "멈춰 있다" : "돌고 있다")
              + " · 스페이스·화살표를 눌러도 " + (snd.누른뒤도멈춰있나 ? "멈춰 있다" : "재생됐다")
              + " · 시각 " + snd.시각 + "초");
  if (!snd.붙은영상) 실패.push("뒤쪽에 영상이 붙어 있지 않다 — 시험이 헐겁다");
  else {
    if (!snd.들어올때멈췄나) 실패.push("보관함에 들어왔는데 뒤쪽 영상이 돌고 있다");
    if (!snd.누른뒤도멈춰있나) 실패.push("보관함에서 스페이스를 눌렀는데 뒤쪽 영상이 재생됐다");
    if (snd.시각 > 0.5) 실패.push("보관함에서 누른 화살표가 뒤쪽 영상을 움직였다");
  }

  console.log("\n=== 한 줄에 몇 장 (2 · 4 · 8) ===");
  const sz = r.크기;
  console.log("  처음 " + sz.처음 + "장 → [2×] " + sz.둘 + "장 → [8×] " + sz.여덟 + "장"
              + " → [4×] " + sz.되돌림 + "장");
  console.log("  물든 단추      " + sz.물든단추 + "× · 기억 " + (sz.기억 || "안 적힘"));
  if (sz.처음 !== 4) 실패.push(`처음에 한 줄 ${sz.처음}장이다 — 4장으로 시작하기로 했다`);
  if (sz.둘 !== 2) 실패.push(`[2×] 인데 한 줄에 ${sz.둘}장이다`);
  if (sz.여덟 !== 8) 실패.push(`[8×] 인데 한 줄에 ${sz.여덟}장이다`);
  if (sz.되돌림 !== 4) 실패.push("[4×] 로 돌아오지 않는다");
  if (sz.물든단추 !== "2") 실패.push("고른 크기 단추에 표가 나지 않는다");
  if (sz.기억 !== "8") 실패.push("고른 크기를 기억하지 않는다 (다음에 열 때도 그대로여야 한다)");

  console.log("\n=== 고르기 ===");
  const pk = r.고르기;
  console.log("  한 번 누르니  " + pk.한번 + "개 고름 · 표 " + (pk.표붙음 ? "붙었다" : "안 붙었다")
              + " · 고름칸 진하기 " + pk.고름칸);
  console.log("  이어서 누르니 " + pk.이어서 + "개 · 같은 것을 다시 누르니 " + pk.다시누르면 + "개");
  console.log("  [전체 선택]   " + pk.전체선택 + "개 (물든 카드 " + pk.모두물듦 + "개)"
              + " · [해제] " + pk.해제뒤 + "개");
  if (pk.한번 !== 1) 실패.push("스틸을 한 번 눌러도 골라지지 않는다");
  if (!pk.표붙음) 실패.push("고른 스틸에 표가 붙지 않는다");
  if (!(parseFloat(pk.고름칸) > 0.5)) 실패.push("고른 스틸의 고름칸이 보이지 않는다");
  if (pk.이어서 !== 3) 실패.push("이어서 눌러도 하나씩 더 담기지 않는다");
  if (pk.다시누르면 !== 2) 실패.push("같은 것을 다시 눌러도 빠지지 않는다");
  if (!(pk.전체선택 > 3) || pk.모두물듦 !== pk.전체선택) 실패.push("[전체 선택] 이 모두 고르지 못한다");
  if (pk.해제뒤 !== 0) 실패.push("[해제] 를 눌러도 고름이 풀리지 않는다");
  if (pk.선택단추) 실패.push("[☑ 선택] 단추가 남아 있다 ([전체 선택] 과 겹쳐 없앴다)");

  console.log("\n=== 두 번 누르면 크게 보기 ===");
  console.log("  크게 보기      " + (r.크게보기.열림 ? "열렸다" : "안 열렸다")
              + " · 보관함 " + (r.크게보기.보관함남음 ? "그대로" : "닫혔다"));
  if (!r.크게보기.열림) 실패.push("스틸을 두 번 눌러도 크게 보이지 않는다");
  if (!r.크게보기.보관함남음) 실패.push("크게 보려는데 보관함이 닫혀 버린다");

  console.log("\n=== 폴더로 담고 빼기 ===");
  const dp = r.담기, op = r.빼기;
  console.log("  폴더 칸에 던지기 " + (dp.전 ? "[" + dp.전.join(",") + "] → [" + (dp.후 || []).join(",") + "]"
                                             : "못 했다")
              + " · 칸 높이 " + dp.칸높이 + "px"
              + " · 올렸을 때 " + (dp.물들었나 ? "물들었다" : "그대로였다"));
  console.log("  맨 위 칸에 던지기 " + (op.전 ? "[" + op.전.join(",") + "] → [" + (op.후 || []).join(",") + "]"
                                             : "못 했다")
              + " · 안내 " + (op.말 === "none" ? "안 뜬다" : "뜬다"));
  console.log("  [전체] 에 놓기 " + (op.왼쪽.전 ? "[" + op.왼쪽.전.join(",") + "] → ["
                                                + (op.왼쪽.후 || []).join(",") + "]" : "못 했다"));
  if (!dp.했나) 실패.push("담을 카드나 폴더 칸을 찾지 못했다 — 시험이 헐겁다");
  else {
    if (!(dp.후 || []).includes("f_인물")) 실패.push("폴더 칸에 던져도 그 폴더로 들어가지 않는다");
    if (!dp.물들었나) 실패.push("카드를 폴더 칸 위로 가져가도 '여기 놓으면 된다' 는 표가 없다");
    /* ★ 제목 줄만 받던 시절에는 겨냥할 자리가 너무 좁았다 */
    if (dp.칸높이 < 90) 실패.push(`폴더 칸이 ${dp.칸높이}px 뿐이다 — 던져 넣기엔 너무 좁다`);
  }
  if (!op.했나) 실패.push("뺄 카드나 맨 위 칸을 찾지 못했다 — 시험이 헐겁다");
  else {
    if ((op.후 || []).length) 실패.push("맨 위 칸에 던져도 폴더에서 빠지지 않는다");
    if (op.말 === "none") 실패.push("맨 위 칸에 올려도 '여기 놓으면 빠진다' 는 안내가 없다");
  }
  if (op.왼쪽.했나 && (op.왼쪽.후 || []).length) 실패.push("[전체] 에 놓아도 폴더에서 빠지지 않는다");

  console.log("\n=== 새로 만든 빈 폴더 ===");
  const ef = r.빈폴더;
  console.log("  제목 줄        " + (ef.제목줄 ? "섰다" : "안 섰다")
              + " · 비었다는 안내 " + (ef.비었다는말 ? "있다" : "없다"));
  console.log("  왼쪽 칸        [" + ef.왼쪽칸.join(" · ") + "]");
  if (!ef.제목줄) 실패.push("새로 만든 폴더가 [전체] 에서 보이지 않는다");
  if (!ef.비었다는말) 실패.push("빈 폴더 자리에 '끌어다 놓으세요' 안내가 없다");

  console.log("\n=== 폴더 제목 줄을 누르면 그 폴더만 ===");
  const fo = r.폴더열기;
  console.log("  '" + fo.바란이름 + "' 를 눌렀더니  제목 " + fo.제목
              + " · 제목 줄 " + fo.제목줄 + "개");
  if (!fo.눌렀나) 실패.push("폴더 제목 줄을 찾지 못했다 — 시험이 헐겁다");
  else {
    if (fo.제목 !== fo.바란이름) 실패.push("제목 줄을 눌렀는데 그 폴더로 들어가지 않았다");
    if (fo.제목줄 !== 1) 실패.push(`폴더 하나만 보는데 제목 줄이 ${fo.제목줄}개다`);
  }

  console.log("\n=== 저장 위치: 알아보기만, 지우지는 않는다 ===");
  const s = r.저장공간;
  console.log("  기록 줄        " + s.줄 + "개 · 번호 [" + s.번호.join(" ") + "]"
              + " · 왼쪽과 어긋난 것 " + s.어긋난것 + "개");
  console.log("  미리보기       " + s.미리보기 + "개 · 고름칸 " + s.고름칸
              + " · 삭제 단추 " + s.삭제단추);
  if (s.눌러서열기)
    console.log("  줄을 눌렀더니  " + (s.눌러서열기.창닫힘 ? "창이 닫히고 " : "창이 그대로인 채 ")
                + "'" + s.눌러서열기.연것 + "' 를 열었다");
  if (!(s.줄 >= 4)) 실패.push("저장 위치에 기록 줄이 모자라다 — 시험이 헐겁다");
  else {
    if (s.고름칸 || s.삭제단추) 실패.push("저장 위치에 아직 지우는 길이 남아 있다");
    if (s.어긋난것) 실패.push("저장 위치의 번호가 왼쪽 [추출 기록] 의 번호와 어긋난다");
    if (s.미리보기 !== s.줄) 실패.push("어느 기록인지 알아볼 미리보기가 빠진 줄이 있다");
    if (!s.눌러서열기 || !s.눌러서열기.창닫힘) 실패.push("줄을 눌러도 그 기록이 열리지 않는다");
    else if (s.눌러서열기.연것 !== s.눌러서열기.바란것)
      실패.push("줄을 눌렀더니 다른 기록이 열렸다");
  }

  console.log(실패.length ? "\n실패" : "\n---------------- 결과 ----------------\n전부 통과");
  실패.forEach(x => console.log("  " + x));
  app.exit(실패.length ? 1 : 0);
 } catch (e) { console.log("시험 자체가 넘어졌다\n" + (e.stack || e)); app.exit(1); }
});
