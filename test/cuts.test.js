/* 컷을 제대로 나누는가 — 이 프로그램의 심장이다.
   =========================================================================
   채점 기준 두 가지.
     ① 진짜 컷 개수와 뽑힌 개수가 같은가   (한 컷에서 여러 장이 나오면 실패)
     ② 컷 시작이 진짜 경계와 같은 자리인가 (두 장 넘게 밀리면 실패)

   장 간격이 들쭉날쭉한 영상(--vfr)도 같이 본다.
   프레임 시각을 계산으로 지어내면 여기서 몇 초씩 밀려서, 컷을 눌렀을 때
   다른 장면이 뜨고 재생과 눈금이 따로 논다.
   ========================================================================= */
const path = require("path");
const fs = require("fs");
const { scan } = require("./_core");
const { make } = require("./make-clip");

const OUT = path.join(__dirname, "_생성물");
const TOL_FRAMES = 2;                    // 두 장까지는 맞은 것으로 본다
const fmt = a => "[" + a.join(", ") + "]";

async function one(label, vfr) {
  const file = path.join(OUT, vfr ? "clip_vfr.mp4" : "clip.mp4");
  fs.mkdirSync(OUT, { recursive: true });
  const meta = await make(file, vfr);
  const { F, core, real, unit, ms } = await scan(file);

  console.log(`\n=== ${label} ===`);
  console.log(`장 ${F.length}개 · ${ms}ms · 진짜 시각 사용 ${real ? "예" : "아니오"}`);

  /* 시각을 계산으로 지어냈다면 얼마나 밀렸을지 */
  let drift = 0;
  for (let i = 0; i < F.length; i++) drift = Math.max(drift, Math.abs(i / meta.fps - F[i].t));
  console.log(`시각을 계산으로 지어냈다면 최대 ${(drift * 1000).toFixed(0)}ms 밀림`
    + ` (${(drift * meta.fps).toFixed(1)}장)`);

  const cuts = core.findCuts(F);
  const picks = core.choose(F, cuts, F[F.length - 1].t);

  const tol = TOL_FRAMES / meta.fps;
  const want = meta.shots.map(s => +s.startSec.toFixed(3));
  const got = picks.map(p => +p.sT.toFixed(3));
  const extra = got.filter(g => !want.some(w => Math.abs(w - g) <= tol));
  const missed = want.filter(w => !got.some(g => Math.abs(w - g) <= tol));

  console.log(`진짜 컷 ${want.length}개  ${fmt(want)}초`);
  console.log(`뽑힌 컷 ${got.length}개  ${fmt(got)}초`);

  const fails = [];
  if (picks.length !== want.length)
    fails.push(`컷 개수가 다르다 (진짜 ${want.length} / 뽑힌 ${picks.length})`);
  if (extra.length) fails.push(`없는 컷을 만들었다: ${fmt(extra)}초  ← 한 컷에서 여러 장이 나오는 원인`);
  if (missed.length) fails.push(`컷을 놓쳤다: ${fmt(missed)}초`);
  /* 컷 하나에 프레임 하나 — 예외 없음 */
  const seen = new Set();
  for (const p of picks) {
    if (seen.has(p.inT)) fails.push(`같은 컷에서 두 장이 나왔다 (${p.inT.toFixed(3)}초)`);
    seen.add(p.inT);
  }
  return { label, fails };
}

(async () => {
  const rs = [];
  rs.push(await one("보통 영상", false));
  rs.push(await one("장 간격이 들쭉날쭉한 영상", true));

  console.log("\n---------------- 결과 ----------------");
  let bad = 0;
  for (const r of rs) {
    if (r.fails.length) { bad++; console.log(`실패  ${r.label}`); r.fails.forEach(f => console.log("        " + f)); }
    else console.log(`통과  ${r.label}`);
  }
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error("시험을 돌리지 못했습니다:", e.message); process.exit(1); });
