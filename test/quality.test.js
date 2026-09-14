/* 읽어낸 화질을 그대로 믿어도 되는가 — 그 판단만 시험한다.
   =========================================================================
   유튜브는 좋은 통로가 막히면 마지막 안전망(android)으로 물러난다.
   그 통로에도 목록은 있다 — 다만 360p 하나뿐이다.
   예전에는 '읽히기는 읽혔다' 를 그대로 받아들여서, 1080p 짜리 영상이
   대기열에 360p 로 올라가 버렸다 (받아보기도 전에 이미 정해져 있었다).

   그래서 ytInfo 는 읽어낸 것이 '제 화질' 인지 먼저 묻고, 아니면 남은 통로도
   마저 본다. 그 기준을 잘못 잡으면 두 가지 중 하나가 깨진다 —
     · 너무 낮으면 → 360p 로 올라가는 예전 버그가 그대로 돌아온다
     · 너무 높으면 → 원래 화질이 낮은 영상마다 모든 통로를 끝까지 돌아
                     링크 넣기가 몇 배로 느려진다 (핀터레스트 핀이 그렇다)
   여기서 채점하는 것이 그 기준이다.

   ★ main.js 에서 제화질인가 의 이름이나 그 앞뒤를 바꾸면 여기가 먼저 깨진다.
   ========================================================================= */
const fs = require("fs");
const path = require("path");

const MAIN = path.join(__dirname, "..", "main.js");

function load() {
  const src = fs.readFileSync(MAIN, "utf8");
  const a = src.indexOf("function 제화질인가(");
  if (a < 0) throw new Error("main.js 에서 제화질인가 를 찾지 못했습니다");
  const b = src.indexOf('ipcMain.handle("ytInfo"', a);
  if (b < 0) throw new Error("main.js 에서 ytInfo 자리를 찾지 못했습니다");
  const mod = { exports: {} };
  new Function("module", src.slice(a, b) + "\nmodule.exports = { 제화질인가 };")(mod);
  return mod.exports;
}

const S = load();
let fail = 0;
const ok = (name, got, want) => {
  const good = got === want;
  console.log((good ? "통과  " : "실패  ") + name +
              (good ? "" : `  — 나온 값 ${got} · 바란 값 ${want}`));
  if (!good) fail++;
};

console.log("\n=== 안전망(360p) 으로 물러난 자국은 붙잡는다 ===");
ok("최고 화질인데 360p 만 읽혔다", S.제화질인가(360, 0), false);
ok("1080p 를 바랐는데 360p 만 읽혔다", S.제화질인가(360, 1080), false);
ok("아무것도 못 읽었다", S.제화질인가(0, 1080), false);

console.log("\n=== 그 위로는 그대로 믿는다 (링크 넣기가 느려지면 안 된다) ===");
ok("핀터레스트 핀 (428p 가 원래 화질)", S.제화질인가(428, 1080), true);
ok("480p 짜리 옛 영상", S.제화질인가(480, 0), true);
ok("제 화질로 읽혔다", S.제화질인가(1080, 1080), true);
ok("바란 것보다 더 좋다", S.제화질인가(2160, 1080), true);

console.log("\n=== 낮은 화질을 일부러 고른 사람은 기다리게 하지 않는다 ===");
ok("360p 를 골랐고 360p 가 읽혔다", S.제화질인가(360, 360), true);
ok("240p 를 골랐고 360p 가 읽혔다", S.제화질인가(360, 240), true);

console.log("\n---------------- 결과 ----------------");
if (fail) { console.log(`${fail}개 실패`); process.exit(1); }
console.log("전부 통과");
