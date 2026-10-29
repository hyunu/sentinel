# Viz 차트 성능 검증

## 테스트 데이터

N100 서비스의 MongoDB에 아래 합성 데이터를 넣어 검증했습니다.

- 기간: **30일**
- 간격: **5초**
- 원본 UART 문서: **518,400개**
- 60초 rollup: **43,201개**
- 필드: `payload.temperature_celsius`, `payload.humidity_percent`, `payload.sensor_id`, `seq_no`, `fid`
- 보드: `PERF-30D` (`perf-30d-board`)

재현 도구: [`tools/perf`](../tools/perf)

## 개선 전 문제

| 문제 | 영향 |
|---|---|
| 7일 조회 시 120,758개 포인트를 메모리에 전량 적재 | 차트 로딩 시 59ms/131ms/71ms long task, 메모리 18.2MB |
| rollup 43,201개를 모두 min/avg/max 포인트로 확장 후 정렬 | 30일/5개 필드 조회 약 2.8초 |
| hover마다 전체 Viz 페이지 React 재렌더 | 마우스 이동 시 불필요한 렌더링 |
| `crypto.randomUUID()`가 HTTP LAN IP에서 동작하지 않음 | LAN 접속 시 필드 추가 실패 |
| MongoDB 4.4에서 `$setWindowFields`/대용량 sort 실패 | rollup이 없는 구간 조회 500 오류 |
| rollup 조회 시 모든 버킷을 그대로 전개 | 긴 기간에서 응답·렌더링 포인트 과다 |

## 적용한 개선

1. **rollup 병합**
   - 60초 rollup 43,201개를 목표 버킷 수(약 2,666개)로 병합한 뒤 min/avg/max를 생성
   - 30일/5필드 기준 응답 포인트를 8,000개 → 약 2,500개로 축소
2. **전량 적재 기준 강화**
   - `FULL_LOAD_MAX_POINTS` 500,000 → 20,000
   - `FULL_LOAD_BYTE_BUDGET` 100MB → 20MB
   - 7일 데이터가 120k 포인트로 전량 적재되던 문제 제거
   - 상세(detail) 조회 상한 50,000 → 20,000
3. **hover 렌더링 throttle**
   - 차트 툴팁은 canvas에서 즉시 갱신
   - 사이드 값 패널은 80ms 간격으로만 React 상태 갱신
4. **HTTP LAN 환경 호환**
   - `crypto.randomUUID`가 없는 비보안 컨텍스트에서도 Viz item ID 생성
5. **MongoDB 4.4 호환**
   - 대용량 aggregation에 `allowDiskUse` 적용
   - 다운샘플 fallback을 `$setWindowFields`(5.0+)에서 `$bucketAuto`(3.4+)로 교체
6. **rollup 조회 시 min/avg/max 포인트 생성 최소화**
   - 병합된 버킷당 3포인트만 생성하고 마지막에 limit 적용

## 결과

### 서버 응답 (N100, 30일)

| 요청 | 포인트 | 응답 크기 | 시간 |
|---|---:|---:|---:|
| 1개 필드 | 2,542 | 163KB | 0.67~0.79초 |
| 5개 필드 | 2,541 | 277KB | 1.75~1.95초 |
| rollup 없는 fallback (1개 필드) | 8,000 | 575KB | 약 3.9초 |

### 브라우저 상호작용 (Playwright + Chrome, 5개 시리즈)

| 시나리오 | 평균 frame | p95 | p99 | long task |
|---|---:|---:|---:|---:|
| 7일 overview hover/zoom/pan | 16.7ms | 16.7ms | 16.8ms | 없음 |
| 1일 full-load(17,043 포인트) hover/pan | 16.7ms | 16.7ms | 16.8ms | 없음 |
| 30일 overview hover/zoom/pan | 16.7ms | 16.7ms | 16.8ms | 없음 |

약 **60fps**를 유지했고, 7일 데이터의 120k 포인트 전량 적재를 제거한 뒤 long task가 사라졌습니다.

## 남은 제약

- 상세 조회가 20,000 포인트를 넘으면 rollup(60초) 기반으로 표시됩니다.
- 1초 단위 원본을 완전히 보려면 해당 구간을 더 좁혀야 합니다.
- rollup이 전혀 없는 아주 오래된 데이터는 `$bucketAuto` fallback을 사용하므로 첫 조회가 느릴 수 있습니다.
