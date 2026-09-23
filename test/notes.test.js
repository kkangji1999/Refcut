/* 안내문이 한 줄씩 반듯하게 서는가 — 글 정리만 시험한다.
   =========================================================================
   왜 필요한가 — 2026-09-23 사용자 보고:
     "업데이트 내용이라든지 안내 멘트가 대부분 정리가 안 돼서 보인다.
      문장 끝부분마다 다음 줄로 넘어가서 이상하게 엉켜 보인다."
   원인은 두 가지였다.
     ① 창(.dlgBody)이 pre-wrap 이라, 소스에 보기 좋게 적어둔 줄바꿈과
        들여쓰기가 화면까지 그대로 따라 나왔다
     ② 바뀐 내용(version.json 의 notes)도 통째로 부어 놓기만 해서,
        '· 항목' 의 둘째 줄이 왼쪽 끝까지 밀려 덩어리가 보이지 않았다
   그래서 창에 넣기 직전에 안내정리() 가 한 번 다듬고,
   바뀐내용() 이 ★ · ※ 를 읽어 제 모양으로 세운다. 그 둘을 채점한다.

   ★ index.html 에서 두 함수의 이름이나 그 앞뒤를 바꾸면 여기가 먼저 깨진다.
   쓰는 법:  node test/notes.test.js   (npm test 에 함께 들어 있다)
   ========================================================================= */
const fs = require("fs");
const path = require("path");

const HTML = path.join(__dirname, "..", "app", "index.html");

function load() {
  const src = fs.readFileSync(HTML, "utf8");
  const cut = (from, to) => {
    const a = src.indexOf(from);
    if (a < 0) throw new Error(`index.html 에서 "${from}" 를 찾지 못했습니다`);
    const b = src.indexOf(to, a);
    if (b < 0) throw new Error(`index.html 에서 "${to}" 를 찾지 못했습니다`);
    return src.slice(a, b);
  };
  const code =
    cut("function 안내정리(s){", "/* 브라우저 기본 알림") +
    cut("function 바뀐내용(txt){", "\n/* ---------- 업데이트 확인") +
    "\nmodule.exports = { 안내정리, 바뀐내용 };";
  const mod = { exports: {} };
  new Function("module", code)(mod);
  return mod.exports;
}

const S = load();
let fail = 0;
const ok = (name, got, want) => {
  const good = got === want;
  console.log((good ? "통과  " : "실패  ") + name +
              (good ? "" : `\n        나온 값 ${JSON.stringify(got)}` +
                           `\n        바란 값 ${JSON.stringify(want)}`));
  if (!good) fail++;
};
const 참 = (name, got) => ok(name, !!got, true);

console.log("\n=== 창에 뜨는 안내문 ===");

/* 소스에 적은 모양 그대로 — 줄을 바꾸고 다음 줄은 들여써 두었다 */
ok("이어 적은 줄은 한 칸으로 붙는다",
   S.안내정리(`고른 기록 3개를 삭제할까요?
       폴더에 저장된 이미지는 지워지지 않습니다.`),
   "고른 기록 3개를 삭제할까요? 폴더에 저장된 이미지는 지워지지 않습니다.");

ok("빈 줄은 문단 사이가 된다",
   S.안내정리("즐겨찾기는 그대로 남습니다.\n\n계속할까요?"),
   "즐겨찾기는 그대로 남습니다.<br><br>계속할까요?");

ok("홀로 선 줄바꿈은 줄바꿈으로 남는다",
   S.안내정리("원본 영상 연결만 해제합니다.\n컷은 그대로 남습니다."),
   "원본 영상 연결만 해제합니다.<br>컷은 그대로 남습니다.");

ok("일부러 적어둔 <br> 은 건드리지 않는다",
   S.안내정리("<b>새 버전이 있습니다</b><br><br>받을까요?"),
   "<b>새 버전이 있습니다</b><br><br>받을까요?");

ok("빈 글도 탈이 없다", S.안내정리(null), "");

/* 들여쓴 줄이 화면에 그대로 나오면 안 된다 (엉켜 보이던 바로 그 증상) */
참("화면 글에 들여쓰기가 남지 않는다",
   !/\s{3,}/.test(S.안내정리(`첫 줄입니다.
        둘째 줄입니다.
        셋째 줄입니다.`)));

console.log("\n=== 업데이트의 [바뀐 내용] ===");

const 적어둔글 = `이번에 바뀐 내용


★ 링크 화질을 바로잡았습니다

  최고 화질로 맞춰 두었는데도
  360p 로 올라가는 일이 있었습니다.

    · 이제 남은 통로를 마저 봅니다
    · 처음부터 제 화질이면 곧바로 끝납니다

※ 설치할 때 '알 수 없는 게시자' 라고 물으면 [추가 정보] 를 눌러주세요.`;

const html = S.바뀐내용(적어둔글);
참("★ 는 제목으로 선다", /<div class="nHead">링크 화질을 바로잡았습니다<\/div>/.test(html));
참("· 는 항목으로 선다", /<div class="nLi">.*이제 남은 통로를 마저 봅니다/.test(html));
ok("항목을 빠짐없이 센다", (html.match(/class="nLi"/g) || []).length, 2);
참("※ 는 덧붙이는 말로 선다", /class="nNote"/.test(html));
참("한 덩어리의 줄은 이어 붙는다",
   /최고 화질로 맞춰 두었는데도 360p 로 올라가는 일이 있었습니다\./.test(html));
참("★ 표시는 글에 남기지 않는다", !/★/.test(html));
참("· 표시는 글 대신 제자리(dot)에 둔다",
   (html.match(/·/g) || []).length === (html.match(/class="dot"/g) || []).length);
참("글자는 그대로 두고 < > 만 막는다",
   /&lt;b&gt;/.test(S.바뀐내용("· <b>굵게</b> 적어보기")));
참("빈 글도 탈이 없다", /^<div class="nBox"><\/div>$/.test(S.바뀐내용("")));

console.log(fail ? "\n실패" : "\n---------------- 결과 ----------------\n전부 통과");
process.exit(fail ? 1 : 0);
