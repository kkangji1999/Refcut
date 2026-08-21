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
/* ffmpeg 가 남긴 글에서 '왜 못 읽었는지' 한 줄을 골라낸다.
   그냥 "읽지 못했습니다" 만 띄우면 사용자가 다음에 무엇을 할지 알 수 없다. */
function readErr(txt, err) {
  const t = String(txt || "");
  if (/ENOENT|not recognized|찾을 수 없습니다/i.test(String((err && err.message) || "")))
    return "ffmpeg 를 찾지 못했습니다";
  const m = t.match(/^.*(Invalid data found|No such file|Permission denied|moov atom not found|Unknown format|Decoder .* not found|does not contain any stream)[^\n]*/mi);
  if (m) return m[0].trim().slice(0, 160);
  const last = t.trim().split("\n").filter(Boolean).pop();
  return (last || "영상 정보를 읽지 못했습니다").slice(0, 160);
}

/* ffprobe 가 없을 때의 대체 경로.
   ffmpeg 는 출력 파일을 안 주면 오류로 끝나지만, 그 전에 영상 정보를
   먼저 찍어준다. 그 글을 읽어 길이·크기·초당 장수를 뽑아낸다. */
function probeViaFfmpeg(filePath) {
  return new Promise((resolve) => {
    execFile(ffmpegPath(), ["-hide_banner", "-i", filePath],
      { maxBuffer: 1 << 22, windowsHide: true, timeout: 30000 }, (err, stdout, stderr) => {
        const txt = String(stderr || "") + String(stdout || "");
        const dm = txt.match(/Duration:\s*(\d+):(\d\d):(\d\d(?:\.\d+)?)/);
        /* ★ MPEG-TS 계열은 첫 장의 시각이 0 이 아니라 1.4초쯤에서 시작한다.
           이 값을 알아야 프레임을 어떻게 뽑을지 정할 수 있다 (grabPNGs 참고). */
        const sm = txt.match(/Duration:[^\n]*?start:\s*(-?[\d.]+)/);
        const vm = txt.match(/Stream #\d+:\d+[^\n]*?:\s*Video:\s*([^\s,(]+)([^\n]*)/);
        const rest = vm ? vm[2] : "";
        const rm = rest.match(/[,\s](\d{2,5})x(\d{2,5})/);
        const fm = rest.match(/,\s*([\d.]+)\s*fps/);
        if (!dm && !vm)
          return resolve({ ok: false, error: readErr(txt, err) });
        let size = 0;
        try { size = fs.statSync(filePath).size; } catch (e) {}
        resolve({
          ok: true,
          hasVideo: !!vm,               /* 화면이 들어 있는가 (소리뿐인 파일 가려내기) */
          start: sm ? parseFloat(sm[1]) : 0,
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
      "-show_entries", "stream_disposition=attached_pic",
      "-show_entries", "format=duration,size",
      "-of", "json", filePath,
    ], { maxBuffer: 1 << 22, timeout: 30000 }, (err, stdout) => {
      if (err) return resolve({ ok: false, error: String(err.message || err) });
      try {
        const j = JSON.parse(stdout);
        const s = (j.streams && j.streams[0]) || {};
        const [n, d] = String(s.r_frame_rate || "24/1").split("/").map(Number);
        resolve({
          ok: true,
          /* 앨범 표지 한 장(attached_pic)은 '영상'이 아니다 — 소리 파일이다 */
          hasVideo: !!(s.width && s.height &&
                       !((s.disposition || {}).attached_pic)),
          width: s.width, height: s.height,
          codec: s.codec_name,
          fps: snapFps(d ? n / d : 24),
          duration: parseFloat((j.format || {}).duration || 0),
          size: parseInt((j.format || {}).size || 0, 10),
        });
      } catch (e) { resolve({ ok: false, error: String(e) }); }
    });
  });
  if (byProbe.ok && byProbe.hasVideo) return byProbe;
  /* ffprobe 가 없거나 실패하면 ffmpeg 가 읽는다.
     ★ ffprobe 가 '화면이 없다' 고 했을 때도 한 번 더 물어본다 —
       MXF·MPEG-TS 처럼 스트림을 늦게 찾는 그릇은 ffprobe 가 놓치는 일이 있다.
       ffmpeg 도 못 찾으면 그때야 소리뿐인 파일로 본다. */
  const byFf = await probeViaFfmpeg(filePath);
  if (byFf.ok && byFf.hasVideo) return byFf;
  return byProbe.ok ? byProbe : byFf;
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

/* 한 장이 제대로 나왔는지 (빈 파일이 아닌지) 본다 */
function madeOk(f) {
  try { return fs.existsSync(f) && fs.statSync(f).size > 0; } catch (e) { return false; }
}

/* 빠른 길: 시각마다 -ss 를 입력 앞에 두어 키프레임 단위로 건너뛴 뒤 정확히 맞춘다.
   긴 영상에서 가장 빠르다 — mp4·mov·mkv·avi 는 이 길로 간다. */
function grabBySeek(filePath, times, out) {
  return (async () => {
    for (let i = 0; i < times.length; i++) {
      await new Promise((res) => {
        const ff = spawn(ffmpegPath(), [
          "-v", "error",
          "-ss", String(times[i]),
          "-i", filePath,
          "-frames:v", "1",
          "-y", out[i],
        ], { windowsHide: true });
        ff.on("close", () => res());
        ff.on("error", () => res());
      });
    }
  })();
}

/* 한 번에 훑는 길.
   ★ MPEG-TS 계열(.ts·.m2ts·.mts)은 첫 장의 시각이 0 이 아니라 1.4초쯤에서
     시작한다. 그런 그릇에서 -ss 를 입력 앞에 두면 ffmpeg 가 엉뚱한 자리로
     건너뛴다 — 다른 장면이 나오거나, 뒤쪽 시각은 아예 한 장도 안 나온다.
     (한 장도 안 나오면 예전에는 샷리스트를 만들다 영영 멈춰 있었다)
   그래서 그런 그릇은 처음부터 한 번 훑으면서 원하는 시각의 장만 골라낸다.
   훑기는 한 번뿐이므로 컷이 많을수록 오히려 이쪽이 빠르다. */
function grabByScan(filePath, times, out, fps) {
  return new Promise((resolve) => {
    const w = 0.9 / (fps > 1 && isFinite(fps) ? fps : 24);   // 한 장 만큼의 창
    const tmp = path.join(os.tmpdir(),
      "reftown_cut_" + Date.now() + Math.random().toString(36).slice(2, 7));
    fs.mkdirSync(tmp, { recursive: true });
    /* 필터 안에서는 쉼표가 칸막이라, 글자로 쓰려면 앞에 역슬래시를 붙여야 한다.
       역슬래시는 글 속에서 한 겹씩 벗겨지기 쉬워 문자표(92)로 직접 만든다. */
    const 쉼표 = String.fromCharCode(92) + ",";
    const expr = times.map((t) =>
      "between(t" + 쉼표 + (+t).toFixed(6) + 쉼표 + (+t + w).toFixed(6) + ")"
    ).join("+");
    const ff = spawn(ffmpegPath(), [
      "-v", "error", "-i", filePath,
      "-map", "0:v:0",
      "-vf", "select=" + expr,
      "-vsync", "0", "-y", path.join(tmp, "%d.png"),
    ], { windowsHide: true });
    const done = () => {
      /* ★ 뽑힌 개수가 요청한 개수와 같을 때만 자리를 맞춘다.
         하나라도 더 뽑혔으면 그 뒤가 통째로 한 칸씩 밀려 엉뚱한 장이 된다 —
         그럴 때는 아무것도 옮기지 않고, 부르는 쪽이 느리지만 확실한 길로 간다. */
      let 개수 = 0;
      try { 개수 = fs.readdirSync(tmp).length; } catch (e) {}
      if (개수 === times.length) {
        for (let i = 0; i < times.length; i++) {
          const from = path.join(tmp, (i + 1) + ".png");
          try { if (madeOk(from)) { fs.rmSync(out[i], { force: true }); fs.renameSync(from, out[i]); } }
          catch (e) {}
        }
      }
      try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
      resolve();
    };
    ff.on("close", done);
    ff.on("error", done);
  });
}

/* 느리지만 언제나 맞는 길: -ss 를 입력 뒤에 두면 처음부터 풀어가며 정확히 맞춘다.
   앞의 두 길이 모두 실패한 자리에만 쓴다 (한 장마다 처음부터 풀므로 느리다). */
function grabByDecode(filePath, times, out) {
  return (async () => {
    for (let i = 0; i < times.length; i++) {
      await new Promise((res) => {
        const ff = spawn(ffmpegPath(), [
          "-v", "error", "-i", filePath,
          "-ss", String(times[i]), "-frames:v", "1", "-y", out[i],
        ], { windowsHide: true });
        ff.on("close", () => res());
        ff.on("error", () => res());
      });
    }
  })();
}

/* 지정한 시각들의 원본 해상도 프레임을 PNG 로 저장한다. */
ipcMain.handle("grabPNGs", async (_e, { filePath, times, outDir, prefix }) => {
  fs.mkdirSync(outDir, { recursive: true });
  const out = times.map((_, i) => path.join(outDir, `${prefix}_CUT${i + 1}.png`));
  for (const f of out) { try { fs.rmSync(f, { force: true }); } catch (e) {} }

  const info = await probeViaFfmpeg(filePath);
  const fps = (info && info.fps) || 24;
  const 늦게시작 = !!(info && Math.abs(info.start || 0) > 0.001);

  if (늦게시작) await grabByScan(filePath, times, out, fps);
  else await grabBySeek(filePath, times, out);

  /* 빠진 자리가 있으면 다음 길로 넘어간다.
     ★ 늦게 시작하는 그릇에서 앞쪽 -ss 로 되돌아가면 '다른 장' 이 나온다.
       없는 것보다 나쁘므로, 그쪽은 느리지만 확실한 길로만 다시 시도한다. */
  const 빠진자리 = () => out.map((f, i) => (madeOk(f) ? -1 : i)).filter((i) => i >= 0);
  let missing = 빠진자리();
  if (missing.length && !늦게시작) {
    await grabByScan(filePath, missing.map((i) => times[i]),
                     missing.map((i) => out[i]), fps);
    missing = 빠진자리();
  }
  if (missing.length) {
    await grabByDecode(filePath, missing.map((i) => times[i]),
                       missing.map((i) => out[i]));
    missing = 빠진자리();
  }
  /* 끝내 못 뽑은 자리는 숨기지 않고 알려준다 — 화면 쪽이 그 컷을 건너뛴다 */
  return { ok: missing.length < out.length, files: out, missing };
});

/* 취소 */
const CANCEL = new Map();
ipcMain.handle("cancelScan", (_e, jobId) => {
  const fn = CANCEL.get(jobId);
  if (fn) fn();
  return { ok: true };
});

/* =========================================================================
   미리보기용 사본 만들기
   -------------------------------------------------------------------------
   ★ 추출은 ffmpeg 가 하므로 ProRes·DNxHD·AVI·WMV·MPEG-TS 도 문제없이 된다.
     그런데 결과 화면의 재생기는 크롬이 돌린다. 크롬은 저런 형식을 열지 못해서,
     추출은 멀쩡히 끝났는데 재생 칸만 까맣게 죽어 있었다 — 안내도 없었다.
   그래서 크롬이 못 여는 영상일 때만, 결과 폴더에 작은 mp4 사본을 하나 만든다.
   한 번 만들어두면 다음부터는 그대로 다시 쓴다 (원본은 건드리지 않는다).
   ========================================================================= */
const PREVIEW = new Map();
ipcMain.handle("makePreview", async (e, { src, dest, jobId }) => {
  const info = await probeViaFfmpeg(src);
  const iw = (info && info.width) || 0;
  const 길이 = (info && info.duration) || 0;
  /* ★ 화질을 어디까지 지킬 것인가.
     처음에는 1280 · crf28 로 만들었다. 그런데 4K 마스터를 올려놓고 보면
     "원본 화질이 아닌 느낌" 이 그대로 드러난다 — 이 칸으로 레퍼런스를
     들여다보는 사람에게는 그것이 곧 화질이다.
     재어 보니 4K 를 그대로 만들어도 걸리는 시간이 같았다. 오래 걸리는 쪽은
     인코딩이 아니라 '원본을 읽어 오는 것' 이기 때문이다 (1.3GB 를 네트워크
     드라이브에서 읽는 데 12초, 4K 로 만들든 720p 로 만들든 12초).
     그래서 줄이지 않는다 — 원본 해상도 그대로 만든다.
     아주 긴 영상만 파일이 지나치게 커지지 않게 1920 으로 낮춘다. */
  const 긴영상 = 길이 > 600;                      // 10분이 넘으면
  const W = (긴영상 && iw > 1920) ? (1920 & ~1) : 0;   // 0 = 줄이지 않는다
  const 목표폭 = W || iw;
  /* 이미 만들어 둔 사본이 있어도, 그때보다 지금 기준이 높아졌으면 다시 만든다.
     ★ 예전에는 '파일이 있으면 무조건 다시 쓴다' 였다. 그래서 화질 기준을
       올려도 옛날에 만든 흐린 사본이 계속 나왔다 — 고친 것이 안 고쳐진 것처럼
       보이던 원인이다. */
  try {
    if (fs.existsSync(dest) && fs.statSync(dest).size > 4096) {
      const 옛것 = await probeViaFfmpeg(dest);
      if (옛것 && 옛것.ok && 옛것.width && (!목표폭 || 옛것.width >= 목표폭 - 2))
        return { ok: true, path: dest, reused: true };
    }
  } catch (x) {}
  return new Promise((resolve) => {
    try { fs.mkdirSync(path.dirname(dest), { recursive: true }); } catch (x) {}
    const tmp = dest + ".만드는중";
    const ff = spawn(ffmpegPath(), [
      "-v", "info", "-hide_banner", "-y",
      "-i", src,
      "-map", "0:v:0", "-map", "0:a:0?",       // 소리는 있으면 넣는다
      /* W 가 0 이면 줄이지 않는다 (원본 해상도 그대로) */
      ...(W ? ["-vf", "scale=" + W + ":-2"] : []),
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
      /* 되감기를 자주 하는 칸이라 열쇠장(키프레임)을 촘촘히 둔다 */
      "-g", "48",
      "-pix_fmt", "yuv420p", "-movflags", "+faststart",
      "-c:a", "aac", "-b:a", "128k",
      "-f", "mp4", tmp,
    ], { windowsHide: true });

    let dur = 0, err = "", killed = false;
    PREVIEW.set(jobId, () => { killed = true; try { ff.kill("SIGKILL"); } catch (x) {} });
    ff.stderr.on("data", (d) => {
      const t = d.toString();
      if (!dur) {
        const m = t.match(/Duration:\s*(\d+):(\d\d):(\d\d(?:\.\d+)?)/);
        if (m) dur = (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]);
      }
      const ts = t.match(/time=(\d+):(\d\d):(\d\d(?:\.\d+)?)/g);
      if (ts && dur > 0) {
        const l = ts[ts.length - 1].match(/time=(\d+):(\d\d):(\d\d(?:\.\d+)?)/);
        const at = (+l[1]) * 3600 + (+l[2]) * 60 + parseFloat(l[3]);
        e.sender.send("prevProgress",
          { jobId, percent: Math.max(0, Math.min(100, at / dur * 100)) });
      }
      if (err.length < 4000) err += t;
    });
    ff.on("error", (x) => {
      PREVIEW.delete(jobId);
      resolve({ ok: false, error: "ffmpeg 를 실행하지 못했습니다: " + x.message });
    });
    ff.on("close", (code) => {
      PREVIEW.delete(jobId);
      if (killed || code !== 0) {
        try { fs.unlinkSync(tmp); } catch (x) {}
        return resolve(killed ? { ok: false, aborted: true }
                              : { ok: false, error: readErr(err, null) });
      }
      /* 다 만든 뒤에야 제 이름을 붙인다 — 중간에 끊긴 반쪽짜리를 다음에 쓰면 안 된다 */
      try { fs.rmSync(dest, { force: true }); fs.renameSync(tmp, dest); }
      catch (x) { return resolve({ ok: false, error: String(x.message || x) }); }
      resolve({ ok: true, path: dest });
    });
  });
});
ipcMain.handle("cancelPreview", (_e, jobId) => {
  const fn = PREVIEW.get(jobId);
  if (fn) fn();
  return { ok: true };
});

/* =========================================================================
   파일 자리 맞추기
   -------------------------------------------------------------------------
   컷을 손으로 정리하면(병합·분할·교체) 저장 폴더의 CUT 번호가 목록과 어긋난다.
   그림을 다시 뽑아 쓰면 확실하지만, 컷이 많은 작업에서는 그때마다 몇 십 초가
   걸린다 — 그림 내용은 그대로이고 '번호'만 밀린 것이 대부분이기 때문이다.
   그래서 화면 쪽이 "무엇을 무엇으로" 만 정해서 보내고, 여기서는 이름만 바꾼다.
   ★ 서로 자리를 맞바꾸는 경우가 있으므로 반드시 두 걸음으로 옮긴다.
     한 번에 옮기면 아직 옮기지 않은 파일을 덮어써 버린다.
   ========================================================================= */
ipcMain.handle("arrangeFiles", (_e, { moves, remove, copy }) => {
  const 옮김 = [], 없음 = [];
  const 목록 = (moves || []).filter((m) => m && m.from && m.to && m.from !== m.to);
  try {
    for (const m of 목록) {
      if (!fs.existsSync(m.from)) { 없음.push(m.from); continue; }
      m.tmp = m.to + ".자리옮기는중";
      try { fs.mkdirSync(path.dirname(m.to), { recursive: true }); } catch (x) {}
      fs.renameSync(m.from, m.tmp);
      옮김.push(m);
    }
    for (const m of 옮김) {
      try { fs.rmSync(m.to, { force: true }); } catch (x) {}
      fs.renameSync(m.tmp, m.to);
    }
  } catch (e) {
    /* 도중에 멈췄으면 임시 이름으로 남은 것을 되돌려 놓는다 — 반쪽으로 두지 않는다 */
    for (const m of 옮김) {
      try { if (fs.existsSync(m.tmp)) fs.renameSync(m.tmp, m.from); } catch (x) {}
    }
    return { ok: false, error: String(e.message || e) };
  }
  /* 복사 — 즐겨찾기처럼 '원래 자리는 그대로 두고 사본을 따로 두는' 경우에 쓴다 */
  let 베낌 = 0;
  for (const c of (copy || [])) {
    try {
      if (!c || !c.from || !c.to || !fs.existsSync(c.from)) { 없음.push(c && c.from); continue; }
      fs.mkdirSync(path.dirname(c.to), { recursive: true });
      fs.copyFileSync(c.from, c.to);
      베낌++;
    } catch (x) {}
  }
  let 지움 = 0;
  for (const p of (remove || [])) {
    try { if (p && fs.existsSync(p) && fs.statSync(p).isFile()) { fs.rmSync(p, { force: true }); 지움++; } }
    catch (x) {}
  }
  return { ok: true, moved: 옮김.length, copied: 베낌, removed: 지움, missing: 없음 };
});

/* =========================================================================
   구간을 영상으로 잘라내기
   -------------------------------------------------------------------------
   프레임을 연속으로 뽑는 길은 이미 있지만, 소리가 없고 파일이 수백 장이 된다.
   레퍼런스로 "이 구간" 을 통째로 남기고 싶을 때가 있어서 영상으로도 뽑는다.
     · 그대로   — 다시 만들지 않고 잘라내기만 한다. 화질·소리 100% 원본.
                  다만 잘리는 자리가 열쇠장(키프레임)까지 밀릴 수 있다.
     · 정확히   — 딱 그 구간으로 다시 만든다. 해상도는 원본 그대로 두고
                  화질을 아주 높게(crf 16) 잡아 눈으로는 차이가 없게 한다.
   ========================================================================= */
const CLIP = new Map();

/* 원본이 '편집용 그릇' 인지 본다.
   ProRes·DNxHD 처럼 편집실에서 쓰는 것, 10bit·4:2:2·4:4:4 처럼 색을 넉넉히 담은 것은
   H.264(8bit 4:2:0)로 옮기면 색이 깎인다. 그런 원본만 ProRes 로 뽑는다.
   그 밖의 보통 영상(대개 8bit 4:2:0 H.264)은 H.264 로 뽑는 것이 원본과 같은 자리다. */
function 편집용원본(codec, pix) {
  if (/prores|dnxhd|dnxhr|cfhd|v210|v410|ffv1|huffyuv|utvideo|rawvideo|qtrle/i.test(codec || "")) return true;
  if (/p10|p12|p14|p16|422|444/i.test(pix || "")) return true;
  return false;
}
function 영상속내용(file) {
  return new Promise((resolve) => {
    execFile(ffprobePath(), [
      "-v", "error", "-select_streams", "v:0",
      "-show_entries", "stream=codec_name,pix_fmt", "-of", "json", file,
    ], { maxBuffer: 1 << 20, timeout: 20000 }, (err, stdout) => {
      if (err) return resolve({});
      try {
        const s = (JSON.parse(stdout).streams || [])[0] || {};
        resolve({ codec: s.codec_name, pix: s.pix_fmt });
      } catch (e) { resolve({}); }
    });
  });
}

/* =========================================================================
   구간을 영상으로 뽑기
   -------------------------------------------------------------------------
   ★ 왜 '다시 만들기' 인가.
     자르기만 하고 다시 만들지 않으면(-c copy) 훨씬 빠르지만, 시작 자리가
     반드시 열쇠장(키프레임)이어야 한다. 영상은 대부분의 장을 '앞 장과 무엇이
     다른가' 로만 적어 두기 때문에, 열쇠장이 아닌 자리에서는 그림을 세울 수가 없다.
     그래서 인점보다 앞선 열쇠장까지 되돌아가 시작한다 — 열쇠장 간격이 2초면
     앞이 최대 2초 더 붙는다. 잡은 구간과 다른 영상이 나오는 셈이다.
   그래서 여기서는 언제나 딱 그 구간으로 다시 만든다.
   해상도·초당 장수는 손대지 않고(원본 그대로), 화질만 아주 높게 잡는다.
   ========================================================================= */
ipcMain.handle("clipRange", async (e, { src, destNoExt, start, dur, jobId }) => {
  if (!(dur > 0)) return { ok: false, error: "구간이 너무 짧습니다" };
  const 속 = await 영상속내용(src);
  const 편집용 = 편집용원본(속.codec, 속.pix);

  const 계획 = 편집용
    ? [{ 이름: "prores", ext: ".mov",
         args: ["-c:v", "prores_ks", "-profile:v", "3", "-vendor", "apl0",
                "-pix_fmt", "yuv422p10le", "-c:a", "pcm_s16le"] },
       /* ProRes 로 못 만들면 H.264 로라도 남긴다 — 빈손으로 끝내지 않는다 */
       { 이름: "h264", ext: ".mp4",
         args: ["-c:v", "libx264", "-preset", "fast", "-crf", "15",
                "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "256k",
                "-movflags", "+faststart"] }]
    : [{ 이름: "h264", ext: ".mp4",
         args: ["-c:v", "libx264", "-preset", "fast", "-crf", "15",
                "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "256k",
                "-movflags", "+faststart"] }];

  let 마지막오류 = "만들지 못했습니다";
  for (const p of 계획) {
    const dest = 빈자리(destNoExt + p.ext);
    const tmp = dest.slice(0, dest.length - p.ext.length) + ".만드는중" + p.ext;
    const r = await new Promise((resolve) => {
      const ff = spawn(ffmpegPath(), [
        "-v", "info", "-hide_banner", "-y",
        "-ss", String(start), "-i", src, "-t", String(dur),
        "-map", "0:v:0", "-map", "0:a?",
        ...p.args, tmp,
      ], { windowsHide: true });
      let err = "", killed = false;
      CLIP.set(jobId, () => { killed = true; try { ff.kill("SIGKILL"); } catch (x) {} });
      ff.stderr.on("data", (d) => {
        const t = d.toString();
        const ts = t.match(/time=(\d+):(\d\d):(\d\d(?:\.\d+)?)/g);
        if (ts) {
          const l = ts[ts.length - 1].match(/time=(\d+):(\d\d):(\d\d(?:\.\d+)?)/);
          const at = (+l[1]) * 3600 + (+l[2]) * 60 + parseFloat(l[3]);
          e.sender.send("clipProgress",
            { jobId, percent: Math.max(0, Math.min(100, at / dur * 100)) });
        }
        if (err.length < 4000) err += t;
      });
      ff.on("error", (x) => {
        CLIP.delete(jobId);
        resolve({ ok: false, error: "ffmpeg 를 실행하지 못했습니다: " + x.message });
      });
      ff.on("close", (code) => {
        CLIP.delete(jobId);
        if (killed) { try { fs.rmSync(tmp, { force: true }); } catch (x) {}
                      return resolve({ ok: false, aborted: true }); }
        if (code !== 0) { try { fs.rmSync(tmp, { force: true }); } catch (x) {}
                          return resolve({ ok: false, error: readErr(err, null) }); }
        try { fs.rmSync(dest, { force: true }); fs.renameSync(tmp, dest); }
        catch (x) { return resolve({ ok: false, error: String(x.message || x) }); }
        let size = 0;
        try { size = fs.statSync(dest).size; } catch (x) {}
        resolve({ ok: true, path: dest, size, kind: p.이름,
                  codec: 속.codec || "", pix: 속.pix || "" });
      });
    });
    if (r.ok || r.aborted) return r;
    마지막오류 = r.error || 마지막오류;
  }
  return { ok: false, error: 마지막오류 };
});
ipcMain.handle("clipCancel", (_e, jobId) => {
  const fn = CLIP.get(jobId);
  if (fn) fn();
  return { ok: true };
});

/* =========================================================================
   영상 속내용 자세히 읽기 (Tab 정보창용)
   -------------------------------------------------------------------------
   probe 는 추출에 꼭 필요한 것만 빠르게 읽는다. 여기서는 그 위에
   코덱·프로파일·색 형식·소리까지 더 읽는다 — 정보창을 열 때만 부른다.
   ========================================================================= */
ipcMain.handle("probeFull", async (_e, filePath) => {
  const 한줄 = (args) => new Promise((resolve) => {
    execFile(ffprobePath(), args, { maxBuffer: 1 << 22, timeout: 30000 },
      (err, stdout) => {
        if (err) return resolve(null);
        try { return resolve(JSON.parse(stdout)); } catch (e) { resolve(null); }
      });
  });
  const v = await 한줄([
    "-v", "error", "-select_streams", "v:0",
    "-show_entries",
    "stream=codec_name,codec_long_name,profile,level,pix_fmt,bits_per_raw_sample," +
    "width,height,r_frame_rate,nb_frames,bit_rate,color_primaries,color_transfer,field_order",
    "-show_entries", "format=format_name,format_long_name,duration,size,bit_rate",
    "-of", "json", filePath,
  ]);
  const a = await 한줄([
    "-v", "error", "-select_streams", "a:0",
    "-show_entries", "stream=codec_name,channels,sample_rate,bit_rate,bits_per_raw_sample",
    "-of", "json", filePath,
  ]);
  if (!v) {
    /* ffprobe 가 없으면 ffmpeg 가 읽은 것이라도 돌려준다 */
    const f = await probeViaFfmpeg(filePath);
    return f && f.ok ? { ok: true, video: { codec_name: f.codec, width: f.width,
      height: f.height }, format: { duration: f.duration, size: f.size }, audio: null } : { ok: false };
  }
  return {
    ok: true,
    video: (v.streams && v.streams[0]) || null,
    format: v.format || null,
    audio: (a && a.streams && a.streams[0]) || null,
  };
});


/* =========================================================================
   파일 · 폴더
   ========================================================================= */
/* 파일 고르기 창에 늘어놓을 영상 그릇들.
   ★ 예전에는 여섯 가지뿐이어서 mov 외의 것들은 창에 보이지도 않았다. */
const VIDEO_EXT = ["mp4", "mov", "m4v", "mkv", "avi", "webm", "wmv", "asf",
  "flv", "f4v", "mpg", "mpeg", "mpe", "m2v", "ts", "m2ts", "mts", "m2t",
  "mxf", "3gp", "3g2", "ogv", "vob", "dv", "divx", "qt", "rm", "rmvb", "y4m"];

ipcMain.handle("pickVideos", async () => {
  const r = await dialog.showOpenDialog(win, {
    title: "영상 고르기",
    properties: ["openFile", "multiSelections"],
    filters: [
      { name: "영상", extensions: VIDEO_EXT },
      /* ★ 목록에 없는 그릇도 ffmpeg 는 대개 읽는다.
         고르지도 못하게 막아두면 확인할 길이 없으므로 모든 파일도 열어둔다.
         영상이 아니면 넣는 순간 이유를 알려준다. */
      { name: "모든 파일", extensions: ["*"] },
    ],
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
   ★ 예전에는 yt-dlp 를 설치 파일에 넣지 않고 '처음 쓸 때 앱이 내려받아' 썼다.
     설치 파일이 작아지고 언제 설치하든 최신본을 받는다는 이점이 있었지만,
     백신(V3·알약·디펜더) 눈에는 그것이
     "정체 모를 프로그램이 인터넷에서 exe 를 받아 몰래 실행한다" 로 보였다.
     그래서 받자마자 조용히 지워지고, 사용자에게는 이유 없이
     '링크로 받기가 안 된다' 로만 보였다 — 앱은 지워진 것을 계속 다시 받았다.

   이제는 설치 파일에 처음부터 담아(scripts/fetch-bin.js) 개인 폴더로 옮겨 심는다.
   · 받아서 실행하는 행동 자체가 없으니 백신이 의심할 거리가 줄었다
   · 처음 링크를 넣을 때 기다리지 않는다 (인터넷도 필요 없다)
   · 개인 폴더에 두는 것은 설치 폴더에는 -U 가 쓸 권한이 없기 때문이다
   유튜브는 구조를 수시로 바꾸므로 하루 한 번 스스로 갱신한다.
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

/* =========================================================================
   백신이 도구를 지웠는지 알아내기
   -------------------------------------------------------------------------
   yt-dlp 는 파이썬을 exe 로 묶은 프로그램이라 백신(V3·알약·디펜더)이
   실제 위험이 아닌데도 의심해 조용히 격리·삭제하는 일이 잦다.
   그때 사용자에게 보이는 것은 "링크로 받기가 안 된다" 뿐이고,
   앱은 없어진 파일을 다시 받고 → 백신이 또 지우고 를 되풀이한다.

   그래서 '파일이 사라졌다' 는 신호를 붙잡아 그 자리에서 이유를 말해준다.
   오류 글에 이 표시를 달아두면 어디를 거쳐 올라오든 알아볼 수 있다.
   ========================================================================= */
const 백신표시 = "[백신차단]";
const 백신오류인가 = (m) => String(m || "").includes(백신표시);
const 백신오류 = (무엇) => new Error(백신표시 + " " + 무엇);

const YT_최소 = 1000000;          // 이보다 작으면 온전한 yt-dlp 가 아니다 (17 MB 짜리다)

function 파일크기(p) {
  try { return fs.existsSync(p) ? fs.statSync(p).size : 0; } catch (e) { return 0; }
}

/* 도구가 제자리에 멀쩡히 있는가. 없거나 반쪽이면 백신이 손댄 것이다.
   (격리는 파일을 지우거나 0 바이트로 만든다)
   ★ 반쪽짜리는 여기서 치운다. 그대로 두면 다음에도 그것을 쓰려 들지만,
     치워두면 백신 예외를 잡은 뒤 다시 누르기만 해도 저절로 되살아난다. */
function 도구확인(exe, 최소, 이름) {
  if (파일크기(exe) >= 최소) return exe;
  try { fs.rmSync(exe, { force: true }); } catch (e) {}
  throw 백신오류(이름 + "가 준비되자마자 사라졌습니다");
}

/* 실행 자체가 안 될 때 — 파일이 없어졌거나 잠겼으면 백신 짓이다.
   (백신은 실행하려는 순간에 낚아채 지우거나, 0 바이트로 만들어 놓는다) */
function 실행실패(exe, e) {
  if (파일크기(exe) < YT_최소) {
    try { fs.rmSync(exe, { force: true }); } catch (x) {}
    return 백신오류("영상 받기 도구가 사라졌습니다");
  }
  const c = e && e.code;
  if (c === "EACCES" || c === "EPERM")
    return 백신오류("영상 받기 도구를 실행하지 못했습니다");
  return e;
}

/* 설치 파일에 함께 넣어둔 원본을 개인 폴더로 옮겨 심는다.
   ★ 왜 옮겨 심는가 — yt-dlp 는 스스로를 갈아끼우며 최신을 유지하는데(-U),
     설치 폴더(Program Files)에는 쓸 권한이 없어 그 자리에서는 못 한다. */
function 동봉본심기(name, dest) {
  const src = bundledBin(name);
  if (!src) return false;
  try {
    fs.copyFileSync(src, dest);
    try { fs.chmodSync(dest, 0o755); } catch (e) {}
    return fs.existsSync(dest);
  } catch (e) { return false; }
}

async function ensureYtdlp(send) {
  const exe = YTEXE();
  if (!fs.existsSync(exe)) {
    /* ① 설치 파일에 들어 있으면 그것을 쓴다 — 인터넷도, 기다림도 없다.
       백신이 '인터넷에서 exe 를 받아 실행한다' 고 오해할 일도 사라진다. */
    if (동봉본심기("yt-dlp", exe)) {
      도구확인(exe, YT_최소, "영상 받기 도구");
      /* 동봉본은 설치 파일을 만들던 날의 것이다. 유튜브는 구조를 자주 바꾸므로
         바로 아래 '하루 한 번 갱신' 으로 넘겨 최신으로 맞춘다. */
      writeSettings({ ...readSettings(), ytUpdated: 0 });
      if (send) send({ stage: "setup", text: "영상 받기 도구를 최신으로 맞추는 중... (처음 한 번만)" });
    } else {
      /* ② 동봉본이 없거나 백신이 설치 폴더에서 지웠다면 예전처럼 받아온다 */
      if (send) send({ stage: "setup", text: "영상 받기 도구를 준비하는 중... (처음 한 번만)" });
      let res;
      try { res = await net.fetch(YT_RELEASE); }
      catch (e) {
        throw new Error("영상 받기 도구를 내려받지 못했습니다.\n"
          + "인터넷 연결이나 백신·방화벽이 막고 있는지 확인해 주세요.");
      }
      if (!res.ok) throw new Error("영상 받기 도구를 내려받지 못했습니다 (" + res.status + ")");
      const buf = Buffer.from(await res.arrayBuffer());
      const tmp = exe + ".part";              // 받다 말면 반쪽짜리가 남지 않게
      fs.writeFileSync(tmp, buf);
      try { fs.chmodSync(tmp, 0o755); } catch (e) {}
      try { fs.renameSync(tmp, exe); } catch (e) { throw 백신오류("영상 받기 도구를 저장하지 못했습니다"); }
      도구확인(exe, YT_최소, "영상 받기 도구");
      writeSettings({ ...readSettings(), ytUpdated: Date.now() });
      return exe;
    }
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
  /* ★ 쓰기 직전에 늘 확인한다.
     백신은 처음 받을 때가 아니라 한참 뒤에 검사하다 지우기도 한다.
     한 번만 확인하고 넘어가면 그때부터는 이유 없는 실패가 된다. */
  return 도구확인(exe, YT_최소, "영상 받기 도구");
}

/* =========================================================================
   자바스크립트 실행기 (quickjs) — 유튜브 때문에 필요하다
   -------------------------------------------------------------------------
   유튜브는 진짜 영상 주소를 자바스크립트로 뒤섞어 내려준다.
   yt-dlp 는 그 뒤섞임을 풀 자바스크립트 실행기가 있어야 원래 주소를 얻는다.
   실행기가 없으면 목록까지는 멀쩡히 보이는데, 막상 받을 때 403(접근 거부)으로
   중간에 끊긴다 — "유튜브 주소만 추출에 실패한다" 던 것이 바로 이것이다.
   (만든 사람 컴퓨터에는 개발용 node 가 깔려 있어 이 구멍이 잘 보이지 않았다)
   그래서 2 MB 짜리 작은 실행기 하나를 처음 한 번만 받아 yt-dlp 옆에 둔다.
   ========================================================================= */
const isYoutube = (u) => /youtube[.]com|youtu[.]be/i.test(String(u || ""));
function qjsAsset() {
  const a = process.arch;
  if (process.platform === "win32")
    return a === "ia32" ? "qjs-windows-x86.exe" : "qjs-windows-x86_64.exe";
  if (process.platform === "darwin")
    return a === "arm64" ? "qjs-darwin-arm64" : "qjs-darwin-x86_64";
  return a === "arm64" ? "qjs-linux-aarch64" : "qjs-linux-x86_64";
}
const QJSEXE = () => path.join(YTDIR(), process.platform === "win32" ? "qjs.exe" : "qjs");
let qjsPending = null;
/* 없으면 받아온다. 실패해도 던지지 않는다 — 다른 사이트는 이것 없이도 된다 */
function ensureQuickjs(send) {
  const exe = QJSEXE();
  if (fs.existsSync(exe)) return Promise.resolve(exe);
  if (qjsPending) return qjsPending;
  /* 설치 파일에 들어 있으면 그대로 옮겨 심는다 — 이쪽도 백신이 잘 의심한다 */
  if (동봉본심기("qjs", exe)) return Promise.resolve(exe);
  qjsPending = (async () => {
    if (send) send({ stage: "setup", text: "유튜브용 도구를 준비하는 중... (처음 한 번만)" });
    const res = await net.fetch(
      "https://github.com/quickjs-ng/quickjs/releases/latest/download/" + qjsAsset());
    if (!res.ok) throw new Error("실행기 내려받기 실패 (" + res.status + ")");
    const tmp = exe + ".part";                 // 받다 말면 반쪽짜리가 남지 않게
    fs.writeFileSync(tmp, Buffer.from(await res.arrayBuffer()));
    try { fs.chmodSync(tmp, 0o755); } catch (e) {}
    fs.renameSync(tmp, exe);
    return exe;
  })().catch(() => { qjsPending = null; return ""; });
  return qjsPending;
}
/* yt-dlp 에게 "자바스크립트는 이걸로 돌려라" 고 알려주는 옵션 */
function jsArgs() {
  const p = QJSEXE();
  return fs.existsSync(p) ? ["--js-runtimes", "quickjs:" + p] : [];
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
  /* ★ 유튜브는 순서가 전부다.
     기본 통로는 목록만 잘 읽어주고, 막상 받으려 하면 403 으로 끊긴다.
     '페이지에 심는 플레이어'(web_embedded) 통로는 그대로 열려 있어
     4K 까지 원래 화질로 받아진다. 그것을 맨 앞에 두고,
     그 통로가 막힌 영상(심기 금지)만 차례로 뒤로 물린다.
     맨 뒤의 android 는 360p 뿐이지만 '그래도 하나는 받아진다'는 안전망이다.
     ※ 이 통로들은 자바스크립트 실행기가 있어야 열린다 (ensureQuickjs) */
  if (isYoutube(url)) {
    const c = (v) => ["--extractor-args", "youtube:player_client=" + v];
    return [c("web_embedded"), c("web_safari"), [], c("android"), ...cookiePlans()];
  }
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
  /* ★ 백신이 도구를 지웠다면 나머지 오류는 모두 그 뒤끝일 뿐이다 */
  const av = errs.find(백신오류인가);
  if (av) return av;
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
      done = true; clearTimeout(timer); rej(실행실패(exe, e));
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

/* =========================================================================
   짧은 주소 펴기 · 핀터레스트
   -------------------------------------------------------------------------
   ★ 핀터레스트는 두 가지가 걸림돌이다.
     ① 공유 버튼이 주는 주소가 pin.it/XXXX 라는 짧은 주소다.
        yt-dlp 는 이것을 모른다 — 따라가서 진짜 핀 주소로 바꿔줘야 한다.
     ② 핀에 올라온 영상이 핀터레스트에 직접 있는 것도 있고,
        유튜브·비메오로 이어지기만 하는 것도 있다. 뒤엣것은 yt-dlp 의
        핀터레스트 추출기가 "영상이 없다" 며 물러난다.
        그럴 때는 핀 페이지를 읽어 이어지는 영상 주소를 찾아 그쪽으로 간다.
   ========================================================================= */
function 호스트(u) { try { return new URL(String(u)).hostname.replace(/^www\./, ""); }
                    catch (e) { return ""; } }
const 핀터레스트인가 = (u) => /(^|\.)pinterest\.[a-z.]+$/i.test(호스트(u))
                          || /^pin\.it$/i.test(호스트(u));

/* 짧은 주소를 따라가 진짜 주소로 바꾼다. 못 펴면 원래 것을 그대로 돌려준다. */
async function 주소펴기(url) {
  /* ★ 지금 잘 되는 사이트는 건드리지 않는다 — pin.it 하나만 편다 */
  if (!/^pin[.]it$/i.test(호스트(url))) return url;
  try {
    const r = await net.fetch(url, { redirect: "follow",
      headers: { "User-Agent": UA } });
    if (r && r.url && r.url !== url) return r.url;
  } catch (e) {}
  return url;
}

/* 핀 페이지를 읽어 '이어지는 영상 주소' 나 '핀터레스트가 직접 가진 영상' 을 찾는다 */
async function 핀에서영상찾기(pageUrl) {
  let html = "";
  try {
    const r = await net.fetch(pageUrl, { headers: {
      "User-Agent": UA, "Accept-Language": "ko,en;q=0.8" } });
    if (!r.ok) return null;
    html = await r.text();
  } catch (e) { return null; }
  /* 페이지 안의 JSON 은 슬래시를 역슬래시와 함께 적어 둔다 — 먼저 펴 놓는다.
     (역슬래시는 글 속에서 겹쳐 쓰기 쉬워 문자표(92)로 직접 만든다) */
  const 역슬래시 = String.fromCharCode(92);
  const t = html.split(역슬래시 + "/").join("/");
  /* ① 유튜브·비메오로 이어지는 핀이면 그 주소로 넘긴다 (그쪽이 화질도 좋다) */
  const ext = t.match(
    /https?:[/][/](?:www[.])?(?:youtube[.]com[/]watch[?]v=[\w-]{6,}|youtu[.]be[/][\w-]{6,}|vimeo[.]com[/]\d{6,})/i);
  if (ext) return { kind: "link", url: ext[0] };
  /* ② 핀터레스트가 직접 가진 영상 — 전체 목록(m3u8)이 있으면 화질을 고를 수 있다 */
  const m3u8 = t.match(/https?:[/][/][^"'<>\s]+?[.]m3u8/i);
  if (m3u8) return { kind: "stream", url: m3u8[0], referer: pageUrl };
  const mp4 = t.match(/https?:[/][/]v\d*[.]pinimg[.]com[/]videos[/][^"'<>\s]+?[.]mp4/i);
  if (mp4) return { kind: "stream", url: mp4[0], referer: pageUrl };
  return null;
}

/* 받을 파일 이름이 이미 있으면 번호를 붙여 비어 있는 자리를 찾아준다.
   ('영상만 받기' 로 같은 영상을 두 번 받을 때 먼저 것을 덮지 않는다) */
function 빈자리(dest) {
  try {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (!fs.existsSync(dest)) return dest;
    const ext = path.extname(dest), base = dest.slice(0, dest.length - ext.length);
    for (let n = 2; n < 1000; n++) {
      const p2 = `${base}_${n}${ext}`;
      if (!fs.existsSync(p2)) return p2;
    }
  } catch (e) {}
  return dest;
}
ipcMain.handle("freePath", (_e, dest) => 빈자리(dest));

/* 링크 정보만 먼저 읽어온다 (제목·길이) — 대기열에 보여주기 위해 */
ipcMain.handle("ytInfo", async (_e, url, useCookies, referer) => {
  url = await 주소펴기(url);          // pin.it/XXXX → 진짜 핀 주소
  let exe, last = "";
  try { exe = await ensureYtdlp(null); }
  catch (e) {
    const 원문 = String(e.message || e);
    return { ok: false, error: friendlyYtError(원문),
             blocked: 백신오류인가(원문), toolDir: YTDIR() };
  }
  if (isYoutube(url)) await ensureQuickjs(null);   // 유튜브일 때만, 처음 한 번만

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
        ...ffmpegLocArgs(), ...jsArgs(), ...extra, url], 25000);
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
          ...ffmpegLocArgs(), ...jsArgs(), "--cookies-from-browser", br, url], 9000);
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
  /* ★ 핀터레스트는 '핀에 영상이 직접 있는 것' 과 '유튜브·비메오로 이어지기만
     하는 것' 이 섞여 있다. 뒤엣것은 yt-dlp 가 영상이 없다며 물러난다.
     그럴 때만 핀 페이지를 읽어 이어지는 영상 주소를 찾아 알려준다.
     (화면 쪽이 그 주소로 다시 넣는다 — 다른 사이트의 흐름은 그대로다) */
  if (핀터레스트인가(url)) {
    const 대안 = await 핀에서영상찾기(url);
    if (대안) return { ok: false, altUrl: 대안.url, altKind: 대안.kind,
                       altReferer: 대안.referer || null,
                       error: friendlyYtError(pickError(errs)) };
  }
  /* ★ 백신이 도구를 지운 것이라면 화면 쪽이 '브라우저로 우회' 하지 않도록 알려준다.
     우회는 도구가 멀쩡할 때나 뜻이 있고, 여기서는 사용자만 헤매게 만든다. */
  const 최종 = pickError(errs);
  return { ok: false, error: friendlyYtError(최종),
           blocked: 백신오류인가(최종), toolDir: YTDIR() };
});

/* 백신이 도구를 지웠을 때 보여줄 안내.
   ★ "받지 못했습니다" 로만 끝내면 사용자는 영영 이유를 모른다.
     무엇이 지워졌고, 그것이 무엇이며, 어디를 예외로 잡으면 되는지까지 적는다. */
function 백신안내() {
  return "백신 프로그램이 '영상 받기 도구' 를 지웠습니다.\n\n"
    + "이 도구(yt-dlp)는 영상 사이트에서 파일을 받아오는, 널리 쓰이는 공개 프로그램입니다.\n"
    + "실제로 위험한 것은 아닌데 생김새 때문에 백신이 의심하는 일이 잦습니다.\n"
    + "(V3 · 알약 · 윈도우 디펜더 모두 그럴 수 있습니다)\n\n"
    + "백신 설정에서 아래 폴더를 '검사 제외'(예외) 로 추가한 뒤 다시 시도해 주세요.\n\n"
    + YTDIR();
}

function friendlyYtError(msg) {
  /* ★ 백신이 지운 것이라면 다른 어떤 설명보다 이것이 먼저다 */
  if (백신오류인가(msg)) return 백신안내();
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
    url = await 주소펴기(url);        // 정보를 읽을 때와 같은 주소로 받는다
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const send = (o) => e.sender.send("ytProgress", { jobId, ...o });
    const exe = await ensureYtdlp(send);
    if (isYoutube(url)) await ensureQuickjs(send);
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
        ...jsArgs(),                     // 유튜브 주소를 푸는 자바스크립트 실행기
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
      p2.on("error", (e) => finish(rej, 실행실패(exe, e)));
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
    const 원문 = String(err.message || err);
    return { ok: false, error: friendlyYtError(원문),
             blocked: 백신오류인가(원문), toolDir: YTDIR() };
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
   ★ 로그인은 없어도 된다 — 확인해 보니 로그인 없이도 대부분 잡힌다.
     (주소를 찾는 즉시 창이 닫히므로 로그인할 틈도 없다)
     다만 TVCF 는 기업 계정이 아니면 플레이어가 720p 까지만 내주므로,
     여기서 잡히는 주소도 720p 가 한계다 — 화면 쪽에서 미리 알려준다.
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
  const out = { exePath: YTEXE(), toolDir: YTDIR(), exists: false, size: 0,
                version: "", test: "", error: "", blocked: false,
                bundled: !!bundledBin("yt-dlp"),   // 설치 파일 쪽 원본이 살아 있는가
                ffmpeg: ffmpegPath(), ffmpegOk: false, ffprobeOk: false, jsOk: false };
  try { await ensureQuickjs(null); } catch (e) {}
  out.jsOk = fs.existsSync(QJSEXE());
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
      catch (e) {
        const 원문 = String(e.message || e);
        out.blocked = 백신오류인가(원문);
        out.error = out.blocked ? "백신이 도구를 지웠습니다" : "준비 실패: " + 원문;
        return out;
      }
    }
    try { out.version = (await runYt(YTEXE(), ["--version"], 10000)).trim(); }
    catch (e) {
      const 원문 = String(e.message || e);
      out.blocked = 백신오류인가(원문);
      out.error = out.blocked ? "백신이 도구를 지웠습니다" : "실행 실패: " + 원문;
      return out;
    }
    try {
      await runYt(YTEXE(), ["--dump-single-json", "--no-warnings", "--simulate",
        "--socket-timeout", "8", "--retries", "1", ...jsArgs(),
        "--extractor-args", "youtube:player_client=web_embedded",
        "https://www.youtube.com/watch?v=aqz-KE-bpKQ"], 25000);
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
/* ★ 저장해 둔 PNG 를 '파일 그대로' 클립보드에 넣는다.
   화면 쪽에서 그림을 다시 그려 옮기던 길은 창이 잠깐 초점을 잃거나
   브라우저 보안 규칙에 걸리면 조용히 실패했다 (복사가 됐다 안 됐다 하던 원인).
   경로만 넘기면 이 길은 그런 사정과 무관하게 언제나 된다. */
ipcMain.handle("copyImageFile", (_e, p) => {
  try {
    const img = nativeImage.createFromPath(String(p || ""));
    if (img.isEmpty()) return { ok: false, error: "빈 그림" };
    clipboard.writeImage(img);
    return { ok: true };
  } catch (e) { return { ok: false, error: String(e) }; }
});
ipcMain.handle("copyImage", (_e, data) => {
  try {
    const img = nativeImage.createFromBuffer(Buffer.from(data));
    if (img.isEmpty()) return { ok: false, error: "빈 그림" };
    clipboard.writeImage(img);
    return { ok: true };
  } catch (e) { return { ok: false, error: String(e) }; }
});

/* 파일 묶음마다 실제로 차지하는 공간을 잰다.
   ★ 화면 쪽은 예전에 '브라우저 안에 담긴 blob 크기'만 셌다. 앱은 캡쳐를 파일로
     저장하므로 blob 이 아예 없어서, 저장 공간 목록이 전부 0 MB 로만 보였다. */
ipcMain.handle("pathsSize", (_e, groups) => {
  return (groups || []).map((list) => {
    let n = 0;
    for (const p of list || []) {
      try { n += fs.statSync(p).size; } catch (e) {}
    }
    return n;
  });
});
function dirSizeOf(p) {
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
  if (p) walk(p);
  return n;
}
ipcMain.handle("dirSize", (_e, p) => dirSizeOf(p));
/* 기록마다 자기 폴더 하나를 쓴다. 그 폴더 크기가 곧 "지우면 비워지는 만큼" 이다
   (캡쳐한 PNG + 목록용 작은 그림 + 주소로 받은 원본 영상까지 그 안에 있다) */
ipcMain.handle("dirSizes", (_e, dirs) => (dirs || []).map((d) => dirSizeOf(d)));
