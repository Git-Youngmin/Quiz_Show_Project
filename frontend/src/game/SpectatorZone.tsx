import { Html } from "@react-three/drei";
import { CuboidCollider, RigidBody } from "@react-three/rapier";
import { SPECTATOR_ZONE } from "./constants";

const FLOOR_T = 0.6;
const WALL_T = 0.3;

/**
 * 탈락자 관전 구역 — 보드 왼쪽 바깥의 밀폐된 유리 상자 (type="fixed").
 * 바닥 + 사방 벽 + 천장 콜라이더로 막혀 있어 안에서는 자유롭게 뛰어다닐 수 있지만
 * 메인 퀴즈 보드로는 나갈 수 없다. (보드 쪽 벽은 투명해서 퀴즈를 잘 볼 수 있음)
 */
export function SpectatorZone() {
  const [cx, cy, cz] = SPECTATOR_ZONE.center;
  const [sx, sz] = SPECTATOR_ZONE.size;
  const wh = SPECTATOR_ZONE.wallHeight;
  const ch = SPECTATOR_ZONE.ceilingHeight;

  // [위치, 반크기] — 벽은 발판 윗면(y=0 기준 로컬) 위로 세움
  const walls: { pos: [number, number, number]; half: [number, number, number] }[] = [
    { pos: [sx / 2, wh / 2, 0], half: [WALL_T / 2, wh / 2, sz / 2] }, // 보드 쪽(+x)
    { pos: [-sx / 2, wh / 2, 0], half: [WALL_T / 2, wh / 2, sz / 2] },
    { pos: [0, wh / 2, sz / 2], half: [sx / 2, wh / 2, WALL_T / 2] },
    { pos: [0, wh / 2, -sz / 2], half: [sx / 2, wh / 2, WALL_T / 2] },
  ];

  return (
    <RigidBody type="fixed" colliders={false} position={[cx, cy, cz]} friction={1}>
      {/* 발판 */}
      <CuboidCollider args={[sx / 2, FLOOR_T / 2, sz / 2]} position={[0, -FLOOR_T / 2, 0]} />
      <mesh position={[0, -FLOOR_T / 2, 0]} receiveShadow castShadow>
        <boxGeometry args={[sx, FLOOR_T, sz]} />
        <meshStandardMaterial color="#3a335c" />
      </mesh>
      <mesh position={[0, 0.01, 0]} rotation-x={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[sx - 0.6, sz - 0.6]} />
        <meshStandardMaterial color="#5a4f8c" />
      </mesh>

      {/* 유리벽 (마찰 0 → 벽에 붙어 기어오르지 못함) */}
      {walls.map(({ pos, half }, i) => (
        <group key={i}>
          <CuboidCollider args={half} position={pos} friction={0} />
          <mesh position={pos}>
            <boxGeometry args={[half[0] * 2, half[1] * 2, half[2] * 2]} />
            <meshStandardMaterial color="#c9e9ff" transparent opacity={0.16} depthWrite={false} />
          </mesh>
          {/* 상단 테두리 */}
          <mesh position={[pos[0], wh, pos[2]]}>
            <boxGeometry args={[Math.max(half[0] * 2, 0.12), 0.12, Math.max(half[2] * 2, 0.12)]} />
            <meshStandardMaterial color="#ffffff" />
          </mesh>
        </group>
      ))}

      {/* 보이지 않는 천장 — 점프로 벽을 넘는 것을 원천 차단 */}
      <CuboidCollider args={[sx / 2, 0.2, sz / 2]} position={[0, ch, 0]} />

      <Html position={[0, wh + 0.8, 0]} center zIndexRange={[10, 0]}>
        <div className="zone-label">관전석</div>
      </Html>
    </RigidBody>
  );
}
