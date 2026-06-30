export type ManualLocale = 'en' | 'ko';

export type L = { en: string; ko: string };

export function l(en: string, ko: string): L {
  return { en, ko };
}

export function t(text: L, locale: ManualLocale): string {
  return text[locale];
}

export type ManualBlock =
  | { kind: 'p'; text: L }
  | { kind: 'ul'; items: L[] }
  | { kind: 'json'; label?: L; code: string }
  | { kind: 'hex'; label?: L; code: string }
  | { kind: 'tip'; text: L };

export type ManualTypeDoc = {
  type: string;
  summary: L;
  blocks: ManualBlock[];
};

export type ManualGroupDoc = {
  id: string;
  title: L;
  intro: ManualBlock[];
  types: ManualTypeDoc[];
};

export type ManualUi = {
  title: L;
  tipLabel: L;
  footnote: L;
  gettingStarted: L;
  expressions: L;
  workflow: L;
};

export const MANUAL_UI: ManualUi = {
  title: l('Parse Rules Manual', '파싱 규칙 매뉴얼'),
  tipLabel: l('Tip', '팁'),
  footnote: l(
    'Based on Sentinel Serial Parser (parse_rules).',
    'Sentinel Serial Parser(parse_rules) 기준입니다.',
  ),
  gettingStarted: l('Getting started', '시작하기'),
  expressions: l('Expressions (Field vs Expr)', '표현식 (Field vs Expr)'),
  workflow: l('Design workflow', '설계 순서'),
};

export const MANUAL_INTRO: ManualBlock[] = [
  {
    kind: 'p',
    text: l(
      'parse_rules describes how raw UART bytes become named fields. The visual editor and JSON tab edit the same document. The Go engine reads fields top-to-bottom, left-to-right inside nested blocks.',
      'parse_rules는 UART 원시 바이트를 이름 있는 필드로 바꾸는 규칙입니다. 시각 편집과 JSON 탭은 같은 문서를 편집하며, Go 엔진은 필드를 위에서 아래로, 중첩 블록 안에서는 순서대로 읽습니다.',
    ),
  },
  {
    kind: 'p',
    text: l(
      'Think in three layers: (1) frame — fixed header/tail bytes, (2) payload — FID-specific body, (3) nested blocks — repeats, switches, and bit splits inside the payload.',
      '세 층으로 생각하면 쉽습니다: (1) 프레임 — 고정 헤더/테일, (2) payload — FID별 본문, (3) 중첩 블록 — 반복·분기·비트 분할.',
    ),
  },
  {
    kind: 'hex',
    label: l('LCP frame example (simplified)', 'LCP 프레임 예 (단순화)'),
    code: 'AA 00 24 CF 00 6F 00 03 … payload … CRC16 BB',
  },
  {
    kind: 'ul',
    items: [
      l(
        'AA / BB — start and end markers (often validated with Validate + U8)',
        'AA / BB — 시작·종료 마커 (보통 Validate + U8로 검증)',
      ),
      l('length — U16 big-endian, bounds the frame body', 'length — U16 빅엔디안, 프레임 본문 길이'),
      l('fid — U8 command id (207 = CF function call, 205 = CD ACK)', 'fid — U8 명령 ID (207=CF 함수 호출, 205=CD ACK)'),
      l('seq_no, attribute — header fields before payload', 'seq_no, attribute — payload 앞 헤더 필드'),
      l('payload — Switch on fid, then nested repeats for FC/FA blocks', 'payload — fid로 Switch 후 FC/FA 블록 반복'),
      l('crc16 — U16 over bytes from AA through payload end', 'crc16 — AA부터 payload 끝까지 U16 CRC'),
    ],
  },
];

export const MANUAL_EXPRESSIONS: ManualBlock[] = [
  {
    kind: 'p',
    text: l(
      'Many types reference earlier field values via expressions. In the UI, pick Field (name of a parsed field) or Expr (a formula).',
      '많은 타입이 앞에서 파싱한 필드 값을 표현식으로 참조합니다. UI에서는 Field(필드 이름) 또는 Expr(수식)을 선택합니다.',
    ),
  },
  {
    kind: 'ul',
    items: [
      l('Field ref: function_count — repeat that many items', 'Field: function_count — 그 횟수만큼 반복'),
      l('Expr: block_len - 2 — read (total block length minus flag and len bytes)', 'Expr: block_len - 2 — (블록 전체 − flag·len) 바이트 읽기'),
      l('Validate: value == 0xAA — must match or parsing fails', 'Validate: value == 0xAA — 일치하지 않으면 파싱 실패'),
      l('If / Optional predicate: flag == 0xFE — parse child fields only when true', 'If / Optional: flag == 0xFE — 조건이 참일 때만 하위 필드 파싱'),
    ],
  },
  {
    kind: 'json',
    label: l('Expr object form (JSON tab)', 'Expr 객체 형식 (JSON 탭)'),
    code: `{ "length_from": { "expr": "block_len - 2" } }`,
  },
  {
    kind: 'tip',
    text: l(
      'Expressions can use + - * / %, comparisons, && || !, and nested names like attribute.retry_count after Bits fields are parsed.',
      '표현식에는 + - * / %, 비교, && || !, Bits 파싱 후 attribute.retry_count 같은 중첩 이름을 쓸 수 있습니다.',
    ),
  },
];

export const MANUAL_GROUPS: ManualGroupDoc[] = [
  {
    id: 'primitive',
    title: l('Integer / Float', '정수 / 실수'),
    intro: [
      {
        kind: 'p',
        text: l(
          'Read a fixed number of bytes as a number. Multi-byte types need endian: big (MSB first, typical on the wire for LCP) or little.',
          '고정 바이트 수를 숫자로 읽습니다. 2바이트 이상은 endian이 필요합니다: big(와이어 MSB 우선, LCP 일반) 또는 little.',
        ),
      },
    ],
    types: [
      {
        type: 'U8',
        summary: l('1 unsigned byte (0–255).', '부호 없는 1바이트 (0–255).'),
        blocks: [
          { kind: 'json', code: '{ "name": "fid", "type": "U8" }' },
          { kind: 'hex', label: l('Wire', '와이어'), code: 'CF  →  fid = 207' },
        ],
      },
      {
        type: 'U16 / U32',
        summary: l('2 or 4 byte unsigned integers.', '2 또는 4바이트 부호 없는 정수.'),
        blocks: [
          { kind: 'json', code: '{ "name": "length", "type": "U16", "endian": "big" }' },
          { kind: 'hex', label: l('Wire', '와이어'), code: '00 24  →  length = 36' },
        ],
      },
      {
        type: 'I8 / I16 / I32',
        summary: l('Signed integers — same size/endian rules as unsigned.', '부호 있는 정수 — 크기/endian 규칙 동일.'),
        blocks: [{ kind: 'json', code: '{ "name": "offset", "type": "I16", "endian": "big" }' }],
      },
      {
        type: 'Float',
        summary: l('32-bit IEEE float.', '32비트 IEEE 부동소수.'),
        blocks: [{ kind: 'json', code: '{ "name": "temperature", "type": "Float", "endian": "little" }' }],
      },
      {
        type: 'Bool',
        summary: l('1 byte interpreted as boolean (0 = false, non-zero = true).', '1바이트 불리언 (0=false, 그 외=true).'),
        blocks: [{ kind: 'json', code: '{ "name": "enabled", "type": "Bool" }' }],
      },
    ],
  },
  {
    id: 'fixed',
    title: l('Fixed length', '고정 길이'),
    intro: [
      {
        kind: 'p',
        text: l(
          'Consume exactly size bytes every time — no length prefix and no expression.',
          '매번 size 바이트를 정확히 소비합니다 — 길이 prefix나 표현식 없음.',
        ),
      },
    ],
    types: [
      {
        type: 'Fixed',
        summary: l('Raw bytes of fixed size (shown as hex in results).', '고정 크기 raw 바이트 (결과는 hex).'),
        blocks: [{ kind: 'json', code: '{ "name": "magic", "type": "Fixed", "size": 4 }' }],
      },
      {
        type: 'String',
        summary: l('Fixed-size ASCII/UTF-8 text (may include padding nulls).', '고정 길이 문자열 (null 패딩 가능).'),
        blocks: [{ kind: 'json', code: '{ "name": "tag", "type": "String", "size": 8 }' }],
      },
      {
        type: 'Padding',
        summary: l('Skip bytes without storing them — useful for reserved fields.', '바이트를 건너뛰고 저장하지 않음 — 예약 영역용.'),
        blocks: [{ kind: 'json', code: '{ "name": "reserved", "type": "Padding", "size": 2 }' }],
      },
    ],
  },
  {
    id: 'variable',
    title: l('Variable length', '가변 길이'),
    intro: [
      {
        kind: 'p',
        text: l(
          'Length comes from another field or from “rest of container”. Common inside TLV blocks after a len byte is read.',
          '길이는 다른 필드 또는 컨테이너 “나머지”에서 옵니다. len 바이트를 읽은 TLV 블록 안에서 자주 씁니다.',
        ),
      },
    ],
    types: [
      {
        type: 'VarBytes',
        summary: l('Byte blob whose length is length_from (field name or expr).', 'length_from(필드 또는 expr)만큼 바이트 blob.'),
        blocks: [
          {
            kind: 'json',
            code: `{
  "name": "value",
  "type": "VarBytes",
  "length_from": { "expr": "block_len - 2" }
}`,
          },
          {
            kind: 'p',
            text: l(
              'Classic FA argument: block_len includes flag+len+value; value size = block_len − 2.',
              'FA 인자 예: block_len은 flag+len+value 전체; value 크기 = block_len − 2.',
            ),
          },
          { kind: 'hex', label: l('FA block', 'FA 블록'), code: 'FA 05 01 02 03 04 05' },
        ],
      },
      {
        type: 'VarString',
        summary: l('Same as VarBytes but decoded as string.', 'VarBytes와 같으나 문자열로 디코드.'),
        blocks: [{ kind: 'json', code: '{ "name": "label", "type": "VarString", "length_from": "name_len" }' }],
      },
      {
        type: 'Until',
        summary: l('Read bytes until a delimiter (decimal byte values, comma-separated in UI).', '구분자까지 읽기 (UI에서는 10진수, 쉼표 구분).'),
        blocks: [
          { kind: 'json', code: '{ "name": "body", "type": "Until", "delimiter": [187] }' },
          {
            kind: 'tip',
            text: l('187 = 0xBB — often used as end marker when not using a fixed frame tail.', '187 = 0xBB — 고정 tail 없을 때 종료 마커로 사용.'),
          },
        ],
      },
      {
        type: 'UntilEnd',
        summary: l('Consume all remaining bytes in the current container.', '현재 컨테이너의 남은 바이트 전부.'),
        blocks: [
          { kind: 'json', code: '{ "name": "tail_data", "type": "UntilEnd" }' },
          {
            kind: 'p',
            text: l('Use as the last field inside a bounded block or payload.', '경계가 있는 블록 또는 payload의 마지막 필드로 사용.'),
          },
        ],
      },
    ],
  },
  {
    id: 'composite',
    title: l('Structure / Control', '구조 / 제어'),
    intro: [
      {
        kind: 'p',
        text: l(
          'Combine fields, repeat patterns, branch on values, or split one byte into bit flags. These types usually contain nested child fields in the editor.',
          '필드 조합, 반복, 값 분기, 바이트 비트 분할. 편집기에서 하위 필드를 중첩하는 타입들입니다.',
        ),
      },
    ],
    types: [
      {
        type: 'Validate',
        summary: l('Parse inner type, then check validate_expr. Fails if expression is false.', 'inner 파싱 후 validate_expr 검사. 거짓이면 실패.'),
        blocks: [
          {
            kind: 'json',
            code: `{
  "name": "stx",
  "type": "Validate",
  "inner": { "type": "U8" },
  "validate_expr": "value == 0xAA"
}`,
          },
          { kind: 'hex', label: l('Expect', '기대값'), code: 'AA' },
        ],
      },
      {
        type: 'Bits',
        summary: l('Split bytes into named bit fields (widths must sum to byte size).', '바이트를 이름 있는 비트 필드로 분할 (비트 수 합 = 바이트 크기).'),
        blocks: [
          {
            kind: 'json',
            code: `{
  "name": "attribute",
  "type": "Bits",
  "bits": [
    { "name": "retry_count", "bits": 4 },
    { "name": "priority", "bits": 4 }
  ]
}`,
          },
          { kind: 'hex', label: l('One byte 0x03', '1바이트 0x03'), code: 'retry_count=3, priority=0' },
        ],
      },
      {
        type: 'Switch',
        summary: l('Branch payload by key_from (usually fid). Each case key is decimal or hex string.', 'key_from(보통 fid)로 payload 분기. case 키는 10진 또는 hex 문자열.'),
        blocks: [
          {
            kind: 'json',
            code: `{
  "name": "payload",
  "type": "Switch",
  "key_from": "fid",
  "cases": {
    "207": [ { "name": "function_count", "type": "U8" } ],
    "205": [ { "name": "status", "type": "U8" } ]
  }
}`,
          },
          {
            kind: 'tip',
            text: l('207 = 0xCF (function call), 205 = 0xCD (ACK). Add a default case for unknown FIDs.', '207=0xCF(함수 호출), 205=0xCD(ACK). 알 수 없는 FID용 default case 추가 권장.'),
          },
        ],
      },
      {
        type: 'RepeatCount',
        summary: l('Repeat item_rules exactly count_from times (field or expr).', 'count_from 횟수만큼 item_rules 반복.'),
        blocks: [
          {
            kind: 'json',
            code: `{
  "name": "functions",
  "type": "RepeatCount",
  "count_from": "function_count",
  "item_rules": [
    { "name": "flag", "type": "U8" },
    { "name": "len", "type": "U8" }
  ]
}`,
          },
          {
            kind: 'p',
            text: l(
              'LCP CF payload: function_count then that many FC blocks, each with flag, len, function_id, arg_count, FA arguments…',
              'LCP CF payload: function_count 다음 FC 블록 반복 — flag, len, function_id, arg_count, FA 인자…',
            ),
          },
        ],
      },
      {
        type: 'RepeatUntilEnd',
        summary: l('Repeat item_rules until the current container runs out of bytes.', '컨테이너 바이트가 끝날 때까지 item_rules 반복.'),
        blocks: [
          {
            kind: 'json',
            code: `{
  "name": "records",
  "type": "RepeatUntilEnd",
  "item_rules": [ { "name": "code", "type": "U8" } ]
}`,
          },
        ],
      },
      {
        type: 'RepeatUntil',
        summary: l('Repeat while predicate is false; stop when expr becomes true.', 'predicate가 거짓인 동안 반복; expr이 참이면 종료.'),
        blocks: [
          {
            kind: 'json',
            code: `{
  "name": "items",
  "type": "RepeatUntil",
  "predicate": { "expr": "flag == 0x00" },
  "item_rules": [ { "name": "flag", "type": "U8" } ]
}`,
          },
        ],
      },
      {
        type: 'Optional',
        summary: l('Parse nested rules only when predicate is true; otherwise skip.', 'predicate가 참일 때만 rules 파싱, 아니면 건너뜀.'),
        blocks: [
          {
            kind: 'json',
            code: `{
  "name": "error_detail",
  "type": "Optional",
  "predicate": { "expr": "flag == 0xFE" },
  "rules": [ { "name": "code", "type": "U8" } ]
}`,
          },
        ],
      },
      {
        type: 'If',
        summary: l('Like Optional but with then and optional else branches.', 'Optional과 유사하나 then / else 분기.'),
        blocks: [
          {
            kind: 'json',
            code: `{
  "name": "branch",
  "type": "If",
  "predicate": { "expr": "arg_count > 0" },
  "then": [ { "name": "first_arg", "type": "U8" } ],
  "else": [ { "name": "padding", "type": "Padding", "size": 1 } ]
}`,
          },
        ],
      },
      {
        type: 'Struct / Nested',
        summary: l('Struct groups fields under one object. Nested runs a sub-parser on nested fields.', 'Struct는 필드를 객체로 묶음. Nested는 하위 필드에 서브 파서 실행.'),
        blocks: [
          {
            kind: 'json',
            code: `{
  "name": "header",
  "type": "Struct",
  "fields": [
    { "name": "version", "type": "U8" },
    { "name": "flags", "type": "U8" }
  ]
}`,
          },
        ],
      },
      {
        type: 'Array',
        summary: l('Fixed-schema array: count_from × item_type (single field type per item).', 'count_from × item_type 고정 스키마 배열.'),
        blocks: [
          {
            kind: 'json',
            code: `{
  "name": "samples",
  "type": "Array",
  "count_from": "sample_count",
  "item_type": { "type": "U16", "endian": "big" }
}`,
          },
        ],
      },
      {
        type: 'LengthPrefixed',
        summary: l('Read len_type (e.g. U8), then parse item_rules for that many bytes.', 'len_type(예: U8) 읽은 뒤 그 길이만큼 item_rules 파싱.'),
        blocks: [
          {
            kind: 'json',
            code: `{
  "name": "blob",
  "type": "LengthPrefixed",
  "len_type": { "type": "U8" },
  "item_rules": [ { "name": "data", "type": "UntilEnd" } ]
}`,
          },
        ],
      },
      {
        type: 'Computed',
        summary: l('No wire bytes — store expr result as a field (derived values).', '와이어 바이트 없음 — expr 결과를 필드로 저장.'),
        blocks: [{ kind: 'json', code: `{ "name": "total", "type": "Computed", "expr": "function_count * 2" }` }],
      },
      {
        type: 'Transform',
        summary: l('Parse inner type, then apply transform_expr (value variable holds raw read).', 'inner 파싱 후 transform_expr 적용 (value=원시 읽기 값).'),
        blocks: [
          {
            kind: 'json',
            code: `{
  "name": "temp_c",
  "type": "Transform",
  "inner": { "type": "U16", "endian": "big" },
  "transform_expr": "value / 10"
}`,
          },
          { kind: 'p', text: l('Raw 235 → stored as 23.5 after transform.', '원시 235 → transform 후 23.5 저장.') },
        ],
      },
    ],
  },
];

export const MANUAL_WORKFLOW: ManualBlock[] = [
  {
    kind: 'p',
    text: l('Recommended workflow when designing a new protocol:', '새 프로토콜 설계 권장 순서:'),
  },
  {
    kind: 'ul',
    items: [
      l('Sketch the wire layout on paper: markers, fixed header, variable payload, CRC.', '와이어 레이아웃을 종이에 그리기: 마커, 고정 헤더, 가변 payload, CRC.'),
      l('Add top-level fields in order — Validate for magic bytes, U16/U8 for header.', '위에서부터 필드 추가 — 마커는 Validate, 헤더는 U16/U8.'),
      l('Put FID-specific body under Switch keyed on fid.', 'FID별 본문은 fid Switch 아래에.'),
      l('Use RepeatCount for counted lists (function_count, arg_count).', '개수 기반 목록은 RepeatCount (function_count, arg_count).'),
      l('Use VarBytes + length_from expr inside self-sized FA/FC blocks.', 'FA/FC 자기 길이 블록 안에는 VarBytes + length_from expr.'),
      l('Run Parse Test with a known-good HEX capture before saving.', '저장 전 Parse Test로 알려진 good HEX 검증.'),
      l('Save as Protocol for boards, or save as Template to reuse in other protocols.', '보드용 Protocol 저장, 또는 Template로 재사용.'),
    ],
  },
  {
    kind: 'tip',
    text: l(
      'Load template → LCP/OSP default to see a full working example, then modify field names or cases incrementally.',
      'Load template → LCP/OSP default로 전체 예제를 불러온 뒤, 필드명·case를 조금씩 수정하세요.',
    ),
  },
];
