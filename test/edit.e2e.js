/* 컷을 손으로 정리하는 길이 제대로 이어져 있는가.
   =========================================================================
   추출까지는 다른 시험(app.e2e)이 본다. 여기서는 그 뒤를 본다.

     ① 병합   — 여러 컷이 한 컷이 되고 번호가 1부터 다시 매겨지는가
     ② 교체   — 지금 재생 위치의 그림이 그 컷의 대표가 되는가
     ③ 분할   — 한 컷이 두 컷으로 갈리고 시각이 어긋나지 않는가
     ④ 초기화 — 손댄 것이 모두 사라지고 분석 직후로 정확히 돌아가는가

   그리고 손본 결과가 '보이는 모든 곳' 에 함께 반영되는가.

     ⑤ 재생바 눈금   — 컷이 줄고 늘 때 눈금도 같이 줄고 느는가
                       (분석 프레임을 볼 때는 그 장의 자리에 점도 찍히는가)
     ⑥ 즐겨찾기      — 병합해도 걸어둔 즐겨찾기가 살아남는가
     ⑦ 저장 폴더     — CUT1..N 만 남고 남는 번호는 지워지는가
     ⑧ 샷리스트      — 새 목록으로 다시 만들어지는가
     ⑨ 스타트 프레임 — 손본 컷 목록에 맞춰 다시 만들어지는가
     ⑩ 기록(JSON)    — 위 모든 것이 그대로 적히는가

   덤으로 새로 들어온 것들도 한 번씩 두드려 본다.
     · 구간 표시에 '몇 장 · 몇 컷' 이 나오는가
     · 구간을 영상으로 잘라낼 수 있는가
     · 정보창이 코덱을 읽어 오는가

   쓰는 법:  npm run test:edit     (창은 뜨지만 곧 스스로 닫힌다)
   ========================================================================= */
const { app, BrowserWindow } = require("electron");
const path = require("path");
const fs = require("fs");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(__dirname, "_생성물");
const VIDEO = path.join(OUT, "clip.mp4");

const 시험방 = require("./_격리")(app, "edit");
const SAVE = path.join(시험방.저장, "컷정리결과");
require(path.join(ROOT, "main.js"));

const waitWindow = () => new Promise(res => {
  const t = setInterval(() => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w && !w.webContents.isLoading()) { clearInterval(t); res(w); }
  }, 200);
});

const 목록읽기 = d => { try { return fs.readdirSync(d); } catch (e) { return []; } };

app.whenReady().then(async () => {
  try {
    if (!fs.existsSync(VIDEO)) {
      fs.mkdirSync(OUT, { recursive: true });
      await require("./make-clip").make(VIDEO, false);
    }
    fs.rmSync(SAVE, { recursive: true, force: true });
    /* ★ 지난 번 시험이 남긴 기록도 함께 치운다.
       기록은 저장 폴더 안 _기록 에 쌓이는데, 이것을 두면 지난 번 시험의 컷과
       즐겨찾기가 이번 셈에 섞여 들어와 엉뚱한 자리에서 실패한다. */
    fs.rmSync(path.join(시험방.저장, "_기록"), { recursive: true, force: true });

    const win = await waitWindow();
    win.webContents.on("console-message", (_e, lvl, msg) => {
      if (lvl >= 2 && !/Content-Security-Policy/.test(msg)) console.log("  [화면 오류]", msg);
    });

    const r = await win.webContents.executeJavaScript(`(async()=>{
      const 잠깐=ms=>new Promise(k=>setTimeout(k,ms));
      const 목록=()=>S.out.shots.map(s=>({idx:s.idx,t:+s.t.toFixed(3),
        inT:+(s.inT??0).toFixed(3), outT:s.outT==null?null:+s.outT.toFixed(3),
        hand:!!s.hand, fav:!!s.fav, file:s.file||null, thumb:s.thumb||null}));
      const 기록=async()=>{ const j=await jobGet(S.jobId);
        return {n:(j.shots||[]).length, idx:(j.shots||[]).map(x=>x.idx),
                fav:(j.shots||[]).map(x=>!!x.fav),
                orig:(j.origShots||[]).length, edited:!!j.edited,
                keep:(j.keepShots||[]).length, keepFile:((j.keepShots||[])[0]||{}).file||null,
                rev:j.rev||0, maxFiles:j.maxFiles||0}; };
      const 눈금=()=>({ mk:document.querySelectorAll("#marks .mk").length });

      for(let i=0;i<10 && $("dlg").classList.contains("on");i++){ closeDlg(false); await 잠깐(120); }
      await jobPut({id:OUTKEY, dir:${JSON.stringify(SAVE)}});
      const FILE=${JSON.stringify(VIDEO)};
      const p=await window.CG.probe(FILE);
      S.queue=[{name:"clip.mp4", path:FILE, duration:p.duration, fps:p.fps,
                w:p.width, h:p.height, size:p.size, type:"video/mp4", status:"wait"}];
      renderQueue();
      await startRun();
      if(!S.out) return {error:"추출 결과가 없습니다 · "+(statusEl.textContent||"")};
      if(S.out.shots.length<4) return {error:"컷이 너무 적어 시험할 수 없습니다"};

      for(let i=0;i<60 && !pv.videoWidth;i++) await 잠깐(100);
      if(!pv.videoWidth) return {error:"재생 칸이 영상을 읽지 못했습니다"};

      const out={ 처음:목록(), base:S.out.base, outDir:S.out.outDir, 처음눈금:눈금() };

      /* ---------- 즐겨찾기를 하나 담아 둔다 ----------
         이제 즐겨찾기는 컷 목록과 따로 사는 사본이다.
         병합·교체·분할은 물론 [초기화] 까지 해도 그대로 남아야 한다. */
      await saveShotFav(2,true);
      const 내즐겨=()=>allFavShots().filter(x=>x.job.id===S.jobId).length;
      out.처음즐겨=내즐겨(); out.처음즐겨기록=await 기록();

      /* ---------- ① 병합 : CUT2 + CUT3 ---------- */
      await doMerge([1,2], null);
      await flushFolder();
      out.병합=목록(); out.병합기록=await 기록(); out.병합눈금=눈금();
      out.격자수=grid.querySelectorAll("figure").length;
      out.병합즐겨=내즐겨(); out.병합즐겨기록=await 기록();

      /* ---------- ② 교체 : 두 번째 컷 한가운데 화면으로 ---------- */
      S.sel.clear(); paintSel();
      const s2=S.out.shots[1];
      pv.currentTime=(s2.inT + (s2.outT??s2.inT+0.5))/2;
      await 잠깐(400);
      const 교체시각=pv.currentTime;
      await replaceHere();
      await flushFolder();
      out.교체=목록(); out.교체시각=+교체시각.toFixed(3);

      /* ---------- ③ 분할 ---------- */
      const s3=S.out.shots[1];
      pv.currentTime=(s3.inT + (s3.outT??s3.inT+0.5))/2;
      await 잠깐(400);
      await splitHere();
      await flushFolder();
      out.분할=목록(); out.분할기록=await 기록(); out.분할눈금=눈금();

      /* ---------- 구간 표시 · 구간 영상 ---------- */
      S.inT=0.4; S.outT=1.6; paintIO();
      out.구간글=$("ioText").textContent;
      const 클립=$("ioClip").onclick();          // 물어보지 않고 바로 뽑는다
      let 떴다=false;
      for(let i=0;i<300;i++){
        await 잠깐(100);
        if($("dlg").classList.contains("on") && /구간 영상/.test($("dlgTitle").textContent)){
          떴다=true; break; }
      }
      out.클립알림=떴다 ? $("dlgBody").textContent.slice(0,200) : "(알림창이 뜨지 않았다)";
      closeDlg(true);
      await 클립;
      clearIO();

      /* ---------- 정보창 코덱 ---------- */
      const pf=await window.CG.probeFull(S.out.srcPath);
      out.코덱=(pf&&pf.ok&&pf.video)?(pf.video.codec_name||""):"";

      /* ---------- ⑨ 스타트 프레임 ---------- */
      out.스타트비움 = !S.out.startShots;
      out.스타트만듦 = await buildStartShots();
      out.스타트=(S.out.startShots||[]).map(x=>({idx:x.idx,t:+x.t.toFixed(3),file:x.file||null}));
      /* 파일이 실제로 생겼는지는 지금 확인해 둔다 —
         뒤이어 도는 [초기화] 가 낡은 스타트 프레임을 폴더에서 치우기 때문이다 */
      out.스타트있나=[];
      for(const x of (S.out.startShots||[])){
        let 있다=false;
        try{ const b=await window.CG.readFile(x.file); 있다=!!(b && b.byteLength>1000); }catch(e){}
        out.스타트있나.push(있다);
      }
      S.mode="smart"; paintModeSw(); refreshShots();

      /* ---------- ④ 초기화 ---------- */
      const p2=resetCuts();
      for(let i=0;i<50;i++){ await 잠깐(100);
        if($("dlg").classList.contains("on") && /초기화/.test($("dlgTitle").textContent)) break; }
      closeDlg(true);
      await p2;
      await flushFolder();
      out.초기화=목록(); out.초기화기록=await 기록(); out.초기화눈금=눈금();
      out.수정표시=$("editedTag").classList.contains("on");
      out.초기화즐겨=내즐겨(); out.초기화즐겨기록=await 기록();
      out.눈금기준={ smart:(drawMarks(),MARKS.slice()) };
      S.mode="start"; refreshShots(); out.눈금기준.start=MARKS.slice();
      S.mode="smart"; refreshShots();
      return out;
    })()`, true);

    if (r.error) { console.log("실패 ", r.error); app.exit(1); return; }

    const fails = [];
    const 같은목록 = (a, b) => a.length === b.length
      && a.every((x, i) => x.idx === b[i].idx && Math.abs(x.t - b[i].t) < 1e-3
        && Math.abs((x.inT || 0) - (b[i].inT || 0)) < 1e-3);
    const 번호연속 = a => a.every((x, i) => x.idx === i + 1);

    const CUTS = path.join(r.outDir, r.base + "_CUTS");
    const 분석 = path.join(CUTS, "분석 프레임");
    const 미리 = path.join(CUTS, "_목록미리보기(작은그림)");
    const 스타트 = path.join(CUTS, "스타트 프레임");
    const 구간 = path.join(CUTS, "구간 영상");
    const 시트 = path.join(CUTS, r.base + "_샷리스트_분석프레임.png");

    console.log(`처음 ${r.처음.length}컷 → 병합 ${r.병합.length}컷 `
      + `→ 분할 ${r.분할.length}컷 → 초기화 ${r.초기화.length}컷`);
    console.log(`저장 폴더  분석 프레임 ${목록읽기(분석).length}장 · `
      + `미리보기 ${목록읽기(미리).length}장 · 구간 영상 ${목록읽기(구간).length}개`);
    console.log(`구간 표시  ${r.구간글}`);
    console.log(`코덱       ${r.코덱 || "(못 읽음)"}`);

    /* ① 병합 */
    if (r.병합.length !== r.처음.length - 1)
      fails.push(`병합: ${r.처음.length}컷에서 하나 줄어야 하는데 ${r.병합.length}컷이다`);
    if (!번호연속(r.병합)) fails.push("병합: 컷 번호가 1부터 이어지지 않는다");
    if (r.병합[1] && r.처음[2] && Math.abs(r.병합[1].outT - r.처음[2].outT) > 1e-3)
      fails.push("병합: 합친 컷의 끝이 마지막 컷의 끝과 다르다");
    if (r.격자수 !== r.병합.length)
      fails.push(`병합: 화면에 그려진 컷(${r.격자수})이 목록(${r.병합.length})과 다르다`);

    /* ② 교체 */
    if (!r.교체[1] || !r.교체[1].hand) fails.push("교체: 직접 고른 표시가 붙지 않았다");
    if (r.교체[1] && Math.abs(r.교체[1].t - r.교체시각) > 0.1)
      fails.push(`교체: 대표 시각이 재생 위치(${r.교체시각}s)와 다르다 (${r.교체[1].t}s)`);
    if (r.교체.length !== r.병합.length)
      fails.push("교체: 컷 수가 달라졌다 (교체는 수를 바꾸면 안 된다)");

    /* ③ 분할 */
    if (r.분할.length !== r.교체.length + 1)
      fails.push(`분할: 한 컷 늘어야 하는데 ${r.분할.length}컷이다`);
    if (!번호연속(r.분할)) fails.push("분할: 컷 번호가 1부터 이어지지 않는다");
    r.분할.forEach((s, i) => {
      const n = r.분할[i + 1];
      if (n && s.outT != null && Math.abs(s.outT - n.inT) > 1e-3)
        fails.push(`분할: CUT${s.idx} 의 끝과 CUT${n.idx} 의 시작이 어긋난다`);
      if (s.outT != null && s.t > s.outT + 1e-3)
        fails.push(`분할: CUT${s.idx} 의 대표 시각이 컷 밖으로 나갔다`);
    });

    /* ⑤ 재생바 눈금 */
    if (r.처음눈금.mk !== r.처음.length)
      fails.push(`눈금: 처음에 ${r.처음눈금.mk}개 — 컷 수(${r.처음.length})와 다르다`);
    if (r.병합눈금.mk !== r.병합.length)
      fails.push(`눈금: 병합 뒤 ${r.병합눈금.mk}개 — 컷 수(${r.병합.length})와 다르다`);
    if (r.분할눈금.mk !== r.분할.length)
      fails.push(`눈금: 분할 뒤 ${r.분할눈금.mk}개 — 컷 수(${r.분할.length})와 다르다`);
    if (r.초기화눈금.mk !== r.초기화.length)
      fails.push(`눈금: 초기화 뒤 ${r.초기화눈금.mk}개 — 컷 수(${r.초기화.length})와 다르다`);

    /* ⑥ 즐겨찾기 — 한 번 담으면 무슨 짓을 해도 남아야 한다 */
    if (r.처음즐겨 !== 1) fails.push(`즐겨찾기: 하나 담았는데 ${r.처음즐겨}개로 잡힌다`);
    if (r.처음즐겨기록.keep !== 1) fails.push("즐겨찾기: 기록에 담기지 않았다");
    if (r.병합즐겨 !== 1) fails.push(`즐겨찾기: 병합 뒤 ${r.병합즐겨}개 — 사라졌거나 늘었다`);
    if (r.초기화즐겨 !== 1)
      fails.push(`즐겨찾기: 초기화 뒤 ${r.초기화즐겨}개 — 담아둔 것이 없던 일이 됐다`);
    if (r.초기화즐겨기록.keep !== 1)
      fails.push("즐겨찾기: 초기화가 기록의 보관 목록까지 지웠다");
    const 담은파일 = r.초기화즐겨기록.keepFile;
    if (!담은파일) fails.push("즐겨찾기: 담아둔 사본의 자리가 기록에 없다");
    else if (!fs.existsSync(담은파일))
      fails.push("즐겨찾기: 담아둔 사본이 폴더 정리에 휩쓸려 사라졌다");
    else if (담은파일.indexOf("즐겨찾기") < 0)
      fails.push(`즐겨찾기: 사본이 [즐겨찾기] 칸이 아닌 곳에 있다 — ${담은파일}`);

    /* ⑦ 저장 폴더 */
    const 분석파일 = 목록읽기(분석).filter(f => /\.png$/i.test(f)).sort();
    const 있어야 = r.분할.map((_, i) => `${r.base}_CUT${i + 1}.png`).sort();
    if (분석파일.join("|") !== 있어야.join("|"))
      fails.push(`저장 폴더: [분석 프레임] 이 목록과 다르다\n`
        + `            폴더 ${분석파일.join(", ")}\n            목록 ${있어야.join(", ")}`);
    const 미리파일 = 목록읽기(미리).filter(f => /^CUT\d+\.jpg$/i.test(f)).length;
    if (미리파일 !== r.분할.length)
      fails.push(`저장 폴더: 미리보기가 ${미리파일}장 — 컷 수(${r.분할.length})와 다르다`);
    r.분할.forEach(s => {
      if (s.file && !fs.existsSync(s.file)) fails.push(`CUT${s.idx} 의 그림 파일이 없다`);
      if (s.thumb && !fs.existsSync(s.thumb)) fails.push(`CUT${s.idx} 의 미리보기가 없다`);
    });
    if (목록읽기(분석).some(f => /직접|메꿈|지금화면/.test(f)))
      fails.push("저장 폴더: 임시로 뽑은 그림이 [분석 프레임] 에 그대로 남아 있다");

    /* ⑧ 샷리스트 */
    if (!fs.existsSync(시트)) fails.push("샷리스트: 파일이 없다");
    else if (fs.statSync(시트).size < 2000) fails.push("샷리스트: 파일이 비어 있다시피 하다");

    /* ⑨ 스타트 프레임 */
    if (!r.스타트비움) fails.push("스타트 프레임: 컷을 손봤는데도 옛 목록이 남아 있었다");
    if (!r.스타트만듦) fails.push("스타트 프레임: 새 컷 목록으로 다시 만들지 못했다");
    if (r.스타트.length !== r.분할.length)
      fails.push(`스타트 프레임: ${r.스타트.length}장 — 손본 컷 수(${r.분할.length})와 다르다`);
    r.스타트.forEach((s, i) => {
      const a = r.분할[i];
      if (!a) return;
      if (a.idx !== s.idx) fails.push(`스타트 프레임: ${i + 1}번째 컷 번호가 어긋난다`);
      if (Math.abs(a.inT - s.t) > 1e-3)
        fails.push(`CUT${s.idx} 스타트 프레임의 시각(${s.t}s)이 컷 시작(${a.inT}s)과 다르다`);
      if (!r.스타트있나[i]) fails.push(`CUT${s.idx} 스타트 프레임 파일이 만들어지지 않았다`);
    });
    /* 초기화는 컷 목록을 되돌리므로 낡은 스타트 프레임도 폴더에서 함께 치운다.
       (번호만 맞춰 남겨두면 '옛 컷의 스타트' 가 폴더에 남아 가장 헷갈린다) */
    const 스타트남음 = 목록읽기(스타트).filter(f => /\.png$/i.test(f)).length;
    if (스타트남음 !== 0)
      fails.push(`스타트 프레임: 초기화 뒤에도 폴더에 ${스타트남음}장이 남아 있다`);

    /* ④ 초기화 */
    if (!같은목록(r.초기화, r.처음))
      fails.push(`초기화: 분석 직후(${r.처음.length}컷)와 다르다 (${r.초기화.length}컷)`);
    if (r.초기화.some(s => s.hand)) fails.push("초기화: 직접 고른 표시가 남아 있다");
    if (r.초기화기록.n !== r.처음.length || r.초기화기록.edited)
      fails.push("초기화: 기록이 되돌아가지 않았다");
    if (r.수정표시) fails.push("초기화: 화면의 [수정됨] 표시가 남아 있다");
    const 초기화파일 = 목록읽기(분석).filter(f => /\.png$/i.test(f)).length;
    if (초기화파일 !== r.처음.length)
      fails.push(`초기화: 저장 폴더가 ${초기화파일}장 — 처음(${r.처음.length}장)과 다르다`);

    /* ⑩ 기록 */
    if (r.병합기록.n !== r.병합.length || !r.병합기록.edited)
      fails.push("기록: 병합이 그대로 적히지 않았다");
    if (r.병합기록.orig !== r.처음.length)
      fails.push(`기록: 되돌릴 밑그림이 ${r.병합기록.orig}컷으로 잘못 적혔다`);
    if (r.분할기록.n !== r.분할.length) fails.push("기록: 분할이 그대로 적히지 않았다");
    if (!(r.분할기록.rev > 0)) fails.push("기록: 그림이 바뀌었다는 표(rev)가 오르지 않았다");

    /* 눈금 기준 — 보고 있는 목록에 따라 자리가 달라져야 한다 */
    if (!r.눈금기준 || !r.눈금기준.smart.length || !r.눈금기준.start.length)
      fails.push("눈금: 자리를 읽지 못했다");
    else {
      const 같음 = r.눈금기준.smart.length === r.눈금기준.start.length
        && r.눈금기준.smart.every((t, i) => Math.abs(t - r.눈금기준.start[i]) < 1e-6);
      if (같음) fails.push("눈금: 분석 프레임과 스타트 프레임의 자리가 똑같다 "
        + "(분석 프레임은 컷 한가운데라 달라야 한다)");
      r.초기화.forEach((s, i) => {
        if (Math.abs(r.눈금기준.smart[i] - s.t) > 1e-3)
          fails.push(`눈금: CUT${s.idx} 의 눈금이 분석 프레임 자리와 다르다`);
        if (Math.abs(r.눈금기준.start[i] - s.inT) > 1e-3)
          fails.push(`눈금: CUT${s.idx} 의 스타트 눈금이 컷 시작과 다르다`);
      });
    }

    /* 덤 */
    if (/뜨지 않았다/.test(r.클립알림 || ""))
      fails.push("구간 영상: 다 만들었다는 알림이 뜨지 않았다");
    if (!/장/.test(r.구간글) || !/컷/.test(r.구간글))
      fails.push(`구간 표시에 몇 장·몇 컷인지가 없다 — "${r.구간글}"`);
    const 클립파일 = 목록읽기(구간);
    if (!클립파일.length) fails.push("구간 영상: 잘라낸 파일이 없다");
    else if (fs.statSync(path.join(구간, 클립파일[0])).size < 1000)
      fails.push("구간 영상: 파일이 비어 있다");
    if (!r.코덱) fails.push("정보창: 코덱을 읽어 오지 못했다");

    console.log(fails.length ? "\n실패"
      : "\n통과  손본 결과가 목록·화면·눈금·즐겨찾기·저장 폴더·샷리스트에 모두 반영됐다");
    fails.forEach(f => console.log("      " + f));
    app.exit(fails.length ? 1 : 0);
  } catch (e) {
    console.error("시험을 돌리지 못했습니다:", e && e.message);
    app.exit(1);
  }
});
