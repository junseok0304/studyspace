# StudySpace 외부 환경 검증 리포트

- **검증일:** 2026-09-23
- **검증 대상:** 로컬 서버, 반응형 화면, Gemini 실행 전제조건, Docker 실행 전제조건

## 완료된 검증

| 항목 | 결과 | 근거 |
|---|---|---|
| 프론트엔드 테스트 | 통과 | `npm test` 15개 통과 |
| 프론트엔드 빌드 | 통과 | `npm run build` 성공 |
| 백엔드 테스트 | 통과 | `gradle test` 성공 |
| 로컬 서버 기동 | 통과 | `gradle bootRun --args='--server.port=8092'` |
| 헬스 체크 | 통과 | `/actuator/health` → `{"status":"UP"}` |
| 홈 화면 | 통과 | `/` → HTTP 200 |
| CSRF 발급 | 통과 | `/api/auth/csrf` → HTTP 200, token 반환 |
| 반응형 가로 overflow | 통과 | 390/768/1024/1440px 모두 `scrollWidth === innerWidth` |
| STT 비활성 | 통과 | `studyspace.features.stt.enabled=false` |
| Gemini 실제 provider 호출 | 통과 | `STUDYSPACE_AI_MOCK_ENABLED=false`로 앱을 기동하고 SUMMARY 생성 → `COMPLETED`, `mockResult=false`, artifact 저장 |
| Gemini usage metadata | 통과 | 실제 호출 응답의 `usageMetadata` 확인 (`scripts/smoke-gemini.sh`) |
| 녹음 API 흐름 | 통과 | `RecordingTests`에서 다중 녹음 제한, chunk 업로드, 60분 제한, 종료, waveform, Range 재생 검증 |

## 추가 환경 의존 검증

### Gemini 실제 호출 재현

- 실연동 검증은 완료했으며, 기본 로컬 설정은 계속 `STUDYSPACE_AI_MOCK_ENABLED=true`로 안전하게 유지한다.
- 자격증명이 준비된 환경에서 provider 연결만 재확인하려면 저장소 루트에서 다음을 실행한다. 키 값은 출력하거나 커밋하지 않는다.

```bash
./scripts/smoke-gemini.sh
```

- 앱 전체 흐름(인증 → 과목/노트 생성 → SUMMARY 생성 → artifact 저장)은 `mockResult=false`로 완료했다.
- staging에서 추가 확인할 항목은 AI 노트·마인드맵·인포그래픽·퀴즈·플래시카드·PNG 분석의 성공/실패/timeout, `usage_records` 저장, 원문 근거 표시다.
- API 키 자체는 저장소와 리포트에 기록하지 않는다.

### Docker/배포

- Docker CLI는 설치되어 있지만 Docker 데몬이 실행되지 않았다.
- `docker compose` 플러그인도 현재 설치되어 있지 않아 `docker compose config`를 실행할 수 없었다.
- 데몬과 Compose 플러그인이 준비되면 다음 순서로 검증한다.

```bash
docker compose config
docker compose build
docker compose up -d
curl --fail http://127.0.0.1:8091/actuator/health
./scripts/backup-docker.sh
./scripts/restore-docker.sh ./backups/<UTC 시각> --confirm
```

### 실제 마이크·브라우저 코덱

- 서버 녹음 API와 저장·재생 흐름은 자동 테스트로 검증했지만, 이 실행 환경에서는 실제 마이크 권한 승인과 녹음 장치 입력을 승인하지 않았다.
- Chrome/Safari에서 확인할 항목은 권한 거부, `audio/webm;codecs=opus` fallback, 4초 chunk 업로드 재시도, 60분 자동 종료, 저장 후 재생·파형·구간 재생이다.
- 실제 마이크 권한 테스트는 사용자 장치에서 브라우저 권한을 승인한 뒤 수행해야 한다.

## 현재 결론

애플리케이션 코드와 로컬 품질 검증은 완료되었고, 외부 자격증명·Docker 데몬·실제 마이크가 필요한 세 항목만 환경 의존 보류 상태다. 해당 환경이 준비되면 위 명령과 체크리스트로 재검증한다.
