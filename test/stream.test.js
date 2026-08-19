/* 화질 올려잡기 — 주소를 읽고 더 높은 화질 후보를 만드는 부분만 시험한다.
   =========================================================================
   TVCF 처럼 재생 창으로 주소를 잡아오는 사이트는, 잡힌 주소 하나가 곧 화질이다.
   플레이어가 720p 로 재생하면 1080p 가 있는 영상도 720p 주소만 잡힌다.
   그래서 "이 주소는 몇 p 인가" 를 읽고 "더 높은 화질 주소" 후보를 만든다.
   그 두 가지가 여기서 채점하는 것이다 (실제 통신은 하지 않는다).

   ★ main.js 에서 아래 함수 이름이나 그 앞뒤를 바꾸면 여기가 먼저 깨진다.
     그때는 잘라오는 자리를 함께 고쳐주면 된다.
   ========================================================================= */
const fs = require("fs");
const path = require("path");

const MAIN = path.join(__dirname, "..", "main.js");

function cut(src, from, to) {
  const a = src.indexOf(from);
  if (a < 0) throw new Error(`main.js 에서 "${from}" 를 찾지 못했습니다`);
  const b = src.indexOf(to, a);
  if (b < 0) throw new Error(`main.js 에서 "${to}" 를 찾지 못했습니다`);
  return src.slice(a, b);
}

function load() {
  const src = fs.readFileSync(MAIN, "utf8");
  const code =
    cut(src, "const TIERS = [", "function peek(url, referer, ms, range) {") +
    cut(src, "const isMasterM3U =", "async function upgradeStream(") +
    "\nmodule.exports = { heightFromUrl, looksMaster, qualitySwaps," +
    " masterCandidates, isMasterM3U, maxHeightOfMaster, TIERS };";

  const tmp = path.join(__dirname, "_생성물", "stream.generated.js");
  fs.mkdirSync(path.dirname(tmp), { recursive: true });
  fs.writeFileSync(tmp, code);
  delete require.cache[require.resolve(tmp)];
  return require(tmp);
}

const S = load();
let fail = 0;
function ok(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { console.log(`통과  ${name}`); return; }
  fail++;
  console.log(`실패  ${name}\n      나온 값 ${g}\n      기대값 ${w}`);
}
function has(name, list, item) {
  if (list.includes(item)) { console.log(`통과  ${name}`); return; }
  fail++;
  console.log(`실패  ${name}\n      ${item}\n      가 후보에 없다: ${JSON.stringify(list)}`);
}

console.log("\n=== 주소에서 화질 읽기 ===");
ok("720p 표기", S.heightFromUrl("https://a.com/v/movie_720p.mp4"), 720);
ok("1280x720 표기", S.heightFromUrl("https://a.com/v/clip_1280x720.mp4"), 720);
ok("폴더로 나뉜 화질", S.heightFromUrl("https://a.com/hls/1080/index.m3u8"), 1080);
ok("밑줄로 붙은 화질", S.heightFromUrl("https://a.com/ad_2024_480.mp4"), 480);
ok("화질이 없는 주소", S.heightFromUrl("https://a.com/watch/abc.mp4"), 0);
/* 아이디 안에 우연히 섞인 숫자를 화질로 오해하지 않는다 */
ok("긴 숫자 아이디", S.heightFromUrl("https://a.com/v/1080234567.mp4"), 0);

console.log("\n=== 전체 목록처럼 보이는가 ===");
ok("master", S.looksMaster("https://a.com/x/master.m3u8"), true);
ok("chunklist", S.looksMaster("https://a.com/x/chunklist_720.m3u8"), false);
ok("조각 파일", S.looksMaster("https://a.com/x/seg-12.ts"), false);

console.log("\n=== 더 높은 화질 후보 만들기 ===");
const a = S.qualitySwaps("https://a.com/v/movie_720p.mp4", 720, 1080);
has("720p → 1080p", a, "https://a.com/v/movie_1080p.mp4");
const b = S.qualitySwaps("https://a.com/hls/720/index.m3u8", 720, 1080);
has("폴더 720 → 1080", b, "https://a.com/hls/1080/index.m3u8");
const c = S.qualitySwaps("https://a.com/v/clip_1280x720.mp4", 720, 1080);
has("1280x720 → 1920x1080", c, "https://a.com/v/clip_1920x1080.mp4");
ok("자기 자신은 후보가 아니다",
   S.qualitySwaps("https://a.com/v/x.mp4", 720, 1080).includes("https://a.com/v/x.mp4"), false);

console.log("\n=== 전체 목록 주소 찾기 ===");
const m = S.masterCandidates("https://a.com/hls/720/index.m3u8");
has("같은 폴더의 master", m, "https://a.com/hls/720/master.m3u8");
has("윗 폴더의 master", m, "https://a.com/hls/master.m3u8");
ok("자기 자신은 넣지 않는다", m.includes("https://a.com/hls/720/index.m3u8"), false);

console.log("\n=== 목록 내용 읽기 ===");
const MASTER = [
  "#EXTM3U",
  "#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=854x480",
  "480/index.m3u8",
  "#EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1280x720",
  "720/index.m3u8",
  "#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080",
  "1080/index.m3u8",
].join("\n");
const MEDIA = ["#EXTM3U", "#EXTINF:6.0,", "seg-1.ts", "#EXTINF:6.0,", "seg-2.ts"].join("\n");
ok("전체 목록을 알아본다", S.isMasterM3U(MASTER), true);
ok("조각 목록은 전체 목록이 아니다", S.isMasterM3U(MEDIA), false);
ok("가장 높은 화질을 읽는다", S.maxHeightOfMaster(MASTER), 1080);

console.log("\n---------------- 결과 ----------------");
if (fail) { console.log(`${fail}개 실패`); process.exit(1); }
console.log("전부 통과");
