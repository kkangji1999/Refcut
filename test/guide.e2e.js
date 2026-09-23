/* 처음 오신 분을 위한 안내(가이드)를 시험한다.
   =========================================================================
   왜 필요한가 — 2026-09-23, 사용자 요청이 세 번 고쳐지며 여기까지 왔다:
     "가이드가 떴으면 좋겠다"
       → "네모와 색으로만 그리니 뭘 말하는지 모르겠다"
       → "한꺼번에 보여주니 복잡하다. 글 따로 그림 따로라 힘들다.
          차례대로 친절하게, 그리고 진짜 추출 기록이 들어가 있어야 한다"
   그래서 지금은 —
     · 무대에 이 프로그램의 실제 화면(왼쪽 기록 · 가운데 재생 · 오른쪽 컷)을 세우고
     · 한 장면에 '한 곳' 만 크게 비추며 그 아래 한 문장만 말한다
     · 장면은 저절로 흐르고, 마당은 [다음] 으로 넘긴다 (다섯 마당)
     · 예시 화면의 이름과 썸네일은 실제로 뽑아둔 기록을 그대로 쓴다
   여기서 채점하는 것 —
     · 처음 켜면 저절로 뜨는가 · 다섯 마당인가 · 마당마다 장면이 셋 이상인가
     · 장면마다 실제 화면 세 칸이 서고, 한 곳만 환한가 · 말하는 곳으로 다가가는가
     · ★ 썸네일이 실제로 그려지는가 (style 안의 주소가 깨지면 새까맣게 뜬다)
     · 예시에 진짜 기록이 들어가는가 · [다음] 은 늘 눌리는가
     · 장면이 저절로 흐르는가 · [다시 보지 않기] · [📖 사용법] · Esc
   쓰는 법:  npm run test:guide
   ========================================================================= */
const { app, BrowserWindow } = require("electron");
const path = require("path");
const ROOT = path.join(__dirname, "..");
require("./_격리")(app, "guide");
require(path.join(ROOT, "main.js"));

const waitWindow = () => new Promise(res => {
  const t = setInterval(() => { const w = BrowserWindow.getAllWindows()[0];
    if (w && !w.webContents.isLoading()) { clearInterval(t); res(w); } }, 200);
});
const 잠깐 = ms => new Promise(r => setTimeout(r, ms));

app.whenReady().then(async () => {
 try {
  const win = await waitWindow();
  win.setSize(1200, 900);
  win.webContents.on("console-message", (_e, lvl, msg) => {
    if (lvl >= 2 && !/Content-Security-Policy/.test(msg)) console.log("  [화면오류]", msg); });

  await win.webContents.executeJavaScript(
    `(()=>{ try{ localStorage.removeItem("cg_guide"); }catch(e){} closeDlg(null); return 1; })()`, true);

  const r = await win.webContents.executeJavaScript(`(async()=>{
    const 잠깐 = ms => new Promise(r=>setTimeout(r,ms));
    const $$ = s => [...document.querySelectorAll(s)];
    const out = {};
    closeDlg(null);
    if(!document.getElementById('guide').classList.contains('on')) openGuide();
    await 잠깐(250);
    out.열림 = document.getElementById('guide').classList.contains('on');
    out.마당수 = GUIDE.length;
    out.마당제목 = GUIDE.map(g=>g.t);
    out.장면수 = GUIDE.map(g=>g.장면.length);
    out.다음잠김 = document.getElementById('gNext').classList.contains('wait')
                 || document.getElementById('gNext').disabled;
    out.첫마당 = { 표: document.getElementById('gStepNo').textContent,
                  제목: document.getElementById('gTitle').textContent,
                  점: $$('#gDots s').length,
                  이전: getComputedStyle(document.getElementById('gPrev')).visibility };
    /* 예시 화면에 진짜 기록이 들어가는가 */
    const 기록 = 가이드기록들();
    out.기록 = { 쌓인것:(HIST||[]).length, 예시:기록.map(x=>x.이름),
                실제이름: (HIST||[]).length ? 기록.every(x=>(HIST||[]).some(j=>j.name===x.이름)) : null };
    /* 마당마다 · 장면마다 */
    const 본것=[];
    for(let i=0;i<GUIDE.length;i++){
      clearTimeout(g타이머); gIdx=i; paintGuide();
      const 마당=[];
      for(let b=0;b<GUIDE[i].장면.length;b++){
        clearTimeout(g타이머); g장면=b; 장면보이기(); clearTimeout(g타이머);
        await 잠깐(700);          /* 카메라와 불빛이 자리를 잡을 때까지 */
        const 썸=$$('#gStage .gThumb');
        마당.push({
          말: (document.getElementById('gCap').textContent||'').trim().length,
          무대: document.getElementById('aSide') ? '보관함' : '본 화면',
          칸: $$('#gStage .gPart').length,
          환한칸: $$('#gStage .gPart.on').length,
          썸: 썸.length,
          그려진썸: 썸.filter(el=>getComputedStyle(el).backgroundImage!=='none').length,
          확대: (()=>{ const t=getComputedStyle(document.getElementById('gApp')).transform;
                      const m=/matrix\\(([^,]+)/.exec(t); return m?Math.round(parseFloat(m[1])*100)/100:1; })(),
          장면수: (+document.getElementById('gScrub').max + 1) / 100,
          이장면: Math.floor(+document.getElementById('gScrub').value / 100) + 1,
          /* ★ 짚을 이름표가 무대 안에 살아 있는가 —
             진짜 화면에 같은 id 가 있으면 $() 가 그쪽을 집어 온 화면이 어두워진다 */
          짚기: (()=>{ const q=GUIDE[i].장면[b].구역;
            const ids = typeof q==='string' ? [q]
                      : (Array.isArray(q) && typeof q[0]==='string' ? q : []);
            const st=document.getElementById('gStage');
            return ids.map(id=>{ const e=document.getElementById(id);
              return { id, 무대안:!!(e && st && st.contains(e)),
                       w:e?e.offsetWidth:0, h:e?e.offsetHeight:0 }; }); })(),
          비추기: (()=>{ const sp=document.getElementById('gSpot');
            return sp ? { 켜짐:+getComputedStyle(sp).opacity>.5,
                          자리:[parseFloat(sp.style.left)||0, parseFloat(sp.style.top)||0,
                                parseFloat(sp.style.width)||0] } : null; })(),
        });
      }
      본것.push(마당);
      if(i===GUIDE.length-1) out.마지막단추 = document.getElementById('gNext').textContent;
    }
    out.마당 = 본것;
    /* ★ 말로만 하지 않고 그 자리에서 해 보이는가 (재생 머리·구간·하트) */
    const 움직임재기 = async (마당,장면,재기) => {
      clearTimeout(g타이머); gIdx=마당; paintGuide();
      clearTimeout(g타이머); g장면=장면; 장면보이기(); clearTimeout(g타이머);
      await 잠깐(250); const 처음=재기();
      await 잠깐(2600); const 나중=재기();
      clearTimeout(g타이머);
      return { 처음, 나중 };
    };
    const 머리 = () => parseFloat((document.getElementById('gPlayhead')||{}).style.left||0);
    const 띠   = () => parseFloat((document.getElementById('gBand')||{}).style.width||0);
    const 하트수 = () => $$('#gStage .gHeart.on').length;
    /* ★ D · F 는 '한 프레임' 이다 — 화면 그림이 통째로 바뀌면 한 컷씩 건너뛰어 보인다 */
    const 한장 = () => ({ 머리:머리(),
      번호:((document.getElementById('gFrameNo')||{}).textContent||'').trim(),
      그림:(((document.getElementById('gScreen')||{}).style||{}).backgroundImage||'') });
    out.해보임 = {
      프레임넘기기: await 움직임재기(3,3,한장),      /* ④마당 D · F */
      구간잡기:   await 움직임재기(3,6,띠),        /* ④마당 I · O */
      하트담기:   await 움직임재기(4,0,하트수),     /* ⑤마당 ♡ */
      컷병합:     await 움직임재기(2,7,()=>$$('#gStage .gCell.gone').length), /* ③마당 병합 */
      붙여넣기:   await 움직임재기(2,12,()=>$$('#gStage .gSlot.on').length),  /* ③마당 주르륵 붙이기 */
    };
    /* ★ 내보내기 아이콘이 장면이 끝나도 계속 빛나던 오류를 잡아 둔다 */
    clearTimeout(g타이머); gIdx=3; paintGuide();
    clearTimeout(g타이머); g장면=7; 장면보이기(); clearTimeout(g타이머);
    await 잠깐(1600); const 빛나는것 = $$('#gStage .gBtn.ico.key').length;
    await 잠깐(3200);
    out.내보내기불 = { 도중:빛나는것, 끝나고:$$('#gStage .gBtn.ico.key').length };
    clearTimeout(g타이머); 동작멈춤();
    /* ★ Shift — 재생 머리가 컷 눈금에 정말로 착 붙는가 */
    clearTimeout(g타이머); gIdx=3; paintGuide();
    clearTimeout(g타이머); g장면=1; 장면보이기(); clearTimeout(g타이머);
    {
      const 눈금=[46,102,158,214,262].map(x=>10+x-4);
      const 붙은것=[];
      for(let k=0;k<14;k++){
        await 잠깐(400);
        const h=parseFloat((document.getElementById('gPlayhead')||{}).style.left||0);
        if(눈금.indexOf(h)>=0 && 붙은것.indexOf(h)<0) 붙은것.push(h);
      }
      out.자석={ 붙은자리:붙은것.length };
    }
    clearTimeout(g타이머); 동작멈춤();
    /* ★ 보관함 2 · 4 · 8장 — 누르는 대로 칸이 진짜 바뀌는가 */
    clearTimeout(g타이머); gIdx=4; paintGuide();
    clearTimeout(g타이머); g장면=4; 장면보이기(); clearTimeout(g타이머);
    {
      const 잰것=[];
      for(let k=0;k<16;k++){
        await 잠깐(350);
        const e=document.getElementById('aCard0');
        if(e) 잰것.push(e.offsetWidth);
      }
      out.칸바뀜={ 가장작은:Math.min.apply(null,잰것), 가장큰:Math.max.apply(null,잰것),
                  가짓수:new Set(잰것).size };
    }
    clearTimeout(g타이머); 동작멈춤();
    /* ★ 아래 슬라이드바로 직접 옮겨 볼 수 있는가 */
    clearTimeout(g타이머); gIdx=0; paintGuide(); await 잠깐(200);
    const sc=document.getElementById('gScrub');
    sc.value=200; sc.dispatchEvent(new Event('input',{bubbles:true}));
    await 잠깐(300);
    out.슬라이드 = { 옮긴장면:g장면, 멈췄나:!자동,
                   단추:document.getElementById('gAuto').textContent.trim() };
    document.getElementById('gAuto').click();
    await 잠깐(200);
    out.슬라이드.다시감 = !!자동;
    /* 장면이 저절로 흐르는가 */
    clearTimeout(g타이머); gIdx=0; paintGuide();
    const 처음장면 = g장면;
    await 잠깐((GUIDE[0].장면[0].ms||2800)+500);
    out.흐름 = { 처음:처음장면, 다음:g장면 };
    /* 닫고 · 다시 보고 · 그만 보기 */
    gIdx = GUIDE.length-1; paintGuide();
    document.getElementById('gNext').click();
    await 잠깐(200);
    out.닫힘 = !document.getElementById('guide').classList.contains('on');
    out.그림멈춤 = document.querySelectorAll('#gStage .gPart').length;
    out.적어둔것 = (()=>{ try{ return localStorage.getItem('cg_guide'); }catch(e){ return ''; } })();
    document.getElementById('guideBtn').click();
    await 잠깐(200);
    out.다시열림 = document.getElementById('guide').classList.contains('on');
    out.다시첫마당 = document.getElementById('gStepNo').textContent;
    document.getElementById('gAgain').checked = true;
    document.getElementById('gSkip').click();
    await 잠깐(200);
    out.끄기 = { 닫힘: !document.getElementById('guide').classList.contains('on'),
                적어둔것: (()=>{ try{ return localStorage.getItem('cg_guide'); }catch(e){ return ''; } })() };
    openGuide();
    await 잠깐(150);
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
    await 잠깐(200);
    out.Esc닫힘 = !document.getElementById('guide').classList.contains('on');
    return out;
  })()`, true);

  const 실패 = [];
  const GUIDE_제목 = (r,i) => (r.마당제목 && r.마당제목[i]) || "";
  console.log("\n=== 안내가 뜨는가 ===");
  console.log("  열림           " + (r.열림 ? "떴다" : "안 떴다")
              + " · 마당 " + r.마당수 + "개 · 장면 [" + r.장면수.join(" ") + "]"
              + " · [다음] " + (r.다음잠김 ? "잠겨 있다" : "늘 눌린다"));
  console.log("  첫 마당        " + r.첫마당.표 + " · " + r.첫마당.제목
              + " · 점 " + r.첫마당.점 + "개 · [이전] " + r.첫마당.이전);
  console.log("  예시 기록      쌓인 것 " + r.기록.쌓인것 + "개 · [" + r.기록.예시.join(" · ") + "]"
              + (r.기록.실제이름 === null ? " (아직 없어 그린 그림)"
                                         : r.기록.실제이름 ? " · 진짜 기록이다" : " · 가짜다"));
  if (!r.열림) 실패.push("처음 켰는데 안내가 뜨지 않는다");
  if (r.마당수 !== 5) 실패.push(`마당이 ${r.마당수}개다 — 다섯으로 묶기로 했다`);
  if (r.다음잠김) 실패.push("[다음] 이 잠겨 있다 — 늘 눌리게 하기로 했다");
  if (r.첫마당.점 !== r.마당수) 실패.push("마당 점이 마당 수와 다르다");
  if (r.첫마당.이전 !== "hidden") 실패.push("첫 마당인데 [이전] 이 보인다");
  r.장면수.forEach((n,i)=>{ if(n < 3) 실패.push(`${i+1}마당의 장면이 ${n}개뿐이다 — 차례대로 짚어주기로 했다`); });
  /* ★ 예시 화면에는 내가 뽑은 기록이 들어가야 한다 (빈 화면이면 더 헷갈린다) */
  if (r.기록.실제이름 === false) 실패.push("예시 화면에 진짜 추출 기록이 들어가지 않았다");

  console.log("\n=== 장면마다 한 곳씩 크게 ===");
  r.마당.forEach((마당,i)=>{
    console.log("  " + (i+1) + "마당 " + GUIDE_제목(r,i));
    마당.forEach((s,b)=>console.log("     " + (b+1) + ") " + s.무대 + " · 글 " + s.말 + "자 · 칸 " + s.칸
      + "(환한 칸 " + s.환한칸 + ") · 썸네일 " + s.그려진썸 + "/" + s.썸
      + " · 확대 " + s.확대 + "배 · " + s.이장면 + "/" + s.장면수
      + (s.비추기 && s.비추기.켜짐 ? " · 비춤 [" + s.비추기.자리.join(",") + "]" : " · 전체")));
    마당.forEach((s,b)=>{
      const 이름 = (i+1) + "마당 " + (b+1) + "장면";
      if (s.말 < 12) 실패.push(이름 + "에 설명이 없다");
      /* 본 화면은 세 칸, 보관함은 폴더 칸 + 본문 두 칸이다 */
      const 바란칸 = s.무대 === '보관함' ? 2 : 3;
      if (s.칸 !== 바란칸) 실패.push(이름 + " " + s.무대 + " 무대에 칸이 " + s.칸 + "개다");
      /* ★ 동그라미 대신 '볼 곳만 환하게' 로 바꿨다 */
      if (!s.비추기) 실패.push(이름 + "에 비추는 자리(스포트라이트)가 없다");
      /* ★ 이름표로 짚는 장면은 그 이름표가 무대 안에 실제로 있어야 한다 */
      (s.짚기 || []).forEach(p => {
        if (!p.무대안) 실패.push(이름 + " 가 짚는 [" + p.id + "] 이 안내 무대에 없다"
                                + " — 진짜 화면에 같은 이름이 있는지 보라");
        else if (!p.w || !p.h) 실패.push(이름 + " 가 짚는 [" + p.id + "] 의 크기가 0 이다");
      });
      if (s.짚기 && s.짚기.length && s.비추기 && !(s.비추기.자리[2] > 0))
        실패.push(이름 + " 의 비추는 자리가 0 이다 — 화면이 통째로 어두워진다");
      /* ★ 주소가 깨지면 새까만 네모만 남는다 (두 번 그랬다) */
      if (!(s.썸 >= 8)) 실패.push(이름 + "에 썸네일이 " + s.썸 + "장뿐이다");
      if (s.그려진썸 !== s.썸) 실패.push(이름 + " 썸네일 " + (s.썸 - s.그려진썸) + "장이 그려지지 않았다");
      if (s.장면수 !== r.장면수[i]) 실패.push(이름 + " 슬라이드바 칸 수가 장면 수와 다르다");
      if (s.이장면 !== b+1) 실패.push(이름 + " 슬라이드바가 지금 장면을 가리키지 않는다");
    });
    const 확대들 = 마당.map(s=>s.확대);
    if (new Set(확대들).size < 2) 실패.push((i+1) + "마당의 장면들이 모두 같은 자리다 — 말하는 곳으로 다가가야 한다");
    const 비춘것 = 마당.filter(s=>s.비추기 && s.비추기.켜짐);
    if (비춘것.length < 2) 실패.push((i+1) + "마당에서 한 곳만 환하게 비추는 장면이 모자라다");
    if (new Set(비춘것.map(s=>s.비추기.자리.join(","))).size < 2)
      실패.push((i+1) + "마당의 비추는 자리가 늘 같다");
  });
  if (!/다 봤습니다/.test(r.마지막단추)) 실패.push("마지막 마당인데 단추가 [다음] 그대로다");
  /* ★ 즐겨찾기는 즐겨찾기 화면에서 설명해야 한다 */
  const 보관함장면 = (r.마당[4]||[]).filter(s=>s.무대==='보관함').length;
  console.log("  ⑤마당에서 보관함 화면으로 보여준 장면 " + 보관함장면 + "개");
  if (보관함장면 < 3) 실패.push("즐겨찾기를 보관함 화면에서 보여주는 장면이 " + 보관함장면 + "개뿐이다");

  console.log("\n=== 말한 것을 그 자리에서 해 보이는가 ===");
  const mv = r.해보임;
  const 한 = mv.프레임넘기기;
  console.log("  D · F 한 프레임씩  " + 한.처음.번호 + " → " + 한.나중.번호
              + " · 재생 머리 " + 한.처음.머리 + " → " + 한.나중.머리
              + " · 화면 그림 " + (한.처음.그림 === 한.나중.그림 ? "그대로(같은 컷)" : "통째로 바뀐다"));
  console.log("  I · O 구간 잡기    구간 띠 " + mv.구간잡기.처음 + " → " + mv.구간잡기.나중);
  console.log("  ♡ 담기            찬 하트 " + mv.하트담기.처음 + "개 → " + mv.하트담기.나중 + "개");
  console.log("  병합              합쳐져 사라진 컷 " + mv.컷병합.처음 + "개 → " + mv.컷병합.나중 + "개");
  console.log("  주르륵 붙여넣기    붙은 컷 " + mv.붙여넣기.처음 + "장 → " + mv.붙여넣기.나중 + "장");
  console.log("  내보내기 아이콘    도중 " + r.내보내기불.도중 + "개 켜짐 → 끝나고 "
              + r.내보내기불.끝나고 + "개");
  if (한.나중.머리 <= 한.처음.머리)
    실패.push("D · F 를 말하면서 프레임이 넘어가는 모습을 보여주지 않는다");
  if (한.처음.번호 === 한.나중.번호)
    실패.push("D · F 를 말하는데 프레임 번호가 그대로다");
  /* ★ 한 프레임인데 그림이 통째로 바뀌면 '한 컷씩' 건너뛰는 것처럼 보인다 */
  if (한.처음.그림 !== 한.나중.그림)
    실패.push("D · F 인데 화면 그림이 통째로 바뀐다 — 한 컷씩 넘어가는 것처럼 보인다");
  if (!(mv.붙여넣기.나중 >= 3 && mv.붙여넣기.나중 > mv.붙여넣기.처음))
    실패.push("복사한 컷을 다른 창에 주르륵 붙이는 모습을 보여주지 않는다");
  if (!r.내보내기불.도중)
    실패.push("구간 내보내기를 말하면서 아이콘이 켜지는 모습을 보여주지 않는다");
  if (r.내보내기불.끝나고)
    실패.push("장면이 끝났는데 내보내기 아이콘이 " + r.내보내기불.끝나고 + "개 계속 빛난다");
  if (!(mv.구간잡기.나중 > mv.구간잡기.처음))
    실패.push("I · O 를 말하면서 구간이 잡히는 모습을 보여주지 않는다");
  if (!(mv.하트담기.나중 > mv.하트담기.처음))
    실패.push("♡ 를 말하면서 담기는 모습을 보여주지 않는다");
  if (!(mv.컷병합.나중 > mv.컷병합.처음))
    실패.push("병합을 말하면서 컷이 합쳐지는 모습을 보여주지 않는다");

  console.log("  Shift 자석        눈금에 붙은 자리 " + r.자석.붙은자리 + "곳");
  console.log("  보관함 2 · 4 · 8장  칸 너비 " + r.칸바뀜.가장작은 + " ~ " + r.칸바뀜.가장큰
              + "px (" + r.칸바뀜.가짓수 + "가지)");
  if (!(r.자석.붙은자리 >= 3))
    실패.push("Shift 를 말하면서 재생 머리가 눈금에 붙는 모습을 보여주지 않는다");
  if (!(r.칸바뀜.가장큰 - r.칸바뀜.가장작은 > 100))
    실패.push("2 · 4 · 8장을 말하는데 칸 크기가 그대로다");

  console.log("\n=== 슬라이드바로 직접 옮겨 보기 ===");
  const sb = r.슬라이드;
  console.log("  3번째로 끌었더니 " + (sb.옮긴장면+1) + "번 장면 · 저절로 넘기기 "
              + (sb.멈췄나 ? "멈췄다" : "계속 돈다") + " (단추 " + sb.단추 + ")"
              + " · 다시 누르니 " + (sb.다시감 ? "돈다" : "안 돈다"));
  if (sb.옮긴장면 !== 2) 실패.push("슬라이드바를 옮겨도 그 장면으로 가지 않는다");
  if (!sb.멈췄나) 실패.push("슬라이드바를 잡았는데 저절로 넘어가는 것이 멈추지 않는다");
  if (!sb.다시감) 실패.push("[▶] 를 눌러도 다시 돌지 않는다");

  console.log("\n=== 장면이 저절로 흐르는가 ===");
  console.log("  " + r.흐름.처음 + "번 장면 → 기다렸더니 " + r.흐름.다음 + "번 장면");
  if (r.흐름.처음 === r.흐름.다음) 실패.push("기다려도 다음 장면으로 넘어가지 않는다");

  console.log("\n=== 닫고 · 다시 보고 · 그만 보기 ===");
  console.log("  마지막에서     " + (r.닫힘 ? "닫혔다" : "안 닫혔다")
              + " · 무대 " + (r.그림멈춤 ? "아직 돈다" : "비웠다")
              + " · 적어둔 것 " + (r.적어둔것 || "없음"));
  console.log("  [📖 사용법]    " + (r.다시열림 ? "다시 열린다" : "안 열린다") + " · " + r.다시첫마당);
  console.log("  다시 보지 않기 " + (r.끄기.닫힘 ? "닫혔다" : "안 닫혔다")
              + " · 적어둔 것 " + (r.끄기.적어둔것 || "없음"));
  console.log("  Esc            " + (r.Esc닫힘 ? "닫힌다" : "안 닫힌다"));
  if (!r.닫힘) 실패.push("마지막에서 눌러도 안내가 닫히지 않는다");
  if (r.그림멈춤) 실패.push("닫았는데 그림이 계속 돌고 있다");
  if (!r.적어둔것) 실패.push("다 본 것을 기억하지 않는다 — 켤 때마다 다시 뜬다");
  if (!r.다시열림) 실패.push("[📖 사용법] 으로 다시 열리지 않는다");
  if (r.다시첫마당 !== "1 / " + r.마당수) 실패.push("다시 열었는데 1마당부터가 아니다");
  if (!r.끄기.닫힘) 실패.push("[건너뛰기] 로 닫히지 않는다");
  if (r.끄기.적어둔것 !== "off") 실패.push("[다시 보지 않기] 를 걸어도 기억하지 않는다");
  if (!r.Esc닫힘) 실패.push("Esc 로 닫히지 않는다");

  console.log(실패.length ? "\n실패" : "\n---------------- 결과 ----------------\n전부 통과");
  실패.forEach(x => console.log("  " + x));
  app.exit(실패.length ? 1 : 0);
 } catch (e) { console.log("시험 자체가 넘어졌다\n" + (e.stack || e)); app.exit(1); }
});
