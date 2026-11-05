# Quiz Show Project

**폴가이즈 스타일 3D 서바이벌 + 카훗 스타일 실시간 퀴즈**를 합친 멀티플레이어 웹 게임입니다.
참가자는 폰이나 PC로 접속해 캐릭터를 움직여 **정답 구역에 서 있어야** 합니다. 시간이 끝나면 오답 구역의 바닥이 꺼지고, 마지막까지 살아남은 1명이 우승합니다.

![송출 화면: 정답 발표 직전, 차단벽이 솟아오르고 오답 구역이 깜빡입니다](docs/screenshots/reveal-barrier.jpg)

## 한눈에 보기

| 로비: 캐릭터 고르기 | 모바일: 가상 조이스틱 |
|---|---|
| ![로비](docs/screenshots/lobby.jpg) | ![모바일](docs/screenshots/mobile.jpg) |
| 닉네임, 방 코드, 모양 4종, 색상 6종을 고르고 입장합니다 | 폰에서는 조이스틱과 점프 버튼으로 조작합니다 |

| 문제 진행 (참가자 화면) | 오답 구역 바닥 꺼짐 |
|---|---|
| ![문제 진행](docs/screenshots/play-question.jpg) | ![바닥 꺼짐](docs/screenshots/elimination-drop.jpg) |
| O는 왼쪽, X는 오른쪽. 남은 시간이 화면 위에 표시됩니다 | 오답 구역 타일이 기울어지며 떨어지고, 위에 있던 캐릭터도 함께 떨어집니다 |

| 4지선다 모드 | 십자 차단벽 + 3구역 탈락 |
|---|---|
| ![4지선다](docs/screenshots/multiple-question.jpg) | ![4지선다 탈락](docs/screenshots/multiple-elimination.jpg) |
| 보드가 A·B·C·D 네 구역으로 나뉩니다 | 시간 종료 직전 십자(➕) 유리벽이 솟아 구역 이동을 막습니다 |

| 탈락자 관전석 | 우승자 피날레 |
|---|---|
| ![관전석](docs/screenshots/spectator-zone.jpg) | ![우승](docs/screenshots/winner.jpg) |
| 탈락하면 보드 옆 유리 상자로 이동해 계속 뛰어다니며 구경합니다 | 최후의 1인에게 카메라가 줌인하고 머리 위로 색종이가 터집니다 |

<details>
<summary>관리자 패널 · 대기 화면 보기</summary>

| 관리자 패널 (4지선다 출제) | 송출 화면 (대기 중) |
|---|---|
| ![관리자](docs/screenshots/admin.jpg) | ![대기](docs/screenshots/display-waiting.jpg) |

</details>

## 화면 구성

| 경로 | 누가 쓰나 | 내용 |
|---|---|---|
| `/` | 참가자 | 로비 (닉네임·방 코드·캐릭터 선택) |
| `/play?room=…` | 참가자 | 3D 플레이 화면 (PC: WASD/방향키 + Space, 모바일: 조이스틱) |
| `/admin?room=…` | 진행자 | 문제 출제(O/X · 4지선다), 진행 상황, 라운드 리셋 |
| `/display?room=…` | 방송 송출 | UI를 최소화한 관전 뷰, 게임 단계별 다이나믹 카메라 |

## 기술 스택

| 영역 | 사용 기술 |
|---|---|
| 프론트엔드 | React 19, Vite, React Three Fiber, @react-three/rapier(물리), drei, Zustand, React Router |
| 백엔드 | Node.js + TypeScript + `ws` (방 단위 WebSocket, 서버 메모리 상태) |
| 공용 | `@quiz/shared`: 메시지 타입, 구역 판정(`zoneAt`), 상수 |

```
/shared    프론트·백엔드 공용 메시지 규약 (shared/src/protocol.ts)
/backend   Node.js WebSocket 서버 (src/GameRoom.ts = 방 1개의 게임 상태/타이머)
/frontend  React + R3F 클라이언트
/docs      스크린샷
```

## 로컬 실행

```bash
npm install
```

```bash
npm run dev:backend
```

```bash
npm run dev:frontend
```

두 명령을 각각 다른 터미널에서 실행한 뒤 http://localhost:5173 에 접속하세요. 개발 중에는 Vite가 `/api` 요청(WebSocket 포함)을 백엔드(`:8787`)로 전달합니다. 같은 Wi-Fi의 폰에서는 `http://<PC IP>:5173`으로 접속할 수 있습니다.

테스트 (백엔드 실행 중에):

```bash
npm run test:ws
```

```bash
npm run test:game
```

## 무료 배포 (Render.com)

Node 서버 하나가 **빌드된 프론트엔드와 WebSocket을 함께 서빙**하므로, 무료 웹 서비스 1개로 배포할 수 있습니다.

1. Render 대시보드에서 **New → Blueprint**를 누르고 이 저장소를 선택합니다. `render.yaml` 설정이 자동으로 적용됩니다.
2. 배포가 끝나면 `https://<서비스명>.onrender.com`으로 접속합니다.

직접 설정할 경우: Build Command `npm ci --include=dev && npm run build`, Start Command `npm start`

| 환경 변수 | 기본값 | 설명 |
|---|---|---|
| `PORT` | `8787` | Render가 자동으로 지정 |
| `ALLOWED_ORIGINS` | `*` | WebSocket 허용 Origin (쉼표 구분) |
| `STATIC_DIR` | `frontend/dist` | 서빙할 프론트엔드 빌드 폴더 |

> **무료 플랜 참고:** 15분 동안 요청이 없으면 서버가 잠들고, 다음 접속 때 깨어나는 데 30초~1분 정도 걸립니다. 방송 전에 미리 한 번 접속해 두세요. 게임 상태는 메모리에만 있어서 서버가 재시작되면 초기화됩니다.

프론트엔드를 다른 곳(정적 호스팅)에 따로 올릴 때는 빌드 전에 `frontend/.env`에 `VITE_WS_BASE=wss://<서버 주소>`를 설정하세요.

## 게임 규칙과 흐름

```
waiting ─(관리자 출제)→ countdown 3s → question_active N초 → reveal 3s → elimination 4.5s ─┬→ waiting
                                                                                         └→ game_over (생존자 ≤ 1)
```

| 퀴즈 유형 | 보드 분할 | 정답 구역 |
|---|---|---|
| O/X | 좌우 2분할 (x = 0) | O 왼쪽 · X 오른쪽 |
| 4지선다 | 십자 4분할 (x = 0, z = 0) | A 좌상 · B 우상 · C 좌하 · D 우하 |

- 정답은 `reveal` 전까지 클라이언트에 보내지 않습니다.
- 제한 시간 종료 1.5초 전에 구역 사이 차단벽이 솟아오릅니다. 모든 기기가 서버 시계에 맞춰 같은 순간에 움직입니다.
- 정답 발표 시점에 각 플레이어의 구역을 확정해 두고, 그 값으로 탈락을 판정합니다. 벽이 올라온 뒤 위치를 조작해도 결과가 바뀌지 않습니다.
- 탈락자는 바닥을 뚫고 떨어진 뒤 관전석으로 이동합니다.
- 생존자가 1명 이하가 되면 `game_over`입니다. 관리자가 라운드를 리셋하면 새 게임이 시작됩니다.
- 캐릭터 모양은 4가지지만, 물리 충돌체는 모두 같은 크기의 캡슐이라 유불리가 없습니다.

## WebSocket API

`/api/rooms/:roomId/ws?role=player|admin|display&name=닉네임&shape=capsule|box|sphere|cone&color=%23ff5c8a`

| 방향 | type | 설명 |
|---|---|---|
| C→S | `move` | `{ p: [x,y,z], r }` 내 위치/회전 (player 전용, 최대 20Hz) |
| C→S | `ping` | `{ t }` 지연 측정·시계 보정 |
| C→S | `fell` | 보드 밖으로 떨어짐 (문제 진행 중이면 탈락) |
| C→S | `admin_start_question` | `{ quizType: "OX", answer: "O"\|"X" }` 또는 `{ quizType: "MULTIPLE", answer: "A"~"D", choices: [4개] }` + `question`, `timeLimitSec` |
| C→S | `admin_reset` | 진행 중단 + 전원 부활 + 재배치 |
| S→C | `welcome` | 접속 직후: 내 id, 플레이어 목록(외형 포함), 게임 상태, 서버 시각 |
| S→C | `player_joined` / `player_left` | 입장·퇴장 |
| S→C | `snapshot` | 약 15Hz, 움직인 플레이어의 위치·회전만 |
| S→C | `game_state` | `{ phase, round, quizType, question, choices, answer, droppedZones, phaseEndsAt, barrierRaisesAt, winnerId }` |
| S→C | `players_eliminated` | `{ ids }` |
| S→C | `round_reset` | 전원 부활 + 새 스폰 위치 |

> 관리자 인증은 아직 없습니다. `role=admin`으로 접속하면 누구나 출제할 수 있으니, 공개 방송에서는 방 코드를 추측하기 어렵게 정하세요.
