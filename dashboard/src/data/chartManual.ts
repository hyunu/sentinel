import type { ManualBlock } from './parseRulesManual';
import { l } from './parseRulesManual';

export const CHART_MANUAL_UI = {
  title: l('Chart Guide', '차트 가이드'),
  tipLabel: l('Tip', '팁'),
  footnote: l(
    'Shortcuts use physical keys (KeyboardEvent.code), so they work in Korean and English layouts.',
    '단축키는 물리 키(code) 기준이라 한글·영문 자판 모두에서 동작합니다.',
  ),
  overview: l('Overview', '개요'),
  configuration: l('Configuration', '설정'),
  interactions: l('Zoom & pan', '줌 · 이동'),
  minimap: l('Bottom minimap', '하단 미니맵'),
  commands: l('Command overlay', '제어명령 표시'),
  liveMode: l('Live mode', 'Live 모드'),
  toolbar: l('Chart toolbar', '차트 툴바'),
  data: l('Data & export', '데이터 · 내보내기'),
  keyboard: l('Keyboard shortcuts', '키보드 단축키'),
};

export const CHART_MANUAL_OVERVIEW: ManualBlock[] = [
  {
    kind: 'p',
    text: l(
      'The chart plots protocol fields on one shared time axis. Choose a board and protocol, pick a time range, add items in Configuration, then refresh.',
      '프로토콜 필드를 하나의 시간축 위에 그립니다. 보드와 프로토콜을 고르고 기간을 선택한 뒤 설정에서 항목을 추가하고 새로고침합니다.',
    ),
  },
  {
    kind: 'ul',
    items: [
      l('Every series shares the X (time) axis; each item can use its own Y axis, unit, offset, weight, and color.', '모든 시리즈는 시간(X)축을 공유하고, 항목마다 Y축·단위·오프셋·가중치·색상을 따로 지정할 수 있습니다.'),
      l('The header shows the selected board, protocol, and time range. Live mode adds new packets as they arrive.', '상단에는 선택한 보드·프로토콜·기간이 표시됩니다. Live 모드에서는 새 패킷이 도착하는 대로 이어서 그립니다.'),
      l('Wide ranges are loaded in two steps: a rough min/max overview first, then detailed samples for the visible window.', '넓은 기간은 두 단계로 불러옵니다. 먼저 전체 윤곽용 min/max 샘플을 그리고, 화면에 보이는 구간의 상세 데이터를 이어서 불러옵니다.'),
    ],
  },
];

export const CHART_MANUAL_CONFIGURATION: ManualBlock[] = [
  {
    kind: 'ul',
    items: [
      l('Board · protocol: the protocol assigned to the board is used for field parsing.', '보드 · 프로토콜: 보드에 지정된 프로토콜로 필드를 파싱합니다.'),
      l('Time range: 1d / 3d / 7d / 15d / 30d / 3m / 6m / 1y / all, or a custom start and end.', '기간: 1일 / 3일 / 7일 / 15일 / 30일 / 3개월 / 6개월 / 1년 / 전체 중에서 고르거나 시작·종료를 직접 지정합니다.'),
      l('Session: sets the chart time range to the selected session start/end (live assignment filtering is not applied).', '세션: 선택한 세션의 시작·종료 시각으로 차트 기간을 맞춥니다. 세션 할당 여부로 행을 필터링하지는 않습니다.'),
      l('Items: add every field at once or search and add individual fields. Each row controls visibility, label, type, Y axis, unit, Y min/max, offset, weight, and color.', '항목: 전체 필드를 한 번에 추가하거나 검색해서 개별 필드를 추가합니다. 각 행에서 표시 여부, 이름, 타입, Y축, 단위, Y 최소/최대, 오프셋, 가중치, 색상을 설정합니다.'),
      l('Auto layout: place visible on/off items below the analog series with fixed spacing.', 'Y축 자동 배치: 표시 중인 on/off 항목을 아날로그 값 아래에 일정 간격으로 배치합니다.'),
      l('Profiles: save the current items and settings per board, add another profile, or delete one.', '프로필: 보드별로 현재 항목과 설정을 저장하고, 프로필을 추가하거나 삭제할 수 있습니다.'),
    ],
  },
  {
    kind: 'tip',
    text: l(
      'Profile changes are kept only after pressing Save changes. Visibility, offset, and weight changes need a save to persist.',
      '프로필 변경은 변경 저장을 눌러야 유지됩니다. 표시 여부·오프셋·가중치 변경도 저장해야 다음에 유지됩니다.',
    ),
  },
];

export const CHART_MANUAL_INTERACTIONS: ManualBlock[] = [
  {
    kind: 'ul',
    items: [
      l('Wheel — zoom in/out around the pointer (time axis).', '휠 — 포인터 기준 시간축 확대·축소'),
      l('Drag on the Y axis — zoom the value axis in/out vertically.', 'Y축 값 위에서 상하 드래그 — 값 축 확대·축소'),
      l('Shift + drag — select a time range to zoom in.', 'Shift + 드래그 — 구간을 지정해 줌인'),
      l('Drag (while zoomed) — pan left/right; drag vertically too when the Y axis is zoomed.', '드래그(줌 상태) — 좌우 이동; Y축이 줌된 상태에서는 상하로도 이동'),
      l('Alt + drag — measure elapsed time between two points.', 'Alt + 드래그 — 두 시점 사이 시간 간격 측정'),
      l('Double-click — reset zoom to the full loaded range and restore the value axis.', '더블클릭 — 줌 초기화(불러온 전체 구간) 및 값 축 원래대로'),
      l('+ / − or [ / ] — zoom in and out (chart focused).', '+ / − 또는 [ / ] — 차트 포커스 시 확대·축소'),
      l('Arrow keys — pan left/right when zoomed; Shift + arrows or Page Up/Down for faster pan.', '방향키 — 줌 상태에서 좌우 이동; Shift+방향키 또는 Page Up/Down으로 빠르게 이동'),
      l('Home / 0 — reset zoom when zoomed.', 'Home / 0 — 줌 상태에서 초기화'),
      l('Esc — cancel selection/measure, then reset zoom, then exit fullscreen.', 'Esc — 선택/측정 취소 → 줌 초기화 → 전체 화면 종료'),
    ],
  },
  {
    kind: 'tip',
    text: l(
      'Click the chart area once so it has focus before using pan/zoom arrow keys. Letter toggles (F/T/V/S) work anywhere on the page.',
      '좌우 이동·줌 방향키는 차트를 클릭해 포커스를 맞춘 뒤 사용하세요. F/T/V/S 같은 토글 키는 페이지 어디서나 동작합니다.',
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

export const CHART_MANUAL_COMMANDS: ManualBlock[] = [
  {
    kind: 'p',
    text: l(
      'The C button shows protocol-defined control commands as vertical lines on the chart. A badge shows how many commands are hidden while the overlay is off.',
      'C 버튼은 프로토콜이 정의한 제어명령을 차트 위 세로선으로 표시합니다. 표시를 끈 상태에서는 배지로 숨겨진 명령 수를 보여줍니다.',
    ),
  },
  {
    kind: 'ul',
    items: [
      l('Command strip: a compact list of TX/RX commands in the current window.', '제어명령 스트립: 현재 구간의 TX/RX 명령을 간단히 보여줍니다.'),
      l('Command list (≡): search commands by content, direction, or time and click one to jump the chart to that moment.', '제어명령 목록(≡): 내용·방향·시각으로 검색하고 항목을 클릭하면 차트가 해당 시각으로 이동합니다.'),
    ],
  },
];

export const CHART_MANUAL_LIVE: ManualBlock[] = [
  {
    kind: 'p',
    text: l(
      'Live mode loads the latest raw parsed samples and appends new packets as they arrive. Your zoom span stays the same and the window follows the newest point. Pan away from the live edge to pause follow.',
      'Live 모드는 방금 파싱된 원본 샘플을 불러오고, 새 패킷이 오면 그대로 이어 그립니다. 줌 폭은 유지한 채 최신 시점으로 따라갑니다. 최신 끝에서 벗어나 이동하면 따라가기를 멈춥니다.',
    ),
  },
  {
    kind: 'tip',
    text: l(
      'Live uses raw packets for the visible tail. History ranges use the sampled overview and detailed data instead.',
      'Live 모드는 보이는 꼬리 구간을 원본 패킷으로 그립니다. 과거 기간은 샘플 개요와 상세 데이터를 사용합니다.',
    ),
  },
];

export const CHART_MANUAL_TOOLBAR: ManualBlock[] = [
  {
    kind: 'ul',
    items: [
      l('Guide (?) — open this manual. Fullscreen (F) expands the chart card.', '가이드(?) — 이 매뉴얼을 엽니다. 전체 화면(F)은 차트 카드를 화면에 맞게 확대합니다.'),
      l('Zoom in / out — step zoom on the time axis (+/− or [ / ]). Reset zoom uses Home or 0.', '확대 / 축소 — 시간축 단계 줌 (+/− 또는 [ / ]). 줌 초기화는 Home 또는 0.'),
      l('Y range — open the dialog to fix the left/right Y axis min and max.', 'Y 범위 — 좌/우 Y축 최소·최대를 직접 고정하는 창을 엽니다.'),
      l('Tooltip (T) — show or hide the hover value popup at the cursor time.', '툴팁(T) — 커서 시각의 호버 값 팝업을 표시하거나 숨깁니다.'),
      l('C — toggle control-command vertical lines. ≡ opens the searchable command list.', 'C — 제어명령 세로선 표시를 켜고 끕니다. ≡는 검색 가능한 제어명령 목록을 엽니다.'),
      l('E — event display settings: hide a protocol event or render it as continuous data.', 'E — 이벤트 표시 설정: 프로토콜 이벤트를 숨기거나 연속 데이터로 표시합니다.'),
      l('V — field values panel. The panel-layout buttons place it below or to the left of the chart.', 'V — 필드 값 패널. 패널 위치 버튼으로 차트 아래나 왼쪽에 둘 수 있습니다.'),
      l('S — statistics panel with min / max / avg / count / last for visible series.', 'S — 표시 중인 시리즈의 min / max / avg / count / last 통계 패널입니다.'),
    ],
  },
];

export const CHART_MANUAL_DATA: ManualBlock[] = [
  {
    kind: 'ul',
    items: [
      l('Refresh reloads the selected range (Alt + R). In Live mode it reloads the raw tail.', '새로고침은 선택한 기간을 다시 불러옵니다(Alt + R). Live 모드에서는 원본 꼬리를 다시 읽습니다.'),
      l('CSV export downloads the currently loaded chart data.', 'CSV 내보내기는 현재 불러온 차트 데이터를 내려받습니다.'),
      l('Changing the time range or fields triggers a new query; the loading indicator shows rough sampling and detail loading separately.', '기간이나 항목을 바꾸면 새로 조회합니다. 로딩 표시는 전체 윤곽 샘플링과 상세 로딩을 구분해 보여줍니다.'),
    ],
  },
  {
    kind: 'tip',
    text: l(
      'Narrow the time range when the chart feels slow; wide ranges load a sampled overview and then fetch detail for the visible window.',
      '차트가 느리면 기간을 좁히세요. 넓은 기간은 샘플 개요를 먼저 그리고 보이는 구간의 상세 데이터를 추가로 불러옵니다.',
    ),
  },
];
