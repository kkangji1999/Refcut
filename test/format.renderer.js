/* format.e2e.js 가 앱 화면 안에서 돌리는 시나리오 (그 파일이 __ __ 자리를 채운다) */
(async () => {
  try {
    const 영상 = __영상__, 아님 = __아님__;
    await jobPut({ id: OUTKEY, dir: __저장__ });
    const out = [], 거절 = [];

    for (const { nm, p } of 영상) {
      S.queue = []; closeDlg(null);
      await addFiles([{ file: { name: nm, size: 0, type: "" }, path: p }]);
      const row = { nm, 대기열: S.queue.length === 1, 정보: "", 추출: "", 재생: "" };
      if (row.대기열) {
        const it = S.queue[0];
        row.정보 = it.duration.toFixed(1) + "s " + it.w + "x" + it.h
                 + " " + (it.fps || 0).toFixed(0) + "fps";
        await startRun();
        row.추출 = S.out ? (S.out.shots.length + "장")
                        : ("실패 " + (statusEl.textContent || ""));
        if (S.out) {
          /* 재생기가 자리를 잡을 때까지 기다린다 (사본을 만드는 중일 수 있다) */
          for (let i = 0; i < 120; i++) {
            if (pv.readyState >= 1) break;
            const n = document.getElementById("pvNote");
            if (n.classList.contains("on") && /정상입니다|확인해/.test(n.textContent)) break;
            await new Promise(r => setTimeout(r, 250));
          }
          /* 주소는 한글이 % 로 바뀌어 있으므로 되돌려서 본다 */
          let src = ""; try { src = decodeURIComponent(pv.currentSrc || ""); } catch (e) {}
          row.재생 = pv.readyState >= 1
            ? (src.indexOf("미리보기") >= 0 ? "사본으로 재생" : "바로 재생")
            : ("안됨 · " + (document.getElementById("pvNote").textContent || ""));
        }
      }
      out.push(row);
    }

    for (const { nm, p } of 아님) {
      S.queue = []; closeDlg(null);
      document.getElementById("dlgBody").innerHTML = "";
      await addFiles([{ file: { name: nm, size: 0, type: "" }, path: p }]);
      거절.push({ nm, 들어감: S.queue.length > 0,
        안내: (document.getElementById("dlgBody").textContent || "").slice(0, 90) });
    }
    return { out, 거절 };
  } catch (e) { return { err: String((e && e.stack) || e) }; }
})()
