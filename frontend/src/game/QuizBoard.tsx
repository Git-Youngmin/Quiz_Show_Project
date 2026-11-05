import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { CuboidCollider, RigidBody, type RapierRigidBody } from "@react-three/rapier";
import { Euler, Quaternion, type MeshStandardMaterial } from "three";
import type { Answer } from "@quiz/shared";
import { useGameStore } from "../store/useGameStore";
import { BOARD_SIZE, BOARD_THICKNESS } from "./constants";

/** 두 타일 사이 틈 (캐릭터 지름 0.9 보다 훨씬 작아서 빠지지 않음) */
const TILE_GAP = 0.2;
/** 바닥이 꺼질 때 하강 가속도 — 중력(9.81)보다 커야 캐릭터가 바닥에서 떨어져 나감 */
const DROP_ACCEL = 30;
const DROP_MIN_Y = -60;

/** O / X 2분할 퀴즈 보드 */
export function QuizBoard() {
  return (
    <>
      <FloorTile zone="O" />
      <FloorTile zone="X" />
    </>
  );
}

const TILE_STYLE: Record<Answer, { color: string; sign: -1 | 1 }> = {
  O: { color: "#4d8bff", sign: -1 },
  X: { color: "#ff5c6c", sign: 1 },
};

/**
 * 바닥 타일 1개 — kinematicPosition 강체.
 *  - 평소: 제자리에 고정 (fixed 와 동일하게 동작)
 *  - reveal 단계 오답 구역: 흔들림 + 깜빡임 (곧 꺼진다는 예고)
 *  - elimination 단계 droppedZone: 가속하며 낙하 + 기울어짐
 *  - waiting 복귀: 아래에서 부드럽게 원위치
 * 상태는 매 프레임 store.getState() 로 읽어 React 리렌더 없이 물리만 갱신한다.
 */
function FloorTile({ zone }: { zone: Answer }) {
  const { color, sign } = TILE_STYLE[zone];
  const width = BOARD_SIZE / 2 - TILE_GAP / 2;
  const cx = sign * (TILE_GAP / 2 + width / 2);
  const t = BOARD_THICKNESS;

  const body = useRef<RapierRigidBody>(null);
  const topMat = useRef<MeshStandardMaterial>(null);
  const sim = useRef({ y: 0, vy: 0, tilt: 0 });
  const euler = useMemo(() => new Euler(), []);
  const quat = useMemo(() => new Quaternion(), []);

  useFrame((state, delta) => {
    const rb = body.current;
    if (!rb) return;
    const dt = Math.min(delta, 0.1);
    const { phase, droppedZone, answer } = useGameStore.getState().game;
    const s = sim.current;
    const time = state.clock.elapsedTime;
    let shakeX = 0;
    let shakeZ = 0;
    let flash = 0;

    if (droppedZone === zone) {
      // ── 낙하 ──
      s.vy += DROP_ACCEL * dt;
      s.y = Math.max(DROP_MIN_Y, s.y - s.vy * dt);
      // 바깥쪽으로 기울어지며 떨어짐
      s.tilt = Math.min(0.5, s.tilt + dt * 0.35) ;
    } else {
      // ── 원위치 복구 ──
      s.vy = 0;
      s.y += (0 - s.y) * (1 - Math.exp(-dt * 3));
      if (Math.abs(s.y) < 0.001) s.y = 0;
      s.tilt += (0 - s.tilt) * (1 - Math.exp(-dt * 3));

      // ── 정답 발표 중 오답 구역: 덜덜 떨림 + 깜빡임 ──
      if (phase === "reveal" && answer && answer !== zone) {
        const amp = 0.06;
        shakeX = Math.sin(time * 61) * amp;
        shakeZ = Math.cos(time * 53) * amp;
        flash = 0.35 + 0.35 * Math.sin(time * 18);
      }
    }

    rb.setNextKinematicTranslation({ x: cx + shakeX, y: s.y, z: shakeZ });
    euler.set(0, 0, -sign * s.tilt);
    rb.setNextKinematicRotation(quat.setFromEuler(euler));
    if (topMat.current) topMat.current.emissiveIntensity = flash;
  });

  return (
    <RigidBody ref={body} type="kinematicPosition" colliders={false} position={[cx, 0, 0]} friction={1}>
      {/* 윗면이 y = 0 (body 원점) */}
      <CuboidCollider args={[width / 2, t / 2, BOARD_SIZE / 2]} position={[0, -t / 2, 0]} />

      <mesh position={[0, -t / 2, 0]} receiveShadow castShadow>
        <boxGeometry args={[width, t, BOARD_SIZE]} />
        <meshStandardMaterial color="#e9e4ff" />
      </mesh>
      <mesh position={[0, 0.01, 0]} rotation-x={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[width - 0.6, BOARD_SIZE - 0.6]} />
        <meshStandardMaterial ref={topMat} color={color} emissive="#ffffff" emissiveIntensity={0} />
      </mesh>
      <ZoneMark kind={zone} />
    </RigidBody>
  );
}

/** 바닥에 그려진 큰 O / X 마크 (폰트 로딩 없이 지오메트리로 표현) */
function ZoneMark({ kind }: { kind: Answer }) {
  return (
    <group position={[0, 0.02, 0]} rotation-x={-Math.PI / 2}>
      {kind === "O" ? (
        <mesh>
          <ringGeometry args={[3, 4.2, 48]} />
          <meshStandardMaterial color="#ffffff" transparent opacity={0.85} />
        </mesh>
      ) : (
        [Math.PI / 4, -Math.PI / 4].map((rot) => (
          <mesh key={rot} rotation-z={rot}>
            <planeGeometry args={[9.5, 1.2]} />
            <meshStandardMaterial color="#ffffff" transparent opacity={0.85} />
          </mesh>
        ))
      )}
    </group>
  );
}
