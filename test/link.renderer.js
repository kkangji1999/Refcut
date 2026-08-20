/* link.e2e.js 가 앱 화면 안에서 돌리는 시나리오.
   붙여넣으면 '대기열까지만' 가야 하고, 그 자리에 [⬇ 영상다운] 이 있어야 한다. */
(async () => {
  try {
    S.queue = []; renderQueue();
    await addLink("https://www.pinterest.com/pin/739716307575438329/");
    const it = S.queue[0] || {};
    const 버튼 = [...document.querySelectorAll("#queue button")]
      .map(b => b.textContent).filter(t => t.indexOf("영상다운") >= 0);
    return { 개수: S.queue.length, 추출중: S.running, 이름: it.name || "",
             링크: !!it.isLink, 다운버튼: 버튼.length };
  } catch (e) { return { err: String((e && e.stack) || e) }; }
})()
