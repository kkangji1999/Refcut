/* 시험을 실제 앱과 완전히 떼어 놓는다.
   =========================================================================
   ★ 2026-08-20, 시험이 사용자의 진짜 결과물을 지웠다.
     · 시험이 앱과 같은 앱데이터를 쓰는 바람에 시험 기록 80여 개가
       진짜 기록 목록에 섞여 들어갔다
     · 사용자가 캡쳐 저장 폴더를 test/_생성물 안쪽으로 잡아 두었는데,
       시험이 시작할 때 그 폴더를 통째로 비워서 그날 뽑은 그림이 다 사라졌다
     · 앱이 켜져 있으면 프로필이 잠겨 시험이 그대로 멈추기도 했다
   그래서 시험은 자기만의 앱데이터와 자기만의 저장 폴더 안에서만 논다.
   시험 파일 맨 위에서 main.js 를 부르기 '전에' 이것을 먼저 부른다.
   ========================================================================= */
const path = require("path");
const fs = require("fs");

module.exports = function 격리(app, 이름) {
  const 방 = path.join(__dirname, "_생성물", "_시험방", 이름);
  const 앱데이터 = path.join(방, "앱데이터");
  const 저장 = path.join(방, "저장");
  fs.mkdirSync(앱데이터, { recursive: true });
  fs.mkdirSync(저장, { recursive: true });
  app.setPath("userData", 앱데이터);
  /* 기록이 쌓이는 자리(rootDir)는 설정 파일이 정한다 — 미리 적어 둔다 */
  fs.writeFileSync(path.join(앱데이터, "settings.json"),
    JSON.stringify({ outDir: 저장 }, null, 2), "utf8");
  return { 방, 저장, 앱데이터 };
};
