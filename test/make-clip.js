/* 컷 위치를 미리 아는 시험용 영상을 만든다.
   =========================================================================
   프레임을 직접 그려서 ffmpeg 에 밀어 넣는다 — 어디가 진짜 컷인지 100% 안다.
   그래서 "컷을 몇 개로 잡았나" 를 눈대중이 아니라 숫자로 채점할 수 있다.

   일부러 '컷이 아닌데 컷처럼 보이는 것' 들을 섞어 두었다.
     · 빠르게 흐르는 화면 (휘프팬·핸드헬드)
     · 한두 장 번쩍하는 플래시
     · 포커스가 흐림 → 또렷으로 넘어가는 컷
     · 빠른 줌
   이런 것을 컷으로 잘못 잡으면 "한 컷에서 프레임이 여러 장" 이 된다.
   실제로 v26.8.2504 까지는 진짜 컷 7개짜리 영상을 27개로 잡았다.

   쓰는 법:  node test/make-clip.js [내보낼파일] [--vfr]
     --vfr : 장 간격을 일부러 들쭉날쭉하게 만든다 (내려받은 영상 흉내).
             프레임 시각을 계산으로 지어내면 여기서 몇 초씩 밀린다.
   ========================================================================= */
const { spawn } = require("child_process");
const path = require("path");
const W = 640, H = 360, FPS = 24;

function fill(buf, fn) {
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const o = (y * W + x) * 3, c = fn(x, y);
    buf[o] = c[0]; buf[o + 1] = c[1]; buf[o + 2] = c[2];
  }
}

/* 화면 하나(=컷 하나). r 은 그 컷 안에서의 진행도 0~1, i 는 몇 번째 장인지 */
const SHOTS = [
  {
    name: "A 가만한 하늘색 화면", dur: 2.0,
    draw: (b) => fill(b, (x, y) => [40, 90 + (y >> 2), 200 - (x >> 3)]),
  },
  {
    /* 초당 800px 로 흐른다. 장과 장 사이가 원래 많이 다른 화면 */
    name: "B 빠르게 흐르는 화면(휘프팬)", dur: 3.0,
    draw: (b, r) => {
      const sh = Math.round(r * 2400);
      fill(b, (x) => { const v = ((x + sh) % 90) < 45 ? 235 : 25; return [v, (v * 0.4) | 0, 255 - v]; });
    },
  },
  {
    name: "C 가만한 초록 화면", dur: 2.0,
    draw: (b) => fill(b, (x, y) => [30 + (x >> 4), 170, 60 + (y >> 3)]),
  },
  {
    /* 30·31 번째 장만 새하얗다. '내용 없는 화면' 으로 잡혀 컷으로 오해받기 쉽다 */
    name: "D 가만한 화면 + 두 장 번쩍(플래시)", dur: 2.5,
    draw: (b, r, i) => {
      if (i === 30 || i === 31) fill(b, () => [255, 255, 255]);
      else fill(b, (x, y) => [200 - (y >> 2), 60, 40 + (x >> 4)]);
    },
  },
  {
    /* 흐림 정도가 '연속적으로' 줄어든다 — 실제 렌즈처럼.
       정수 단계로 뚝뚝 끊기면 그 순간마다 진짜 컷처럼 보이므로 두 단계를 섞는다. */
    name: "E 포커스가 흐림→또렷으로", dur: 3.0,
    draw: (b, r) => {
      const rad = 1 + (1 - r) * 25, lo = Math.floor(rad), hi = lo + 1, mix = rad - lo;
      const cell = (g) => (g % 2 ? 220 : 45);
      fill(b, (x, y) => {
        const a = cell(Math.floor(x / lo) + Math.floor(y / lo));
        const c = cell(Math.floor(x / hi) + Math.floor(y / hi));
        const v = Math.round(a * (1 - mix) + c * mix);
        return [v, v, (v * 0.7) | 0];
      });
    },
  },
  {
    /* 빠르게 움직이는 화면으로 '진짜 컷' 이 들어가는 경우.
       움직임을 걸러내다가 이런 진짜 컷까지 놓치면 안 된다. */
    name: "F 진짜 컷 → 곧바로 빠른 줌", dur: 2.5,
    draw: (b, r) => {
      const z = 1 + r * 6;
      fill(b, (x, y) => {
        const u = (x - W / 2) / z + W / 2, w = (y - H / 2) / z + H / 2;
        const v = ((Math.floor(u / 14) + Math.floor(w / 14)) % 2) ? 30 : 240;
        return [(v * 0.5) | 0, v, 255 - v];
      });
    },
  },
  {
    name: "G 천천히 도는 화면", dur: 2.5,
    draw: (b, r) => {
      const a = r * 0.8;
      fill(b, (x, y) => {
        const u = (x - W / 2) * Math.cos(a) - (y - H / 2) * Math.sin(a);
        const v = ((u / 30) | 0) % 2 ? 90 : 210;
        return [v, 200 - v, 120];
      });
    },
  },
];

function ffmpegBin() {
  try { return require("ffmpeg-static"); }
  catch (e) { return process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg"; }
}

async function make(out, vfr) {
  const args = ["-y", "-f", "rawvideo", "-pix_fmt", "rgb24",
    "-s", `${W}x${H}`, "-r", String(FPS), "-i", "-"];
  /* 일곱 장에 한 장씩 빼서 장 간격을 들쭉날쭉하게 만든다 */
  if (vfr) args.push("-vf", "select='not(eq(mod(n\\,7),3))'", "-fps_mode", "vfr");
  args.push("-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-g", "48", out);

  /* ffmpeg 의 인코딩 수다는 삼킨다 — 실패했을 때만 보여준다 */
  const ff = spawn(ffmpegBin(), args, { stdio: ["pipe", "ignore", "pipe"] });
  let err = "";
  ff.stderr.on("data", d => { if (err.length < 4000) err += d.toString(); });
  const buf = Buffer.alloc(W * H * 3);
  const shots = [];
  let frame = 0;
  for (const s of SHOTS) {
    shots.push({ name: s.name, startFrame: frame, startSec: frame / FPS });
    const n = Math.round(s.dur * FPS);
    for (let i = 0; i < n; i++) {
      s.draw(buf, i / n, i);
      if (!ff.stdin.write(Buffer.from(buf))) await new Promise(r => ff.stdin.once("drain", r));
      frame++;
    }
  }
  ff.stdin.end();
  const code = await new Promise(r => ff.on("close", r));
  if (code !== 0) throw new Error("시험용 영상을 만들지 못했습니다\n" + err.slice(0, 600));
  return { file: out, fps: FPS, totalFrames: frame, vfr: !!vfr, shots };
}

module.exports = { make, FPS, SHOTS };

if (require.main === module) {
  const out = process.argv[2] || path.join(__dirname, "_생성물", "clip.mp4");
  require("fs").mkdirSync(path.dirname(out), { recursive: true });
  make(out, process.argv.includes("--vfr"))
    .then(r => console.log(JSON.stringify(r, null, 1)));
}
