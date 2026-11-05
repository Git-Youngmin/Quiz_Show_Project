import { CuboidCollider, RigidBody } from "@react-three/rapier";
import { BOARD_SIZE, BOARD_THICKNESS } from "./constants";

/**
 * 퀴즈 보드 — 고정(fixed) 물리 바닥.
 * 시각적으로 O(왼쪽, 파랑) / X(오른쪽, 빨강) 구역을 나눠 둠 (판정 로직은 Phase 2).
 */
export function QuizBoard() {
  const half = BOARD_SIZE / 2;
  const t = BOARD_THICKNESS;

  return (
    <RigidBody type="fixed" colliders={false} friction={1}>
      {/* 윗면이 y = 0 이 되도록 아래로 t/2 내림 */}
      <CuboidCollider args={[half, t / 2, half]} position={[0, -t / 2, 0]} />

      {/* 받침대 */}
      <mesh position={[0, -t / 2, 0]} receiveShadow>
        <boxGeometry args={[BOARD_SIZE, t, BOARD_SIZE]} />
        <meshStandardMaterial color="#e9e4ff" />
      </mesh>

      {/* O 구역 */}
      <mesh position={[-half / 2, 0.01, 0]} rotation-x={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[half - 0.3, BOARD_SIZE - 0.6]} />
        <meshStandardMaterial color="#4d8bff" />
      </mesh>
      {/* X 구역 */}
      <mesh position={[half / 2, 0.01, 0]} rotation-x={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[half - 0.3, BOARD_SIZE - 0.6]} />
        <meshStandardMaterial color="#ff5c6c" />
      </mesh>

      <ZoneMark position={[-half / 2, 0.02, 0]} kind="O" />
      <ZoneMark position={[half / 2, 0.02, 0]} kind="X" />
    </RigidBody>
  );
}

/** 바닥에 그려진 큰 O / X 마크 (텍스트 폰트 로딩 없이 지오메트리로 표현) */
function ZoneMark({ position, kind }: { position: [number, number, number]; kind: "O" | "X" }) {
  return (
    <group position={position} rotation-x={-Math.PI / 2}>
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
