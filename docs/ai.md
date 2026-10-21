# Sentinel AI 분석

`POST /api/v1/ai/query`는 선택한 보드의 실제 UART 데이터를 **도구 호출(tool calling)** 로 조회한 뒤, 그 결과만 근거로 답변합니다. LLM이 숫자를 직접 계산하거나 Mongo 쿼리를 생성하지 않으므로, 값·구간·통계는 백엔드가 결정적으로 계산합니다.

```
사용자 질문
  → LLM이 도구 선택
  → Go가 Mongo/rollup 조회
  → LLM이 도구 결과를 요약
  → 답변 + 사용한 도구 + (선택) 차트 스펙
```

## 1. 설정

AI는 선택 사항입니다. `AI_MODEL`이 비어 있으면 서버는 정상 동작하고 `/ai/query`만 `503`을 반환합니다.

| 환경 변수 | 기본값 | 설명 |
|---|---|---|
| `AI_PROVIDER` | `openai` | `openai`(OpenAI 호환) 또는 `anthropic` |
| `AI_BASE_URL` | (없음) | OpenAI 호환 서버의 base URL. 보통 `/v1`까지 포함 |
| `AI_MODEL` | (없음) | 모델 ID. 비어 있으면 AI 비활성 |
| `AI_API_KEY` | (없음) | API 키. 로컬 vLLM/Ollama는 더미 값 사용 가능 |
| `AI_MAX_TOKENS` | `1024` | 응답 최대 토큰 (128~8192) |
| `AI_TEMPERATURE` | `0.2` | 0~2 |
| `AI_TIMEOUT_SECONDS` | `60` | provider 요청 1회 타임아웃 |
| `AI_MAX_TOOL_ROUNDS` | `6` | 도구 호출 라운드 상한 (1~12) |
| `AI_API_TOKEN` | (없음) | 선택. 설정 시 AI 질의/스트리밍 요청에 `X-AI-Token` 또는 `Bearer` 토큰 필요 |
| `AI_RATE_LIMIT_PER_MINUTE` | `30` | 클라이언트 IP별 AI 요청 한도 (1~600) |

`.env.example`을 복사해 `.env`로 사용할 수 있습니다. Docker Compose는 `.env`를 자동으로 읽습니다.

### 상태 확인

```bash
curl http://localhost:5050/api/v1/ai/status
```

```json
{"configured":true,"provider":"openai","model":"exaone-4.0-32b","max_rounds":6,"tools":13}
```

## 2. Provider 예시

### 2.1 EXAONE 4.0 (vLLM, OpenAI 호환)

EXAONE 4.0은 tool calling과 한국어를 지원합니다. vLLM에서 OpenAI 호환 엔드포인트로 서빙합니다.

```bash
vllm serve LGAI-EXAONE/EXAONE-4.0-32B \
  --served-model-name exaone-4.0-32b \
  --enable-auto-tool-choice \
  --tool-call-parser hermes \
  --port 8000
```

```env
AI_PROVIDER=openai
AI_BASE_URL=http://localhost:8000/v1
AI_MODEL=exaone-4.0-32b
AI_API_KEY=local
```

> **라이선스**: EXAONE 4.0 공개 가중치는 기본적으로 **비상업용(NC)** 라이선스입니다. 상용 제품·수익화에 사용하려면 LG AI Research와 별도 계약이 필요합니다. FriendliAI의 EXAONE 서버리스 API는 상용 사용이 허용된 경로로 안내되고 있습니다.

### 2.2 Ollama (로컬, OpenAI 호환)

```bash
ollama serve
ollama run hf.co/LGAI-EXAONE/EXAONE-4.0-32B-GGUF:Q4_K_M
```

```env
AI_PROVIDER=openai
AI_BASE_URL=http://localhost:11434/v1
AI_MODEL=hf.co/LGAI-EXAONE/EXAONE-4.0-32B-GGUF:Q4_K_M
AI_API_KEY=local
```

### 2.3 OpenAI / OpenAI 호환 서비스

```env
AI_PROVIDER=openai
AI_BASE_URL=https://api.openai.com/v1
AI_MODEL=<your-model>
AI_API_KEY=sk-...
```

Qwen, Llama, Gemini 호환 엔드포인트, FriendliAI 등도 `AI_PROVIDER=openai`로 연결할 수 있습니다. 해당 서비스의 OpenAI 호환 base URL과 모델 ID를 사용하세요.

### 2.4 Anthropic (네이티브 Messages API)

```env
AI_PROVIDER=anthropic
AI_BASE_URL=https://api.anthropic.com
AI_MODEL=<your-claude-model>
AI_API_KEY=sk-ant-...
```

`anthropic` provider는 tool use 블록을 네이티브로 변환합니다.

### 2.5 Docker Compose 사용 시

컨테이너 안의 `localhost`는 호스트가 아닙니다. 호스트에서 vLLM/Ollama를 실행 중이라면 macOS/Windows에서는 `host.docker.internal`을 사용하세요.

```env
AI_BASE_URL=http://host.docker.internal:8000/v1
```

Linux에서는 `extra_hosts` 또는 같은 Compose 네트워크에 모델 서버를 추가하는 편이 안전합니다.

## 3. 제공 도구

| 도구 | 역할 |
|---|---|
| `list_boards` | 보드 목록·상태·위치 |
| `get_board` | 보드 상세 + 연결된 프로토콜 |
| `list_protocols` | 프로토콜 목록 + 필드 경로 |
| `get_protocol` | 프로토콜 프레임/필드/메타데이터 |
| `list_fields` | 선택 기간에 실제 저장된 필드와 건수 |
| `stats` | 필드의 count/min/max/avg |
| `query_series` | 필드 시계열 (rollup 활용, 최대 1000 포인트) |
| `find_events` | `field > value` 같은 조건의 연속 구간 |
| `find_anomalies` | z-score / IQR / change-point 기반 이상치 탐지 |
| `compare_sessions` | 세션 간 count/min/max/avg 비교 및 변화율 |
| `list_sessions` | 캡처 세션 목록 |
| `query_raw` | 원본 UART 샘플 (최대 50건) |
| `propose_chart` | 대시보드 차트 스펙 반환 |

### 안전 장치

- 모든 데이터 도구는 **선택한 보드로 고정**됩니다.
- 시간 범위·포인트 수·원본 샘플 수에 상한이 있습니다.
- 필드 이름은 허용 문자만 통과하며, Mongo 쿼리에 직접 삽입되지 않습니다.
- 도구 결과는 16KB로 잘리고, 시스템 프롬프트는 원본 UART/ASCII를 **신뢰하지 않는 데이터**로 취급하도록 지시합니다.
- 도구 호출은 `AI_MAX_TOOL_ROUNDS`와 총 25회로 제한됩니다.
- API 키는 응답이나 로그에 노출되지 않습니다.
- `AI_API_TOKEN`을 설정하면 AI 질의/스트리밍 엔드포인트에 토큰 인증이 적용됩니다. 대시보드는 **설정 → AI 접근 토큰**에 값을 저장하며, 토큰은 브라우저 localStorage에만 보관됩니다.
- AI 요청은 클라이언트 IP별 분당 호출 수로 제한되며, 초과 시 `429 ai_rate_limited`를 반환합니다.

## 4. API

### 요청

```json
{
  "board_id": "sentinel_aabbccddeeff",
  "protocol_id": "preset-temperature-protocol",
  "query": "최근 1시간 온도가 30도를 넘은 구간을 찾아줘",
  "history": [
    {"role": "user", "content": "이전 질문"},
    {"role": "assistant", "content": "이전 답변"}
  ]
}
```

- `protocol_id`는 선택. 없으면 보드에 할당된 프로토콜을 사용합니다.
- `history`는 `user`/`assistant`만 허용되고 최근 10개로 제한됩니다.

### 응답

```json
{
  "answer": "최근 1시간 동안 30도를 넘은 구간은 2회였습니다...",
  "provider": "openai",
  "model": "exaone-4.0-32b",
  "board_id": "sentinel_aabbccddeeff",
  "protocol_id": "preset-temperature-protocol",
  "tool_calls": [
    {"name": "find_events", "arguments": {"field": "payload.temperature_celsius", "op": ">", "value": 30}, "duration_ms": 42}
  ],
  "chart": {
    "board_id": "sentinel_aabbccddeeff",
    "protocol_id": "preset-temperature-protocol",
    "fields": ["payload.temperature_celsius"],
    "start": "2026-10-21T10:00:00Z",
    "end": "2026-10-21T11:00:00Z",
    "aggregation": "raw",
    "bucket_seconds": 60
  },
  "usage": {"prompt_tokens": 1200, "completion_tokens": 180, "total_tokens": 1380},
  "rounds": 3
}
```

대시보드의 AI 질의 페이지는 도구 호출 내역과 차트 카드를 표시하며, “시각화에서 열기”를 누르면 해당 보드·필드·기간으로 Viz 화면을 엽니다. `aggregation`이 `avg`/`min`/`max`이면 Viz가 `/viz/query-items`에 `aggregation`/`bucket_seconds`를 전달하고, 서버가 Mongo `$group`으로 집계한 결과를 차트·커서 값·통계 패널에 사용합니다.

### 스트리밍 (SSE)

`POST /api/v1/ai/query/stream`은 동일한 요청 본문을 받아 `text/event-stream`으로 진행 상황과 토큰을 전송합니다.

```text
data: {"type":"round","round":1}

data: {"type":"tool_call","round":1,"tool_call":{"name":"list_fields","arguments":{"last_minutes":60},"duration_ms":2}}

data: {"type":"round","round":2}

data: {"type":"token","content":"최근 "}

data: {"type":"token","content":"1시간 "}

data: {"type":"done","result":{"answer":"...","tool_calls":[...],"rounds":2}}
```

- `round`: 모델 호출 라운드 시작
- `token`: 응답 텍스트 델타
- `tool_call`: 도구 실행 완료
- `error`: `code`와 사용자용 메시지
- `done`: 최종 `result` (비스트리밍 응답과 동일한 구조)

대시보드는 스트리밍 중 “중단” 버튼으로 `AbortController`를 통해 요청을 취소할 수 있습니다.

## 5. 테스트

```bash
cd backend
go test ./internal/ai ./internal/api ./internal/config
```

- provider 요청/응답 변환은 `httptest`로 실제 HTTP를 사용합니다.
- 에이전트 루프, 도구 오류 전달, 최대 라운드, 히스토리 정제를 테스트합니다.
- OpenAI 호환·Anthropic 스트리밍(SSE) 누적과 tool call 델타를 테스트합니다.
- 시간 범위, 이벤트 구간, 이상치(z-score/IQR/change-point), 필드 경로 추출은 순수 함수 단위 테스트로 검증합니다.

## 6. 문제 해결

| 증상 | 확인 |
|---|---|
| `ai_not_configured` (503) | `AI_MODEL`이 설정됐는지, OpenAI 기본 엔드포인트면 `AI_API_KEY`가 있는지 확인 |
| `ai_request_failed` (502) | 백엔드 로그의 provider 오류 확인. `AI_BASE_URL`에 `/v1` 포함 여부 확인 |
| 504 | `AI_TIMEOUT_SECONDS`, 질의 범위, `AI_MAX_TOOL_ROUNDS` 조정 |
| 도구가 필드를 못 찾음 | `list_fields`로 실제 저장된 필드명 확인 (예: `payload.temperature_celsius`) |
| 차트가 비어 있음 | 해당 기간에 데이터가 있는지, Viz의 보드/프로토콜이 일치하는지 확인 |

## 7. 확장 아이디어

- 자연어 → VizProfile 생성
- 리포트 저장 및 스케줄링
- 임베딩 기반 프로토콜 문서 검색(RAG)
- 세션 자동 분할 규칙 추천
- 이상 탐지 결과를 세션 경계/차트 주석으로 저장

현재 구조는 도구를 추가하는 것만으로 기능을 확장할 수 있습니다. LLM 교체는 `AI_PROVIDER`/`AI_BASE_URL`/`AI_MODEL`만 바꾸면 됩니다.
