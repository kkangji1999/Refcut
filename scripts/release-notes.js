/* 깃허브 릴리스 본문에 안내문을 넣는다 (배포 마지막 단계)
   =========================================================================
   ★ 왜 필요한가 — electron-builder 는 본문을 비운 채로 릴리스를 만든다.
     그런데 앱의 업데이트 창이 보여주는 '이번에 바뀐 내용' 은
     latest.yml 이 아니라 깃허브 릴리스 본문에서 온다
     (autoUpdater 의 깃허브 통로가 릴리스 설명을 읽어간다).
     본문이 비면 사용자는 "새 버전이 있습니다" 만 보고 무엇이 바뀌었는지 모른다
     — v26.8.2508 · 2509 가 실제로 그렇게 나갔다.

     사람이 손으로 채우는 단계로 두었더니 두 번을 내리 잊었다.
     그래서 npm run release 안으로 집어넣는다. 잊을 수가 없게.

   쓰는 법 :  node scripts/release-notes.js        (npm run release 가 알아서 부른다)
              GH_TOKEN 환경변수가 있어야 한다.
   ========================================================================= */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const 읽기 = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, f), "utf8"));

const pkg = 읽기("package.json");
const ver = 읽기("version.json");
const OWNER = pkg.build.publish[0].owner;
const REPO = pkg.build.publish[0].repo;
const TAG = "v" + pkg.version;
const API = "https://api.github.com/repos/" + OWNER + "/" + REPO;

const 토큰 = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || "";
const 머리 = {
  "Authorization": "Bearer " + 토큰,
  "Accept": "application/vnd.github+json",
  "User-Agent": "reftown-release",
};

/* 버전이 두 곳에서 어긋나면 앱이 엉뚱한 것을 보게 된다 — 먼저 막는다 */
if (pkg.version !== ver.version) {
  console.error("\n  ✕ 버전이 어긋납니다 — package.json " + pkg.version
    + " · version.json " + ver.version);
  process.exit(1);
}
if (!토큰) {
  console.error("\n  ✕ GH_TOKEN 이 없습니다. 릴리스 본문을 채우지 못했습니다.");
  console.error("    깃허브 릴리스 페이지에서 손으로 넣어주세요 — 비워두면");
  console.error("    사용자가 무엇이 바뀌었는지 볼 수 없습니다.\n");
  process.exit(1);
}
if (!String(ver.notes || "").trim()) {
  console.error("\n  ✕ version.json 의 notes 가 비어 있습니다.\n");
  process.exit(1);
}

/* 제목은 안내문 첫 ★ 줄에서 따온다 (없으면 버전만) */
function 제목() {
  const 별 = String(ver.notes).split("\n")
    .map((l) => l.trim())
    .find((l) => l.startsWith("★"));
  return 별 ? TAG + " — " + 별.replace(/^★\s*/, "") : TAG;
}

async function 부르기(url, opt) {
  const r = await fetch(url, opt);
  if (!r.ok) throw new Error(r.status + " " + (await r.text()).slice(0, 300));
  return r.json();
}

(async () => {
  console.log("\n릴리스 본문을 채웁니다 — " + TAG);

  /* 태그로 찾는다. 아직 초안(draft)이면 태그로는 안 잡히므로 목록에서 찾는다 */
  let rel = null;
  try { rel = await 부르기(API + "/releases/tags/" + TAG, { headers: 머리 }); }
  catch (e) {
    const list = await 부르기(API + "/releases?per_page=20", { headers: 머리 });
    rel = list.find((x) => x.tag_name === TAG);
  }
  if (!rel) {
    console.error("  ✕ " + TAG + " 릴리스를 찾지 못했습니다 — 먼저 올렸는지 확인해 주세요.\n");
    process.exit(1);
  }

  await 부르기(API + "/releases/" + rel.id, {
    method: "PATCH", headers: 머리,
    body: JSON.stringify({ name: 제목(), body: ver.notes, draft: false }),
  });
  console.log("  본문 " + ver.notes.length + "자 · 제목 " + 제목());

  /* 세 파일이 다 올라갔는지 본다. 하나라도 빠지면 자동 업데이트가 새 버전을 못 본다 */
  const 확인 = await 부르기(API + "/releases/" + rel.id, { headers: 머리 });
  const 이름들 = (확인.assets || []).map((a) => a.name);
  const 있어야 = ["Reftown-Setup-" + pkg.version + ".exe",
                  "Reftown-Setup-" + pkg.version + ".exe.blockmap",
                  "latest.yml"];
  let 빠짐 = 0;
  for (const n of 있어야) {
    const ok = 이름들.includes(n);
    console.log("  " + (ok ? "○" : "✕") + " " + n);
    if (!ok) 빠짐++;
  }
  if (빠짐) {
    console.error("\n  ✕ 빠진 파일이 있습니다 — 이대로면 앱이 새 버전을 못 봅니다.\n");
    process.exit(1);
  }
  console.log("  " + 확인.html_url + "\n");
})().catch((e) => {
  console.error("\n  ✕ " + (e && e.message || e) + "\n");
  process.exit(1);
});
