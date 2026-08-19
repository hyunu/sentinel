# virtual_esp32_board

CSV 캡처 파일을 읽어서 Sentinel 백엔드로 UART 스니핑 데이터처럼 전송하는 독립 실행 프로그램입니다.
기존 UART 테스트 툴에 기능을 추가한 것이 아니라, 보드가 없어도 백엔드/대시보드를 검증할 수 있도록 별도로 분리된 가상 ESP32 보드 도구입니다.

## 기능

- CSV(`Time,Dir,Raw`) 로드
- 가상 보드 자동 등록
- UART 데이터 `/api/v1/data/uart` 전송
- heartbeat `/api/v1/heartbeat` 전송
- 원본 캡처 시간 간격 재생
- 속도 배율, 반복 재생, 최대 전송 개수 제한

## 실행

작업 경로는 저장소 루트 기준입니다.

```bash
dotnet run --project tools/virtual_esp32_board/virtual_esp32_board.csproj -- \
  --server http://localhost:5050 \
  --csv tools/exodus_uart_test/LCP_TEST_M8_2026-06-22_17-29-45.CSV \
  --speed 5 \
  --board-role LCP \
  --uid VESP32
```

## 빠른 검증 예시

```bash
dotnet run --project tools/virtual_esp32_board/virtual_esp32_board.csproj -- \
  --server http://localhost:5050 \
  --csv tools/exodus_uart_test/LCP_TEST_M8_2026-06-22_17-29-45.CSV \
  --speed 50 \
  --max-packets 200 \
  --uid VESP32
```
