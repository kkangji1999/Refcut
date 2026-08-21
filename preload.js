/* 렌더러(index.html)와 메인 프로세스를 잇는 다리.
   contextIsolation 을 켜둔 채로 필요한 것만 골라 열어준다. */
const { contextBridge, ipcRenderer, webUtils } = require("electron");

/* 끌어다 놓은 파일의 '실제 위치'를 알아낸다.
   예전에는 file.path 로 바로 읽을 수 있었지만 최신 Electron 에서는 막혔다.
   webUtils.getPathForFile 이 그 대체 수단이고, 없는 판을 대비해 예전 방식도 남겨둔다. */
function pathOf(file) {
  try {
    if (webUtils && typeof webUtils.getPathForFile === "function") {
      const p = webUtils.getPathForFile(file);
      if (p) return p;
    }
  } catch (e) {}
  return (file && file.path) || null;
}

/* ★ 끌어다 놓은 파일의 위치는 '떨어뜨린 그 순간의 원본 파일'에서만 읽을 수 있다.
   화면 쪽 코드가 파일을 다시 만들어 쓰면 위치 정보가 사라진다.
   그래서 여기(preload)에서 가장 먼저 가로채 경로만 따로 적어둔다.
   preload 는 화면과 같은 문서 안에서 돌기 때문에 원본 파일을 그대로 볼 수 있다. */
let LAST_DROP = [];
const grab = (fileList) => {
  LAST_DROP = Array.from(fileList || []).map((f) => ({
    name: f.name, size: f.size, type: f.type, path: pathOf(f),
  }));
};
window.addEventListener("drop", (e) => {
  try { if (e.dataTransfer && e.dataTransfer.files) grab(e.dataTransfer.files); } catch (x) {}
}, true);                                  // true = 다른 코드보다 먼저 받는다
window.addEventListener("change", (e) => {
  try {
    const t = e.target;
    if (t && t.tagName === "INPUT" && t.type === "file") grab(t.files);
  } catch (x) {}
}, true);

contextBridge.exposeInMainWorld("CG", {
  isElectron: true,
  version: ipcRenderer.sendSync("appVersion"),   /* 설치된 진짜 버전 */
  pathOf,                         /* 개별 파일의 위치 (되면) */
  lastDropped: () => LAST_DROP.slice(),   /* 방금 넣은 파일들의 위치 */

  /* 영상 정보 */
  probe: (filePath) => ipcRenderer.invoke("probe", filePath),

  /* 대기열에 띄울 작은 그림 한 장 (파일이든 인터넷 주소든 상관없다) */
  thumbAt: (src, time, referer) =>
    ipcRenderer.invoke("thumbAt", { src, time: time || 0, referer: referer || null }),

  /* ★ 분석용 축소 프레임 스트림.
     onFrame(index, Uint8ClampedArray) 가 프레임마다 호출된다.
     데이터는 320x180 RGBA — 기존 measure() 가 쓰던 것과 같은 형식이라
     검출 알고리즘을 그대로 재사용할 수 있다. */
  scanFrames: (filePath, jobId, onFrame) => {
    const h = (_e, msg) => {
      if (msg.jobId !== jobId) return;
      onFrame(msg.index, new Uint8ClampedArray(msg.data));
    };
    ipcRenderer.on("frame", h);
    return ipcRenderer.invoke("scanFrames", { filePath, jobId })
      .finally(() => ipcRenderer.removeListener("frame", h));
  },
  cancelScan: (jobId) => ipcRenderer.invoke("cancelScan", jobId),

  /* 크롬이 못 여는 형식일 때만 쓰는 미리보기용 mp4 사본
     onProgress({percent}) 가 만드는 동안 계속 불린다 */
  makePreview: (src, dest, jobId, onProgress) => {
    const h = (_e, m) => { if (m.jobId === jobId) onProgress && onProgress(m); };
    ipcRenderer.on("prevProgress", h);
    return ipcRenderer.invoke("makePreview", { src, dest, jobId })
      .finally(() => ipcRenderer.removeListener("prevProgress", h));
  },
  cancelPreview: (jobId) => ipcRenderer.invoke("cancelPreview", jobId),

  /* 원본 해상도 PNG 저장 */
  grabPNGs: (filePath, times, outDir, prefix) =>
    ipcRenderer.invoke("grabPNGs", { filePath, times, outDir, prefix }),

  /* 컷을 손보고 나서 저장 폴더의 CUT 번호를 목록과 다시 맞춘다.
     그림을 새로 뽑지 않고 이름만 바꾸므로 컷이 많아도 순식간이다. */
  arrangeFiles: (moves, remove, copy) =>
    ipcRenderer.invoke("arrangeFiles",
      { moves: moves || [], remove: remove || [], copy: copy || [] }),

  /* 구간을 딱 그만큼 영상으로 뽑기 (해상도·초당 장수는 원본 그대로) */
  clipRange: (o, onProgress) => {
    const h = (_e, m) => { if (m.jobId === o.jobId) onProgress && onProgress(m); };
    ipcRenderer.on("clipProgress", h);
    return ipcRenderer.invoke("clipRange", o)
      .finally(() => ipcRenderer.removeListener("clipProgress", h));
  },
  clipCancel: (jobId) => ipcRenderer.invoke("clipCancel", jobId),

  /* 정보창에서만 쓰는 자세한 속내용 (코덱·프로파일·색 형식·소리) */
  probeFull: (filePath) => ipcRenderer.invoke("probeFull", filePath),

  /* 파일 · 폴더 */
  pickVideos: () => ipcRenderer.invoke("pickVideos"),
  pickFolder: () => ipcRenderer.invoke("pickFolder"),
  revealFolder: (p) => ipcRenderer.invoke("revealFolder", p),
  defaultOutDir: () => ipcRenderer.invoke("defaultOutDir"),
  getRoot: () => ipcRenderer.invoke("getRoot"),
  setRoot: (d) => ipcRenderer.invoke("setRoot", d),
  checkUpdate: () => ipcRenderer.invoke("checkUpdate"),

  /* 새 버전 내려받기 — onProgress(받은양, 전체, 퍼센트) 가 계속 불린다 */
  downloadUpdate: (onProgress) => {
    const h = (_e, m) => onProgress && onProgress(m);
    ipcRenderer.on("updProgress", h);
    return ipcRenderer.invoke("downloadUpdate")
      .finally(() => ipcRenderer.removeListener("updProgress", h));
  },
  installUpdate: () => ipcRenderer.invoke("installUpdate"),

  /* 영상 링크로 받기 */
  ytInfo: (url, useCookies, referer) =>
    ipcRenderer.invoke("ytInfo", url, !!useCookies, referer||null),
  ytDownload: (url, dest, jobId, opts, onProgress) => {
    const h = (_e, m) => { if (m.jobId === jobId) onProgress(m); };
    ipcRenderer.on("ytProgress", h);
    return ipcRenderer.invoke("ytDownload", {
        url, dest, jobId,
        height: (opts && opts.height) || 0,
        plan: (opts && opts.plan) || null,
        useCookies: !!(opts && opts.useCookies),
        referer: (opts && opts.referer) || null })
      .finally(() => ipcRenderer.removeListener("ytProgress", h));
  },
  ytCancel: (jobId) => ipcRenderer.invoke("ytCancel", jobId),
  /* 같은 이름이 이미 있으면 번호를 붙여 비어 있는 자리를 알려준다 */
  freePath: (dest) => ipcRenderer.invoke("freePath", dest),
  ytDiag: () => ipcRenderer.invoke("ytDiag"),

  /* 브라우저에서 열어 영상 주소 잡기 */
  sniffOpen: (pageUrl, onFound, onClosed) => {
    const f = (_e, m) => onFound(m);
    const c = () => { ipcRenderer.removeListener("sniffFound", f);
                      ipcRenderer.removeListener("sniffClosed", c); onClosed && onClosed(); };
    ipcRenderer.on("sniffFound", f);
    ipcRenderer.on("sniffClosed", c);
    return ipcRenderer.invoke("sniffOpen", pageUrl);
  },
  sniffClose: () => ipcRenderer.invoke("sniffClose"),
  /* 잡은 스트림 주소보다 더 좋은 화질이 있는지 찾아본다 */
  streamUpgrade: (o) => ipcRenderer.invoke("streamUpgrade", o||{}),
  openExternal: (u) => ipcRenderer.invoke("openExternal", u),
  dirSize: (p) => ipcRenderer.invoke("dirSize", p),

  /* 그림 복사 (화면 쪽 복사가 막혔을 때 쓰는 확실한 길) */
  copyImage: (bytes) => ipcRenderer.invoke("copyImage", bytes),
  /* 저장된 PNG 를 파일 그대로 복사 — 가장 확실하다 */
  copyImageFile: (p) => ipcRenderer.invoke("copyImageFile", p),
  /* 기록마다 실제로 차지하는 공간 (파일 묶음별 합계) */
  pathsSize: (groups) => ipcRenderer.invoke("pathsSize", groups || []),
  dirSizes: (dirs) => ipcRenderer.invoke("dirSizes", dirs || []),

  /* 파일 읽고 쓰기 */
  readFile: (p) => ipcRenderer.invoke("readFile", p),
  writeFile: (p, data) => ipcRenderer.invoke("writeFile", { path: p, data }),

  /* 기록 저장 (JSON 파일) */
  jobList: () => ipcRenderer.invoke("jobList"),
  jobSave: (job) => ipcRenderer.invoke("jobSave", job),
  jobDelete: (id) => ipcRenderer.invoke("jobDelete", id),
});
