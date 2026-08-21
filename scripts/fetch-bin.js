/* 설치 파일에 함께 넣을 도구를 미리 받아둔다 (빌드할 때 한 번)
   =========================================================================
   ★ 왜 필요한가 — 백신 때문이다.
     예전에는 yt-dlp 와 quickjs 를 '쓸 때 앱이 스스로 인터넷에서 받아' 썼다.
     그런데 백신(V3·알약·디펜더) 입장에서 그것은
     "정체 모를 프로그램이 인터넷에서 exe 를 받아 몰래 실행한다" 는
     악성코드와 똑같은 행동이다. 그래서 받자마자 조용히 지워버린다.
     사용자에게는 그냥 '링크로 받기가 안 된다' 로만 보인다.

     설치 파일 안에 처음부터 들어 있으면 그 행동 자체가 사라진다.
     (파일 자체를 의심하는 오탐은 남지만, 그때는 앱이 안내문을 띄운다)

   쓰는 법 :  node scripts/fetch-bin.js          (없는 것만 받는다)
              node scripts/fetch-bin.js --force  (있어도 새로 받는다)
   npm run dist / release 가 알아서 먼저 돌린다.
   ========================================================================= */
const fs = require("fs");
const path = require("path");

const BIN = path.join(__dirname, "..", "bin");
const 강제 = process.argv.includes("--force");

/* 윈도우 x64 용만 받는다 — 설치 파일이 그것 하나뿐이다 (package.json 의 win.target) */
const 목록 = [
  { name: "yt-dlp.exe", 최소: 5 * 1024 * 1024,
    url: "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe",
    설명: "영상 받기 도구" },
  { name: "qjs.exe", 최소: 512 * 1024,
    url: "https://github.com/quickjs-ng/quickjs/releases/latest/download/qjs-windows-x86_64.exe",
    설명: "유튜브용 자바스크립트 실행기" },
];

const MB = (n) => (n / 1048576).toFixed(1) + " MB";

async function 받기(항목) {
  const dest = path.join(BIN, 항목.name);
  if (!강제 && fs.existsSync(dest) && fs.statSync(dest).size >= 항목.최소) {
    console.log(`  건너뜀  ${항목.name}  (이미 있음 · ${MB(fs.statSync(dest).size)})`);
    return true;
  }
  process.stdout.write(`  받는 중  ${항목.name}  — ${항목.설명} ... `);
  const res = await fetch(항목.url);        // 리다이렉트는 fetch 가 따라간다
  if (!res.ok) throw new Error(`내려받지 못했습니다 (${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 항목.최소)
    throw new Error(`받아진 파일이 너무 작습니다 (${MB(buf.length)}) — 백신이 가로챘을 수 있습니다`);
  /* 받다 만 반쪽짜리가 남지 않게 옆에 받아두고 마지막에 이름을 바꾼다 */
  const tmp = dest + ".part";
  fs.writeFileSync(tmp, buf);
  try { fs.chmodSync(tmp, 0o755); } catch (e) {}
  fs.rmSync(dest, { force: true });
  fs.renameSync(tmp, dest);
  console.log(`완료 (${MB(buf.length)})`);
  return true;
}

(async () => {
  console.log("\n설치 파일에 넣을 도구를 준비합니다");
  fs.mkdirSync(BIN, { recursive: true });
  for (const 항목 of 목록) {
    try { await 받기(항목); }
    catch (e) {
      console.error(`\n  ✕ ${항목.name} — ${e.message}`);
      console.error(
        "\n  이 도구가 없으면 설치한 사람의 컴퓨터가 처음 쓸 때 직접 받아야 하고,\n" +
        "  그때 백신이 지워버릴 수 있습니다. 인터넷 연결과 백신 설정을 확인한 뒤\n" +
        "  다시 시도해 주세요.  (다시 시도: node scripts/fetch-bin.js)\n");
      process.exit(1);
    }
  }
  console.log(`준비 끝 — ${BIN}\n`);
})();
