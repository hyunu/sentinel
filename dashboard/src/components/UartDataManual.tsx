import Modal from './Modal';
import ManualBlocks from './ManualBlocks';
import {
  MANUAL_UI,
  l,
  t as manualT,
  type ManualBlock,
  type ManualLocale,
} from '../data/parseRulesManual';
import { useTranslation } from '../i18n';
import '../styles/parseRulesManual.css';

type ManualSection = {
  id: string;
  title: ReturnType<typeof l>;
  blocks: ManualBlock[];
};

const SECTIONS: ManualSection[] = [
  {
    id: 'intro',
    title: l('Getting started', '시작하기'),
    blocks: [
      {
        kind: 'p',
        text: l(
          'This page lists the raw UART frames stored for the selected board together with the fields produced by the protocol assigned to that board.',
          '이 화면은 선택한 보드에 저장된 UART 원시 프레임과, 그 보드에 연결된 프로토콜로 파싱된 결과를 함께 보여줍니다.',
        ),
      },
      {
        kind: 'p',
        text: l(
          'Pick a board at the top. The assigned protocol is read-only here; change it on the Boards page. Parsed values always reflect the protocol that was active when each row was parsed.',
          '상단에서 보드를 선택합니다. 연결된 프로토콜은 이 화면에서 수정할 수 없고 보드 화면에서 변경합니다. 파싱 결과는 각 행이 파싱될 당시의 프로토콜을 기준으로 저장됩니다.',
        ),
      },
      {
        kind: 'tip',
        text: l(
          'After changing a protocol, run Reparse so existing rows get the new fields.',
          '프로토콜을 바꾼 뒤에는 재파싱을 실행해야 기존 행에 새 필드가 반영됩니다.',
        ),
      },
    ],
  },
  {
    id: 'filters',
    title: l('Filters', '조회 조건'),
    blocks: [
      {
        kind: 'ul',
        items: [
          l('Board: selects the data source and shows its assigned protocol.', '보드: 조회할 데이터 소스를 선택하고 연결된 프로토콜을 표시합니다.'),
          l('Time range: all, last 1 hour, last 24 hours, last 7 days, or a custom start/end.', '기간: 전체, 최근 1시간, 최근 24시간, 최근 7일, 또는 직접 시작/종료를 지정합니다.'),
          l('Session: limits rows to data assigned to one session.', '세션: 특정 세션에 할당된 데이터만 조회합니다.'),
          l('Direction: all, TX, or RX.', '방향: 전체, TX, RX 중에서 선택합니다.'),
          l('Page size: how many rows are loaded per request.', '행 수: 한 번에 불러올 행 수입니다.'),
        ],
      },
      {
        kind: 'p',
        text: l(
          'Press Search to apply the filters. Changing the board resets the session, rows, and paging state.',
          '조회 버튼을 눌러 조건을 적용합니다. 보드를 바꾸면 세션, 목록, 페이징 상태가 초기화됩니다.',
        ),
      },
      {
        kind: 'tip',
        text: l(
          'Narrow the time range first on large datasets; counts and dumps are much faster.',
          '데이터가 많을 때는 기간을 먼저 좁히면 개수 조회와 다운로드가 훨씬 빠릅니다.',
        ),
      },
    ],
  },
  {
    id: 'table',
    title: l('Reading the table', '표 읽기'),
    blocks: [
      {
        kind: 'ul',
        items: [
          l('Time: receive time of the frame.', '시간: 프레임이 수신된 시각입니다.'),
          l('Dir: TX (sent) or RX (received).', '방향: TX(송신) 또는 RX(수신)입니다.'),
          l('RAW: original hex frame. Long frames are clamped; expand or copy them.', 'RAW: 원본 hex 프레임입니다. 긴 프레임은 접혀서 표시되며 펼치기/복사할 수 있습니다.'),
          l('Parsed: JSON fields produced by the protocol. Expand or copy the full JSON.', '파싱됨: 프로토콜이 만들어낸 JSON 필드입니다. 펼치기 또는 전체 JSON 복사를 사용할 수 있습니다.'),
        ],
      },
      {
        kind: 'p',
        text: l(
          'Rows without parsed fields are counted as missing. Use Reparse to fill them in.',
          '파싱 결과가 없는 행은 누락으로 집계됩니다. 재파싱으로 채울 수 있습니다.',
        ),
      },
    ],
  },
  {
    id: 'download',
    title: l('Download and delete', '내려받기와 삭제'),
    blocks: [
      {
        kind: 'ul',
        items: [
          l('Download exports the currently filtered rows as a data dump.', '다운로드: 현재 조회 조건에 해당하는 행을 데이터 덤프로 내려받습니다.'),
          l('Delete removes stored UART data and cannot be undone. A confirmation phrase is required.', '삭제: 저장된 UART 데이터를 제거하며 되돌릴 수 없습니다. 확인 문구를 입력해야 실행됩니다.'),
        ],
      },
      {
        kind: 'tip',
        text: l(
          'Download a backup before running a large delete.',
          '대량 삭제 전에는 먼저 다운로드로 백업해 두세요.',
        ),
      },
    ],
  },
  {
    id: 'reparse',
    title: l('Reparse', '재파싱'),
    blocks: [
      {
        kind: 'p',
        text: l(
          'Reparse rebuilds parsed fields from the stored raw frames using the current protocol.',
          '재파싱은 저장된 원시 프레임을 현재 프로토콜로 다시 해석해 파싱 필드를 갱신합니다.',
        ),
      },
      {
        kind: 'ul',
        items: [
          l('Scope: the whole board or only the current filter.', '범위: 보드 전체 또는 현재 조회 조건에 해당하는 행만 선택합니다.'),
          l('Mode: fill missing rows only, or reparse every row.', '모드: 누락된 행만 채우거나 모든 행을 다시 파싱합니다.'),
          l('Runs as a background job with progress, ETA, and cancel.', '백그라운드 작업으로 실행되며 진행률, 예상 시간, 취소를 제공합니다.'),
          l('Overwritten rows are backed up first, and rollups are rebuilt when the job finishes.', '덮어쓰는 행은 먼저 백업되고, 작업이 끝나면 집계(rollup)가 다시 생성됩니다.'),
        ],
      },
      {
        kind: 'tip',
        text: l(
          'Reparsing all rows on a large board takes a while. Start with the missing-only mode.',
          '데이터가 많은 보드에서 전체 재파싱은 오래 걸립니다. 먼저 누락만 모드로 실행해 보세요.',
        ),
      },
    ],
  },
];

type UartDataManualProps = {
  open: boolean;
  onClose: () => void;
};

export default function UartDataManual({ open, onClose }: UartDataManualProps) {
  const { locale: appLocale } = useTranslation();
  const locale: ManualLocale = appLocale;
  const tipLabel = manualT(MANUAL_UI.tipLabel, locale);

  return (
    <Modal open={open} onClose={onClose} title={manualT(l('UART Data Manual', 'UART 데이터 매뉴얼'), locale)} wide>
      <div className="parse-rules-manual">
        {SECTIONS.map((section, index) => (
          <details key={section.id} className="manual-section" open={index === 0}>
            <summary>{manualT(section.title, locale)}</summary>
            <div className="manual-section-body">
              <ManualBlocks blocks={section.blocks} locale={locale} tipLabel={tipLabel} />
            </div>
          </details>
        ))}
        <p className="manual-footnote muted">
          {manualT(
            l(
              'Parsed fields depend on the protocol version. Reparse after protocol changes.',
              '파싱 필드는 프로토콜 버전에 따라 달라집니다. 프로토콜 변경 후에는 재파싱하세요.',
            ),
            locale,
          )}
        </p>
      </div>
    </Modal>
  );
}
