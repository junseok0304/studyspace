# 개발 확인

Java 21과 Gradle로 서버 테스트를 실행한다.

```sh
gradle test --no-daemon
```

Markdown 미리보기는 로컬에 번들된 라이브러리만 사용한다. 브라우저가 외부 CDN이나 이미지 서버에 노트 내용을 전송하지 않는다. `frontend/markdown.js`를 수정하면 Node.js와 npm으로 번들을 다시 만든다. 생성물 `src/main/resources/static/markdown.js`도 함께 커밋하여 Java 서버만으로 실행할 수 있게 한다.

```sh
npm ci
npm test
npm run build
```

사용 라이브러리와 구현 참고:

- [Marked](https://marked.js.org/): Markdown 파싱. 출력은 반드시 정제한다.
- [DOMPurify](https://github.com/cure53/DOMPurify): 허용된 HTML 요소와 속성만 미리보기에 남긴다.
- [highlight.js](https://highlightjs.org/): 코드 펜스에 명시된 지원 언어를 강조한다. 미지원 언어는 일반 텍스트로 표시한다.

의존성 버전은 `package-lock.json`에 고정한다. 배포 번들의 라이선스 고지는 빌드 시 유지한다. API 키, 학교 계정, 환경 파일, runtime 데이터와 PRD는 커밋하지 않는다. 테스트에는 실제 계정 대신 전용 테스트 계정을 사용한다.

## 카카오 로그인 로컬 설정

카카오디벨로퍼스에서 클라이언트 시크릿을 활성화한 경우 `KAKAO_CLIENT_SECRET_REQUIRED=true`와 카카오 로그인용 시크릿을 로컬 `.env`에 설정한다. 비즈니스 인증용 시크릿은 카카오 로그인에 사용하지 않는다. 비활성화한 앱만 `KAKAO_CLIENT_SECRET_REQUIRED=false`로 실행할 수 있다.

로컬 Redirect URI는 `http://localhost:8091/api/auth/kakao/callback`으로 통일한다. 브라우저가 `127.0.0.1`로 시작하면 서버가 OAuth 상태 쿠키를 유지하기 위해 `localhost`로 먼저 이동시킨다. 운영 Redirect URI는 `https://studyspace.omong.kr/api/auth/kakao/callback`이다.

## Docker 로컬 검증과 운영 준비

`.env.example`을 `.env`로 복사하고 실제 값은 로컬 파일에만 입력한다. 이미지와 Compose 설정에는 비밀값을 넣지 않는다.

```sh
docker compose config
docker compose build
docker compose up -d
curl --fail http://127.0.0.1:8091/actuator/health
```

MySQL과 첨부·학교 암호화 키 등 런타임 파일은 서로 분리된 Docker 볼륨에 유지된다. 백업은 SQL과 런타임 아카이브의 SHA-256 목록을 함께 기록한다. 복원은 목록이 있으면 먼저 무결성을 검사하고, 기존 런타임 볼륨 내용을 교체하므로 백업 디렉터리와 `--confirm`을 모두 지정해야 한다. Compose 플러그인(`docker compose`)과 구형 명령(`docker-compose`) 중 설치된 쪽을 사용한다.

```sh
./scripts/backup-docker.sh
./scripts/restore-docker.sh ./backups/<UTC 시각> --confirm
```
