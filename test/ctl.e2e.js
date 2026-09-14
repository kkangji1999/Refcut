/* 창 모드에서 재생바가 충분히 길게 남는가, 기록을 여러 개 골라 지울 수 있는가.
   =========================================================================
   왜 필요한가 — 2026-09-14 사용자 보고:
     "창 모드로만 쓰는데 재생바가 굉장히 짧아져서 마우스로 조정하기 힘들다"
     재생 줄에는 단추 여섯 개와 시각(1분 23초 05장 / 3분 32초 00장)과
     소리 막대가 함께 서 있었다. 창 모드(1560px)에서 그것들이 줄의 절반을
     가져가고 재생바에는 260px 남짓만 남았다 — 1초가 2px 도 안 되니
     마우스가 조금만 흔들려도 몇 초씩 건너뛰었다.
   그래서 시각은 윗줄로 빼고, 단추를 한 치수 줄이고, 소리 막대는 접어두었다.
   여기서 지키는 것은 '그렇게 비운 자리를 재생바가 실제로 가져갔는가' 다.
   (재생 줄에 무엇을 하나 더 놓으면 이 시험이 먼저 깨진다 — 그게 목적이다)

   함께 보는 것:
     · 기록 고르기 — Ctrl 하나씩 · Shift 범위 · Esc 풀기 · 한 번만 묻고 다 지우기
     · 연속 프레임 단추가 영상(🎬) 과 다른 그림인가

   쓰는 법:  npm run test:ctl
   ========================================================================= */
const { app, BrowserWindow } = require("electron");
const path = require("path"); const fs = require("fs");
const { execFileSync } = require("child_process");
const ROOT = path.join(__dirname, "..");
const OUT = path.join(__dirname, "_생성물", "재생줄");
/* 시험은 진짜 앱데이터·기록을 건드리지 않는다 (test/_격리.js 설명 참고) */
const 시험방 = require("./_격리")(app, "ctl");
const SAVE = path.join(시험방.저장, "결과");
require(path.join(ROOT, "main.js"));
const FF = require(path.join(ROOT, "node_modules/ffmpeg-static"));

/* 사용자가 실제로 쓰는 창 크기 (main.js 의 minWidth 가 1500 이다) */
const 창너비 = 1560, 창높이 = 940;

const waitWindow = () => new Promise(res => {
  const t = setInterval(() => { const w = BrowserWindow.getAllWindows()[0];
    if (w && !w.webContents.isLoading()) { clearInterval(t); res(w); } }, 200);
});
/* 장면이 두 번 바뀌는 짧은 시험 영상 (단색이면 '빈 화면' 으로 걸러진다) */
function make(name, seed) {
  const f = path.join(OUT, name);
  if (fs.existsSync(f)) return f;
  execFileSync(FF, ["-v", "error", "-y",
    "-f", "lavfi", "-i", "testsrc=s=640x360:r=24:d=1:decimals=" + seed,
    "-f", "lavfi", "-i", "smptebars=s=640x360:r=24:d=1",
    "-f", "lavfi", "-i", "testsrc2=s=640x360:r=24:d=1",
    "-filter_complex", "[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]",
    "-map", "[v]", "-c:v", "libx264", "-pix_fmt", "yuv420p", f]);
  return f;
}

const 실패 = [];
const ok = (name, cond, extra) => {
  console.log("  " + (cond ? "통과  " : "실패  ") + name + (extra ? "  — " + extra : ""));
  if (!cond) 실패.push(name);
};

app.whenReady().then(async () => {
 try {
  fs.mkdirSync(OUT, { recursive: true });
  /* 지난 시험의 기록도 지운다 — 안 그러면 돌릴 때마다 쌓여 세는 값이 어긋난다 */
  fs.rmSync(path.join(시험방.저장, "_기록"), { recursive: true, force: true });
  const 영상 = [1, 2, 3, 4, 5].map((n) => {
    const p = make("재생줄" + n + ".mp4", n);
    return { nm: path.basename(p), p };
  });

  const win = await waitWindow();
  win.webContents.on("console-message", (_e, lvl, msg) => {
    if (lvl >= 2 && !/Content-Security-Policy/.test(msg)) console.log("  [화면오류]", msg);
  });
  win.setSize(창너비, 창높이);

  /* ---- 영상 다섯 개를 뽑아 기록을 쌓고, 첫 기록을 연다 ---- */
  const 준비 = await win.webContents.executeJavaScript(
    "(async()=>{ try{" +
    "  await jobPut({id:OUTKEY, dir:" + JSON.stringify(SAVE) + "});" +
    "  for(const v of " + JSON.stringify(영상) + "){" +
    "    S.queue=[]; closeDlg(null);" +
    "    await addFiles([{file:{name:v.nm,size:0,type:''}, path:v.p}]);" +
    "    await startRun(); }" +
    "  await renderHist();" +
    "  await loadJob(HIST[0].id);" +
    "  for(let i=0;i<40 && !S.playSrc;i++) await new Promise(r=>setTimeout(r,100));" +
    "  await new Promise(r=>setTimeout(r,500));" +
    "  return {기록수:HIST.filter(j=>!j.archived).length, err:null};" +
    "}catch(e){ return {err:String(e&&e.stack||e)}; } })()", true);
  if (준비.err) { console.log("시험 중 오류\n" + 준비.err); app.exit(1); return; }

  /* ---- 1) 재생 줄 ---- */
  const c = await win.webContents.executeJavaScript(
    "(()=>{" +
    "  const w=el=>Math.round(document.getElementById(el).getBoundingClientRect().width);" +
    "  const 단추=[...document.querySelectorAll('.ctl .pbtn')];" +
    "  const 키=b=>{const r=b.getBoundingClientRect();" +
    "    return b.id+' '+Math.round(r.width)+'x'+Math.round(r.height);};" +
    "  return { 재생바:w('track')," +
    "    줄폭:Math.round(document.querySelector('.ctl').getBoundingClientRect().width)," +
    "    시각이재생줄안에:!!document.querySelector('.ctl #pTime')," +
    "    시각줄있나:!!document.querySelector('.tRow #pTime')," +
    "    볼륨평소:Math.round(document.getElementById('pVol').getBoundingClientRect().width)," +
    "    단추:단추.map(키)," +
    "    제일큰단추:Math.max(...단추.map(b=>b.getBoundingClientRect().width)) };" +
    "})()", true);
  const 비율 = c.재생바 / c.줄폭;
  console.log("\n=== 창 모드(" + 창너비 + "px) 재생 줄 ===");
  console.log("  재생줄 " + c.줄폭 + "px 중 재생바 " + c.재생바 + "px ("
              + Math.round(비율 * 100) + "%)");
  console.log("  단추 " + c.단추.join(" · "));
  ok("재생바가 재생 줄의 3분의 2 이상을 쓴다", 비율 >= 0.66, Math.round(비율 * 100) + "%");
  ok("시각(초/장)이 재생 줄에서 빠졌다", !c.시각이재생줄안에);
  ok("시각이 제 윗줄에 있다", c.시각줄있나);
  ok("소리 막대는 평소 접혀 있다", c.볼륨평소 === 0, c.볼륨평소 + "px");
  ok("재생 줄 단추가 30px 를 넘지 않는다", c.제일큰단추 <= 30, c.제일큰단추 + "px");

  /* 마우스를 올린 것과 같은 상태(.peek)에서 소리 막대가 펼쳐지는가 */
  const vol = await win.webContents.executeJavaScript(
    "(()=>{ 볼륨살짝(); return new Promise(r=>setTimeout(()=>r(" +
    "  Math.round(document.getElementById('pVol').getBoundingClientRect().width)),300)); })()",
    true);
  ok("마우스를 올리면 소리 막대가 펼쳐진다", vol >= 60, vol + "px");

  /* ---- 2) 연속 프레임 단추 그림 ---- */
  const ico = await win.webContents.executeJavaScript(
    "(()=>{ const e=document.querySelector('#ioSeq .seqIco');" +
    "  const r=e&&e.getBoundingClientRect();" +
    "  return {있나:!!e, 높이:r?Math.round(r.height):0," +
    "    글자로그렸나:(document.getElementById('ioSeq').textContent||'').trim().length>0," +
    "    영상단추:(document.getElementById('ioClip').textContent||'').trim()}; })()", true);
  console.log("\n=== 내보내기 그림 ===");
  console.log("  연속 프레임 "
    + (ico.있나 ? "직접 그린 그림 " + ico.높이 + "px" : "없음")
    + " · 영상 " + ico.영상단추);
  ok("연속 프레임이 영상(🎬) 과 다른 그림이다", ico.있나 && !ico.글자로그렸나);
  ok("옆 단추와 키가 맞는다", ico.높이 >= 14 && ico.높이 <= 22, ico.높이 + "px");

  /* ---- 3) 기록 여러 개 고르기 ---- */
  const sel = await win.webContents.executeJavaScript(
    "(()=>{ const rows=[...document.querySelectorAll('#hist .job')];" +
    "  const ev=o=>new MouseEvent('click',{bubbles:true,...o});" +
    "  rows[0].dispatchEvent(ev({ctrlKey:true}));" +
    "  rows[3].dispatchEvent(ev({shiftKey:true,ctrlKey:true}));" +
    "  const 범위=S.histSel.size;" +
    "  rows[1].dispatchEvent(ev({ctrlKey:true}));" +           // 가운데 하나만 뺀다
    "  const 뺀뒤=S.histSel.size;" +
    "  const 물든줄=document.querySelectorAll('#hist .job.sel').length;" +
    "  const 바=document.getElementById('histBar').classList.contains('on');" +
    "  const 글=document.getElementById('histSelCount').textContent;" +
    "  return {범위, 뺀뒤, 물든줄, 바, 글}; })()", true);
  /* ★ Esc 는 진짜 글쇠로 눌러본다 — 만들어 낸 이벤트는 실제와 다르게 움직인다 */
  win.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
  win.webContents.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
  await new Promise((r) => setTimeout(r, 200));
  sel.Esc뒤 = await win.webContents.executeJavaScript("S.histSel.size", true);
  console.log("\n=== 기록 여러 개 고르기 ===");
  console.log("  Shift 범위 " + sel.범위 + "개 → Ctrl 로 하나 빼서 "
              + sel.뺀뒤 + "개 · " + sel.글);
  ok("Shift 로 범위가 잡힌다", sel.범위 === 4, sel.범위 + "개");
  ok("Ctrl 로 하나씩 뺄 수 있다", sel.뺀뒤 === 3, sel.뺀뒤 + "개");
  ok("고른 줄이 화면에도 물든다", sel.물든줄 === 3);
  ok("고르면 삭제 줄이 나타난다", sel.바 && /3개/.test(sel.글));
  ok("Esc 로 고름이 풀린다", sel.Esc뒤 === 0, "남은 것 " + sel.Esc뒤 + "개");

  /* ---- 4) 한 번만 묻고 고른 것만 지운다 ---- */
  const del = await win.webContents.executeJavaScript(
    "(async()=>{ const 처음=HIST.filter(j=>!j.archived).length;" +
    "  const rows=[...document.querySelectorAll('#hist .job')];" +
    "  const ev=o=>new MouseEvent('click',{bubbles:true,...o});" +
    "  rows[0].dispatchEvent(ev({ctrlKey:true}));" +
    "  rows[2].dispatchEvent(ev({shiftKey:true,ctrlKey:true}));" +
    "  const 고른것=[...S.histSel];" +
    "  const 일=고른기록삭제();" +
    "  await new Promise(r=>setTimeout(r,300));" +
    "  const 창=document.getElementById('dlg').classList.contains('on');" +
    "  document.getElementById('dlgYes').click();" +          // [예]
    "  await 일;" +
    "  return {처음, 고른수:고른것.length, 창떴나:창," +
    "    남은것:HIST.filter(j=>!j.archived).length," +
    "    고른것만사라졌나:고른것.every(id=>!HIST.some(j=>j.id===id && !j.archived))," +
    "    고름풀림:S.histSel.size===0," +
    "    바:document.getElementById('histBar').classList.contains('on')}; })()", true);
  console.log("\n=== 골라서 한 번에 지우기 ===");
  console.log("  " + del.처음 + "개 중 " + del.고른수 + "개를 골라 지우고 "
              + del.남은것 + "개 남음");
  ok("묻는 창이 한 번만 뜬다", del.창떴나);
  ok("고른 것만 사라진다",
     del.고른것만사라졌나 && del.남은것 === del.처음 - del.고른수, del.남은것 + "개 남음");
  ok("지운 뒤 고름이 풀리고 삭제 줄도 사라진다", del.고름풀림 && !del.바);

  console.log("\n---------------- 결과 ----------------");
  if (실패.length) {
    console.log(실패.length + "개 실패\n  · " + 실패.join("\n  · "));
    app.exit(1); return;
  }
  console.log("전부 통과");
  app.exit(0);
 } catch (e) { console.log("시험이 터졌습니다\n" + (e.stack || e)); app.exit(1); }
});
