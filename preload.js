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
  pathOf,                         /* 개별 파일의 위치 (되면) */
  lastDropped: () => LAST_DROP.slice(),   /* 방금 넣은 파일들의 위치 */

  /* 영상 정보 */
  probe: (filePath) => ipcRenderer.invoke("probe", filePath),

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

  /* 원본 해상도 PNG 저장 */
  grabPNGs: (filePath, times, outDir, prefix) =>
    ipcRenderer.invoke("grabPNGs", { filePath, times, outDir, prefix }),

  /* 파일 · 폴더 */
  pickVideos: () => ipcRenderer.invoke("pickVideos"),
  pickFolder: () => ipcRenderer.invoke("pickFolder"),
  revealFolder: (p) => ipcRenderer.invoke("revealFolder", p),
  defaultOutDir: () => ipcRenderer.invoke("defaultOutDir"),
  getRoot: () => ipcRenderer.invoke("getRoot"),
  setRoot: (d) => ipcRenderer.invoke("setRoot", d),
  checkUpdate: () => ipcRenderer.invoke("checkUpdate"),

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
  openExternal: (u) => ipcRenderer.invoke("openExternal", u),
  dirSize: (p) => ipcRenderer.invoke("dirSize", p),

  /* 그림 복사 (화면 쪽 복사가 막혔을 때 쓰는 확실한 길) */
  copyImage: (bytes) => ipcRenderer.invoke("copyImage", bytes),

  /* 파일 읽고 쓰기 */
  readFile: (p) => ipcRenderer.invoke("readFile", p),
  writeFile: (p, data) => ipcRenderer.invoke("writeFile", { path: p, data }),

  /* 기록 저장 (JSON 파일) */
  jobList: () => ipcRenderer.invoke("jobList"),
  jobSave: (job) => ipcRenderer.invoke("jobSave", job),
  jobDelete: (id) => ipcRenderer.invoke("jobDelete", id),
});
