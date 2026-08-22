import type { ManualBlock } from './parseRulesManual';
import { l } from './parseRulesManual';

export const CHART_MANUAL_UI = {
  title: l('Chart Guide', '차트 가이드'),
  tipLabel: l('Tip', '팁'),
  footnote: l(
    'Shortcuts use physical keys (KeyboardEvent.code), so they work in Korean and English layouts. Live mode disables zoom/pan keys.',
    '단축키는 물리 키(code) 기준이라 한글·영문 자판 모두에서 동작합니다. Live 모드에서는 줌·이동 키가 비활성화됩니다.',
  ),
  overview: l('Overview', '개요'),
  interactions: l('Zoom & pan', '줌 · 이동'),
  minimap: l('Bottom minimap', '하단 미니맵'),
  liveMode: l('Live mode', 'Live 모드'),
  toolbar: l('Toolbar', '툴바'),
  keyboard: l('Keyboard shortcuts', '키보드 단축키'),
};

export const CHART_MANUAL_OVERVIEW: ManualBlock[] = [
  {
    kind: 'p',
    text: l(
      'Visualize protocol fields over time. Select a board and protocol, add fields in Configuration, then Refresh. Multiple series share one time axis; each can use its own Y-axis and unit.',
      '프로토콜 필드를 시간축 차트로 봅니다. Configuration에서 보드·프로토콜을 고르고 필드를 추가한 뒤 Refresh 하세요. 여러 시리즈가 하나의 시간축을 공유하며, Y축·단위는 항목마다 다르게 둘 수 있습니다.',
    ),
  },
  {
    kind: 'ul',
    items: [
      l('Hover the chart to see values at a time (toggle with the tooltip button).', '차트에 마우스를 올리면 해당 시각의 값을 볼 수 있습니다(툴팁 버튼으로 켜고 끔).'),
      l('Use the chart header icons next to zoom: toggle hover popup and field values.', '차트 제목 우측 줌 옆 아이콘으로 호버 팝업·필드 값을 켜고 끌 수 있습니다.'),
      l('Field values toggle chart series visibility (same as Configuration checkboxes).', '필드 값의 눈 아이콘은 Configuration 체크박스와 동일하게 차트 시리즈 표시를 바꿉니다.'),
      l('Place the field values panel at the bottom or on the left (icons next to the field values toggle). Your choice is remembered.', '필드 값 패널을 하단 또는 좌측에 둘 수 있습니다(필드 값 토글 옆 아이콘). 선택은 저장됩니다.'),
      l('Statistics summarizes min / max / avg for visible series.', 'Statistics에서 표시 중인 시리즈의 min / max / avg를 봅니다.'),
    ],
  },
];

export const CHART_MANUAL_INTERACTIONS: ManualBlock[] = [
  {
    kind: 'ul',
    items: [
      l('Wheel — zoom in/out around the pointer (time axis).', '휠 — 포인터 기준 시간축 확대·축소'),
      l('Shift + drag — select a time range to zoom in.', 'Shift + 드래그 — 구간을 지정해 줌인'),
      l('Drag (while zoomed) — pan left/right.', '드래그(줌 상태) — 좌우 이동'),
      l('Alt + drag — measure elapsed time between two points.', 'Alt + 드래그 — 두 시점 사이 시간 간격 측정'),
      l('Double-click — reset zoom to the full loaded range.', '더블클릭 — 줌 초기화(불러온 전체 구간)'),
      l('+ / − or [ / ] — zoom in and out (chart focused).', '+ / − 또는 [ / ] — 차트 포커스 시 확대·축소'),
      l('Arrow keys — pan left/right when zoomed; Shift + arrows or Page Up/Down for faster pan.', '방향키 — 줌 상태에서 좌우 이동; Shift+방향키 또는 Page Up/Down으로 빠르게 이동'),
      l('Home / 0 — reset zoom when zoomed.', 'Home / 0 — 줌 상태에서 초기화'),
      l('Esc — cancel selection/measure, then reset zoom, then exit fullscreen.', 'Esc — 선택/측정 취소 → 줌 초기화 → 전체 화면 종료'),
    ],
  },
  {
    kind: 'tip',
    text: l(
      'Click the chart area once so it has focus before using pan/zoom arrow keys.',
      '좌우 이동·줌 방향키는 차트를 클릭해 포커스를 맞춘 뒤 사용하세요. F/T/V/S 등 토글 키는 페이지 어디서나 동작합니다.',
    ),
  },
  {
    kind: 'tip',
    text: l(
      'Horizontal wheel or Shift + vertical wheel pans when zoomed in.',
      '줌인 상태에서 가로 휠 또는 Shift + 세로 휠로 좌우 이동할 수 있습니다.',
    ),
  },
];

export const CHART_MANUAL_KEYBOARD: ManualBlock[] = [
  {
    kind: 'p',
    text: l(
      'Letter keys are matched by physical key position, not the character printed on the key — they work the same in Korean (한글) and English layouts.',
      '알파벳 단축키는 입력 문자가 아니라 물리 키 위치(code)로 인식되어 한글·영문 자판 모두에서 같게 동작합니다.',
    ),
  },
  {
    kind: 'ul',
    items: [
      l('F — toggle fullscreen', 'F — 전체 화면'),
      l('T — toggle hover tooltip', 'T — 호버 툴팁'),
      l('V — toggle field values panel', 'V — 필드 값 패널'),
      l('S — toggle statistics panel', 'S — 통계 패널'),
      l('? (Shift + /) — open this guide', '? (Shift + /) — 이 가이드'),
      l('L — toggle Live mode (anywhere on page)', 'L — Live 모드 (페이지 어디서나)'),
      l('Alt + R — refresh data (anywhere on page)', 'Alt + R — 데이터 새로고침 (페이지 어디서나)'),
    ],
  },
];

export const CHART_MANUAL_MINIMAP: ManualBlock[] = [
  {
    kind: 'p',
    text: l(
      'The strip below the chart shows the full loaded timeline. The highlighted thumb is the window shown in the main chart.',
      '차트 아래 줄은 불러온 전체 시간축입니다. 강조된 썸이 메인 차트에 보이는 구간입니다.',
    ),
  },
  {
    kind: 'ul',
    items: [
      l('Drag the thumb — pan while keeping the same zoom span.', '썸 드래그 — 같은 줌 폭을 유지하며 이동'),
      l('Click the track — center the window on that time.', '트랙 클릭 — 해당 시각을 중심으로 이동'),
      l('When viewing the full range, the thumb spans the entire track (overview).', '전체 구간을 볼 때는 썸이 트랙 전체를 덮습니다(개요).'),
    ],
  },
];

export const CHART_MANUAL_LIVE: ManualBlock[] = [
  {
    kind: 'p',
    text: l(
      'Live mode polls the server every few seconds and appends new points. Zoom, pan, and the minimap are disabled while Live is on.',
      'Live 모드는 몇 초마다 서버에서 새 포인트를 가져옵니다. Live가 켜져 있으면 줌·이동·미니맵은 비활성화됩니다.',
    ),
  },
  {
    kind: 'tip',
    text: l(
      'Turn off Live before inspecting a historical window in detail.',
      '과거 구간을 자세히 보려면 Live를 끈 뒤 Time Range를 조정하세요.',
    ),
  },
];

export const CHART_MANUAL_TOOLBAR: ManualBlock[] = [
  {
    kind: 'ul',
    items: [
      l('Fullscreen — expand the chart card to the screen (F).', '전체 화면 — 차트 카드를 화면에 맞게 확대 (F)'),
      l('Zoom in / out — step zoom on the time axis (+/− or [/]).', '확대 / 축소 — 시간축 단계 줌 (+/− 또는 [/])'),
      l('Reset zoom — same as double-click (Home / 0).', '줌 초기화 — 더블클릭과 동일 (Home / 0)'),
      l('Tooltip — show or hide the hover value popup (T).', '툴팁 — 호버 값 팝업 표시 여부 (T)'),
      l('Field values — show or hide the panel listing values at the cursor time (V).', '필드 값 — 커서 시각의 항목 값 패널 표시 여부 (V)'),
      l('Panel layout — bottom (under the chart) or left (beside the chart).', '패널 위치 — 하단(차트 아래) 또는 좌측(차트 옆)'),
    ],
  },
];
