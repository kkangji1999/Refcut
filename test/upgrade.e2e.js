/* 화질 올려잡기 — 가짜 CDN 을 세워 놓고 진짜로 통신시켜 확인한다.
   =========================================================================
   TVCF 처럼 재생 창으로 주소를 잡아오는 사이트는, 잡힌 주소 하나가 곧 화질이다.
   플레이어가 720p 로 재생하면 1080p 가 있는 영상도 720p 로 받아졌다.
   그래서 잡은 주소에서 더 높은 화질을 찾아 올리는데, 그것이 정말 통하는지는
   주소를 만들어 보는 것(stream.test.js)만으로는 알 수 없다 — 실제로 물어보고
   응답을 보고 판단하는 부분이 남아 있기 때문이다.

   여기서는 720p·1080p 를 실제로 내려주는 작은 서버를 띄우고, 앱이 그 서버에
   물어봐서 1080p 로 갈아타는지 본다.

   쓰는 법:  npm run test:app     (창은 뜨지만 곧 스스로 닫힌다)
   ========================================================================= */
const { app, BrowserWindow } = require("electron");
const path = require("path");
const http = require("http");
/* ★ 진짜 main.js 를 그대로 불러온다 — streamUpgrade 손잡이가 여기서 등록된다 */
require(path.join(__dirname, "..", "main.js"));

const MASTER = [
  "#EXTM3U",
  "#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=854x480",
  "480/index.m3u8",
  "#EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1280x720",
  "720/index.m3u8",
  "#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080",
  "1080/index.m3u8",
].join("\n");
const MEDIA = ["#EXTM3U", "#EXTINF:6.0,", "seg-1.ts", "#EXT-X-ENDLIST"].join("\n");

const srv = http.createServer((req, res) => {
  const u = req.url.split("?")[0];
  const send = (code, type, body) => {
    res.writeHead(code, { "Content-Type": type, "Content-Length": Buffer.byteLength(body || "") });
    res.end(body || "");
  };
  if (u === "/hls/master.m3u8") return send(200, "application/vnd.apple.mpegurl", MASTER);
  if (/^\/hls\/(480|720|1080)\/index\.m3u8$/.test(u))
    return send(200, "application/vnd.apple.mpegurl", MEDIA);
  /* 진행형 mp4 — 720 과 1080 만 있다 (1440·2160 은 없다) */
  if (u === "/v/ad_720p.mp4" || u === "/v/ad_1080p.mp4")
    return send(206, "video/mp4", "\u0000\u0000");
  /* 화질 올려잡기가 통하지 않아야 하는 쪽 */
  if (u === "/only/clip_720p.mp4") return send(206, "video/mp4", "\u0000\u0000");
  send(404, "text/plain", "no");
});

const waitWindow = () => new Promise((res) => {
  const t = setInterval(() => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w && !w.webContents.isLoading()) { clearInterval(t); res(w); }
  }, 200);
});

app.whenReady().then(async () => {
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const B = "http://127.0.0.1:" + srv.address().port;
  const win = await waitWindow();
  const call = (o) => win.webContents.executeJavaScript(
    `window.CG.streamUpgrade(${JSON.stringify(o)})`);

  let fail = 0;
  const check = (name, got, wantUrl, wantH) => {
    const ok = got && got.url === wantUrl && got.height === wantH;
    if (!ok) fail++;
    console.log((ok ? "통과  " : "실패  ") + name);
    if (!ok) console.log("      나온 값 " + JSON.stringify(got) +
                         "\n      기대값 " + wantUrl + " / " + wantH + "p");
  };

  console.log("\n=== HLS: 720p 조각 목록으로 잡혔을 때 ===");
  check("윗 폴더의 전체 목록을 찾아 1080p 로 올린다",
        await call({ url: B + "/hls/720/index.m3u8", referer: B + "/page", want: 0 }),
        B + "/hls/master.m3u8", 1080);

  console.log("\n=== HLS: 이미 전체 목록일 때 ===");
  check("손대지 않는다",
        await call({ url: B + "/hls/master.m3u8", referer: B + "/page", want: 0 }),
        B + "/hls/master.m3u8", 1080);

  console.log("\n=== 진행형 mp4: 주소에 화질이 박혀 있을 때 ===");
  check("720p 를 1080p 로 바꿔 실제로 있는 것을 쓴다",
        await call({ url: B + "/v/ad_720p.mp4", referer: B + "/page", want: 0 }),
        B + "/v/ad_1080p.mp4", 1080);

  console.log("\n=== 사용자가 720p 까지만 원했을 때 ===");
  check("원한 것보다 높이 올리지 않는다",
        await call({ url: B + "/v/ad_720p.mp4", referer: B + "/page", want: 720 }),
        B + "/v/ad_720p.mp4", 720);

  console.log("\n=== 더 높은 화질이 정말 없을 때 ===");
  check("원래 주소 그대로 둔다",
        await call({ url: B + "/only/clip_720p.mp4", referer: B + "/page", want: 0 }),
        B + "/only/clip_720p.mp4", 720);

  console.log("\n---------------- 결과 ----------------");
  console.log(fail ? fail + "개 실패" : "전부 통과");
  app.exit(fail ? 1 : 0);
});
