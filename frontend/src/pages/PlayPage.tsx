import { Suspense, useEffect, useMemo } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { CLOSE_CODE, MAX_PLAYERS_PER_ROOM, isLobbyPhase } from "@quiz/shared";
import { Canvas } from "@react-three/fiber";
import { KeyboardControls } from "@react-three/drei";
import { Physics } from "@react-three/rapier";
import { ConnectionStatus } from "../components/ConnectionStatus";
import { useRoomConnection } from "../lib/useRoomConnection";
import { useGameStore, useSelf, useSelfAlive } from "../store/useGameStore";
import { QuizBanner } from "../components/QuizBanner";
import { SoundToggle } from "../components/SoundToggle";
import { useGameAudio } from "../audio/useGameAudio";
import { KEYBOARD_MAP } from "../game/input/controls";
import { VirtualJoystick, shouldShowJoystick } from "../game/input/VirtualJoystick";
import { World } from "../game/World";
import { LocalPlayer } from "../game/LocalPlayer";
import { RemotePlayers } from "../game/RemotePlayers";
import { CAMERA_OFFSET, PHYSICS_GRAVITY } from "../game/constants";

/** 참가자 3D 뷰: PC(WASD/방향키 + Space) / 모바일(가상 조이스틱 + 점프 버튼) */
export default function PlayPage() {
  const [params] = useSearchParams();
  // 닉네임 없이 들어오면(공유 링크 등) 로비로 보내 캐릭터를 먼저 고르게 함
  if (!params.get("name")) {
    return <Navigate to={`/?${new URLSearchParams({ room: params.get("room") || "lobby" })}`} replace />;
  }
  return <PlayScene />;
}

function PlayScene() {
  useRoomConnection("player");
  useGameAudio("play");
  const showJoystick = useMemo(shouldShowJoystick, []);
  const alive = useSelfAlive();
  const fatal = useGameStore((s) => s.fatalCloseCode);
  const [params] = useSearchParams();

  // 로비에서 고른 입장 위치 (새로고침해도 URL 로 유지)
  useEffect(() => {
    useGameStore.getState().setLobbySpot(params.get("spot") === "stand" ? "stand" : "board");
    // 처음 들어올 때 한 번만
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 정원(100명) 초과로 서버가 4009 로 끊은 경우
  if (fatal === CLOSE_CODE.ROOM_FULL) return <RoomFull />;

  return (
    <KeyboardControls map={KEYBOARD_MAP}>
      <div className="stage">
        <Canvas shadows camera={{ position: CAMERA_OFFSET, fov: 50 }} dpr={[1, 2]}>
          <Suspense fallback={null}>
            <Physics gravity={PHYSICS_GRAVITY}>
              <World />
              <SelfPlayer />
              <RemotePlayers />
            </Physics>
          </Suspense>
        </Canvas>

        <PlayHud />
        <SoundToggle />
        <PlayCorner />
        <QuizBanner showSelfStatus />
        {/* 탈락 후에도 관전석에서 움직일 수 있으므로 조작 UI 유지 */}
        {showJoystick ? (
          <VirtualJoystick />
        ) : (
          <div className="hint">{alive ? "WASD / 방향키 이동 · Space 점프" : "관전석 · WASD 이동 · Space 점프"}</div>
        )}
      </div>
    </KeyboardControls>
  );
}

/** welcome 을 받아 selfId 가 생기면 서버가 정한 스폰 위치에 내 캐릭터 생성 */
function SelfPlayer() {
  const selfId = useGameStore((s) => s.selfId);
  const spawnVersion = useGameStore((s) => s.spawnVersion);
  const alive = useSelfAlive();
  // 스폰 정보는 접속/라운드 리셋 시점에만 사용 (이후 위치는 로컬 물리엔진이 결정)
  const spawn = useMemo(
    () => (selfId ? useGameStore.getState().players[selfId] : undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selfId, spawnVersion],
  );
  if (!selfId || !spawn) return null;
  // 재접속(selfId 변경) 또는 라운드 리셋(spawnVersion 증가) → key 변경으로 새 위치에 재생성
  return (
    <LocalPlayer
      key={`${selfId}:${spawnVersion}`}
      spawn={spawn.p}
      color={spawn.color}
      shape={spawn.characterShape}
      name={spawn.name}
      alive={alive}
    />
  );
}

function PlayHud() {
  const self = useSelf();
  const count = useGameStore((s) => s.playerIds.length);
  return (
    <div className="hud">
      <ConnectionStatus />
      <div className="row mono" style={{ marginTop: 4 }}>
        {self && (
          <span>
            <span style={{ color: self.color }}>●</span> {self.name}
          </span>
        )}
        <span>참가자 {count}명</span>
      </div>
    </div>
  );
}

function RoomFull() {
  const [params] = useSearchParams();
  return (
    <div className="room-full">
      <div style={{ fontSize: 56 }}>🚪</div>
      <h1>방이 가득 찼어요</h1>
      <p>
        이 방은 최대 {MAX_PLAYERS_PER_ROOM}명까지 참가할 수 있어요.
        <br />
        자리가 나면 다시 시도하거나 다른 방 코드로 입장해 주세요.
      </p>
      <div className="row" style={{ justifyContent: "center" }}>
        <button className="btn" type="button" onClick={() => location.reload()}>
          다시 시도
        </button>
        <Link className="btn secondary" to={`/?${new URLSearchParams({ room: params.get("room") || "lobby" })}`}>
          로비로
        </Link>
      </div>
    </div>
  );
}

/**
 * 오른쪽 위 버튼들
 *  - [나가기]: 방에서 나가 로비로 (연결을 끊어 방 인원에서 바로 빠짐)
 *  - [관전석으로 / 보드로]: 로비(대기·게임 종료) 중 생존자만, 원하는 곳에서 기다리기
 */
function PlayCorner() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const phase = useGameStore((s) => s.game.phase);
  const spot = useGameStore((s) => s.lobbySpot);
  const alive = useSelfAlive();
  const connected = useGameStore((s) => !!s.selfId);
  const canToggle = connected && alive && isLobbyPhase(phase);

  return (
    <div className="play-corner">
      <button
        type="button"
        className="corner-btn"
        onClick={() => {
          if (!confirm("방에서 나갈까요?")) return;
          useGameStore.getState().disconnect();
          navigate(`/?${new URLSearchParams({ room: params.get("room") || "lobby" })}`);
        }}
      >
        나가기
      </button>
      {canToggle && (
        <button
          type="button"
          className="corner-btn accent"
          onClick={() => useGameStore.getState().setLobbySpot(spot === "stand" ? "board" : "stand")}
        >
          {spot === "stand" ? "🟦 보드로" : "🏟 관전석으로"}
        </button>
      )}
    </div>
  );
}
