# StudySpace

StudySpace는 강의노트·강의자료·복습·퀴즈를 관리하는 다중 사용자 학습 공간입니다. 현재는 1단계 회원가입·이메일 로그인·로그아웃·세션 인증을 구현한 상태입니다.

## 로컬 실행

요구사항: Java 21, Gradle 9 이상 또는 Gradle Wrapper, macOS/Linux.

```bash
cd /Users/junseok/Desktop/junseok/project/26-2/project_studyspace
gradle bootRun
```

브라우저에서 `http://localhost:8091`을 엽니다. 기본 데이터베이스는 프로젝트의 `runtime/studyspace`에 생성되는 H2 파일 DB입니다. 서버를 다시 시작해도 가입한 계정이 유지됩니다.

테스트:

```bash
gradle test
```

## 인증 API

모든 변경 요청은 먼저 `GET /api/auth/csrf`를 호출해 `XSRF-TOKEN` 쿠키를 받고, 쿠키 값을 `X-XSRF-TOKEN` 헤더로 보내야 합니다. 브라우저 화면은 이 과정을 자동으로 처리합니다.

```text
POST /api/auth/signup       { email, password, nickname }
POST /api/auth/login        { email, password }
POST /api/auth/logout
GET  /api/auth/me
GET  /api/auth/csrf
GET  /api/auth/verify-email?token=...
```

개발 환경에서는 빠른 로컬 테스트를 위해 가입 즉시 이메일을 인증된 상태로 만듭니다. 실제 이메일 인증 흐름을 켜려면 다음처럼 실행합니다.

```bash
STUDYSPACE_REQUIRE_EMAIL_VERIFICATION=true gradle bootRun
```

이 설정에서는 가입 응답의 `developmentVerificationUrl`을 개발용 인증 링크로 사용할 수 있습니다. 운영에서는 이 링크를 화면에 노출하지 않고 SMTP 메일 발송 계층으로 교체해야 합니다.

## 설정

주요 환경변수는 다음과 같습니다.

| 변수 | 기본값 | 용도 |
| --- | --- | --- |
| `STUDYSPACE_PORT` | `8091` | 로컬 서버 포트 |
| `STUDYSPACE_DB_URL` | `jdbc:h2:file:./runtime/studyspace;MODE=MySQL;AUTO_SERVER=TRUE` | JDBC URL |
| `STUDYSPACE_DB_USERNAME` | `sa` | DB 사용자 |
| `STUDYSPACE_DB_PASSWORD` | 빈 값 | DB 비밀번호 |
| `STUDYSPACE_REQUIRE_EMAIL_VERIFICATION` | `false` | 이메일 인증 요구 여부 |
| `STUDYSPACE_COOKIE_SECURE` | `false` | HTTPS 운영 시 세션 쿠키 Secure 설정 |
| `STUDYSPACE_KAKAO_ENABLED` | `false` | 카카오 로그인 활성화 |
| `KAKAO_REST_API_KEY` | 빈 값 | 카카오 OAuth 서버용 REST API 키 |
| `KAKAO_JAVASCRIPT_KEY` | 빈 값 | 향후 카카오 JavaScript SDK용 키 |
| `KAKAO_CLIENT_SECRET` | 빈 값 | 카카오 앱에서 활성화한 클라이언트 시크릿 |
| `KAKAO_REDIRECT_URI` | `http://localhost:8091/api/auth/kakao/callback` | 카카오 앱에 등록한 Redirect URI |
| `STUDYSPACE_PUBLIC_BASE_URL` | `http://localhost:8091` | OAuth 성공 후 돌아갈 서비스 주소 |

카카오 로그인은 REST API 키를 서버 환경변수로 읽어 OAuth 인가 코드 흐름을 수행합니다. 사용자가 제공한 운영 도메인에서는 다음 Redirect URI를 카카오 개발자 콘솔에 등록해야 합니다.

```text
https://studyspace.omong.kr/api/auth/kakao/callback
```

운영 실행 예시는 다음과 같습니다. 실제 키는 셸 명령 이력이나 저장소에 남기지 않는 방식으로 주입하세요.

```bash
STUDYSPACE_KAKAO_ENABLED=true \
KAKAO_REST_API_KEY='발급받은-REST-API-키' \
KAKAO_REDIRECT_URI='https://studyspace.omong.kr/api/auth/kakao/callback' \
STUDYSPACE_PUBLIC_BASE_URL='https://studyspace.omong.kr' \
STUDYSPACE_COOKIE_SECURE=true \
gradle bootRun
```

카카오 앱에서 클라이언트 시크릿을 활성화한 경우 `KAKAO_CLIENT_SECRET`도 추가해야 합니다. JavaScript 키는 현재 서버 OAuth 흐름에는 사용하지 않습니다. 카카오 이메일이 기존 이메일 계정과 같아도 자동 병합하지 않고, 카카오 사용자 ID를 별도 소셜 식별자로 저장합니다.

### 카카오 개발자 콘솔에 등록할 주소 구분

현재 구현에서 카카오 로그인에 등록할 주소는 OAuth Redirect URI 하나입니다.

```text
https://studyspace.omong.kr/api/auth/kakao/callback
```

로컬에서 카카오 로그인을 시험할 때는 다음 주소도 카카오 앱에 함께 등록할 수 있습니다.

```text
http://localhost:8091/api/auth/kakao/callback
```

카카오 공식 문서의 **계정 상태 변경 웹훅**과 **연결 끊기 웹훅**은 OAuth Redirect URI와 별개의 기능입니다. 두 웹훅 수신 엔드포인트는 현재 구현·운영 배포하지 않았으므로 지금은 등록하지 마세요. 웹훅을 추가할 때는 HTTPS 443 포트의 별도 수신 주소를 구현한 뒤 카카오 개발자 콘솔의 `앱 > 웹훅`에서 등록해야 합니다. 자세한 정책은 [콜백/웹훅 안내](https://developers.kakao.com/docs/ko/getting-started/callback)와 [계정 상태 변경 웹훅 설정](https://developers.kakao.com/docs/ko/app-setting/app#account-change-webhook)을 확인하세요.

## 현재 검증 상태

- `gradle test`: 회원가입, 중복 이메일, 잘못된 비밀번호, 로그인 세션, `/me`, 로그아웃 후 접근 차단 통과
- 실제 localhost HTTP 흐름: CSRF 토큰 발급 → 회원가입 → 로그인 → `/api/auth/me` 확인
- 카카오 더미 키로 OAuth 시작 경로의 302 리다이렉트·state 생성 확인
- 다음 개발 단계: 사용자별 학기·과목·노트 서버 저장
