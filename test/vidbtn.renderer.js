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

    /* ---- 5) 보관함에서 영상을 두 번 눌렀을 때 ----
       ★ 처음에는 보관함을 닫고 결과 화면으로 끌고 갔고, 그 다음에는 첫 컷 한 장을
         스틸로 띄웠다. 영상을 담아 둔 사람이 보고 싶은 것은 그 영상이다.
         이제 같은 자리에서 원본이 그대로 돌고, 아래 컷 띠를 누르면 그 지점부터 본다. */
    {
      const j0 = HIST[0];
      const rec = await jobGet(j0.id);
      rec.fav = true;
      rec.shots[1].fav = true;      // 이 영상 속 한 순간도 담아 둔다 (재생 줄의 하트)
      await jobPut(rec);
      await renderHist();
      document.getElementById("archive").classList.add("on");
      renderArchive();
      const card = [...document.querySelectorAll("#archive .acard")]
        .find(el => String(el.dataset.k || "").startsWith("V|"));
      const v = document.getElementById("lbVid");
      if (card) {
        card.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
        for (let i = 0; i < 60 && v.readyState < 1; i++)   // 영상이 열릴 때까지
          await new Promise(r => setTimeout(r, 100));
        await new Promise(r => setTimeout(r, 400));
      }
      const 돌았나 = !v.paused;         // ★ 줄을 건드리기 전에 본다 (짧은 시험 영상은 금세 끝난다)
      const 길이 = v.duration || 0;
      const tr = document.getElementById("lbTrack");
      const tw = tr.getBoundingClientRect();

      /* ① 재생 줄에 커서를 올리면 그 지점 화면이 뜨는가 */
      tr.dispatchEvent(new PointerEvent("pointermove",
        { clientX: tw.left + tw.width * 0.55, clientY: tw.top + 14, bubbles: true }));
      const tip = document.getElementById("lbTip");
      const 미리보기 = { 떴나: tip.classList.contains("on"),
                        그림: !!(tip.querySelector("img").getAttribute("src") || ""),
                        글: tip.querySelector("span").textContent };

      /* ② 내가 담아둔 순간에 하트가 떠 있는가 (자리까지 맞는가) */
      const hs = [...document.querySelectorAll("#lbHearts .hh")];
      const 하트 = { 개수: hs.length, 담은것: (LB.hearts || []).length,
                    자리: hs.length && 길이
                      ? Math.abs(parseFloat(hs[0].style.left) - LB.hearts[0].t / 길이 * 100) : null };

      /* ③ 하트를 누르면 그 순간으로 건너뛰는가 */
      let 건너뜀 = null;
      if (hs.length) {
        const 목표 = LB.hearts[0].t;
        hs[0].click();
        await new Promise(r => setTimeout(r, 120));
        v.pause();                      // 흘러가기 전에 멈춰 세우고 잰다
        건너뜀 = { 목표: Math.round(목표 * 100) / 100,
                   실제: Math.round(v.currentTime * 100) / 100 };
      }

      /* ④ 재생 줄을 눌러 옮길 수 있는가 */
      tr.dispatchEvent(new PointerEvent("pointerdown",
        { clientX: tw.left + tw.width * 0.25, clientY: tw.top + 14,
          button: 0, bubbles: true, cancelable: true }));
      tr.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
      await new Promise(r => setTimeout(r, 150));
      v.pause();
      const 줄로이동 = { 목표: Math.round(길이 * 0.25 * 100) / 100,
                       실제: Math.round(v.currentTime * 100) / 100 };

      결과.영상크게 = {
        카드있나: !!card,
        크게열림: document.getElementById("lb").classList.contains("on"),
        영상모드: document.getElementById("lb").classList.contains("vid"),
        영상붙음: !!v.getAttribute("src"),
        그려짐: v.videoWidth || 0,
        길이: Math.round(길이 * 100) / 100,
        돌고있나: 돌았나,
        보관함남음: document.getElementById("archive").classList.contains("on"),
        컷띠남음: !!document.getElementById("lbStrip"),
        재생줄: getComputedStyle(document.getElementById("lbBar")).display,
        미리보기, 하트, 건너뜀, 줄로이동,
        장수: (LB.list || []).length,
        이동단추: getComputedStyle(document.getElementById("lbGo")).display,
        이동단추글자: document.getElementById("lbGo").textContent,
        복사단추: getComputedStyle(document.getElementById("lbCopy")).display,
      };
      closeLB();
      await new Promise(r => setTimeout(r, 200));
      결과.영상크게.닫은뒤소리 = !v.paused;              // 닫았는데 소리가 남아 있으면 안 된다
      결과.영상크게.닫은뒤주소 = !!v.getAttribute("src");

      /* ---- 영상을 보고 난 뒤에 스틸을 열어도 그림으로 보이는가 ----
         (영상 자리가 그대로 남아 그림을 가리면 안 된다) */
      const rec2 = await jobGet(j0.id);
      await renderHist(); renderArchive();
      const 스틸 = [...document.querySelectorAll("#archive .acard")]
        .find(el => !String(el.dataset.k || "").startsWith("V|"));
      if (스틸) {
        스틸.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
        await new Promise(r => setTimeout(r, 400));
      }
      결과.스틸 = {
        카드있나: !!스틸,
        열림: document.getElementById("lb").classList.contains("on"),
        영상모드: document.getElementById("lb").classList.contains("vid"),
        그림보임: getComputedStyle(document.getElementById("lbImg")).display,
        영상붙음: !!v.getAttribute("src"),
        재생줄: getComputedStyle(document.getElementById("lbBar")).display,
        복사단추: getComputedStyle(document.getElementById("lbCopy")).display,
        이동단추글자: document.getElementById("lbGo").textContent,
      };
      closeLB();
      rec2.fav = false; rec2.shots[1].fav = false; await jobPut(rec2);
      document.getElementById("archive").classList.remove("on");
      await renderHist();
    }

    /* ---- 6) 단추 이름 ---- */
    const sv = document.getElementById("saveVid");
    결과.단추 = { 글자: sv.textContent, 설명: sv.title };
    결과.안내 = document.getElementById("speedNote").textContent;
  } catch (e) { 결과.err = String((e && e.stack) || e); }
  return 결과;
})()
