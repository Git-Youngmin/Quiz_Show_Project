# Quiz Show Project

폴가이즈 스타일 3D 서바이벌 + 카훗 스타일 실시간 퀴즈 멀티플레이어 웹앱.

## 구조 (npm workspaces 모노레포)

```
/shared    프론트·백엔드 공용 WebSocket 메시지 타입 (@quiz/shared)
/backend   Cloudflare Worker + Durable Object (방 단위 WebSocket 서버)
/frontend  React + Vite + Zustand (+ R3F / Rapier, Task 2-2에서 3D 씬 추가)
```

## 로컬 실행

```bash
npm install
npm run dev:backend      # 터미널 1: http://127.0.0.1:8787
npm run dev:frontend     # 터미널 2: http://localhost:5173 (/api → 8787 프록시)
npm run test:ws          # (선택) WebSocket 스모크 테스트
npm run test:game -w backend  # (선택) 퀴즈 게임 루프 테스트
```

| 경로 | 용도 |
|---|---|
| `/play?room=lobby&name=홍길동` | 참가자 |
| `/admin?room=lobby` | 방장 패널 |
| `/display?room=lobby` | 방송 송출 뷰 |

배포 시에는 `frontend/.env`에 `VITE_WS_BASE=wss://<worker 주소>`를 설정하세요.

## WebSocket API

`GET /api/rooms/:roomId/ws?role=player|admin|display&name=닉네임`

| 방향 | type | 설명 |
|---|---|---|
| C→S | `move` | `{ p: [x,y,z], r }` 내 위치/회전 (player 전용) |
| C→S | `ping` | `{ t }` 지연 측정 |
| S→C | `welcome` | 접속 직후 내 id와 현재 플레이어 목록 |
| S→C | `player_joined` / `player_left` | 입·퇴장 |
| S→C | `snapshot` | 약 66ms마다 변경된 플레이어 위치 묶음 |
| S→C | `pong` | `{ t, serverTime }` (시계 보정) |
| C→S | `fell` | 플레이어가 보드 밖으로 떨어짐 (진행 중이면 탈락) |
| C→S | `admin_start_question` | `{ question, answer: "O"\|"X", timeLimitSec }` (admin 전용) |
| C→S | `admin_reset` | 진행 중단 + 전원 부활 + 재배치 (admin 전용) |
| S→C | `game_state` | `{ phase, round, question, answer, droppedZone, phaseEndsAt }` |
| S→C | `players_eliminated` | `{ ids }` |
| S→C | `round_reset` | 전원 부활 + 새 스폰 위치 |

## 게임 루프

```
waiting ─(admin 출제)→ countdown 3s → question_active N초 → reveal 3s → elimination 4.5s → waiting
```

- 단계 전환은 Durable Object **Alarm** 으로 처리 (hibernation 후에도 유지)
- 정답은 `reveal` 전까지 클라이언트에 전송되지 않음
- `reveal → elimination` 시 서버가 마지막 위치로 오답 구역(x<0: O, x≥0: X) 플레이어를 탈락 처리

메시지 정의: `shared/src/protocol.ts`
