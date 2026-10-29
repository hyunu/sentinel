# Sentinel chart performance dataset

30일 · 5초 간격 · 518,400개 UART 문서와 60초 rollup을 생성하는 테스트 도구입니다.

## 실행

N100의 `sentinel-mongodb` 컨테이너에 스크립트를 넣고 실행합니다.

```bash
scp tools/perf/seed_sentinel_perf.js n100-pve-dev:/tmp/
ssh n100-pve-dev 'docker cp /tmp/seed_sentinel_perf.js sentinel-mongodb:/tmp/ && \
  docker exec sentinel-mongodb mongo sentinel /tmp/seed_sentinel_perf.js'

scp tools/perf/seed_sentinel_perf_rollups.js n100-pve-dev:/tmp/
ssh n100-pve-dev 'docker cp /tmp/seed_sentinel_perf_rollups.js sentinel-mongodb:/tmp/ && \
  docker exec sentinel-mongodb mongo sentinel /tmp/seed_sentinel_perf_rollups.js'
```

생성되는 보드: `PERF-30D` (`perf-30d-board`)

## 정리

```bash
ssh n100-pve-dev "docker exec sentinel-mongodb mongo sentinel --quiet --eval '
  db.uart_data.deleteMany({board_id:\"perf-30d-board\"});
  db.viz_rollups.deleteMany({board_id:\"perf-30d-board\"});
  db.sessions.deleteMany({board_id:\"perf-30d-board\"});
  db.boards.deleteOne({_id:\"perf-30d-board\"});
'"
```
