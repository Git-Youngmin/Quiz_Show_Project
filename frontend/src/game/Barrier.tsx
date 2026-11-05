import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { CuboidCollider, RigidBody, type RapierRigidBody } from "@react-three/rapier";
import type { Group, MeshBasicMaterial, MeshStandardMaterial } from "three";
import { BOARD_SIZE, isBarrierPhase } from "@quiz/shared";
import { serverNow, useGameStore } from "../store/useGameStore";

/** 점프 최고점(발 높이 약 2.4)보다 높아야 넘어갈 수 없음 */
const HEIGHT = 3.6;
/** 타일 사이 틈(0.2)을 통과할 수 있는 두께 */
const THICKNESS = 0.12;
/** 숨어 있을 때 y — 보드 받침(두께 1) 아래로 완전히 내려감 */
const HIDDEN_Y = -(HEIGHT + 1.3);
const LASER_COUNT = 5;

/**
 * 구역 사이 차단벽 (레이저 펜스 + 유리벽) — kinematicPosition 강체 1개.
 *  - OX       : x = 0 을 따라 한 줄
 *  - MULTIPLE : x = 0, z = 0 을 가로지르는 십자(➕) — 같은 강체에 벽 2개를 붙여 함께 오르내림
 * 서버가 내려준 barrierRaisesAt(서버 시각)이 지나면 바닥 아래에서 솟아오르고,
 * waiting / game_over 가 되면 다시 내려간다. 모든 기기가 서버 시계 기준으로 동시에 움직인다.
 */
export function Barrier() {
  const body = useRef<RapierRigidBody>(null);
  const group = useRef<Group>(null);
  const lasers = useRef<(MeshBasicMaterial | null)[]>([]);
  const glassMats = useRef<(MeshStandardMaterial | null)[]>([]);
  const y = useRef(HIDDEN_Y);
  const quizType = useGameStore((s) => s.game.quizType);
  // 회전 0 = z 축을 따라 뻗은 벽(x=0), 90° = x 축을 따라 뻗은 벽(z=0)
  const walls = quizType === "MULTIPLE" ? [0, Math.PI / 2] : [0];

  useFrame((state, delta) => {
    const rb = body.current;
    if (!rb) return;
    const dt = Math.min(delta, 0.1);
    const { phase, barrierRaisesAt } = useGameStore.getState().game;
    const up = isBarrierPhase(phase) && barrierRaisesAt !== null && serverNow() >= barrierRaisesAt;

    // 올라올 땐 빠르고 단호하게, 내려갈 땐 천천히
    const target = up ? 0 : HIDDEN_Y;
    y.current += (target - y.current) * (1 - Math.exp(-dt * (up ? 7 : 2.5)));
    if (Math.abs(target - y.current) < 0.002) y.current = target;
    rb.setNextKinematicTranslation({ x: 0, y: y.current, z: 0 });

    if (group.current) group.current.visible = y.current > HIDDEN_Y + 0.05;

    // 레이저가 위로 흐르듯 깜빡임
    const t = state.clock.elapsedTime;
    lasers.current.forEach((m, i) => {
      if (m) m.opacity = 0.55 + 0.45 * Math.sin(t * 8 - (i % LASER_COUNT) * 0.9);
    });
    for (const m of glassMats.current) if (m) m.emissiveIntensity = 0.35 + 0.15 * Math.sin(t * 3);
  });

  return (
    <RigidBody ref={body} type="kinematicPosition" colliders={false} position={[0, HIDDEN_Y, 0]}>
      <group ref={group} visible={false}>
        {walls.map((rot, w) => (
          <group key={`${quizType}-${w}`} rotation-y={rot}>
            {/* friction 0: 벽 위에 올라타거나 달라붙지 않도록 */}
            <CuboidCollider args={[THICKNESS / 2, HEIGHT / 2, BOARD_SIZE / 2]} position={[0, HEIGHT / 2, 0]} friction={0} />
            <WallVisual
              glassRef={(m) => (glassMats.current[w] = m)}
              laserRef={(i, m) => (lasers.current[w * LASER_COUNT + i] = m)}
            />
          </group>
        ))}
      </group>
    </RigidBody>
  );
}

/** 벽 하나의 외형: 유리 + 레이저 라인 + 상단 레일 + 양 끝 기둥 (z 축 방향으로 뻗음) */
function WallVisual({
  glassRef,
  laserRef,
}: {
  glassRef: (m: MeshStandardMaterial | null) => void;
  laserRef: (i: number, m: MeshBasicMaterial | null) => void;
}) {
  return (
    <>
      <mesh position={[0, HEIGHT / 2, 0]}>
        <boxGeometry args={[THICKNESS, HEIGHT, BOARD_SIZE]} />
        <meshStandardMaterial ref={glassRef} color="#9ff3ff" emissive="#3fd8ff" transparent opacity={0.22} depthWrite={false} />
      </mesh>
      {Array.from({ length: LASER_COUNT }, (_, i) => (
        <mesh key={i} position={[0, ((i + 0.5) / LASER_COUNT) * HEIGHT, 0]}>
          <boxGeometry args={[THICKNESS * 1.6, 0.05, BOARD_SIZE]} />
          <meshBasicMaterial ref={(m) => laserRef(i, m)} color="#7df9ff" transparent toneMapped={false} />
        </mesh>
      ))}
      <mesh position={[0, HEIGHT, 0]}>
        <boxGeometry args={[0.22, 0.14, BOARD_SIZE + 0.2]} />
        <meshStandardMaterial color="#d8faff" metalness={0.6} roughness={0.3} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[0, HEIGHT / 2, (s * BOARD_SIZE) / 2]}>
          <boxGeometry args={[0.3, HEIGHT, 0.3]} />
          <meshStandardMaterial color="#d8faff" metalness={0.6} roughness={0.3} />
        </mesh>
      ))}
    </>
  );
}
