# Reftown (레프타운)

영상을 넣으면 컷·포커스·카메라가 바뀔 때마다 대표 프레임을 자동으로 뽑아주는 도구입니다.
작화·연출 레퍼런스를 모을 때 쓰려고 만들었습니다.

![Reftown](build/icon.png)

## 무엇을 하나요

- 영상 파일을 끌어다 놓거나 주소를 붙여넣으면 컷이 바뀌는 지점을 찾아 프레임을 저장합니다
- 컷은 **원본 해상도 PNG** 로 저장됩니다
- 마음에 드는 컷은 즐겨찾기에 담아 따로 모아 볼 수 있습니다
- 이미지도 기록도 폴더 하나(기본값 `문서\Reftown`)에 들어가서, 그 폴더만 복사하면 백업입니다

## 실행하기

```bash
npm install
npm start
```

## 설치 파일 만들기

```bash
npm run dist
```

`dist` 폴더 안에 **Reftown Setup.exe** 가 생깁니다.
자세한 내용은 [설치하기.md](설치하기.md) 를 봐주세요.

## 업데이트 확인

앱은 켤 때와 [업데이트] 버튼을 누를 때 이 저장소의
[`version.json`](version.json) 하나만 확인합니다.

```json
{ "version": "26.8.1814", "notes": "무엇이 바뀌었는지", "url": "설치파일 주소" }
```

새 버전을 낼 때는 `app/index.html` 의 `APP_VERSION`, `package.json` 의 `version`,
그리고 이 `version.json` 을 같은 값으로 맞춰서 올리면 됩니다.

## 만든 것들

- Electron
- [ffmpeg-static](https://github.com/eugeneware/ffmpeg-static) — 프레임 추출
- [yt-dlp](https://github.com/yt-dlp/yt-dlp) — 영상 주소로 받기 (처음 쓸 때 자동으로 내려받습니다)

## 라이선스

UNLICENSED — 개인 용도로 만든 프로그램입니다.
