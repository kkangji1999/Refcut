/* 주소로 넣기 — 사이트별로 정보가 읽히는지 본다 (인터넷이 있어야 한다)
   =========================================================================
   보는 것:
     · 핀터레스트 영상 핀 (핀터레스트가 직접 가진 영상)
     · 핀터레스트 → 유튜브로 이어지는 핀
     · 유튜브 (예전부터 되던 것 — 그대로인지 확인)
   쓰는 법:  npm run test:link
   ========================================================================= */
const { app, BrowserWindow } = require("electron");
const path = require("path"); const fs = require("fs");
const ROOT = path.join(__dirname, "..");
/* 시험은 진짜 앱데이터·기록을 건드리지 않는다 (test/_격리.js 설명 참고) */
const 시험방 = require("./_격리")(app, "link");
require(path.join(ROOT, "main.js"));

const waitWindow = () => new Promise(res => {
  const t = setInterval(() => { const w = BrowserWindow.getAllWindows()[0];
    if (w && !w.webContents.isLoading()) { clearInterval(t); res(w); } }, 200);
});
const 대상 = [
  { nm: "핀터레스트(직접)", url: "https://www.pinterest.com/pin/739716307575438329/" },
  { nm: "핀터레스트(유튜브)", url: "https://www.pinterest.com/pin/10836855323494193/" },
  { nm: "유튜브", url: "https://www.youtube.com/watch?v=aqz-KE-bpKQ" },
];
app.whenReady().then(async () => {
  const win = await waitWindow();
  const r = await win.webContents.executeJavaScript(
    "(async()=>{ const L=" + JSON.stringify(대상) + "; const out=[];\n" +
    " for(const it of L){\n" +
    "  const t0=Date.now(); let q=null;\n" +
    "  try{ q=await window.CG.ytInfo(it.url,false,null); }catch(e){ q={ok:false,error:String(e)}; }\n" +
    "  out.push({nm:it.nm, ok:!!(q&&q.ok), title:(q&&q.title)||'', site:(q&&q.site)||'',\n" +
    "            heights:(q&&q.heights)||[], alt:(q&&q.altUrl)||'',\n" +
    "            err:(q&&q.error)||'', 초:((Date.now()-t0)/1000).toFixed(1)});\n" +
    " } return out; })()", true);
  /* 붙여넣은 뒤 대기열에서 멈추는지, 받기 버튼이 있는지 */
  const 대기 = await win.webContents.executeJavaScript(
    fs.readFileSync(path.join(__dirname, "link.renderer.js"), "utf8"), true);

  const 실패 = [];
  console.log("");
  for (const x of r) {
    console.log("  " + x.nm.padEnd(18) + (x.ok ? "읽음" : "★ 실패") + "  " + x.초 + "초");
    if (x.ok) console.log("     " + (x.site || "?") + " · " + x.title.slice(0, 50) +
      " · 화질 " + (x.heights.join("/") || "-"));
    else { console.log("     " + String(x.err).split("\n")[0].slice(0, 90) +
      (x.alt ? "  → 대안 " + x.alt : "")); 실패.push(x.nm); }
  }
  console.log("");
  console.log("붙여넣은 뒤 (추출이 저절로 시작되면 안 된다)");
  if (대기.err) { console.log("  오류 " + 대기.err); 실패.push("대기열 확인"); }
  else {
    console.log("  대기열 " + 대기.개수 + "개 · 추출중 " + (대기.추출중 ? "★ 예" : "아니오") +
      " · [⬇ 영상다운] 버튼 " + 대기.다운버튼 + "개");
    console.log("  " + 대기.이름);
    if (대기.개수 !== 1) 실패.push("대기열에 안 들어갔다");
    if (대기.추출중) 실패.push("추출이 저절로 시작됐다");
    if (!대기.링크) 실패.push("링크 항목으로 표시되지 않았다");
    if (대기.다운버튼 !== 1) 실패.push("[⬇ 영상다운] 버튼이 없다");
  }
  console.log("");
  console.log(실패.length ? "실패  " + 실패.join(", ")
    : "통과  세 사이트가 읽히고, 대기열에서 멈추며, 받기 버튼이 있다");
  app.exit(실패.length ? 1 : 0);
});
