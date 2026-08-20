/* 복사가 정말로 클립보드까지 가는지 확인한다.
   =========================================================================
   "어떤 컴퓨터에서는 Ctrl+C·우클릭 복사가 됐다 안 됐다 한다" 는 말이 있었다.
   화면 쪽 클립보드는 창이 초점을 잃으면 조용히 거절하므로, 앱에서는
   저장된 PNG 파일을 그대로 넣는 길(copyImageFile)을 먼저 쓴다.
   여기서는 그 길이 실제로 클립보드를 채우는지 눈으로 확인한다.

   쓰는 법:  npm run test:copy
   ========================================================================= */
const { app, BrowserWindow, clipboard } = require("electron");
const path = require("path");
const fs = require("fs");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(__dirname, "_생성물");
const PNG = path.join(OUT, "복사시험.png");
/* 시험은 진짜 앱데이터·기록을 건드리지 않는다 (test/_격리.js 설명 참고) */
const 시험방 = require("./_격리")(app, "copy");
require(path.join(ROOT, "main.js"));

const waitWindow = () => new Promise((res) => {
  const t = setInterval(() => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w && !w.webContents.isLoading()) { clearInterval(t); res(w); }
  }, 200);
});

let bad = 0;
const ok = (name, cond, extra) => {
  console.log((cond ? "통과  " : "실패  ") + name + (extra ? "  — " + extra : ""));
  if (!cond) bad++;
};

app.whenReady().then(async () => {
  try {
    fs.mkdirSync(OUT, { recursive: true });
    const win = await waitWindow();

    /* 화면 쪽에서 PNG 한 장을 만들어 파일로 저장한다 (캡쳐와 같은 모양) */
    await win.webContents.executeJavaScript(`(async()=>{
      const c=document.createElement("canvas"); c.width=200; c.height=120;
      const x=c.getContext("2d"); x.fillStyle="#2d6cdf"; x.fillRect(0,0,200,120);
      const b=await new Promise(r=>c.toBlob(r,"image/png"));
      await window.CG.writeFile(${JSON.stringify(PNG)}, new Uint8Array(await b.arrayBuffer()));
      return true;
    })()`);
    ok("시험용 PNG 를 저장했다", fs.existsSync(PNG));

    clipboard.clear();
    const r = await win.webContents.executeJavaScript(
      `window.CG.copyImageFile(${JSON.stringify(PNG)})`);
    ok("파일 그대로 복사가 성공했다", !!(r && r.ok), r && r.error);
    const img = clipboard.readImage();
    ok("클립보드에 그림이 들어 있다", !img.isEmpty(),
       img.isEmpty() ? "" : img.getSize().width + "x" + img.getSize().height);

    /* 글자 선택 판정 — 그림 자리 안의 선택은 그림 복사를 막지 않아야 한다 */
    const sel = await win.webContents.executeJavaScript(`(()=>{
      const has=(typeof textSelForKey==="function" && typeof textSelAt==="function");
      return {has, none:has?textSelForKey():null};
    })()`);
    ok("글자 선택 판정 함수가 있다", sel.has);
    ok("선택이 없으면 그림 복사로 간다", sel.none === false);

    console.log("\n---------------- 결과 ----------------");
    console.log(bad ? bad + " 가지 실패" : "전부 통과");
  } catch (e) {
    console.error("시험 자체가 멈췄습니다:", e);
    bad++;
  }
  app.exit(bad ? 1 : 0);
});
