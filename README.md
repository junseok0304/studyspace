# StudySpace

![StudySpace 로고](src/main/resources/static/assets/studyspace-logo.png)

StudySpace는 대학생이 과목별 강의노트·강의자료·강의 녹음을 한곳에 모으고, 노트와 자료를 바탕으로 AI 복습 요약과 퀴즈를 만드는 웹 학습 공간입니다.

## 주요 기능

- **인증**: 이메일 가입·로그인·이메일 인증·비밀번호 재설정, 카카오 로그인
- **노트**: 과목별 강의노트 작성·Markdown 읽기/편집, 수동 저장, 3분 간격 로컬 초안 백업·복구, 가져오기·내보내기
- **강의자료**: PDF·PPTX·HWP·PNG 파일당 최대 50MB, 드래그앤드롭 업로드와 자동 분석·파일별 요약
- **AI 학습**: 현재 노트 기반 인포그래픽·퀴즈·플래시카드 통합 탭 (Gemini 호출 코드 구현, 학습 생성은 모의 모드 기본)
- **녹음**: 과목별 공유·노트 연결, 파형 탐색·확대/축소·배속 재생, 한 건 최대 60분
- **학교 연동**: SKHU 시간표 가져오기·학기·과목 자동 생성
- **학습 현황**: 최근 7일 활동, 과목별 노트, 오늘 수업, 이어서 공부하기, 퀴즈 기록·복습 카드

## 실행

```sh
# 로컬 .env 준비 (.env.example 참고, 키는 Git 제외)
cp .env.example .env

# 서버 (Java 21, Spring Boot, H2 기본)
gradle bootRun --no-daemon
# http://localhost:8091

# 프론트엔드 테스트/번들
npm ci
npm test
npm run build
```

자세한 확인·배포 절차는 [개발 안내](docs/DEVELOPMENT.md), 확정된 제품 범위와 남은 작업은 [최종 PRD v6.0](docs/PRD-FINAL.md)을 참고하세요. 기존 `docs/PRD.md`는 Git에서 제외된 로컬 이력 문서입니다.

현재 화면이 최종 기획입니다. Gemini 실연결 검증 결과와 남은 점검 범위는 [AI 검증 기록](docs/AI-VALIDATION.md)을 참고하세요. 기본 모의 설정에서는 학습 생성·자료 요약·PNG 분석이 외부 AI를 호출하지 않습니다. 실제 연결은 Git에 포함하지 않는 `.env`의 `GEMINI_API_KEY`, `STUDYSPACE_AI_MODEL`, `STUDYSPACE_AI_MOCK_ENABLED=false`로 설정한 뒤 `scripts/run-local.sh`로 실행합니다.
