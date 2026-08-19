/* Reftown(레프타운) — Electron 메인 프로세스
   =========================================================================
   브라우저판과 가장 크게 다른 점 두 가지:

   1) 프레임 읽기를 ffmpeg 가 한다
      브라우저판은 <video> 를 '실제로 재생'하면서 프레임을 긁는다.
      그래서 아무리 빨라도 영상 길이만큼 걸린다 (배속을 올리면 프레임을
      건너뛰고, 되짚어 채우느라 오히려 더 느려진다).
      ffmpeg 는 재생이 아니라 순차 디코드라서 원리적으로 프레임을 흘리지 않고
      보통 10~20배 빠르다. 15초 영상이면 1~3초.

   2) 저장 공간 제한이 없다
      IndexedDB 대신 디스크에 그대로 쓴다. 전체 경로도 그대로 보여줄 수 있다.
   ========================================================================= */
const { app, BrowserWindow, ipcMain, dialog, shell, net,
        clipboard, nativeImage } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { spawn, execFile } = require("child_process");

const isDev = !app.isPackaged;

/* ---------- ffmpeg 실행 파일 찾기 ----------
   순서: 동봉본 → ffmpeg-static → 시스템 PATH
   동봉하지 않아도 시스템에 설치되어 있으면 그대로 쓴다.

   ★ 설치 파일에는 ffmpeg 만 들어간다 (ffprobe 는 없다).
     그래서 ffprobe 가 없는 컴퓨터에서는 영상 정보 읽기가 통째로 실패했다.
     — 만든 사람 컴퓨터에는 ffmpeg 가 따로 깔려 있어서 이 구멍이 보이지 않았다.
     이제 ffprobe 가 없으면 ffmpeg 가 대신 읽는다 (probeViaFfmpeg). */
function binIn(dir, name) {
  const exe = process.platform === "win32" ? name + ".exe" : name;
  const p = path.join(dir, exe);
  return fs.existsSync(p) ? p : null;
}
function bundledBin(name) {
  return binIn(isDev ? path.join(__dirname, "bin")
                     : path.join(process.resourcesPath, "bin"), name);
}
function ffmpegPath() {
  const b = bundledBin("ffmpeg");
  if (b) return b;
  try {
    const p = require("ffmpeg-static");
    if (p && fs.existsSync(p)) return p;
  } catch (e) {}
  return process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";  // PATH 에 있기를 기대
}
function ffprobePath() {
  const b = bundledBin("ffprobe");
  if (b) return b;
  return process.platform === "win32" ? "ffprobe.exe" : "ffprobe";
}
/* yt-dlp 에게 "ffmpeg 은 여기 있다" 고 알려주는 옵션.
   ★ 이걸 안 주면 yt-dlp 는 시스템 PATH 에서만 ffmpeg 를 찾는다.
     없으면 영상과 소리를 합치지 못해 (특히 HLS·유튜브) 받기 자체가 실패한다.
     이것이 "대기열에는 들어가는데 추출이 안 되던" 진짜 원인이었다. */
function ffmpegLocArgs() {
  const p = ffmpegPath();
  return path.isAbsolute(p) && fs.existsSync(p)
    ? ["--ffmpeg-location", path.dirname(p)] : [];
}

let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1560,
    height: 940,
    /* ★ 이보다 좁아지면 글자 단락이 깨지고 배열이 찌그러진다.
       창 자체가 더 줄어들지 않게 막아둔다. */
    minWidth: 1500,
    minHeight: 900,
    show: false,                    // 준비되면 페이드로 띄운다
    backgroundColor: "#16181d",
    autoHideMenuBar: true,
    title: "Reftown",
    icon: path.join(__dirname, "build", process.platform === "win32" ? "icon.ico" : "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.loadFile(path.join(__dirname, "app", "index.html"));

  /* 창이 뜨고 닫힐 때 부드럽게 — 요청 5번의 창 애니메이션 */
  win.once("ready-to-show", () => {
    win.setOpacity(0);
    win.show();
    let o = 0;
    const t = setInterval(() => {
      o = Math.min(1, o + 0.12);
      win.setOpacity(o);
      if (o >= 1) clearInterval(t);
    }, 12);
  });

  let closing = false;
  win.on("close", (e) => {
    if (closing) return;
    e.preventDefault();
    closing = true;
    let o = 1;
    const t = setInterval(() => {
      o -= 0.16;
      if (o <= 0) { clearInterval(t); win.destroy(); return; }
      win.setOpacity(o);
    }, 12);
  });

  /* 개발자 도구는 필요할 때만 F12 로 연다 (켤 때마다 뜨면 방해된다) */
  win.webContents.on("before-input-event", (e, input) => {
    if (input.type === "keyDown" && (input.key === "F12" ||
        (input.control && input.shift && input.key.toLowerCase() === "i"))) {
      win.webContents.toggleDevTools();
      e.preventDefault();
    }
  });
}

app.whenReady().then(createWindow);
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

/* =========================================================================
   영상 정보 읽기
   ========================================================================= */
/* ffmpeg 이 찍어주는 초당 장수는 소수 둘째 자리까지다 (23.98).
   실제로 쓰는 값은 24000/1001 = 23.976... 이므로, 아주 가까우면
   정확한 값으로 되돌려 놓는다. 긴 영상에서 시각이 조금씩 밀리는 것을 막는다. */
function snapFps(v) {
  if (!v || !isFinite(v)) return 24;
  for (const b of [24, 30, 60, 120]) {
    const ntsc = b * 1000 / 1001;
    if (Math.abs(v - ntsc) < 0.02) return ntsc;
    if (Math.abs(v - b) < 0.02) return b;
  }
  return v;
}
/* ffprobe 가 없을 때의 대체 경로.
   ffmpeg 는 출력 파일을 안 주면 오류로 끝나지만, 그 전에 영상 정보를
   먼저 찍어준다. 그 글을 읽어 길이·크기·초당 장수를 뽑아낸다. */
function probeViaFfmpeg(filePath) {
  return new Promise((resolve) => {
    execFile(ffmpegPath(), ["-hide_banner", "-i", filePath],
      { maxBuffer: 1 << 22, windowsHide: true }, (err, stdout, stderr) => {
        const txt = String(stderr || "") + String(stdout || "");
        const dm = txt.match(/Duration:\s*(\d+):(\d\d):(\d\d(?:\.\d+)?)/);
        const vm = txt.match(/Stream #\d+:\d+[^\n]*?:\s*Video:\s*([^\s,(]+)([^\n]*)/);
        const rest = vm ? vm[2] : "";
        const rm = rest.match(/[,\s](\d{2,5})x(\d{2,5})/);
        const fm = rest.match(/,\s*([\d.]+)\s*fps/);
        if (!dm && !vm)
          return resolve({ ok: false, error: "영상 정보를 읽지 못했습니다" });
        let size = 0;
        try { size = fs.statSync(filePath).size; } catch (e) {}
        resolve({
          ok: true,
          width: rm ? parseInt(rm[1], 10) : 0,
          height: rm ? parseInt(rm[2], 10) : 0,
          codec: vm ? vm[1] : "",
          fps: snapFps(fm ? parseFloat(fm[1]) : 24),
          duration: dm ? (+dm[1]) * 3600 + (+dm[2]) * 60 + parseFloat(dm[3]) : 0,
          size,
        });
      });
  });
}

ipcMain.handle("probe", async (_e, filePath) => {
  const byProbe = await new Promise((resolve) => {
    execFile(ffprobePath(), [
      "-v", "error",
      "-select_streams", "v:0",
      "-show_entries", "stream=width,height,r_frame_rate,nb_frames,codec_name",
      "-show_entries", "format=duration,size",
      "-of", "json", filePath,
    ], { maxBuffer: 1 << 22 }, (err, stdout) => {
      if (err) return resolve({ ok: false, error: String(err.message || err) });
      try {
        const j = JSON.parse(stdout);
        const s = (j.streams && j.streams[0]) || {};
        const [n, d] = String(s.r_frame_rate || "24/1").split("/").map(Number);
        resolve({
          ok: true,
          width: s.width, height: s.height,
          codec: s.codec_name,
          fps: d ? n / d : 24,
          duration: parseFloat((j.format || {}).duration || 0),
          size: parseInt((j.format || {}).size || 0, 10),
        });
      } catch (e) { resolve({ ok: false, error: String(e) }); }
    });
  });
  if (byProbe.ok) return byProbe;
  return probeViaFfmpeg(filePath);   // ffprobe 가 없거나 실패하면 ffmpeg 가 읽는다
});

/* =========================================================================
   미리보기 그림 한 장 뽑기
   -------------------------------------------------------------------------
   대기열에 뜨는 작은 그림이다. 파일이든 스트림 주소든 상관없이
   ffmpeg 로 한 장만 떠서 곧바로 돌려준다.
   ★ TVCF 처럼 주소로 넣은 영상은 그림이 없어 "🔗" 만 떠 있었다.
     이제는 아직 내려받기 전이어도 그림이 뜬다.
   ========================================================================= */
ipcMain.handle("thumbAt", async (_e, { src, time, referer }) => {
  const tmp = path.join(os.tmpdir(),
    "reftown_th_" + Date.now() + Math.random().toString(36).slice(2, 7) + ".jpg");
  const head = referer
    ? ["-headers", "Referer: " + referer + "\r\nUser-Agent: " + UA + "\r\n"]
    : [];
  const once = (at) => new Promise((resolve) => {
    const args = ["-v", "error", ...head];
    if (at > 0) args.push("-ss", String(at));
    args.push("-i", src, "-frames:v", "1",
      "-vf", "scale=480:-2", "-q:v", "5", "-y", tmp);
    const ff = spawn(ffmpegPath(), args, { windowsHide: true });
    let over = false;
    const t = setTimeout(() => {
      over = true; try { ff.kill("SIGKILL"); } catch (x) {} resolve(false);
    }, 25000);
    ff.on("error", () => { if (!over) { clearTimeout(t); resolve(false); } });
    ff.on("close", () => {
      if (over) return;
      clearTimeout(t);
      resolve(fs.existsSync(tmp) && fs.statSync(tmp).size > 0);
    });
  });
  try {
    let ok = await once(Math.max(0, Number(time) || 0));
    if (!ok && (Number(time) || 0) > 0) ok = await once(0);   // 그 지점이 없으면 맨 앞으로
    if (!ok) return { ok: false };
    const data = "data:image/jpeg;base64," + fs.readFileSync(tmp).toString("base64");
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  } finally {
    try { fs.unlinkSync(tmp); } catch (e) {}
  }
});

/* =========================================================================
   ★ 핵심: ffmpeg 로 분석용 축소 프레임을 한 번에 뽑는다

   브라우저판의 measure() 는 320x180 으로 줄인 화면을 읽는다.
   여기서도 똑같이 320x180 rawvideo(rgba)를 통째로 받아
   렌더러가 기존 알고리즘 그대로 계산하게 한다.
   → 검출 결과는 브라우저판과 동일하고, 읽는 속도만 10~20배 빨라진다.

   프레임 한 장 = 320*180*4 = 230,400 바이트. 정확히 그 크기로 잘라 보낸다.
   ========================================================================= */
const AW = 320, AH = 180, FRAME_BYTES = AW * AH * 4;

/* ★ 프레임이 '몇 초 지점의 것인가' 는 계산하면 안 된다.
   예전에는 화면 쪽에서 (프레임 번호 ÷ 초당 장수) 로 시각을 지어냈다.
   초당 장수가 일정한 영상은 그래도 맞지만, 내려받은 영상은 초당 장수가
   들쭉날쭉한 경우가 흔하다 (같은 24fps 라고 적혀 있어도 실제 간격이 다르다).
   그러면 뒤로 갈수록 시각이 밀려서,
     · 컷을 눌렀는데 다른 장면이 뜨고
     · 재생하는 동안 눈금과 실제 컷이 어긋난다.
   그래서 ffmpeg 에게 각 프레임의 진짜 시각(pts_time)을 직접 물어본다.
   showinfo 는 프레임 한 장마다 한 줄씩, 내보내는 순서 그대로 찍어준다. */
ipcMain.handle("scanFrames", async (e, { filePath, jobId }) => {
  return new Promise((resolve) => {
    const args = [
      "-v", "info", "-hide_banner",   // showinfo 의 글은 info 수준이라 error 로는 안 보인다
      "-i", filePath,
      "-map", "0:v:0",
      "-vf", `scale=${AW}:${AH}:flags=fast_bilinear,showinfo`,
      /* ★ 이것이 없으면 ffmpeg 가 '초당 장수를 고르게 맞추려고' 프레임을 복사해
         끼워 넣는다. 그러면 showinfo 가 찍어준 시각의 개수와 실제로 받는 장수가
         어긋나서, 진짜 시각을 쓰지 못하고 예전처럼 계산한 값으로 돌아가 버린다.
         복사하지 말고 디코드된 그대로 달라고 한다 (덤으로 조금 더 빠르다). */
      "-vsync", "0",
      "-pix_fmt", "rgba",
      "-f", "rawvideo",
      "-",
    ];
    const ff = spawn(ffmpegPath(), args, { windowsHide: true });
    const chunks = [];
    let buffered = 0, sent = 0, killed = false;
    const times = [];        // 프레임마다의 진짜 시각(초)
    let tail = "";           // 줄이 중간에서 잘려 오는 것을 이어붙이는 자리

    CANCEL.set(jobId, () => { killed = true; try { ff.kill("SIGKILL"); } catch (x) {} });

    ff.stdout.on("data", (buf) => {
      chunks.push(buf); buffered += buf.length;
      /* 프레임 단위로 잘라 렌더러에 흘려보낸다 (메모리에 다 쌓지 않는다) */
      while (buffered >= FRAME_BYTES) {
        const all = chunks.length === 1 ? chunks[0] : Buffer.concat(chunks, buffered);
        const frame = all.subarray(0, FRAME_BYTES);
        const rest = all.subarray(FRAME_BYTES);
        chunks.length = 0;
        if (rest.length) chunks.push(rest);
        buffered = rest.length;
        e.sender.send("frame", { jobId, index: sent++, data: frame });
      }
    });

    /* stderr 에는 showinfo 의 줄과 진짜 오류가 섞여 온다.
       시각은 뽑아서 모으고, 오류로 보여줄 글은 앞부분만 조금 남긴다
       (info 수준이라 그냥 다 쌓으면 긴 영상에서 메모리를 크게 먹는다). */
    let errTxt = "";
    ff.stderr.on("data", (d) => {
      const s = tail + d.toString();
      const lines = s.split("\n");
      tail = lines.pop();                    // 마지막 조각은 다음 번에 이어붙인다
      for (const ln of lines) {
        const m = ln.match(/pts_time:\s*([\d.]+)/);
        if (m) { times.push(parseFloat(m[1])); continue; }
        if (errTxt.length < 4000) errTxt += ln + "\n";
      }
    });
    ff.on("error", (err) => {
      CANCEL.delete(jobId);
      resolve({ ok: false, error: "ffmpeg 를 실행하지 못했습니다: " + err.message });
    });
    ff.on("close", (code) => {
      CANCEL.delete(jobId);
      if (killed) return resolve({ ok: false, aborted: true });
      if (code !== 0) return resolve({ ok: false, error: errTxt.slice(0, 400) || ("ffmpeg 종료 코드 " + code) });
      /* 장수와 시각의 수가 맞을 때만 쓴다. 어긋나면 화면 쪽이 예전 방식으로 돌아간다. */
      resolve({ ok: true, count: sent, times: times.length === sent ? times : null });
    });
  });
});

/* 지정한 시각들의 원본 해상도 프레임을 PNG 로 저장한다.
   -ss 를 입력 앞에 두면 키프레임 단위로 빠르게 건너뛴 뒤 정확히 맞춘다. */
ipcMain.handle("grabPNGs", async (_e, { filePath, times, outDir, prefix }) => {
  fs.mkdirSync(outDir, { recursive: true });
  const out = [];
  for (let i = 0; i < times.length; i++) {
    const dest = path.join(outDir, `${prefix}_CUT${i + 1}.png`);
    await new Promise((res) => {
      const ff = spawn(ffmpegPath(), [
        "-v", "error",
        "-ss", String(times[i]),
        "-i", filePath,
        "-frames:v", "1",
        "-y", dest,
      ], { windowsHide: true });
      ff.on("close", () => res());
      ff.on("error", () => res());
    });
    out.push(dest);
  }
  return { ok: true, files: out };
});

/* 취소 */
const CANCEL = new Map();
ipcMain.handle("cancelScan", (_e, jobId) => {
  const fn = CANCEL.get(jobId);
  if (fn) fn();
  return { ok: true };
});

/* =========================================================================
   파일 · 폴더
   ========================================================================= */
ipcMain.handle("pickVideos", async () => {
  const r = await dialog.showOpenDialog(win, {
    title: "영상 고르기",
    properties: ["openFile", "multiSelections"],
    filters: [{ name: "영상", extensions: ["mp4", "mov", "mkv", "avi", "m4v", "webm"] }],
  });
  return r.canceled ? [] : r.filePaths;
});

ipcMain.handle("pickFolder", async () => {
  const r = await dialog.showOpenDialog(win, {
    title: "저장 폴더 고르기",
    properties: ["openDirectory", "createDirectory"],
  });
  return r.canceled ? null : r.filePaths[0];
});

/* 브라우저에서는 절대 못 하던 것 — 탐색기에서 폴더 열기 */
ipcMain.handle("revealFolder", async (_e, p) => {
  try {
    if (fs.existsSync(p)) { shell.openPath(p); return { ok: true }; }
    return { ok: false, error: "폴더를 찾지 못했습니다" };
  } catch (e) { return { ok: false, error: String(e) }; }
});

ipcMain.handle("defaultOutDir", () => rootDir());

/* 화면에 보여줄 지금 버전. 손으로 적어둔 숫자를 쓰면 올리는 것을 잊는 순간
   "이미 최신" 같은 거짓말을 하게 되므로, 설치된 진짜 버전을 그대로 준다. */
ipcMain.on("appVersion", (e) => { e.returnValue = app.getVersion(); });

/* =========================================================================
   업데이트
   -------------------------------------------------------------------------
   깃허브 릴리스에 올려둔 설치 파일을 프로그램이 스스로 받아서 갈아끼운다.
   사람이 할 일은 없다 — 받겠다고 한 번 답하고, 다 받으면 다시 켜기만 하면 된다.

   릴리스에는 설치 파일(.exe)과 목록(latest.yml)이 함께 올라가 있어야 한다.
   `npm run release` 가 둘 다 만들어 올린다.

   릴리스를 찾지 못하는 옛 방식도 남겨뒀다. 그때는 예전처럼 version.json 을
   보고 내려받는 곳을 열어준다 (자동은 아니지만 길은 끊기지 않는다).
   ========================================================================= */
const { autoUpdater } = require("electron-updater");
autoUpdater.autoDownload = false;          // 물어보고 받는다
autoUpdater.autoInstallOnAppQuit = true;   // 받아뒀으면 끌 때 갈아끼운다
autoUpdater.logger = null;

const UPDATE_URL =
  "https://raw.githubusercontent.com/kkangji1999/Refcut/main/version.json";

/* 옛 방식 — 릴리스를 못 쓸 때만 쓰는 뒷길 */
async function checkByFile() {
  try {
    const res = await net.fetch(UPDATE_URL, { cache: "no-store" });
    if (!res.ok) return { ok: false, error: "확인 실패 (" + res.status + ")" };
    const j = await res.json();
    return { ok: true, manual: true, version: j.version, notes: j.notes || "",
             url: j.url || "", current: app.getVersion() };
  } catch (e) { return { ok: false, error: String(e.message || e) }; }
}

ipcMain.handle("checkUpdate", async () => {
  if (isDev) return checkByFile();          // 개발 중에는 릴리스 정보가 없다
  try {
    const r = await autoUpdater.checkForUpdates();
    const v = r && r.updateInfo && r.updateInfo.version;
    if (!v) return checkByFile();
    let notes = r.updateInfo.releaseNotes || "";
    if (Array.isArray(notes)) notes = notes.map((n) => n.note || "").join("\n");
    notes = String(notes).replace(/<[^>]+>/g, "").trim();
    return { ok: true, manual: false, version: v, notes,
             current: app.getVersion() };
  } catch (e) {
    const f = await checkByFile();          // 릴리스가 없거나 못 읽으면 옛 방식으로
    if (f.ok) return f;
    return { ok: false, error: String((e && e.message) || e) };
  }
});

/* 내려받기 — 얼마나 받았는지 화면에 계속 알려준다 */
ipcMain.handle("downloadUpdate", async () => {
  return new Promise((resolve) => {
    const send = (ch, m) => { try { win && win.webContents.send(ch, m); } catch (x) {} };
    const onProg = (p) => send("updProgress", {
      percent: p.percent || 0, transferred: p.transferred || 0,
      total: p.total || 0, speed: p.bytesPerSecond || 0 });
    const done = (r) => {
      autoUpdater.removeListener("download-progress", onProg);
      autoUpdater.removeListener("update-downloaded", onOk);
      autoUpdater.removeListener("error", onErr);
      resolve(r);
    };
    const onOk = () => done({ ok: true });
    const onErr = (e) => done({ ok: false, error: String((e && e.message) || e) });
    autoUpdater.on("download-progress", onProg);
    autoUpdater.once("update-downloaded", onOk);
    autoUpdater.once("error", onErr);
    autoUpdater.downloadUpdate().catch(onErr);
  });
});

/* 다시 켜면서 갈아끼우기 */
ipcMain.handle("installUpdate", () => {
  setImmediate(() => autoUpdater.quitAndInstall(false, true));
  return { ok: true };
});
ipcMain.handle("openExternal", (_e, u) => { shell.openExternal(u); return { ok: true }; });

/* =========================================================================
   영상 링크로 받기 (yt-dlp)
   -------------------------------------------------------------------------
   yt-dlp 를 설치 파일에 넣지 않고, 처음 쓸 때 한 번 내려받는다.
   그래야 설치 파일이 커지지 않고, 언제 설치하든 최신본을 받는다.
   유튜브는 구조를 수시로 바꾸므로 하루 한 번 스스로 갱신도 한다.
   ========================================================================= */
const YTDIR = () => {
  const d = path.join(app.getPath("userData"), "bin");
  fs.mkdirSync(d, { recursive: true });
  return d;
};
const YTEXE = () => path.join(YTDIR(),
  process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp");
const YT_RELEASE = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/" +
  (process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp");

async function ensureYtdlp(send) {
  const exe = YTEXE();
  if (!fs.existsSync(exe)) {
    if (send) send({ stage: "setup", text: "영상 받기 도구를 준비하는 중... (처음 한 번만)" });
    const res = await net.fetch(YT_RELEASE);
    if (!res.ok) throw new Error("영상 받기 도구를 내려받지 못했습니다 (" + res.status + ")");
    fs.writeFileSync(exe, Buffer.from(await res.arrayBuffer()));
    try { fs.chmodSync(exe, 0o755); } catch (e) {}
    writeSettings({ ...readSettings(), ytUpdated: Date.now() });
    return exe;
  }
  /* 하루 한 번 조용히 갱신 — 실패해도 그냥 넘어간다 */
  const st = readSettings();
  if (Date.now() - (st.ytUpdated || 0) > 86400000) {
    writeSettings({ ...st, ytUpdated: Date.now() });
    try {
      await new Promise((r) => {
        const u = spawn(exe, ["-U"], { windowsHide: true });
        const t = setTimeout(() => { try { u.kill(); } catch (e) {} r(); }, 25000);
        u.on("close", () => { clearTimeout(t); r(); });
        u.on("error", () => { clearTimeout(t); r(); });
      });
    } catch (e) {}
  }
  return exe;
}

/* ---------- 사이트별 재시도 조합 ----------
   한 번에 안 되는 사이트가 있다. 특히 비메오는 기본 방식이
   OAuth 토큰을 받아오다 401 로 막히는 일이 잦다.
   그래서 실패하면 다른 방식으로 몇 번 더 시도한다.
   앞에서 성공하면 뒤는 시도하지 않으므로 평소에는 느려지지 않는다. */
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
           "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
function originOf(u) {
  try { const x = new URL(u); return x.origin + "/"; } catch (e) { return ""; }
}
function cookiePlans() {
  return [["--cookies-from-browser", "chrome"],
          ["--cookies-from-browser", "edge"],
          ["--cookies-from-browser", "firefox"]];
}
function retryPlans(url, useCookies, referer) {
  /* 스트림 주소를 직접 받을 때는 어느 페이지에서 왔는지 알려줘야 통과된다 */
  if (referer) {
    const hdr = ["--referer", referer, "--user-agent", UA];
    return [hdr, [...hdr, "--hls-use-mpegts"], []];
  }
  /* 로그인 정보를 쓰기로 했으면 그것부터 시도한다.
     (회원만 볼 수 있는 사이트는 이게 아니면 아예 안 된다) */
  if (useCookies) return [...cookiePlans(), []];
  const plans = [[]];                                   // ① 기본
  if (/vimeo\.com/i.test(url)) {
    plans.push(["--extractor-args", "vimeo:client=web"]);      // ② 웹 방식
    plans.push(["--extractor-args", "vimeo:client=android"]);  // ③ 안드로이드 방식
    plans.push(["--referer", "https://vimeo.com/"]);           // ④ 임베드 전용 영상
  }
  /* ★ yt-dlp 가 모르는 사이트는 '일반 방식'으로 긁는데,
     그때 브라우저인 척하지 않으면 403(접근 거부)으로 막히는 곳이 많다.
     그 사이트 주소를 출처로 달고 브라우저 신원을 붙여 다시 시도한다.
     (TVCF 같은 국내 사이트가 여기 해당한다) */
  const org = originOf(url);
  if (org) {
    plans.push(["--user-agent", UA, "--referer", org]);
    plans.push(["--user-agent", UA, "--referer", org,
                "--add-header", "Origin:" + org.replace(/\/$/, "")]);
    plans.push(["--user-agent", UA, "--referer", org,
                "--force-generic-extractor"]);
  }
  /* ⑤ 마지막 수단: 브라우저에 로그인된 상태를 빌려 쓴다.
     ★ 윈도우에서 크롬이 켜져 있으면 쿠키 파일이 잠겨 실패한다
       ("Could not copy Chrome cookie database").
       그래서 엣지·파이어폭스도 차례로 시도한다. */
  plans.push(["--cookies-from-browser", "chrome"]);
  plans.push(["--cookies-from-browser", "edge"]);
  plans.push(["--cookies-from-browser", "firefox"]);
  return plans;
}
/* 여러 번 시도한 뒤 사용자에게 보여줄 오류를 고른다.
   마지막 오류(대개 "쿠키를 못 읽었다")는 진짜 원인이 아니므로,
   쿠키 관련이 아닌 첫 오류를 우선해서 보여준다. */
function pickError(errs) {
  const real = errs.find((e) => !/cookie/i.test(e));
  return real || errs[0] || "";
}
/* ★ 시간 제한이 없으면 한 번의 시도가 몇 분씩 멈춰 있을 수 있다.
   (지원하지 않는 사이트나, 크롬이 켜진 채 쿠키를 읽으려 할 때 특히 그렇다)
   정해진 시간이 지나면 끊고 다음 방식으로 넘어간다. */
function runYt(exe, args, ms) {
  return new Promise((res, rej) => {
    let buf = "", err = "", done = false;
    const p2 = spawn(exe, args, { windowsHide: true });
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      try { p2.kill("SIGKILL"); } catch (e) {}
      rej(new Error("시간 초과"));
    }, ms || 20000);
    p2.stdout.on("data", (d) => (buf += d));
    p2.stderr.on("data", (d) => (err += d));
    p2.on("close", (c) => {
      if (done) return;
      done = true; clearTimeout(timer);
      c === 0 ? res(buf) : rej(new Error(err.slice(0, 400)));
    });
    p2.on("error", (e) => {
      if (done) return;
      done = true; clearTimeout(timer); rej(e);
    });
  });
}

/* 사이트가 알려주는 대표 그림 중 가장 큰 것을 고른다.
   없으면 빈 문자열 — 그때는 화면 쪽이 ffmpeg 로 한 장 떠서 쓴다. */
function pickThumb(j) {
  if (j.thumbnail) return String(j.thumbnail);
  const list = (j.thumbnails || []).filter((t) => t && t.url);
  if (!list.length) return "";
  list.sort((a, b) => (b.width || b.preference || 0) - (a.width || a.preference || 0));
  return String(list[0].url);
}

/* 링크 정보만 먼저 읽어온다 (제목·길이) — 대기열에 보여주기 위해 */
ipcMain.handle("ytInfo", async (_e, url, useCookies, referer) => {
  let exe, last = "";
  try { exe = await ensureYtdlp(null); }
  catch (e) { return { ok: false, error: String(e.message || e) }; }

  const errs = [];
  const deadline = Date.now() + 45000;      // 로그인 시도까지 합쳐 60초를 넘기지 않는다
  const plans = useCookies
    ? retryPlans(url, true, referer)
    : retryPlans(url, false, referer).filter((p) => !p.includes("--cookies-from-browser"));
  for (const extra of plans) {
    if (Date.now() > deadline) { errs.push("시간 초과"); break; }
    /* 지원하지 않는 주소라고 이미 판명됐으면 더 시도하지 않는다 */
    if (errs.some((e) => /unsupported url|is not a valid url/i.test(e))) break;
    try {
      const out = await runYt(exe, ["--dump-single-json", "--no-warnings",
        "--no-playlist", "--socket-timeout", "10", "--retries", "1",
        ...ffmpegLocArgs(), ...extra, url], 18000);
      const j = JSON.parse(out);
      /* 이 영상이 실제로 제공하는 화질만 추린다 */
      const heights = [...new Set((j.formats || [])
        .filter((f) => f.vcodec && f.vcodec !== "none" && f.height)
        .map((f) => f.height))].sort((a, b) => b - a);
      return { ok: true, title: j.title || "영상", duration: j.duration || 0,
               ext: j.ext || "mp4", site: j.extractor_key || "",
               thumb: pickThumb(j),    // 대기열에 띄울 대표 그림 (있으면)
               heights,                // 고를 수 있는 화질
               plan: extra };          // 성공한 방식을 기억해 두었다가 받을 때 그대로 쓴다
    } catch (e) { errs.push(String(e.message || e)); }
  }
  /* 로그인이 필요해 보이는 경우에만 브라우저 로그인 정보를 빌려 한 번 시도한다.
     (평소에도 매번 하면 느리고, 크롬이 켜져 있으면 멈추기까지 한다) */
  const needsLogin = errs.some((e) =>
    /private|members-only|login|sign in|403|forbidden|401|unauthorized/i.test(e));
  const loginDeadline = Date.now() + 15000;   // 로그인 시도는 다 합쳐 15초까지만
  if (needsLogin && Date.now() < deadline) {
    for (const br of ["chrome", "edge", "firefox"]) {
      if (Date.now() > loginDeadline) break;
      try {
        const out = await runYt(exe, ["--dump-single-json", "--no-warnings",
          "--no-playlist", "--socket-timeout", "10", "--retries", "1",
          ...ffmpegLocArgs(), "--cookies-from-browser", br, url], 7000);
        const j = JSON.parse(out);
        const heights = [...new Set((j.formats || [])
          .filter((f) => f.vcodec && f.vcodec !== "none" && f.height)
          .map((f) => f.height))].sort((a, b) => b - a);
        return { ok: true, title: j.title || "영상", duration: j.duration || 0,
                 ext: j.ext || "mp4", site: j.extractor_key || "", heights,
                 thumb: pickThumb(j),
                 plan: ["--cookies-from-browser", br] };
      } catch (e) { errs.push(String(e.message || e)); }
    }
  }
  return { ok: false, error: friendlyYtError(pickError(errs)) };
});

function friendlyYtError(msg) {
  const m = msg.toLowerCase();
  if (m.includes("private") || m.includes("members-only") || m.includes("login"))
    return "비공개이거나 로그인이 필요한 영상입니다.";
  if (m.includes("unavailable") || m.includes("removed"))
    return "영상을 찾을 수 없습니다. 삭제되었거나 지역 제한일 수 있습니다.";
  if (m.includes("unsupported url"))
    return "이 사이트는 지원하지 않습니다.";
  if (m.includes("sign in") || m.includes("bot"))
    return "사이트가 자동 접근을 막고 있습니다. 잠시 후 다시 시도해 주세요.";
  if (m.includes("oauth") || m.includes("401") || m.includes("unauthorized"))
    return "이 영상은 사이트가 프로그램의 접근을 막고 있습니다.\n\n"
         + "비메오는 '특정 사이트에만 심을 수 있게' 설정된 영상이 많습니다.\n"
         + "브라우저로는 보이지만 프로그램으로는 받을 수 없는 종류입니다.\n"
         + "영상 파일을 직접 받아서 끌어다 놓아 주세요.";
  if (m.includes("403") || m.includes("forbidden"))
    return "사이트가 접근을 거부했습니다.\n\n"
         + "이 사이트는 아직 지원 목록에 없어 일반 방식으로 시도했지만 막혔습니다.\n"
         + "영상 파일을 직접 받아서 끌어다 놓아 주세요.";
  if (m.includes("generic") && m.includes("unable"))
    return "이 페이지에서 영상을 찾지 못했습니다.\n\n"
         + "아직 지원하지 않는 사이트일 수 있습니다.\n"
         + "영상 파일을 직접 받아서 끌어다 놓아 주세요.";
  if (m.includes("requested format") || m.includes("format is not available"))
    return "고른 화질로는 받을 수 없는 영상입니다.\n"
         + "대기열에서 다른 화질을 골라 다시 시도해 주세요.";
  if (m.includes("cookie"))
    return "브라우저의 로그인 정보를 읽지 못했습니다.\n"
         + "크롬을 완전히 종료한 뒤 다시 시도해 주세요.\n"
         + "(작업 표시줄에서 크롬을 모두 닫아야 합니다)";
  if (m.includes("no video formats") || m.includes("no media"))
    return "이 주소에서 영상을 찾지 못했습니다.\n"
         + "영상이 있는 페이지 주소가 맞는지 확인해 주세요.";
  return "영상을 받지 못했습니다.\n" + msg.slice(0, 200);
}

/* 실제 내려받기. 진행률을 렌더러로 흘려보낸다. */
ipcMain.handle("ytDownload", async (e, { url, dest, jobId, height, plan, useCookies, referer }) => {
  try {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const send = (o) => e.sender.send("ytProgress", { jobId, ...o });
    const exe = await ensureYtdlp(send);
    let killed = false;
    CANCEL.set("yt" + jobId, () => { killed = true; });

    /* 해상도 조건.
       ★ 예전에는 mp4/m4a 라는 확장자까지 못 박아서, 그 형태로 주지 않는 사이트는
         "Requested format is not available" 로 실패했다 (비메오가 그렇다).
         확장자 조건을 빼고, 안 되면 점점 느슨한 조건으로 물러나게 한다.
         마지막 best 는 '무조건 되는' 안전망이다. */
    const cap = height && height > 0 ? `[height<=${height}]` : "";
    const fmt = cap
      ? `bv*${cap}+ba/b${cap}/bv*+ba/b/best`
      : `bv*+ba/b/best`;

    /* ★ 예전에는 한 번의 시도에 시간 제한이 아예 없었다.
       그래서 사이트가 응답을 멈추면 그 자리에서 영영 멈춰 있었다
       ("로딩만 계속 걸리고 끝나지 않는다"는 증상이 이것이다).
       이제는 아무 소식도 없이 조용한 시간이 이어지면 끊고 다음 방식으로 넘어간다. */
    const QUIET_MS = 120000;             // 2분 동안 아무 소식이 없으면 끊는다
    const run = (extra, fmtSel) => new Promise((res, rej) => {
      const args = [
        "--no-warnings", "--no-playlist", "--no-part", "--newline",
        "-f", fmtSel || fmt, "--merge-output-format", "mp4",
        ...ffmpegLocArgs(),              // ffmpeg 위치를 알려준다 (없으면 합치기가 실패한다)
        ...extra, "-o", dest, url,
      ];
      const p2 = spawn(exe, args, { windowsHide: true });
      let over = false, err = "", lastAt = Date.now();
      const finish = (fn, v) => {
        if (over) return;
        over = true; clearInterval(watch); fn(v);
      };
      const watch = setInterval(() => {
        if (over) return;
        if (Date.now() - lastAt > QUIET_MS) {
          try { p2.kill("SIGKILL"); } catch (x) {}
          finish(rej, new Error("응답이 없어 중단했습니다 (2분)"));
        }
      }, 5000);
      CANCEL.set("yt" + jobId, () => {
        killed = true; try { p2.kill("SIGKILL"); } catch (x) {}
      });
      p2.stdout.on("data", (d) => {
        lastAt = Date.now();
        const s2 = d.toString();
        const m = s2.match(/\[download\]\s+([\d.]+)%/);
        if (m) send({ percent: parseFloat(m[1]) });
        if (s2.includes("[Merger]")) send({ text: "영상과 소리를 합치는 중..." });
      });
      p2.stderr.on("data", (d) => { lastAt = Date.now(); err += d; });
      p2.on("close", (c) => (c === 0 ? finish(res) : finish(rej, new Error(err.slice(0, 400)))));
      p2.on("error", (e) => finish(rej, e));
    });

    /* 정보를 읽을 때 성공했던 방식을 먼저 쓰고, 안 되면 나머지를 차례로 */
    const plans = plan && plan.length ? [plan, ...retryPlans(url, useCookies, referer)]
                                      : retryPlans(url, useCookies, referer);
    const dlDeadline = Date.now() + 30 * 60 * 1000;   // 큰 영상도 받을 수 있게 넉넉히
    const allErrs = [];
    let done = false;
    for (const extra of plans) {
      if (killed || Date.now() > dlDeadline) break;
      try { await run(extra); done = true; break; }
      catch (e) {
        allErrs.push(String(e.message || e));
        if (killed) break;
        send({ text: "다른 방식으로 다시 시도하는 중...", percent: 0 });
      }
    }
    /* 그래도 화질 문제로 실패했다면, 조건을 아예 풀고 마지막으로 한 번 더 */
    if (!done && !killed && allErrs.some((e) => /requested format|format is not available/i.test(e))) {
      send({ text: "화질 조건을 풀고 다시 시도하는 중...", percent: 0 });
      for (const extra of plans) {
        if (killed) break;
        try { await run(extra, "best"); done = true; break; }
        catch (e) { allErrs.push(String(e.message || e)); }
      }
    }
    if (!done && !killed) throw new Error(pickError(allErrs));
    CANCEL.delete("yt" + jobId);
    if (killed) return { ok: false, aborted: true };
    if (!fs.existsSync(dest)) return { ok: false, error: "받은 파일을 찾을 수 없습니다." };
    return { ok: true, path: dest, size: fs.statSync(dest).size };
  } catch (err) {
    CANCEL.delete("yt" + jobId);
    return { ok: false, error: friendlyYtError(String(err.message || err)) };
  }
});
/* =========================================================================
   브라우저에서 열어 영상 주소 잡기
   -------------------------------------------------------------------------
   yt-dlp 가 모르는 사이트(TVCF 등)는 페이지를 긁으려다 막힌다.
   그래서 페이지를 '해석'하지 않고, 진짜 브라우저 창을 띄워 사용자가 재생하게 한 뒤
   그때 오가는 통신에서 영상 주소만 주워담는다.
   자바스크립트로 감춰두든 봇을 걸러내든, 실제로 재생되는 것은 반드시 지나가므로
   이 방법은 대부분의 사이트에서 통한다.
   ★ 로그인이 필요하면 그 창에서 그냥 로그인하시면 되고, 그 상태는 다음에도 남는다.
   ========================================================================= */
/* ---------- 주소에서 화질 읽기 ----------
   스트림 주소에는 대개 화질이 적혀 있다 (720p · 1280x720 · /1080/ 처럼).
   그 표기를 읽어 "이 주소는 몇 p 짜리인가" 를 짐작한다. */
const TIERS = [2160, 1440, 1080, 900, 720, 576, 540, 480, 360, 240];
const TIER_W = { 2160: 3840, 1440: 2560, 1080: 1920, 900: 1600, 720: 1280,
                 576: 1024, 540: 960, 480: 854, 360: 640, 240: 426 };
function heightFromUrl(u) {
  const s = String(u || "");
  let m = s.match(/(\d{3,4})[pP](?![a-zA-Z0-9])/);          // 720p
  if (m && +m[1] >= 144) return +m[1];
  m = s.match(/(\d{3,4})[xX](\d{3,4})/);                    // 1280x720
  if (m && +m[2] >= 144) return +m[2];
  for (const h of TIERS) {                                  // /1080/ · _1080 · -1080
    if (new RegExp("(?:^|[^0-9])" + h + "(?:[^0-9]|$)").test(s)) return h;
  }
  return 0;
}
/* 전체 목록(master)처럼 보이는가 — 조각 목록보다 이쪽이 낫다 */
function looksMaster(key) {
  return /playlist|master|index|manifest/i.test(key) && !/chunk|seg|frag/i.test(key);
}

/* ---------- 화질 올려잡기 ----------
   재생 창에서 잡히는 주소는 "그때 재생되던 화질" 하나뿐이다.
   플레이어가 720p 로 시작하면, 1080p 가 있는 영상이라도 720p 주소만 잡힌다.
   (TVCF 에서 최고 화질을 골라도 720p 로 나오던 것이 바로 이것이다)
   그래서 잡은 주소에서 더 높은 화질의 형제 주소를 직접 찾아본다.
     · HLS 조각 목록이면 → 전체 목록(master)을 찾아 올린다.
       전체 목록에는 화질이 다 들어 있어서 yt-dlp 가 최고 화질을 고른다.
     · 주소에 화질이 박혀 있으면 → 그 자리를 높은 숫자로 바꿔 보고,
       실제로 응답하는 것만 쓴다.
   확인되지 않은 후보는 버리므로, 못 찾으면 원래 주소 그대로다. */
function peek(url, referer, ms, range) {
  return new Promise((resolve) => {
    let body = "", done = false, req = null;
    const fin = (v) => {
      if (done) return;
      done = true; clearTimeout(t);
      try { if (req) req.abort(); } catch (x) {}
      resolve(v);
    };
    const t = setTimeout(() => fin(null), ms || 6000);
    try {
      const { session } = require("electron");
      req = net.request({ url, session: session.fromPartition("persist:sniff"),
                          useSessionCookies: true });
    } catch (x) { return fin(null); }
    try {
      req.setHeader("User-Agent", UA);
      if (referer) {
        req.setHeader("Referer", referer);
        const o = originOf(referer).replace(/\/$/, "");
        if (o) req.setHeader("Origin", o);
      }
      if (range) req.setHeader("Range", range);
    } catch (x) {}
    req.on("response", (res) => {
      const pick = (k) => {
        const h = res.headers || {};
        const kk = Object.keys(h).find((x) => x.toLowerCase() === k);
        return kk ? String([].concat(h[kk])[0] || "") : "";
      };
      const info = { code: res.statusCode || 0, type: pick("content-type"),
                     len: parseInt(pick("content-length"), 10) || 0, body: "" };
      res.on("data", (c) => { if (body.length < 200000) body += c.toString("utf8"); });
      res.on("end", () => { info.body = body; fin(info); });
      res.on("error", () => { info.body = body; fin(info); });
    });
    req.on("error", () => fin(null));
    try { req.end(); } catch (x) { fin(null); }
  });
}
const isMasterM3U = (t) => /#EXT-X-STREAM-INF/i.test(String(t || ""));
function maxHeightOfMaster(t) {
  let best = 0, m;
  const re = /RESOLUTION=(\d+)[xX](\d+)/g;
  while ((m = re.exec(String(t || "")))) best = Math.max(best, parseInt(m[2], 10));
  return best;
}
/* 같은 폴더와 그 윗 폴더에서, 전체 목록으로 흔히 쓰는 이름들을 찾아본다 */
function masterCandidates(url) {
  const outs = [];
  try {
    const u = new URL(url);
    const segs = u.pathname.split("/");
    const file = segs.pop() || "";
    const names = ["master.m3u8", "playlist.m3u8", "index.m3u8", "manifest.m3u8"];
    for (let up = 0; up <= 2; up++) {
      const dir = segs.slice(0, segs.length - up);
      if (dir.length < 1) break;
      for (const n of names) {
        if (up === 0 && n === file) continue;
        outs.push(u.origin + dir.join("/") + "/" + n + u.search);
      }
    }
  } catch (x) {}
  return outs;
}
/* 주소에 박힌 화질 표기를 더 높은 화질로 바꾼 후보들 */
function qualitySwaps(url, from, to) {
  const outs = new Set();
  const put = (a, b) => { if (a && url.includes(a)) outs.add(url.split(a).join(b)); };
  put(from + "p", to + "p");
  put(from + "P", to + "P");
  put("_" + from, "_" + to);
  put("-" + from, "-" + to);
  put("/" + from + "/", "/" + to + "/");
  put("=" + from, "=" + to);
  put("x" + from, "x" + to);
  if (TIER_W[from] && TIER_W[to])
    put(TIER_W[from] + "x" + from, TIER_W[to] + "x" + to);
  outs.delete(url);
  return [...outs];
}
async function upgradeStream(url, referer, want) {
  const cur = heightFromUrl(url);
  const out = { url, height: cur, from: cur, upgraded: false };
  const isM3U = /\.m3u8(\?|$)/i.test(url);
  const cap = want && want > 0 ? want : 4320;
  let tried = 0;

  if (isM3U) {
    const r = await peek(url, referer, 7000);
    if (r && r.body && isMasterM3U(r.body)) {
      out.height = maxHeightOfMaster(r.body) || cur;
      return out;                    // 이미 전체 목록이다 — 손댈 것이 없다
    }
    for (const c of masterCandidates(url)) {
      if (tried++ > 10) break;
      const g = await peek(c, referer, 5000);
      if (!g || g.code < 200 || g.code >= 300) continue;
      if (!isMasterM3U(g.body)) continue;
      const h = maxHeightOfMaster(g.body);
      if (cur && h && h < cur) continue;          // 오히려 낮아지면 쓰지 않는다
      out.url = c; out.height = h || cur; out.upgraded = true;
      return out;
    }
  }
  if (!cur) return out;              // 화질이 어디에 적혔는지 모르면 손대지 않는다
  for (const t of TIERS) {           // 높은 것부터 — 처음 되는 것이 최선이다
    if (t <= cur || t > cap) continue;
    for (const c of qualitySwaps(url, cur, t)) {
      if (tried++ > 16) return out;
      const g = await peek(c, referer, 5000, isM3U ? null : "bytes=0-1");
      if (!g || g.code < 200 || g.code >= 300) continue;
      if (isM3U) { if (!/#EXTM3U/i.test(g.body || "")) continue; }
      else if (!/video|mp4|octet-stream|mpegurl/i.test(g.type || "")) continue;
      out.url = c; out.height = t; out.upgraded = true;
      return out;
    }
  }
  return out;
}
/* 화면 쪽에서 "이 주소보다 좋은 것이 있나" 하고 물어본다 */
ipcMain.handle("streamUpgrade", async (_e, { url, referer, want }) => {
  try {
    const r = await upgradeStream(String(url || ""), referer || "", want || 0);
    return { ok: true, ...r };
  } catch (err) { return { ok: false, url, height: 0, upgraded: false }; }
});

let sniffWin = null;
ipcMain.handle("sniffOpen", async (e, pageUrl) => {
  if (sniffWin) { try { sniffWin.close(); } catch (x) {} sniffWin = null; }
  const { session } = require("electron");
  const part = session.fromPartition("persist:sniff");   // 로그인 상태를 기억한다
  const found = new Map();

  /* 찾은 주소 하나를 화면 쪽으로 넘긴다 */
  const report = (u, ctype) => {
    const key = u.split("?")[0];
    if (found.has(key) || found.size > 40) return;
    found.set(key, u);
    /* ★ 스트림 주소에는 제목이 없다. 그 영상이 올라와 있던 웹페이지의
       제목을 같이 보내, 사이트에 적힌 제목 그대로 쓸 수 있게 한다. */
    let pageTitle = "";
    try {
      if (sniffWin && !sniffWin.isDestroyed()) pageTitle = sniffWin.webContents.getTitle() || "";
    } catch (x) {}
    const tag = u + " " + (ctype || "");
    e.sender.send("sniffFound", {
      url: u,
      kind: /\.m3u8|mpegurl/i.test(tag) ? "HLS" : /\.mpd|dash\+xml/i.test(tag) ? "DASH" : "MP4",
      /* 주소 안에 720p · 1280x720 · /1080/ 같은 표기가 있으면 화질 힌트로 쓴다.
         playlist(전체 목록)가 chunklist(조각 목록)보다 낫다. */
      height: heightFromUrl(u),
      master: looksMaster(key),
      name: decodeURIComponent(key.split("/").pop() || "").slice(0, 60),
      pageTitle,
    });
  };
  /* 조각 파일은 후보가 아니다 (수십 개가 흘러와 창이 닫히지 않게 된다) */
  const isSegment = (u) =>
    /\.(ts|m4s)(\?|$)/i.test(u) || /seg[-_]?\d|chunk|frag[-_]?\d/i.test(u);

  part.webRequest.onBeforeRequest({ urls: ["<all_urls>"] }, (details, cb) => {
    const u = details.url;
    if (/\.(m3u8|mpd)(\?|$)/i.test(u) ||
        (/\.mp4(\?|$)/i.test(u) && !/thumb|poster|preview/i.test(u) && !isSegment(u)))
      report(u, "");
    cb({});
  });
  /* ★ 주소 끝이 .mp4 가 아닌 영상도 있다 — 물음표 뒤에 이름을 숨기거나,
     확장자 없이 내려주는 곳이 있다. 그때는 돌아온 응답의 종류를 보고 알아본다.
     (주소만 봐서는 모르는 곳도 이렇게 하면 잡힌다) */
  part.webRequest.onHeadersReceived({ urls: ["<all_urls>"] }, (details, cb) => {
    try {
      const h = details.responseHeaders || {};
      const kk = Object.keys(h).find((k) => k.toLowerCase() === "content-type");
      const ct = kk ? String([].concat(h[kk])[0] || "") : "";
      if (/mpegurl|dash\+xml|video\/(mp4|webm|quicktime|x-m4v)/i.test(ct) &&
          !/thumb|poster|preview/i.test(details.url) && !isSegment(details.url))
        report(details.url, ct);
    } catch (x) {}
    cb({});
  });

  sniffWin = new BrowserWindow({
    width: 1100, height: 780,
    title: "재생 버튼을 눌러주세요 — 주소를 찾으면 닫히고 추출이 시작됩니다",
    autoHideMenuBar: true, backgroundColor: "#101216",
    webPreferences: { session: part, nodeIntegration: false, contextIsolation: true },
  });
  sniffWin.on("closed", () => {
    try { part.webRequest.onBeforeRequest(null); } catch (x) {}
    try { part.webRequest.onHeadersReceived(null); } catch (x) {}
    sniffWin = null;
    try { e.sender.send("sniffClosed"); } catch (x) {}
  });
  try { await sniffWin.loadURL(pageUrl); } catch (err) { /* 로딩 실패해도 창은 유지 */ }
  return { ok: true };
});
ipcMain.handle("sniffClose", () => {
  if (sniffWin) { try { sniffWin.close(); } catch (x) {} sniffWin = null; }
  return { ok: true };
});

/* 진단 — 어디서 막히는지 직접 확인한다 */
ipcMain.handle("ytDiag", async () => {
  const out = { exePath: YTEXE(), exists: false, size: 0, version: "", test: "", error: "",
                ffmpeg: ffmpegPath(), ffmpegOk: false, ffprobeOk: false };
  try {
    const fp = ffmpegPath();
    out.ffmpegOk = await new Promise((r) => {
      const c = spawn(fp, ["-version"], { windowsHide: true });
      c.on("error", () => r(false)); c.on("close", (x) => r(x === 0));
    });
    out.ffprobeOk = await new Promise((r) => {
      const c = spawn(ffprobePath(), ["-version"], { windowsHide: true });
      c.on("error", () => r(false)); c.on("close", (x) => r(x === 0));
    });
  } catch (e) {}
  try {
    out.exists = fs.existsSync(out.exePath);
    if (out.exists) out.size = fs.statSync(out.exePath).size;
    if (!out.exists) {
      try { await ensureYtdlp(null); out.exists = fs.existsSync(out.exePath);
            out.size = out.exists ? fs.statSync(out.exePath).size : 0; }
      catch (e) { out.error = "내려받기 실패: " + (e.message || e); return out; }
    }
    try { out.version = (await runYt(YTEXE(), ["--version"], 10000)).trim(); }
    catch (e) { out.error = "실행 실패: " + (e.message || e); return out; }
    try {
      await runYt(YTEXE(), ["--dump-single-json", "--no-warnings", "--simulate",
        "--socket-timeout", "8", "--retries", "1",
        "https://www.youtube.com/watch?v=aqz-KE-bpKQ"], 20000);
      out.test = "성공";
    } catch (e) { out.test = "실패: " + String(e.message || e).slice(0, 200); }
  } catch (e) { out.error = String(e.message || e); }
  return out;
});
ipcMain.handle("ytCancel", (_e, jobId) => {
  const fn = CANCEL.get("yt" + jobId); if (fn) fn(); return { ok: true };
});

/* ---------- 이름이 Refcut 이던 시절의 짐을 옮겨온다 ----------
   프로그램 이름이 바뀌면 윈도우가 잡아주는 개인 폴더 자리도 함께 바뀐다.
   그대로 두면 설정도, 받아둔 영상 받기 도구도 처음부터 다시가 된다.
   켤 때 한 번만, 조용히 옮겨온다. */
function migrateFromRefcut() {
  try {
    const now = app.getPath("userData");
    const old = path.join(path.dirname(now), "Refcut");
    if (path.resolve(now) === path.resolve(old) || !fs.existsSync(old)) return;
    const cfg = path.join(now, "settings.json");
    if (!fs.existsSync(cfg) && fs.existsSync(path.join(old, "settings.json"))) {
      fs.mkdirSync(now, { recursive: true });
      fs.copyFileSync(path.join(old, "settings.json"), cfg);
    }
    /* 영상 받기 도구도 함께 — 다시 내려받지 않아도 되게 */
    const exe = process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp";
    const from = path.join(old, "bin", exe), to = path.join(now, "bin", exe);
    if (fs.existsSync(from) && !fs.existsSync(to)) {
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(from, to);
    }
  } catch (e) {}
}
migrateFromRefcut();     // 창이 뜨기 전에 끝내둔다

/* =========================================================================
   저장소 — IndexedDB 대신 JSON 파일 (요청 1번)
   기록마다 파일 하나. 사람이 직접 열어 확인·수정할 수 있다.
   ========================================================================= */
/* ★ 기록도 '캡쳐 저장 폴더' 안에 함께 둔다.
   예전에는 프로그램 내부(AppData)에 따로 흩어져서
   "폴더를 지정해도 의미가 없다"는 문제가 있었다.
   이제 이미지와 기록이 한 폴더에 모이므로, 그 폴더만 복사하면 통째로 백업된다. */

const settingsFile = () => path.join(app.getPath("userData"), "settings.json");
function readSettings() {
  try { return JSON.parse(fs.readFileSync(settingsFile(), "utf8")); } catch (e) { return {}; }
}
function writeSettings(o) {
  try { fs.writeFileSync(settingsFile(), JSON.stringify(o, null, 2), "utf8"); } catch (e) {}
}
function rootDir() {
  const s = readSettings();
  if (s.outDir) return s.outDir;
  const now = path.join(os.homedir(), "Documents", "Reftown");
  /* 이름이 Refcut 이던 시절에 쓰던 폴더가 있으면 그것을 계속 쓴다.
     새 폴더를 만들어 버리면 그동안 뽑아둔 기록이 통째로 사라진 것처럼 보인다. */
  const old = path.join(os.homedir(), "Documents", "Refcut");
  if (!fs.existsSync(now) && fs.existsSync(old)) return old;
  return now;
}
const dataDir = () => {
  const d = path.join(rootDir(), "_기록");
  fs.mkdirSync(d, { recursive: true });
  return d;
};
ipcMain.handle("getRoot", () => rootDir());
ipcMain.handle("setRoot", (_e, dir) => {
  const old = rootDir();
  const s = readSettings(); s.outDir = dir; writeSettings(s);
  /* 폴더를 바꾸면 기록도 함께 옮긴다 (따로 놀지 않게) */
  try {
    const from = path.join(old, "_기록"), to = path.join(dir, "_기록");
    if (fs.existsSync(from) && path.resolve(from) !== path.resolve(to)) {
      fs.mkdirSync(to, { recursive: true });
      for (const f of fs.readdirSync(from)) {
        if (!f.endsWith(".json")) continue;
        fs.copyFileSync(path.join(from, f), path.join(to, f));
      }
    }
  } catch (e) {}
  return { ok: true, dir };
});
ipcMain.handle("jobList", () => {
  try {
    return fs.readdirSync(dataDir())
      .filter((f) => f.endsWith(".json"))
      .map((f) => {
        try { return JSON.parse(fs.readFileSync(path.join(dataDir(), f), "utf8")); }
        catch (e) { return null; }
      })
      .filter(Boolean);
  } catch (e) { return []; }
});
ipcMain.handle("jobSave", (_e, job) => {
  fs.writeFileSync(path.join(dataDir(), job.id + ".json"), JSON.stringify(job, null, 2), "utf8");
  return { ok: true };
});
ipcMain.handle("jobDelete", (_e, id) => {
  const f = path.join(dataDir(), id + ".json");
  if (fs.existsSync(f)) fs.unlinkSync(f);
  return { ok: true };
});
/* 렌더러가 디스크의 파일을 직접 읽고 쓸 수 있게 해준다.
   (미리보기 저장, 원본 PNG 다시 읽기) */
ipcMain.handle("readFile", (_e, p) => {
  try { return fs.readFileSync(p); } catch (e) { throw new Error("파일을 읽지 못했습니다: " + p); }
});
ipcMain.handle("writeFile", (_e, { path: p, data }) => {
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, Buffer.from(data));
    return { ok: true };
  } catch (e) { return { ok: false, error: String(e) }; }
});

/* 그림을 윈도우 클립보드에 직접 넣는다.
   화면 쪽(navigator.clipboard)이 막히거나 실패해도 여기로 돌아오면 복사가 된다. */
ipcMain.handle("copyImage", (_e, data) => {
  try {
    const img = nativeImage.createFromBuffer(Buffer.from(data));
    if (img.isEmpty()) return { ok: false, error: "빈 그림" };
    clipboard.writeImage(img);
    return { ok: true };
  } catch (e) { return { ok: false, error: String(e) }; }
});

ipcMain.handle("dirSize", (_e, p) => {
  let n = 0;
  const walk = (d) => {
    let list = [];
    try { list = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
    for (const it of list) {
      const q = path.join(d, it.name);
      if (it.isDirectory()) walk(q);
      else { try { n += fs.statSync(q).size; } catch (e) {} }
    }
  };
  walk(p);
  return n;
});
