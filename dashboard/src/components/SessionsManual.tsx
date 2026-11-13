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
          'Sessions group UART rows into meaningful time ranges. Select a board at the top, then create sessions from the overview timeline or with packet rules.',
          '세션은 UART 데이터를 의미 있는 시간 구간으로 묶습니다. 상단에서 보드를 선택한 뒤 전체 데이터 현황에서 직접 구간을 지정하거나 패킷 규칙으로 세션을 만들 수 있습니다.',
        ),
      },
      {
        kind: 'p',
        text: l(
          'Each UART row belongs to at most one session. A row without a session is shown as unassigned.',
          '각 UART 행은 하나의 세션에만 속할 수 있습니다. 세션이 없는 행은 미지정으로 표시됩니다.',
        ),
      },
    ],
  },
  {
    id: 'timeline',
    title: l('Dataset overview', '전체 데이터 현황'),
    blocks: [
      {
        kind: 'ul',
        items: [
          l('The header shows the first and last data time; the moving label follows the mouse cursor.', '상단에 데이터 시작/종료 시각이 표시되고, 마우스를 움직이면 커서 위치의 시각이 따라다닙니다.'),
          l('Blue: rows assigned to a session. Amber: rows that exist but are unassigned. Dark hatched: no data at all.', '파랑: 세션에 지정된 구간, 주황: 데이터는 있지만 미지정인 구간, 어두운 빗금: 데이터가 없는 구간입니다.'),
          l('Density shading shows how many rows fall in each time slice.', '구간 색의 농도로 해당 시간대의 데이터 밀도를 알 수 있습니다.'),
          l('Violet marks a partial overlap between sessions; red marks an identical (full) overlap.', '보라색은 세션끼리 일부만 겹치는 구간, 빨간색은 시작·종료가 완전히 같은 중복 구간입니다.'),
          l('The summary line shows the data coverage ratio, gaps, and overlap counts.', '요약 줄에 데이터 존재 비율, 빈 구간 수/길이, 중복 구간 수가 표시됩니다.'),
        ],
      },
      {
        kind: 'tip',
        text: l(
          'Drag across the timeline to prefill the session form with that range.',
          '타임라인을 드래그하면 선택한 구간이 세션 생성 폼에 자동으로 입력됩니다.',
        ),
      },
    ],
  },
  {
    id: 'create',
    title: l('Creating a session', '세션 만들기'),
    blocks: [
      {
        kind: 'ul',
        items: [
          l('Drag on the timeline or press New session, then enter a name, optional description, start, and end.', '타임라인을 드래그하거나 새 세션 버튼을 누른 뒤 이름, 설명(선택), 시작/종료 시각을 입력합니다.'),
          l('On save, unassigned rows inside the range are linked to the new session.', '저장하면 해당 구간에서 아직 세션에 지정되지 않은 행이 새 세션에 연결됩니다.'),
          l('If the range overlaps an existing session, a confirmation explains that overlapping rows stay with their current session.', '기존 세션과 시간이 겹치면 확인창이 뜨며, 겹치는 구간의 행은 이미 지정된 세션에 남는다는 안내가 표시됩니다.'),
        ],
      },
      {
        kind: 'tip',
        text: l(
          'Sessions with identical ranges are marked as full duplicates; partially overlapping ranges are marked as partial duplicates in both the timeline and the list.',
          '시작·종료가 같은 세션은 완전 중복, 일부만 겹치는 세션은 일부 중복으로 타임라인과 목록에 표시됩니다.',
        ),
      },
    ],
  },
  {
    id: 'list',
    title: l('Session list', '세션 목록'),
    blocks: [
      {
        kind: 'ul',
        items: [
          l('Edit the name and description inline, then save.', '이름과 설명을 목록에서 바로 수정하고 저장할 수 있습니다.'),
          l('Delete removes the session. Its rows become unassigned and can be claimed by a later session.', '삭제하면 세션이 제거되고 해당 행은 미지정으로 돌아가 이후 세션에 할당될 수 있습니다.'),
          l('The range column shows start and end times; overlap tags warn about duplicate coverage.', '구간 열에 시작/종료 시각이 표시되고, 중복 태그로 겹침 여부를 알 수 있습니다.'),
        ],
      },
    ],
  },
  {
    id: 'auto',
    title: l('Auto split by idle time', '유휴 시간 자동 분할'),
    blocks: [
      {
        kind: 'p',
        text: l(
          'Auto split creates sessions from unassigned data by cutting at idle gaps longer than the configured number of seconds.',
          '자동 분할은 설정한 초보다 긴 유휴 구간을 기준으로 미지정 데이터를 나눠 세션을 만듭니다.',
        ),
      },
      {
        kind: 'tip',
        text: l(
          'Use packet rules instead when session boundaries are defined by a protocol packet rather than silence.',
          '무응답 시간이 아니라 특정 패킷으로 경계를 정해야 한다면 패킷 기준 세션 분할을 사용하세요.',
        ),
      },
    ],
  },
  {
    id: 'rules',
    title: l('Split by packet rules', '패킷 기준 세션 분할'),
    blocks: [
      {
        kind: 'p',
        text: l(
          'Rules are evaluated against raw frames parsed with the board protocol. Conditions inside one rule (FID, direction, field, operator, value) are ANDed; rules are ORed.',
          '규칙은 보드 프로토콜로 파싱한 원시 프레임에 대해 평가됩니다. 규칙 하나의 FID·방향·필드·연산자·값은 모두 만족해야 하고(AND), 여러 규칙 중 하나만 맞으면 적용됩니다(OR).',
        ),
      },
      {
        kind: 'ul',
        items: [
          l('Cut at each packet: every matching packet becomes a boundary and the segments between boundaries become sessions.', '패킷마다 분할: 일치하는 패킷마다 경계를 만들고 경계 사이 구간을 세션으로 만듭니다.'),
          l('Start/end packets: a rule marked Start opens a session and a rule marked End closes it. Only the covered ranges become sessions.', '시작/종료 패킷: 시작 역할 규칙이 세션을 열고 종료 역할 규칙이 닫습니다. 시작부터 종료까지의 구간만 세션으로 생성됩니다.'),
          l('With multiple start rules, the first matching packet opens the session; repeated starts are ignored until an end packet closes it.', '시작 규칙이 여러 개면 가장 먼저 일치한 패킷에서 시작하고, 종료 전까지 반복되는 시작 패킷은 무시됩니다.'),
          l('Starts without a matching end are skipped and reported after the split.', '종료 패킷을 만나지 못한 시작은 세션으로 만들지 않고 결과에 경고로 표시됩니다.'),
          l('Splitting replaces existing sessions after confirmation; rows that are already assigned are not stolen.', '분할을 실행하면 확인 후 기존 세션이 교체되며, 이미 다른 세션에 지정된 행은 가져오지 않습니다.'),
          l('The split runs as a background job. The card shows the scan row count and the session-creation phase, with a Cancel split button.', '분할은 백그라운드 작업으로 실행됩니다. 카드에 스캔 행 수와 세션 생성 단계가 표시되고, 분할 취소 버튼으로 중단할 수 있습니다.'),
        ],
      },
      {
        kind: 'tip',
        text: l(
          'Hover the (i) icon next to the card title for the current mode explanation. Large boards scan in the background; progress and cancel stay available in the card.',
          '카드 제목 옆 (i) 아이콘에 마우스를 올리면 현재 모드 설명을 볼 수 있습니다. 데이터가 많은 보드는 백그라운드에서 스캔하며, 카드에서 진행률과 취소를 사용할 수 있습니다.',
        ),
      },
    ],
  },
];

type SessionsManualProps = {
  open: boolean;
  onClose: () => void;
};

export default function SessionsManual({ open, onClose }: SessionsManualProps) {
  const { locale: appLocale } = useTranslation();
  const locale: ManualLocale = appLocale;
  const tipLabel = manualT(MANUAL_UI.tipLabel, locale);

  return (
    <Modal open={open} onClose={onClose} title={manualT(l('Sessions Manual', '세션 매뉴얼'), locale)} wide>
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
              'A row belongs to one session. Overlapping sessions only mark duplicate time ranges, not duplicate data.',
              '행은 하나의 세션에만 속합니다. 세션 겹침은 시간 범위의 중복을 표시할 뿐 데이터가 중복 저장되지는 않습니다.',
            ),
            locale,
          )}
        </p>
      </div>
    </Modal>
  );
}
