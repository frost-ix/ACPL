// i18n Translation Dictionary & Helpers

export let currentLang = 'ko';

export const i18n = {
  ko: {
    sidebarTitle: '⚡ AI CLI Launcher',
    sidebarSubtitle: 'OS Shell Integration',
    toggleSidebarTitle: '사이드바 토글',
    addFolder: '작업 폴더 추가',
    checkUsage: '현재 사용량 확인하기',
    checkUsageTitle: '현재 계정 사용량(Quota) 확인하기',
    darkTheme: 'Dark 모드',
    lightTheme: 'Light 모드',
    themeToggleTitle: '테마 전환',
    langSelectTitle: '언어 변경 / Language',
    statusSyncing: '설정 자동 동기화 중',
    statusSyncTitle: '설정 자동 보존 (AppData + 실행 경로 이중 동기화)',
    saveConfigBtn: '설정 저장 (directory.json)',
    saveConfigTitle: '설정 저장 (directory.json)',
    extractChatBtn: '📝 대화 추출',
    extractChatTitle: '현재 세션의 전체 대화내용을 텍스트 파일로 순수 추출',
    reportPdfBtn: '📄 보고서 출력',
    reportPdfTitle: '현재 대화내용을 PDF 보고서로 추출',

    // Folder card
    aliasPlaceholder: '🏷️ 별칭 지정 (선택)',
    customCmdPlaceholder: '예: claude --verbose',
    customInputLabel: '직접 입력',
    launchBtn: '▶ 실행',
    launchBtnTitle: '이 위치에서 CLI 세션 시작',
    runningStatus: '● 실행 중',
    closeBtn: '⏹ 닫기',
    closeBtnTitleActive: '세션 닫기',
    closeBtnTitleDisabled: '실행 중인 세션 없음',
    deleteFolderTitle: '목록에서 삭제',
    deleteFolderBtn: '🗑️ 목록에서 삭제',
    sessionActiveDot: '세션 활성화 중 (초록색)',
    sessionInactiveDot: '세션 비활성화됨 (회색)',

    // Session Tabs
    welcomeTab: '사용 안내',

    // Modal
    modalCloseTitle: 'CLI 세션 종료 확인',
    modalCloseDesc: '실행 중인 세션을 종료하시겠습니까?',
    modalConfirm: '종료',
    modalCancel: '취소',

    // Alerts / Messages
    noActiveSession: '현재 실행 중인 세션이 없습니다.',
    sessionNotActive: '현재 선택된 세션이 실행 중이지 않습니다. 세션을 먼저 시작해 주세요.',
    noActiveSessionStartFirst: '활성화된 세션이 없습니다. 실행(▶) 버튼을 먼저 눌러 세션을 연결해 주세요.',
    noActiveSessionForReport: '활성화된 세션이 없습니다. 먼저 폴더 카드의 [▶ 실행] 버튼을 눌러 세션을 연결해 주세요.',
    noContentToExtract: '현재 세션에 추출할 대화 내용이 없습니다.',
    chatSavedSuccess: '현재 세션 대화 내용이 .md 파일로 저장되었습니다!\n\n저장 위치:\n',
    chatSavedError: '대화 추출 저장 중 오류가 발생했습니다: ',
    configSaveSuccess: '사용자 설정(directory.json)이 성공적으로 이중 보존되었습니다!\n\n저장 위치:\n',
    configSaveError: '설정 저장 중 오류가 발생했습니다.\n',

    // PTY start messages
    startingSession: 'PowerShell 세션 시작 중...',
    pathLabel: '경로',
    commandLabel: '실행 명령어',
    sessionLaunchFailed: '세션 실행 실패: ',

    // Welcome Manual
    welcomeHeader: 'ACL - 사용 안내 매뉴얼',
    welcomeStep1: '좌측 <span class="welcome-highlight">[➕ 작업 폴더 추가]</span> 버튼을 눌러 프로젝트 디렉토리를 등록합니다.',
    welcomeStep2: '원하는 AI CLI <span class="welcome-highlight">(Claude / Antigravity / Codex / Etc..)</span>를 선택합니다.',
    welcomeStep3: '폴더 카드의 <span class="welcome-highlight">[▶ 실행]</span> 버튼을 눌러 대화형 세션을 시작합니다.',
    welcomeStep4: '하단 <span class="welcome-highlight">[📊 현재 사용량 확인하기]</span> 버튼으로 플랜 한도(Quota %)를 실시간 체크합니다.',
    welcomeStep5: '상단 <span class="welcome-highlight">[📝 대화 추출]</span> / <span class="welcome-highlight">[📄 보고서 출력]</span> 버튼으로 대화 원문이나 PDF 보고서를 지정 폴더로 자동 저장합니다.',
    welcomeStep6: '하단 <span class="welcome-highlight">[🎨 테마 / 🌐 언어]</span> 설정으로 테마와 언어를 바꿀 수 있습니다 (터미널은 다크 고정).',
    welcomeNote: '📌 <strong>참고사항:</strong> claude가 제대로 구동되지 않는다면 환경변수 PATH에 <code>%USERPROFILE%\\.local\\bin</code> 경로를 추가해주세요.',
    welcomeTip: '💡 <strong>📝 대화 추출 & 📄 보고서 출력 기능:</strong><br> [📝 대화 추출] 버튼을 누르면 AI 호출 없이 현재 화면 텍스트 원문을 즉시 .md 파일로 추출 저장하며, <br>[📄 보고서 출력]은 대화 요약 PDF 문서를 자동 생성합니다.',
    welcomeFooter: '▶ 준비가 되시면 폴더 카드의 [▶ 실행] 버튼을 눌러 세션을 시작하세요!',
    welcomeCredits: '[제작 : 성현우 | GitHub: https://github.com/frost-ix]'
  },
  en: {
    sidebarTitle: '⚡ AI CLI Launcher',
    sidebarSubtitle: 'OS Shell Integration',
    toggleSidebarTitle: 'Toggle Sidebar',
    addFolder: 'Add Folder',
    checkUsage: 'Check Usage',
    checkUsageTitle: 'Check current account quota usage',
    darkTheme: 'Dark Mode',
    lightTheme: 'Light Mode',
    themeToggleTitle: 'Toggle Theme',
    langSelectTitle: 'Language / 언어 변경',
    statusSyncing: 'Auto-syncing config',
    statusSyncTitle: 'Auto-sync Config (AppData + Executable Path)',
    saveConfigBtn: 'Save Settings',
    saveConfigTitle: 'Save Settings',
    extractChatBtn: '📝 Extract Chat',
    extractChatTitle: 'Extract full conversation of current session as raw text file',
    reportPdfBtn: '📄 Export Report',
    reportPdfTitle: 'Export current conversation as PDF report',

    // Folder card
    aliasPlaceholder: '🏷️ Alias (Optional)',
    customCmdPlaceholder: 'e.g. claude --verbose',
    customInputLabel: 'Custom input',
    launchBtn: '▶ Run',
    launchBtnTitle: 'Start CLI Session in this directory',
    runningStatus: '● Running',
    closeBtn: '⏹ Stop',
    closeBtnTitleActive: 'Stop session',
    closeBtnTitleDisabled: 'No running session',
    deleteFolderTitle: 'Delete from list',
    deleteFolderBtn: '🗑️ Delete from list',
    sessionActiveDot: 'Session active (Green)',
    sessionInactiveDot: 'Session inactive (Gray)',

    // Session Tabs
    welcomeTab: 'User Guide',

    // Modal
    modalCloseTitle: 'Confirm Session Termination',
    modalCloseDesc: 'Are you sure you want to terminate the running CLI session?',
    modalConfirm: 'Terminate',
    modalCancel: 'Cancel',

    // Alerts / Messages
    noActiveSession: 'There are no active sessions running.',
    sessionNotActive: 'The selected session is not active. Please start the session first.',
    noActiveSessionStartFirst: 'No active session. Please click the [▶ Run] button first to connect a session.',
    noActiveSessionForReport: 'No active session. Please click the [▶ Run] button on a folder card to connect a session.',
    noContentToExtract: 'No conversation text available to extract in the current session.',
    chatSavedSuccess: 'Current session conversation log has been saved as a .md file!\n\nSaved at:\n',
    chatSavedError: 'An error occurred while saving conversation log: ',
    configSaveSuccess: 'User settings (directory.json) have been saved successfully!\n\nSaved at:\n',
    configSaveError: 'An error occurred while saving settings.\n',

    // PTY start messages
    startingSession: 'Starting PowerShell Session...',
    pathLabel: 'Path',
    commandLabel: 'Command',
    sessionLaunchFailed: 'Session Launch Failed: ',

    // Welcome Manual
    welcomeHeader: 'ACL - User Guide',
    welcomeStep1: 'Click the left <span class="welcome-highlight">[➕ Add Folder]</span> button to register project directories.',
    welcomeStep2: 'Select your preferred AI CLI <span class="welcome-highlight">(Claude / Antigravity / Codex / Etc..)</span>.',
    welcomeStep3: 'Click the <span class="welcome-highlight">[▶ Run]</span> button on the folder card to start an interactive session.',
    welcomeStep4: 'Use the bottom <span class="welcome-highlight">[📊 Check Usage]</span> button to monitor plan quotas (Quota %) in real time.',
    welcomeStep5: 'Use the top <span class="welcome-highlight">[📝 Extract Chat]</span> / <span class="welcome-highlight">[📄 Export Report]</span> buttons to save raw chat or PDF reports.',
    welcomeStep6: 'Customize appearance and language using the bottom <span class="welcome-highlight">[🎨 Theme / 🌐 Language]</span> controls.',
    welcomeNote: '📌 <strong>Note:</strong> If Claude fails to run, add <code>%USERPROFILE%\\.local\\bin</code> to your PATH environment variable.',
    welcomeTip: '💡 <strong>📝 Extract Chat & 📄 Export Report:</strong><br> [📝 Extract Chat] instantly exports current terminal buffer text into a .md file without AI calls, while <br>[📄 Export Report] generates a PDF document summary.',
    welcomeFooter: '▶ When ready, click [▶ Run] on a folder card to launch a session!',
    welcomeCredits: '[Author: Sung Hyunwoo | GitHub: https://github.com/frost-ix]'
  }
};

export function setLanguage(lang) {
  currentLang = lang;
}

export function getCurrentLang() {
  return currentLang;
}

export function t(key) {
  return (i18n[currentLang] && i18n[currentLang][key]) || (i18n['ko'][key] || key);
}
