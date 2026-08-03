# ACPL (AI CLI PowerShell Launcher)

[En](docs/README.md)

ACPL은 Windows 환경에서 Claude Code, Antigravity, Codex 등 다양한 AI CLI 도구를 폴더별로 관리하고 동시에 멀티 세션으로 실행할 수 있도록 돕는 **Tauri v2 (Rust 엔진)** 기반의 데스크톱 인터페이스입니다.

여러 프로젝트 디렉토리를 오가며 터미널 창을 개별적으로 띄우고 명령어를 반복 입력하는 번거로움을 줄이고, 단일 인터페이스에서 폴더별 세션 전환과 대화 기록 저장을 손쉽게 처리할 수 있도록 개발되었습니다.

---

## ⚡ 주요 특징 & 성능

- **디렉토리별 세션 관리**: 프로젝트 폴더 경로와 별칭(Alias)을 등록해두고 클릭 한 번으로 해당 위치에서 지정한 AI CLI 세션을 즉시 시작할 수 있습니다.
- **반응형 탭 시스템**: 여러 세션을 동시에 띄워둘 때 활성화된 탭 위주로 정렬되며, 축소 상태에서도 이니셜 식별이 가능한 반응형 UI를 지원합니다.
- **사용량(Quota) 자동 갱신**: Claude CLI 세션 연결 시 플랜 한도(5시간 한도 / 주간 한도 퍼센트)를 실시간 체크하여 탭 뱃지에 표시합니다.
- **원문 대화 추출 (.md)**: 토큰 소비 없이 터미널 버퍼의 전체 대화 원문을 마크다운(.md) 파일로 즉시 추출 저장합니다.
- **PDF 보고서 생성**: 대화 내용을 요약 정리하여 지정 폴더에 PDF 보고서 문서로 출력합니다.
- **설정 자동 동기화 & 레거시 이중 보존**: 사용자 설정(`directory.json`)은 `%APPDATA%\ACPL` 경로에 보관되며 실행 경로 이중 백업을 지원합니다.
- **안전한 세션 종료 보호**: 세션 실행 중 창을 닫을 때 기존과 동일한 Native TaskDialog 확인 팝업(`[저장 후 종료]`, `[저장하지 않고 종료]`, `[취소]`)을 노출하여 데이터 손실을 방지합니다.

---

## 🛠️ 사전 요구 사항

- Windows 10 이상 (64-bit)
- Node.js (v18 이상 권장)
- Rust toolchain (`rustup`, `cargo`)
- 사용하는 AI CLI 도구 (Anthropic Claude Code, Antigravity, Codex 등) 전역 설치 및 환경변수 설정

---

## 🚀 실행 및 빌드 방법

### 개발 환경 실행

```bash
# 디펜던시 설치
npm install

# Tauri v2 개발 서버 실행
npm start
# 또는
npm run tauri:dev
```

### 실행 파일 (.exe 및 Setup Installer) 빌드

```bash
# 프로덕션 번들 빌드
npm run tauri:build
```

빌드가 완료되면 다음 위치에 바이너리가 생성됩니다:

- **단일 실행 파일**: `src-tauri/target/release/acpl.exe` (~9MB)
- **설치 프로그램 (.exe)**: `src-tauri/target/release/bundle/nsis/ACPL_1.0.2_x64-setup.exe` (~2MB)
- **MSI 패키지**: `src-tauri/target/release/bundle/msi/ACPL_1.0.2_x64_en-US.msi`

---

## 👨‍💻 개발자 정보

- **제작**: frost-ix (성현우)
- **GitHub**: https://github.com/frost-ix
- **문의/개선 의견**: 이슈 또는 프로젝트 리포지토리를 통해 전달해 주세요.
