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

      const 이름들=(rule)=>{
        setNameRule(rule);
        const 안겹치게=이름겹침막기();
        return 컷.map(x=>안겹치게(fname(x,{total:12})));
      };

      const out={};
      out.기본=이름들("");                                  // 아무것도 안 적었을 때
      out.기본유지=이름들(NAME_DEFAULT);
      out.스타트=(()=>{ setNameRule(NAME_DEFAULT);
        return 컷.map(x=>fname(x,{total:12,start:true})); })();
      out.맞춤=이름들("{날짜}_{이름}_{번호3}_{시각}");
      out.겹침=이름들("{이름}_고정");
      out.모르는=이름들("{이름}_{없는조각}_{번호}");
      out.빈규칙=(()=>{ setNameRule("   "); return fname(컷[0],{total:12}); })();
      out.못쓸글자=(()=>{ setNameRule("{이름}/{번호}:*?"); return fname(컷[0],{total:12}); })();

      /* 다른 기록에서 온 컷도 그 기록의 값으로 적히는가 (즐겨찾기 보관함) */
      setNameRule("{이름}_{번호}_{해상도}");
      out.남의기록=fname({idx:5,t:1.0}, {base:"딴영상", total:9,
        fps:25, meta:{w:1280,h:720,fps:25}, start:false});

      setNameRule("");                                     // 다음 시험을 위해 되돌린다

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
      setNameRule(""); $("nameRule").value=""; paintNameBar();
      out.예시글=($("namePrev").textContent||"").trim();
      out.알약=[...$("nameChips").querySelectorAll(".chip")].map(b=>b.textContent);

      /* 알약을 누르면 규칙에 끼워 넣는가 (비어 있을 때는 기본 이름부터 시작) */
      $("nameChips").querySelector(".chip").click();
      out.알약넣은뒤=$("nameRule").value;
      await 잠깐(50);
      out.알약예시=($("namePrev").textContent||"").trim();
      setNameRule(""); $("nameRule").value=""; paintNameBar();

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
    /* 조각은 '외울 수 있는 만큼' 만 내놓아야 한다 —
       열여덟 개를 늘어놓았더니 만든 사람도 못 읽겠다고 했다. */
    const fails_push_알약 = (f, 알약) =>
      f.push(`눌러 넣는 조각이 ${알약.length}개다 — 5~9개여야 한다 (많으면 못 읽는다)`);

    /* ① 기본값은 예전 그대로 */
    const 예전 = ["내영상_CUT1.png", "내영상_CUT2.png", "내영상_CUT12.png"];
    if (!같나(r.기본, 예전))
      f.push(`기본 이름이 예전과 다르다 → ${r.기본.join(", ")}`);
    if (!같나(r.기본유지, 예전)) f.push("기본 규칙을 그대로 적었는데 다른 이름이 나온다");
    if (!같나(r.스타트, ["내영상_CUT1_START.png", "내영상_CUT2_START.png", "내영상_CUT12_START.png"]))
      f.push(`스타트 프레임 이름이 다르다 → ${r.스타트.join(", ")}`);

    /* ② 맞춤 규칙 */
    if (!/^\d{8}_내영상_001_00m03s12f\.png$/.test(r.맞춤[0]))
      f.push(`맞춤 규칙이 채워지지 않았다 → ${r.맞춤[0]}`);
    if (!/_012_/.test(r.맞춤[2])) f.push(`{번호3} 이 자리를 못 채웠다 → ${r.맞춤[2]}`);
    if (r.남의기록 !== "딴영상_5_1280x720.png")
      f.push(`다른 기록의 컷이 그 기록 값으로 안 적힌다 → ${r.남의기록}`);

    /* ③ 겹치면 살려 두는가 */
    if (new Set(r.겹침).size !== 3)
      f.push(`이름이 겹칠 때 덮어쓴다 → ${r.겹침.join(", ")}`);

    /* ④ 잘못 적어도 멀쩡한가 */
    if (!/\{없는조각\}/.test(r.모르는[0]))
      f.push(`모르는 조각이 조용히 사라졌다 (오타를 알 수 없다) → ${r.모르는[0]}`);
    if (r.빈규칙 !== "내영상_CUT1.png")
      f.push(`빈 규칙일 때 기본값으로 안 돌아간다 → ${r.빈규칙}`);
    if (/[\/:*?"<>|]/.test(r.못쓸글자.replace(/\.png$/, "")))
      f.push(`파일에 못 쓰는 글자가 이름에 남았다 → ${r.못쓸글자}`);

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

    /* ⑥ 이름 칸 · 설정 창 */
    if (!r.창열림 || !r.창닫힘) f.push("시간 표시 창이 열리거나 닫히지 않는다");
    if (!r.예시글) f.push("이름 예시가 비어 있다");
    if (!/\.png$/.test(r.예시글)) f.push(`이름 예시가 파일 이름 모양이 아니다 — "${r.예시글}"`);
    const 알약 = r.알약 || [];
    if (!(알약.length >= 5 && 알약.length <= 9))
      fails_push_알약(f, 알약);
    if (!알약.includes("이름") || !알약.includes("번호"))
      f.push(`가장 많이 쓰는 조각이 알약에 없다 — ${알약.join(", ")}`);
    /* 비어 있는 칸에서 알약을 누르면, 알약 하나만 덩그러니 남으면 안 된다 */
    if (!/^\{이름\}_CUT\{번호\}\{구분\}/.test(r.알약넣은뒤 || ""))
      f.push(`빈 칸에서 알약을 눌렀더니 기본 이름이 사라졌다 — "${r.알약넣은뒤}"`);
    if (!r.알약예시) f.push("알약을 넣은 뒤 예시가 갱신되지 않는다");
    if (!/간단|자세히|타임코드/.test(r.시간예시)) f.push("시간 표시 예시가 비어 있다");
    if (!r.눌러바뀜) f.push("재생 시각을 눌러도 표시 방식이 바뀌지 않는다");

    /* ⑦ 화면이 조용히 죽지 않았는가 */
    if (화면오류.length) f.push(`화면 오류 ${화면오류.length}건 · ${화면오류[0]}`);

    console.log("");
    console.log(`이름 예시   ${r.예시글}`);
    console.log(`조각 알약   ${(r.알약 || []).join(" ")}`);
    console.log(`기본 이름   ${r.기본.join("  ")}`);
    console.log(`맞춤 이름   ${r.맞춤.join("  ")}`);
    console.log(`겹칠 때     ${r.겹침.join("  ")}`);
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
