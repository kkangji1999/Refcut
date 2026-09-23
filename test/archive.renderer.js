/* archive.e2e.js 가 앱 화면 안에서 돌리는 시나리오 (그 파일이 __ __ 자리를 채운다) */
(async () => {
  const 결과 = { err: null };
  const 잠깐 = ms => new Promise(r => setTimeout(r, ms));
  const $$ = s => [...document.querySelectorAll(s)];
  const 열수 = el => getComputedStyle(el).gridTemplateColumns.split(" ").filter(Boolean).length;
  try {
    const 영상 = __영상__;
    await jobPut({ id: OUTKEY, dir: __저장__ });

    /* ---- 뽑아서 기록을 쌓고, 폴더를 나눠 담는다 ---- */
    for (const { nm, p } of 영상) {
      S.queue = []; closeDlg(null);
      await addFiles([{ file: { name: nm, size: 0, type: "" }, path: p }]);
      await startRun();
    }
    await renderHist();

    const 폴더 = [["f_인물", "인물", "🎬"], ["f_조명", "조명", "💡"]];
    for (const [id, name, icon] of 폴더)
      await folPut({ id, name, icon, order: 폴더.findIndex(x => x[0] === id),
                     createdAt: new Date().toISOString() });
    await loadFolders();

    let k = 0;
    for (const j of HIST) {
      const rec = await jobGet(j.id);
      (rec.shots || []).forEach((s, i) => {
        if (i % 2 === 0) { s.fav = true; s.folders = i === 0 ? [] : [폴더[k % 2][0]]; }
      });
      await jobPut(rec); k++;
    }
    await renderHist();

    /* ---- 1) 보관함은 격자 하나다 ---- */
    try { localStorage.removeItem("cg_arccols"); } catch (e) {}
    S.arcCols = 4;
    await loadJob(HIST[0].id);                 // 뒤쪽 화면에 영상을 붙여 둔다
    for (let i = 0; i < 40 && !S.playSrc; i++) await 잠깐(100);
    document.getElementById("openFav").click();
    await 잠깐(400);

    const 줄 = $$("#arcGrid .arcRow");
    결과.보관함 = {
      열림: document.getElementById("archive").classList.contains("on"),
      격자: !!document.getElementById("arcGrid"),
      판자취: !!(document.getElementById("arcBoard") || document.getElementById("arcCanvas")
                 || document.getElementById("arcZoom") || document.getElementById("arcSort")),
      줄: 줄.length,
      카드: $$("#arcGrid .acard").length,
      담긴것: allFavs().length,
      열수: 줄.length ? 열수(줄[0]) : 0,
      제목줄: $$("#arcGrid .grpHead b").map(b => b.textContent),
      미분류칸: !!document.querySelector('.afold[data-f="none"]'),
      이름표: $$(".acard .nm").length,
      늘보이는이름: $$(".acard .nm").filter(el => getComputedStyle(el).opacity !== "0").length,
      고름칸: (() => { const c = document.querySelector(".acard .ck");
        return c ? getComputedStyle(c).opacity : "없음"; })(),
    };

    /* ---- 2) 보관함에서 누른 글쇠가 뒤쪽 재생기로 새지 않는가 ---- */
    const 뒤영상 = document.getElementById("pv");
    결과.소리 = { 들어올때멈췄나: 뒤영상.paused, 붙은영상: !!S.playSrc };
    [" ", "ArrowRight", "ArrowLeft", "ArrowUp"].forEach(key =>
      document.dispatchEvent(new KeyboardEvent("keydown",
        { key, code: key === " " ? "Space" : key, bubbles: true, cancelable: true })));
    await 잠깐(250);
    결과.소리.누른뒤도멈춰있나 = 뒤영상.paused;
    결과.소리.시각 = Math.round((뒤영상.currentTime || 0) * 100) / 100;

    /* ---- 3) 한 줄에 몇 장 (2 · 4 · 8) ---- */
    {
      const 잰다 = () => {
        const r = $$("#arcGrid .arcRow");
        return r.length ? 열수(r[0]) : 0;
      };
      const 처음 = 잰다();
      document.querySelector('#arcSizeSw [data-c="2"]').click();
      await 잠깐(250);
      const 둘 = 잰다();
      const 물든단추 = document.querySelector('#arcSizeSw button.on').dataset.c;
      document.querySelector('#arcSizeSw [data-c="8"]').click();
      await 잠깐(250);
      const 여덟 = 잰다();
      const 기억 = (() => { try { return localStorage.getItem("cg_arccols"); } catch (e) { return ""; } })();
      document.querySelector('#arcSizeSw [data-c="4"]').click();
      await 잠깐(250);
      결과.크기 = { 처음, 둘, 여덟, 물든단추, 기억, 되돌림: 잰다() };
    }

    /* ---- 4) 고르기 — 한 번 누르면 곧바로 담긴다 ---- */
    {
      const 카드들 = $$("#arcGrid .acard");
      카드들[0].dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await 잠깐(120);
      const 한번 = S.favSel.size;
      const 표붙음 = 카드들[0].classList.contains("sel");
      const 고름칸 = getComputedStyle(카드들[0].querySelector(".ck")).opacity;

      카드들[1].dispatchEvent(new MouseEvent("click", { bubbles: true }));
      카드들[2].dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await 잠깐(120);
      const 이어서 = S.favSel.size;

      카드들[1].dispatchEvent(new MouseEvent("click", { bubbles: true }));   // 다시 누르면 빠진다
      await 잠깐(120);
      const 다시누르면 = S.favSel.size;

      document.getElementById("arcAll").click();
      await 잠깐(150);
      const 전체선택 = S.favSel.size;
      const 모두물듦 = $$("#arcGrid .acard.sel").length;
      document.getElementById("arcNone").click();
      await 잠깐(120);
      결과.고르기 = { 한번, 표붙음, 고름칸, 이어서, 다시누르면, 전체선택, 모두물듦,
                     해제뒤: S.favSel.size,
                     선택단추: !!document.getElementById("arcPick"),
                     안내: document.getElementById("arcCount").textContent };
    }

    /* ---- 5) 두 번 누르면 크게 보기 ---- */
    {
      const 카드 = document.querySelector("#arcGrid .acard");
      if (카드) {
        카드.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
        await 잠깐(350);
      }
      결과.크게보기 = { 열림: document.getElementById("lb").classList.contains("on"),
                       보관함남음: document.getElementById("archive").classList.contains("on") };
      closeLB();
      S.favSel.clear(); paintArcLive();
      await 잠깐(150);
    }

    /* ---- 6) 폴더 제목 줄에 끌어다 놓으면 그 폴더로 ---- */
    {
      const 카드 = $$("#arcGrid .acard").find(el => {
        const x = allFavs().find(y => y.key === el.dataset.k);
        return x && !foldersOf(x).length;                    // 폴더에 없는 것 하나
      });
      /* 제목 줄이 아니라 '그 폴더 칸' 어디에 던져도 들어가야 한다 */
      const 칸 = $$("#arcGrid .grpSec").find(el => {
        const b = el.querySelector(".grpHead b");
        return b && b.textContent === "인물";
      });
      let 전 = null, 후 = null, 물들었나 = false, 칸높이 = 0;
      if (카드 && 칸) {
        칸높이 = Math.round(칸.getBoundingClientRect().height);   // 던지기 전에 재둔다
        const key = 카드.dataset.k;
        전 = foldersOf(allFavs().find(y => y.key === key)).slice();
        const dt = new DataTransfer();
        카드.ondragstart({ dataTransfer: dt });
        칸.ondragover({ preventDefault(){} });
        물들었나 = 칸.classList.contains("drop");
        /* 칸의 '아래쪽 빈 자리' 에 던진 셈 */
        await 칸.ondrop({ preventDefault(){}, stopPropagation(){}, dataTransfer: dt });
        await 잠깐(350);
        후 = foldersOf(allFavs().find(y => y.key === key)).slice();
      }
      결과.담기 = { 했나: !!(카드 && 칸), 전, 후, 물들었나, 칸높이 };
    }

    /* ---- 7) 왼쪽 [전체] 에 놓으면 폴더에서 빠진다 ---- */
    {
      const 카드 = $$("#arcGrid .acard").find(el => {
        const x = allFavs().find(y => y.key === el.dataset.k);
        return x && foldersOf(x).includes("f_인물");
      });
      const 맨위칸 = document.querySelector("#arcGrid .grpSec.loose");
      let 전 = null, 후 = null, 말 = "";
      if (카드 && 맨위칸) {
        const key = 카드.dataset.k;
        전 = foldersOf(allFavs().find(y => y.key === key)).slice();
        const dt = new DataTransfer();
        카드.ondragstart({ dataTransfer: dt });
        맨위칸.ondragover({ preventDefault(){} });
        말 = getComputedStyle(맨위칸.querySelector(".secTag")).display;
        await 맨위칸.ondrop({ preventDefault(){}, stopPropagation(){}, dataTransfer: dt });
        await 잠깐(350);
        후 = foldersOf(allFavs().find(y => y.key === key)).slice();
      }
      /* 왼쪽 [전체] 에 놓는 길도 그대로 있는가 */
      const 전체칸 = document.querySelector('.afold[data-f="all"]');
      const 카드2 = $$("#arcGrid .acard").find(el => {
        const x = allFavs().find(y => y.key === el.dataset.k);
        return x && foldersOf(x).includes("f_조명");
      });
      let 왼쪽전 = null, 왼쪽후 = null;
      if (카드2 && 전체칸) {
        const key = 카드2.dataset.k;
        왼쪽전 = foldersOf(allFavs().find(y => y.key === key)).slice();
        const dt2 = new DataTransfer();
        카드2.ondragstart({ dataTransfer: dt2 });
        await 전체칸.ondrop({ preventDefault(){}, dataTransfer: dt2 });
        await 잠깐(350);
        왼쪽후 = foldersOf(allFavs().find(y => y.key === key)).slice();
      }
      결과.빼기 = { 했나: !!(카드 && 맨위칸), 전, 후, 말,
                   왼쪽: { 했나: !!(카드2 && 전체칸), 전: 왼쪽전, 후: 왼쪽후 } };
    }

    /* ---- 8) 새로 만든 빈 폴더도 제목 줄로 선다 ---- */
    {
      await folPut({ id: "f_빈폴더", name: "빈폴더", icon: "🆕", order: 9,
                     createdAt: new Date().toISOString() });
      await loadFolders(); renderArchive();
      await 잠깐(300);
      const 제목 = $$("#arcGrid .grpHead").find(el =>
        el.querySelector("b").textContent === "빈폴더");
      결과.빈폴더 = {
        제목줄: !!제목,
        비었다는말: !!document.querySelector("#arcGrid .grpEmpty"),
        왼쪽칸: $$("#arcFolders .afold .nm").map(el => el.textContent),
      };
      await folDel("f_빈폴더"); await loadFolders(); renderArchive();
      await 잠깐(250);
    }

    /* ---- 9) 폴더 제목 줄을 누르면 그 폴더만 ---- */
    {
      const 제목 = $$("#arcGrid .grpHead.go")[0];
      const 이름 = 제목 ? 제목.querySelector("b").textContent : "";
      if (제목) { 제목.click(); await 잠깐(300); }
      결과.폴더열기 = { 눌렀나: !!제목, 바란이름: 이름,
                       제목: document.getElementById("arcWhere").textContent,
                       제목줄: $$("#arcGrid .grpHead").length };
      S.folder = "all"; renderArchive(); await 잠깐(200);
    }
    document.getElementById("archive").classList.remove("on");

    /* ---- 10) 저장 위치: 지우지 않는다 — 번호와 미리보기로 알아보게만 한다 ---- */
    await document.getElementById("storeBtn").onclick();
    await 잠깐(500);
    const 기록줄 = $$("#storeBody .jobSize.go");
    const 왼쪽 = {};
    $$("#hist .job").forEach(el => {
      왼쪽[el.querySelector(".jname").textContent] = el.querySelector(".jnoBig").textContent;
    });
    결과.저장공간 = {
      줄: 기록줄.length,
      번호: 기록줄.map(el => el.querySelector(".jno").textContent),
      어긋난것: 기록줄.filter(el =>
        왼쪽[el.querySelector(".nm").textContent] !== el.querySelector(".jno").textContent).length,
      미리보기: 기록줄.filter(el => { const im = el.querySelector("img.th");
                                    return !!(im && im.getAttribute("src")); }).length,
      고름칸: $$("#storeBody .jck").length,
      삭제단추: $$("#storeBody [data-del]").length,
    };
    if (기록줄.length) {
      const 이름 = 기록줄[0].querySelector(".nm").textContent;
      기록줄[0].click();
      await 잠깐(600);
      결과.저장공간.눌러서열기 = {
        창닫힘: !document.getElementById("storeBox").classList.contains("on"),
        연것: (HIST.find(j => j.id === S.jobId) || {}).name || "",
        바란것: 이름 };
    }
    document.getElementById("storeBox").classList.remove("on");
  } catch (e) { 결과.err = String((e && e.stack) || e); }
  return 결과;
})()
