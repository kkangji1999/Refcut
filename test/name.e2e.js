/* 이름 규칙과 시간 표시가 말한 대로 나오는가.
   =========================================================================
   보는 것:
     ① 아무것도 안 건드리면 예전과 똑같은 이름이 나오는가 (기본값 유지)
     ② 규칙을 고치면 저장·ZIP·즐겨찾기가 모두 그 이름을 쓰는가
     ③ 컷마다 달라지는 조각이 없어 이름이 겹치면, 덮어쓰지 않고 살려 두는가
     ④ 모르는 조각·빈 규칙을 적어도 프로그램이 멀쩡한가
     ⑤ 시각이 세 가지 방식으로 제대로 적히는가 (3분짜리가 3시간으로 보이지 않는가)
     ⑥ 설정 창이 열리고, 예시와 조각 설명이 실제로 채워지는가
     ⑦ 화면 스크립트가 조용히 죽지 않았는가 (여기서 죽으면 앱 전체가 죽는다)

   쓰는 법:  npm run test:name     (창이 잠깐 떴다 닫힌다)
   ========================================================================= */
const { app, BrowserWindow } = require("electron");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const 시험방 = require("./_격리")(app, "name");
require(path.join(ROOT, "main.js"));

const waitWindow = () => new Promise(res => {
  const t = setInterval(() => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w && !w.webContents.isLoading()) { clearInterval(t); res(w); }
  }, 200);
});

app.whenReady().then(async () => {
  try {
    const win = await waitWindow();
    const 화면오류 = [];
    win.webContents.on("console-message", (_e, lvl, msg) => {
      if (lvl >= 2 && !/Content-Security-Policy/.test(msg)) 화면오류.push(msg);
    });

    const r = await win.webContents.executeJavaScript(`(async()=>{
      const 잠깐=ms=>new Promise(k=>setTimeout(k,ms));
      for(let i=0;i<10 && $("dlg").classList.contains("on");i++){ closeDlg(false); await 잠깐(120); }

      /* 시험용 컷 세 장 — 24fps 기준 */
      S.fps=24;
      S.meta={name:"clip.mp4", w:1920, h:1080, fps:24};
      S.mode="smart";
      const 컷=[{idx:1,t:3.5,base:"내영상"},
                {idx:2,t:12.28,base:"내영상"},
                {idx:12,t:3725.5,base:"내영상"}];
      const 이름들=(segs,opt)=>{ setNameSegs(segs);
        return 컷.map(x=>fname(x,Object.assign({total:12},opt||{}))); };

      const out={};
      out.기본=이름들(NAMESEGS_DEFAULT);
      out.스타트=이름들(NAMESEGS_DEFAULT,{start:true});
      out.맞춤=이름들(["","러프","A컷"]);
      out.빈칸건너뜀=이름들(["","","끝"]);
      out.첫칸바꿈=이름들(["다른이름","",""]);
      out.모두비움=이름들(["","",""]);
      out.못쓸글자=이름들(["a/b:c*?","",""])[0];
      /* 칸에 {조각} 을 적으면 그대로 바뀐다 (내놓지 않았을 뿐 살아 있다) */
      out.토막=이름들(["{날짜}","{시각}",""])[0];
      /* 번호 자릿수는 컷 수를 따라간다 — 탐색기에서 10 이 2 앞에 서지 않게 */
      setNameSegs(NAMESEGS_DEFAULT);
      out.자리2=fname(컷[0],{total:9});
      out.자리3=fname(컷[0],{total:150});
      /* 다른 기록에서 온 컷도 그 기록의 값으로 적히는가 (즐겨찾기 보관함) */
      setNameSegs(["","",""]);
      out.남의기록=fname({idx:5,t:1.0}, {base:"딴영상", total:9,
        fps:25, meta:{w:1280,h:720,fps:25}, start:false});
      /* 번호가 늘 붙으므로 이름이 겹칠 수가 없다 */
      setNameSegs(["고정","",""]);
      out.겹침없음=new Set(컷.map(x=>fname(x,{total:12}))).size;
      setNameSegs(NAMESEGS_DEFAULT);
      /* 시각 표기 — 3분 24초 12장 짜리와 1시간 넘는 것 */
      out.시각={};
      for(const v of TIMEVIEWS) out.시각[v]=[사람시각(204.5,v), 사람시각(3725.5,v), 사람시각(24,v)];
      out.기본모드=TIMEVIEW;

      /* 파일 이름 속 시각은 보기 방식과 상관없이 늘 같아야 한다 */
      setTimeView("simple"); const a=tcode(12.28,24);
      setTimeView("tc");     const b=tcode(12.28,24);
      out.이름속시각같음=(a===b); out.이름속시각=a;
      setTimeView("detail");

      /* 이름 칸은 컷 목록 밑에 늘 떠 있다 (창을 열지 않는다) */
      out.칸수=document.querySelectorAll(".nameBar .nameSeg").length;
      out.이름표=($(".nameBar") ? "" : "");
      out.라벨=(document.querySelector(".nameLbl")||{}).textContent||"";
      out.알약남음=document.querySelectorAll(".nameBar .chip").length;

      /* 컷 목록의 이름표가 적는 대로 바뀌는가 (이 시험의 핵심) */
      S.out={shots:컷.map(x=>Object.assign({},x)), keepShots:[]};
      S.sel=new Set(); S.curShot=-1;
      setNameSegs(NAMESEGS_DEFAULT);
      [0,1,2].forEach(i=>{ const el=$("nameSeg"+i); if(el) el.value=NAMESEGS[i]||""; });
      drawGrid();
      out.이름표처음=[...grid.querySelectorAll("figure .cap")].map(c=>c.textContent);
      $("nameSeg1").value="러프"; $("nameSeg1").oninput();   // 사람이 치는 것과 같은 길
      await 잠깐(30);
      out.이름표바뀜=[...grid.querySelectorAll("figure .cap")].map(c=>c.textContent);
      out.예시글=($("namePrev").textContent||"").trim();
      out.저장된칸=NAMESEGS.slice();
      $("nameReset").click();
      await 잠깐(30);
      out.되돌린칸=NAMESEGS.slice();
      out.되돌린이름표=[...grid.querySelectorAll("figure .cap")].map(c=>c.textContent);
      S.out=null; grid.innerHTML="";
      /* 시간 표시 설정 창 */
      openPref();
      await 잠깐(120);
      out.창열림=$("prefBox").classList.contains("on");
      out.시간예시=($("timePrev").textContent||"").trim();
      $("prefClose").click();
      out.창닫힘=!$("prefBox").classList.contains("on");

      /* 재생 시각을 눌러 방식을 돌려가며 바꾸는가 */
      const 처음=TIMEVIEW; $("pTime").click();
      out.눌러바뀜=(TIMEVIEW!==처음);
      setTimeView("detail");
      return out;
    })()`, true);

    const f = [];
    const 같나 = (a, b) => JSON.stringify(a) === JSON.stringify(b);

    /* ① 칸을 이어 붙이고, 번호는 저절로 붙는가 */
    if (!같나(r.기본, ["내영상_CUT_01.png", "내영상_CUT_02.png", "내영상_CUT_12.png"]))
      f.push(`기본 네이밍이 다르다 → ${r.기본.join(", ")}`);
    if (!같나(r.스타트, ["내영상_CUT_START_01.png", "내영상_CUT_START_02.png", "내영상_CUT_START_12.png"]))
      f.push(`스타트 프레임 이름이 다르다 → ${r.스타트.join(", ")}`);
    if (r.맞춤[0] !== "내영상_러프_A컷_01.png")
      f.push(`칸이 _ 로 이어 붙지 않는다 → ${r.맞춤[0]}`);
    /* ② 빈 칸은 건너뛴다 — 밑줄이 두 번 겹치면 안 된다 */
    if (r.빈칸건너뜀[0] !== "내영상_끝_01.png" || /__/.test(r.빈칸건너뜀[0]))
      f.push(`빈 칸을 건너뛰지 않는다 → ${r.빈칸건너뜀[0]}`);
    if (r.첫칸바꿈[0] !== "다른이름_01.png")
      f.push(`첫 칸에 적은 것이 영상 이름을 대신하지 않는다 → ${r.첫칸바꿈[0]}`);
    if (r.모두비움[0] !== "내영상_01.png")
      f.push(`다 비웠을 때 영상 이름_번호 가 아니다 → ${r.모두비움[0]}`);

    /* ③ 번호 자릿수 — 탐색기에서 10 이 2 앞에 서지 않게 */
    if (r.자리2 !== "내영상_CUT_01.png") f.push(`컷 9개일 때 번호가 두 자리가 아니다 → ${r.자리2}`);
    if (r.자리3 !== "내영상_CUT_001.png") f.push(`컷 150개일 때 번호가 세 자리가 아니다 → ${r.자리3}`);
    if (r.겹침없음 !== 3) f.push("번호가 붙는데도 이름이 겹친다");
    if (r.남의기록 !== "딴영상_05.png")
      f.push(`다른 기록의 컷이 그 기록 값으로 안 적힌다 → ${r.남의기록}`);

    /* ④ 잘못 적어도 멀쩡한가 */
    if (/[\/:*?"<>|]/.test(r.못쓸글자.replace(/\.png$/, "")))
      f.push(`파일에 못 쓰는 글자가 이름에 남았다 → ${r.못쓸글자}`);
    if (!/^\d{8}_00m03s12f_01\.png$/.test(r.토막))
      f.push(`칸에 적은 {조각} 이 채워지지 않는다 → ${r.토막}`);
    /* ⑤ 시각 */
    const 시 = r.시각 || {};
    if (!같나(시.simple, ["3분 24초", "1시간 02분 05초", "24초"]))
      f.push(`[간단] 표기가 다르다 → ${JSON.stringify(시.simple)}`);
    if (!같나(시.detail, ["3분 24초 12장", "1시간 02분 05초 12장", "24초 00장"]))
      f.push(`[자세히] 표기가 다르다 → ${JSON.stringify(시.detail)}`);
    if (!같나(시.tc, ["00:03:24:12", "01:02:05:12", "00:00:24:00"]))
      f.push(`[타임코드] 표기가 다르다 → ${JSON.stringify(시.tc)}`);
    for (const v of Object.keys(시))
      if (/^0?0:0?3/.test(시[v][0]) && v !== "tc")
        f.push(`[${v}] 3분짜리가 아직 시:분 으로 읽힌다 → ${시[v][0]}`);
    if (!r.이름속시각같음)
      f.push("보기 방식을 바꿨더니 파일 이름 속 시각까지 달라졌다 (예전 파일과 어긋난다)");

    /* ⑥ 이름 칸 — 적는 대로 컷 목록이 바뀌는가 */
    if (r.칸수 !== 3) f.push(`네이밍 칸이 ${r.칸수}개다 — 3개여야 한다`);
    if (r.라벨 !== "저장 네이밍") f.push(`칸 이름이 "${r.라벨}" 이다 — "저장 네이밍" 이어야 한다`);
    if (r.알약남음) f.push(`네이밍 밑 단추가 ${r.알약남음}개 남아 있다 (빼기로 했다)`);
    if (!같나(r.이름표처음, ["내영상_CUT_01", "내영상_CUT_02", "내영상_CUT_12"]))
      f.push(`컷 이름표가 저장될 이름이 아니다 → ${(r.이름표처음||[]).join(", ")}`);
    if (!같나(r.이름표바뀜, ["내영상_러프_01", "내영상_러프_02", "내영상_러프_12"]))
      f.push(`칸에 적었는데 컷 이름표가 따라 바뀌지 않는다 → ${(r.이름표바뀜||[]).join(", ")}`);
    if (!/러프/.test(r.예시글 || "")) f.push(`예시가 따라 바뀌지 않는다 → "${r.예시글}"`);
    if (!같나(r.저장된칸, ["", "러프", ""])) f.push(`적은 것이 저장되지 않는다 → ${JSON.stringify(r.저장된칸)}`);
    if (!같나(r.되돌린칸, ["", "CUT", ""])) f.push(`[기본] 이 처음으로 안 돌아간다 → ${JSON.stringify(r.되돌린칸)}`);
    if (!같나(r.되돌린이름표, r.이름표처음)) f.push("[기본] 을 눌러도 컷 이름표가 안 돌아간다");
    if (!r.창열림 || !r.창닫힘) f.push("시간 표시 창이 열리거나 닫히지 않는다");
    if (!/간단|자세히|타임코드/.test(r.시간예시)) f.push("시간 표시 예시가 비어 있다");
    if (!r.눌러바뀜) f.push("재생 시각을 눌러도 표시 방식이 바뀌지 않는다");
    /* ⑦ 화면이 조용히 죽지 않았는가 */
    if (화면오류.length) f.push(`화면 오류 ${화면오류.length}건 · ${화면오류[0]}`);

    console.log("");
    console.log(`기본 네이밍  ${r.기본.join("  ")}`);
    console.log(`칸 이어붙임  ${r.맞춤[0]}   ·  빈 칸 건너뜀 ${r.빈칸건너뜀[0]}`);
    console.log(`컷 이름표    ${(r.이름표처음||[]).join("  ")}`);
    console.log(`  러프 입력 → ${(r.이름표바뀜||[]).join("  ")}`);
    console.log(`번호 자릿수  컷 9개 ${r.자리2}  ·  컷 150개 ${r.자리3}`);
    console.log(`시각        간단 ${시.simple && 시.simple[0]} · 자세히 ${시.detail && 시.detail[0]} · 타임코드 ${시.tc && 시.tc[0]}`);
    console.log(`긴 영상     간단 ${시.simple && 시.simple[1]} · 타임코드 ${시.tc && 시.tc[1]}`);
    console.log("");
    if (f.length) { console.log("실패"); f.forEach(x => console.log("      " + x)); }
    else console.log("통과  이름 규칙과 시간 표시가 말한 대로 나온다");
    app.exit(f.length ? 1 : 0);
  } catch (e) {
    console.log("실패 ", e && e.message ? e.message : e);
    app.exit(1);
  }
});
