/* vidbtn.e2e.js 가 앱 화면 안에서 돌리는 시나리오 (그 파일이 __ __ 자리를 채운다) */
(async () => {
  const 결과 = { 기록: [], 정보창: null, 폴더: null, 단추: null, err: null };
  try {
    const 영상 = __영상__;
    await jobPut({ id: OUTKEY, dir: __저장__ });

    /* ---- 1) 영상 여러 개를 잇달아 뽑아 기록을 쌓는다 ----
       두 번째부터는 '보고 있는 결과' 가 있으므로 화면은 그대로 두고
       기록만 늘어난다 — 사용자가 겪은 상황과 똑같다. */
    for (const { nm, p } of 영상) {
      S.queue = []; closeDlg(null);
      await addFiles([{ file: { name: nm, size: 0, type: "" }, path: p }]);
      if (S.queue.length !== 1) throw new Error(nm + " 가 대기열에 들어가지 않았다");
      await startRun();
    }
    await renderHist();

    /* ---- 2) 기록을 하나씩 열어보며 [영상 위치] 가 그 기록을 가리키는지 본다 ---- */
    for (const j of HIST) {
      S.jobId = null;                      // 같은 것 재클릭 무시를 피한다
      await loadJob(j.id);
      for (let i = 0; i < 40 && !S.playSrc; i++) await new Promise(r => setTimeout(r, 100));
      결과.기록.push({ 이름: j.name, 원한것: j.srcPath || "", 붙은것: S.playSrc || "" });
    }

    /* ---- 3) Tab 정보창: 두 줄기로 서고, 배경이 새까맣지 않은가 ---- */
    const box = document.getElementById("pinfoBox");
    box.classList.remove("on");
    await toggleInfo();
    for (let i = 0; i < 40; i++) {                       // 코덱 읽기가 끝날 때까지
      if (!/읽는 중/.test(box.textContent)) break;
      await new Promise(r => setTimeout(r, 150));
    }
    const cs = getComputedStyle(box);
    const ks = [...box.querySelectorAll(".k")], vs = [...box.querySelectorAll(".v")];
    /* 이름칸이 모두 같은 x 에서 시작하고, 값칸도 모두 같은 x 에서 시작해야 '정렬' 이다 */
    const x = el => Math.round(el.getBoundingClientRect().left);
    결과.정보창 = {
      display: cs.display,
      배경: cs.backgroundColor,
      흐림: cs.backdropFilter || cs.webkitBackdropFilter || "",
      이름칸: ks.length, 값칸: vs.length,
      이름줄맞음: new Set(ks.map(x)).size === 1,
      값줄맞음:   new Set(vs.map(x)).size === 1,
      첫줄: ks.length ? ks[0].textContent + " / " + vs[0].textContent : "",
    };
    box.classList.remove("on");

    /* ---- 4) 즐겨찾기 폴더 그림표 고르기 ---- */
    const id = "f_시험";
    await folPut({ id, name: "시험폴더", order: 0, createdAt: new Date().toISOString() });
    await loadFolders();
    document.getElementById("archive").classList.add("on");
    renderArchive();
    const 처음 = document.querySelector('.afold[data-f="' + id + '"] .ic');
    처음.click();                                     // 그림표 고르는 창이 뜬다
    const pick = document.getElementById("icPick");
    const 떴나 = !!pick && pick.classList.contains("on");
    const 고를것 = pick ? [...pick.querySelectorAll("b")] : [];
    if (고를것.length > 6) 고를것[6].click();          // 일곱 번째 그림으로 바꾼다
    await new Promise(r => setTimeout(r, 250));
    const 바뀐 = document.querySelector('.afold[data-f="' + id + '"] .ic');
    /* 다시 읽어들여도 남아 있는가 (저장이 되었는가) */
    await loadFolders();
    const 저장된 = (FOLDERS.find(f => f.id === id) || {}).icon || "";
    결과.폴더 = { 처음: 처음.textContent, 창떴나: 떴나, 고른수: 고를것.length,
                  화면: 바뀐 ? 바뀐.textContent : "", 저장됨: 저장된 };
    await folDel(id); await loadFolders();
    document.getElementById("archive").classList.remove("on");

    /* ---- 5) 단추 이름 ---- */
    const sv = document.getElementById("saveVid");
    결과.단추 = { 글자: sv.textContent, 설명: sv.title };
    결과.안내 = document.getElementById("speedNote").textContent;
  } catch (e) { 결과.err = String((e && e.stack) || e); }
  return 결과;
})()
