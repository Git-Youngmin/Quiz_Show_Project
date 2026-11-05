import { Suspense, useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import { KeyboardControls } from "@react-three/drei";
import { Physics } from "@react-three/rapier";
import { ConnectionStatus } from "../components/ConnectionStatus";
import { useRoomConnection } from "../lib/useRoomConnection";
import { useGameStore, useSelf, useSelfAlive } from "../store/useGameStore";
import { QuizBanner } from "../components/QuizBanner";
import { KEYBOARD_MAP } from "../game/input/controls";
import { VirtualJoystick, shouldShowJoystick } from "../game/input/VirtualJoystick";
import { World } from "../game/World";
import { LocalPlayer } from "../game/LocalPlayer";
import { RemotePlayers } from "../game/RemotePlayers";
import { CAMERA_OFFSET } from "../game/constants";

/** 참가자 3D 뷰: PC(WASD/방향키 + Space) / 모바일(가상 조이스틱 + 점프 버튼) */
export default function PlayPage() {
  useRoomConnection("player");
  const showJoystick = useMemo(shouldShowJoystick, []);
  const alive = useSelfAlive();

  return (
    <KeyboardControls map={KEYBOARD_MAP}>
      <div className="stage">
        <Canvas shadows camera={{ position: CAMERA_OFFSET, fov: 50 }} dpr={[1, 2]}>
          <Suspense fallback={null}>
            <Physics>
              <World />
              <SelfPlayer />
              <RemotePlayers />
            </Physics>
          </Suspense>
        </Canvas>

        <PlayHud />
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
