/* app/index.html 의 '계산부' 만 떼어와서 node 에서 그대로 돌린다.
   =========================================================================
   손으로 옮겨 적으면 앱과 시험이 조금씩 달라져서, 시험은 통과하는데 앱은
   틀리는 일이 생긴다. 그래서 파일에서 직접 잘라 온다.
   여기서 잘라오는 것은 화면(DOM)을 건드리지 않는 순수 계산 함수들뿐이다.

   ★ index.html 에서 아래 표시들을 지우거나 이름을 바꾸면 여기가 먼저 깨진다.
     그때는 이 파일의 잘라오는 자리를 함께 고쳐주면 된다.
   ========================================================================= */
const fs = require("fs");
const path = require("path");

const HTML = path.join(__dirname, "..", "app", "index.html");

function cut(src, from, to) {
  const a = src.indexOf(from);
  if (a < 0) throw new Error(`index.html 에서 "${from}" 를 찾지 못했습니다`);
  const b = src.indexOf(to, a);
  if (b < 0) throw new Error(`index.html 에서 "${to}" 를 찾지 못했습니다`);
  return src.slice(a, b);
}

function load() {
  const src = fs.readFileSync(HTML, "utf8");
  const code =
    cut(src, "const AW=320, AH=180;", "const aCan=") +
    "const _gBuf=new Float32Array(AW*AH);\n" +
    cut(src, "function measureData(px){", "/** 화면에 있는 영상에서") +
    cut(src, "function dist(a,b){", "\n/* ---------- 추출 취소") +
    cut(src, "const CUT_TH", "/* ↑ 여기까지") +
    cut(src, "const ADAPT_RATIO", "\n/* ---------- 3단계") +
    cut(src, "function bestIn(F,lo,hi){", "\nfunction cutStartIndex") +
    cut(src, "function cutStartIndex(F,a,b){", "\n/* ---------- 4단계") +
    cut(src, "const grabAt=", "\nasync function captureEl") +
    "\nmodule.exports={measureData,dist,findCuts,choose,grabAt,CUT_TH,BLANK_STD,AW,AH};";

  const tmp = path.join(__dirname, "_생성물", "core.generated.js");
  fs.mkdirSync(path.dirname(tmp), { recursive: true });
  fs.writeFileSync(tmp, code);
  delete require.cache[require.resolve(tmp)];
  return require(tmp);
}

function ffmpegBin() {
  try { return require("ffmpeg-static"); }
  catch (e) { return process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg"; }
}

/* main.js 의 scanFrames 와 똑같은 명령으로 영상을 훑는다.
   (여기가 앱과 달라지면 시험의 의미가 없어진다 — 바꿀 때 같이 바꿀 것) */
function scan(file) {
  const { spawn } = require("child_process");
  const core = load();
  const FRAME_BYTES = core.AW * core.AH * 4;
  return new Promise((resolve, reject) => {
    const ff = spawn(ffmpegBin(), [
      "-v", "info", "-hide_banner", "-i", file, "-map", "0:v:0",
      "-vf", `scale=${core.AW}:${core.AH}:flags=fast_bilinear,showinfo`,
      "-vsync", "0", "-pix_fmt", "rgba", "-f", "rawvideo", "-",
    ], { windowsHide: true });

    const F = [], times = [], chunks = [];
    let buffered = 0, tail = "", err = "";
    const t0 = Date.now();

    ff.stdout.on("data", (buf) => {
      chunks.push(buf); buffered += buf.length;
      while (buffered >= FRAME_BYTES) {
        const all = chunks.length === 1 ? chunks[0] : Buffer.concat(chunks, buffered);
        const px = all.subarray(0, FRAME_BYTES), rest = all.subarray(FRAME_BYTES);
        chunks.length = 0; if (rest.length) chunks.push(rest); buffered = rest.length;
        const m = core.measureData(px);
        F.push({ t: 0, sharp: m.sharp, std: m.std, sig: m.sig, blank: m.std < core.BLANK_STD });
      }
    });
    ff.stderr.on("data", (d) => {
      const s = tail + d.toString(), lines = s.split("\n");
      tail = lines.pop();
      for (const ln of lines) {
        const m = ln.match(/pts_time:\s*([\d.]+)/);
        if (m) times.push(parseFloat(m[1]));
        else if (err.length < 2000) err += ln + "\n";
      }
    });
    ff.on("error", reject);
    ff.on("close", (c) => {
      if (c !== 0) return reject(new Error(err.slice(0, 400) || "ffmpeg 종료 " + c));
      const real = times.length === F.length;
      F.forEach((f, i) => { f.t = real ? times[i] : i / 24; });
      const gaps = [];
      for (let i = 1; i < F.length; i++) gaps.push(F[i].t - F[i - 1].t);
      gaps.sort((a, b) => a - b);
      resolve({ F, core, real, times, unit: gaps[gaps.length >> 1] || 1 / 24, ms: Date.now() - t0 });
    });
  });
}

module.exports = { load, scan, ffmpegBin, HTML };
