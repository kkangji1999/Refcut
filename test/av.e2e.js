/* 백신이 '영상 받기 도구' 를 지웠을 때 제대로 알려주는지 확인한다.
   =========================================================================
   백신(V3·알약·디펜더)은 yt-dlp 를 조용히 격리한다 — 파일을 지우거나
   0 바이트로 만든다. 예전에는 그때 화면에 아무 흔적도 남지 않아
   "링크로 받기가 그냥 안 된다" 로만 보였고, 앱은 지워진 파일을 계속 다시 받았다.

   여기서 확인하는 것:
     ① 도구가 반쪽이면 백신 때문이라고 가려낸다 (blocked)
     ② 예외로 잡을 폴더 위치를 함께 알려준다 (toolDir)
     ③ 그럴 때는 '브라우저로 우회' 로 넘어가지 않고 바로 안내창을 띄운다
        (우회해도 도구가 없어 못 받는다 — 사용자만 헤맨다)

   쓰는 법:  npm run test:av      (인터넷이 필요 없다)
   ========================================================================= */
const { app, BrowserWindow } = require("electron");
const path = require("path");
const fs = require("fs");

const ROOT = path.join(__dirname, "..");
const 시험방 = require("./_격리")(app, "av");
require(path.join(ROOT, "main.js"));

const URL_ = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

const waitWindow = () => new Promise((res) => {
  const t = setInterval(() => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w && !w.webContents.isLoading()) { clearInterval(t); res(w); }
  }, 200);
});
const 잠깐 = (ms) => new Promise((r) => setTimeout(r, ms));
const 파일크기 = (p) => { try { return fs.existsSync(p) ? fs.statSync(p).size : 0; }
                          catch (e) { return 0; } };

let bad = 0;
const ok = (name, cond, extra) => {
  console.log((cond ? "통과  " : "실패  ") + name + (extra ? "  — " + extra : ""));
  if (!cond) bad++;
};

app.whenReady().then(async () => {
  try {
    const win = await waitWindow();

    /* 백신이 격리한 상태를 그대로 흉내낸다 — 0 바이트만 남긴다 */
    const 도구방 = path.join(시험방.앱데이터, "bin");
    fs.mkdirSync(도구방, { recursive: true });
    const exe = path.join(도구방, process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp");
    fs.writeFileSync(exe, "");
    console.log("\n=== 백신이 지운 상태를 흉내냄 ===  " + exe);

    const r = await win.webContents.executeJavaScript(
      `window.CG.ytInfo(${JSON.stringify(URL_)}, false, null)`);
    ok("받지 못했다고 답한다", !!(r && !r.ok));
    ok("백신 때문임을 가려낸다", !!(r && r.blocked === true), r && r.error);
    ok("예외로 잡을 폴더를 알려준다", !!(r && r.toolDir && r.toolDir.includes("bin")),
       r && r.toolDir);
    ok("안내문에 폴더 위치가 들어 있다",
       !!(r && String(r.error).includes(r.toolDir)));
    ok("안내문이 검사 제외를 알려준다",
       !!(r && /검사 제외/.test(String(r.error))));

    console.log("\n=== 화면이 우회로 새지 않는지 ===");
    /* 처음 켠 컴퓨터에는 환영창이 떠 있다 — 다 뜨기를 기다렸다가 닫는다 */
    await 잠깐(1500);
    for (let i = 0; i < 8; i++) {
      const 떠있나 = await win.webContents.executeJavaScript(
        `document.getElementById("dlg").classList.contains("on")`);
      if (!떠있나) break;
      await win.webContents.executeJavaScript(`closeDlg("cancel"); 0`);
      await 잠깐(400);
    }

    /* 앞에서 앱이 스스로 되살려 놓았으므로, 백신이 또 지운 셈 치고 다시 만든다 */
    fs.writeFileSync(exe, "");
    const 창수 = BrowserWindow.getAllWindows().length;
    await win.webContents.executeJavaScript(
      `addLink(${JSON.stringify(URL_)}, null, "", null); 0`);

    /* 안내창이 뜰 때까지 기다린다 (최대 20초) */
    let 화면 = null;
    for (let i = 0; i < 40; i++) {
      await 잠깐(500);
      화면 = await win.webContents.executeJavaScript(`(function(){
        const d=document.getElementById("dlg");
        return { 열림: !!(d && d.classList.contains("on")),
                 제목: (document.getElementById("dlgTitle")||{}).textContent||"",
                 본문: (document.getElementById("dlgBody")||{}).innerHTML||"",
                 대기열: (typeof S !== "undefined" && S.queue) ? S.queue.length : -1 };
      })()`);
      if (화면.열림 && 화면.제목 === "백신이 막았습니다") break;
    }

    ok("안내창이 떴다", 화면.열림, 화면.제목);
    ok("백신 안내창이다", 화면.제목 === "백신이 막았습니다", 화면.제목);
    ok("폴더 열기 버튼이 있다", 화면.본문.includes("avOpen"));
    ok("브라우저 우회 창을 열지 않았다",
       BrowserWindow.getAllWindows().length === 창수);
    ok("대기열에 찌꺼기를 남기지 않았다", 화면.대기열 === 0, "남은 개수 " + 화면.대기열);

    /* 백신 예외를 잡은 뒤 다시 누르기만 하면 저절로 되살아나야 한다.
       (반쪽짜리를 앱이 스스로 치우고 동봉본을 다시 심는다 — 사람이 할 일은 없다) */
    console.log("\n=== 예외로 잡은 뒤 다시 눌렀을 때 ===");
    ok("반쪽짜리를 스스로 치웠다", 파일크기(exe) === 0 || 파일크기(exe) > 1000000,
       파일크기(exe) + " 바이트");
    const d = await win.webContents.executeJavaScript(`window.CG.ytDiag()`);
    ok("동봉본이 설치 파일에 들어 있다", d.bundled === true,
       d.bundled ? "" : "npm run bin 을 먼저 돌려주세요");
    ok("도구가 되살아났다", d.exists === true && d.size > 1000000,
       (d.size / 1048576).toFixed(1) + " MB");
    ok("백신 표시가 풀렸다", d.blocked === false, d.error);
  } catch (e) {
    console.error("\n시험이 터졌습니다: " + (e && e.stack || e));
    bad++;
  }
  console.log("\n---------------- 결과 ----------------");
  console.log(bad ? `실패 ${bad}건` : "전부 통과");
  app.exit(bad ? 1 : 0);
});
