/* 저장되는 그림이 '바로 그 장' 인가.
   =========================================================================
   컷을 옳게 나눠도, 그림을 뽑을 때 한 장 밀리면 스타트 프레임이 앞 컷의
   마지막 장이 된다. 눈으로는 거의 구분이 안 되는 종류의 오류다.

   그래서 되짚어 확인한다.
     ① 훑기로 얻은 장들의 지문을 기억해 두고
     ② 앱과 똑같은 방식으로 그림 한 장을 뽑아
     ③ 그 그림이 몇 번째 장인지 지문으로 되찾는다.
   ========================================================================= */
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
const { scan, ffmpegBin } = require("./_core");
const { make } = require("./make-clip");

const OUT = path.join(__dirname, "_생성물");

function grabOne(file, at, dest, core) {
  return new Promise((res, rej) => {
    /* 앱의 grabPNGs 와 같은 방식 (-ss 를 입력 앞에 두고 한 장).
       확인하기 좋게 분석용 크기(320x180)로 받아 지문을 바로 잰다. */
    const ff = spawn(ffmpegBin(), ["-v", "error", "-ss", String(at), "-i", file,
      "-frames:v", "1", "-y", "-vf", `scale=${core.AW}:${core.AH}:flags=fast_bilinear`,
      "-pix_fmt", "rgba", "-f", "rawvideo", dest], { windowsHide: true });
    ff.on("error", rej);
    ff.on("close", c => c === 0 ? res() : rej(new Error("ffmpeg 종료 " + c)));
  });
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, "clip.mp4");
  const meta = await make(file, false);
  const { F, core, unit } = await scan(file);
  const fps = 1 / unit;

  const cuts = core.findCuts(F);
  const picks = core.choose(F, cuts, F[F.length - 1].t);
  console.log(`장 ${F.length}개 · 초당 ${fps.toFixed(3)}장 · 컷 ${picks.length}개\n`);

  let bad = 0;
  for (const kind of ["스타트", "분석"]) {
    console.log(`[${kind} 프레임]`);
    for (let i = 0; i < picks.length; i++) {
      const want = kind === "스타트" ? picks[i].sT : picks[i].t;
      const wantIdx = F.findIndex(f => Math.abs(f.t - want) < unit / 2);
      const dest = path.join(OUT, `grab_${kind}_${i}.raw`);
      await grabOne(file, core.grabAt(want, fps), dest, core);
      const got = core.measureData(new Uint8ClampedArray(fs.readFileSync(dest)));

      let best = -1, bd = Infinity;
      F.forEach((f, k) => { const d = core.dist(got.sig, f.sig); if (d < bd) { bd = d; best = k; } });
      /* 가만한 컷 안에서는 모든 장이 똑같아 번호를 가려낼 수 없다.
         원하는 장이 '가장 닮은 장' 과 사실상 같은 그림이면 맞은 것으로 본다. */
      const ok = best === wantIdx || core.dist(got.sig, F[wantIdx].sig) <= bd + 0.5;
      console.log(`  CUT${i + 1}: ${wantIdx}장 → ` +
        (ok ? "그 장 그대로" : `엉뚱한 ${best}장 (${best - wantIdx > 0 ? "+" : ""}${best - wantIdx})`));
      if (!ok) bad++;
    }
  }
  console.log(bad ? `\n실패  어긋난 것 ${bad}개` : "\n통과  전부 원하는 장 그대로 저장됨");
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error("시험을 돌리지 못했습니다:", e.message); process.exit(1); });
