import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import { CuboidCollider, RigidBody } from "@react-three/rapier";
import type { MeshStandardMaterial } from "three";
import { SPECTATOR_ZONES, THROW_PADS, THROW_PAD_SIZE, type SpectatorZoneDef } from "@quiz/shared";
import { useGameStore } from "../store/useGameStore";

const FLOOR_T = 0.6;
const WALL_T = 0.3;
const PAD_COLOR = "#ff3d9a";

/**
 * 탈락자 관전석 — 보드 뒤쪽 좌·우 대각선 위에 하나씩 (type="fixed").
 * 탈락자는 둘 중 무작위 관전석으로 리스폰된다 (LocalPlayer).
 */
export function SpectatorZones() {
  return (
    <>
      {SPECTATOR_ZONES.map((zone, i) => (
        <SpectatorBox key={i} zone={zone} index={i} />
      ))}
    </>
  );
}

/**
 * 관전석 하나 — 보드 중심을 바라보도록 회전한 밀폐 유리 상자.
 * 로컬 +x = 보드 방향(앞), 로컬 z = 좌우. 바닥 + 사방 벽 + 천장 콜라이더로 막혀 있어
 * 안에서는 자유롭게 뛰어다닐 수 있지만 메인 보드로는 나갈 수 없다.
 * 앞쪽 바닥에는 투척 발판(센서), 앞 벽 꼭대기에는 발사대가 있다.
 */
function SpectatorBox({ zone, index }: { zone: SpectatorZoneDef; index: number }) {
  const [depth, width] = zone.size;
  const wh = zone.wallHeight;
  const ch = zone.ceilingHeight;
  const pads = THROW_PADS.map((p, i) => ({ ...p, index: i })).filter((p) => p.zone === index);

  // [위치, 반크기] — 벽은 바닥 윗면(로컬 y=0) 위로 세움
  const walls: { pos: [number, number, number]; half: [number, number, number] }[] = [
    { pos: [depth / 2, wh / 2, 0], half: [WALL_T / 2, wh / 2, width / 2] }, // 앞(보드 쪽)
    { pos: [-depth / 2, wh / 2, 0], half: [WALL_T / 2, wh / 2, width / 2] },
    { pos: [0, wh / 2, width / 2], half: [depth / 2, wh / 2, WALL_T / 2] },
    { pos: [0, wh / 2, -width / 2], half: [depth / 2, wh / 2, WALL_T / 2] },
  ];

  return (
    <RigidBody type="fixed" colliders={false} position={zone.center} rotation={[0, zone.yaw, 0]} friction={1}>
      {/* 바닥 */}
      <CuboidCollider args={[depth / 2, FLOOR_T / 2, width / 2]} position={[0, -FLOOR_T / 2, 0]} />
      <mesh position={[0, -FLOOR_T / 2, 0]} receiveShadow castShadow>
        <boxGeometry args={[depth, FLOOR_T, width]} />
        <meshStandardMaterial color="#3a335c" />
      </mesh>
      <mesh position={[0, 0.01, 0]} rotation-x={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[depth - 0.6, width - 0.6]} />
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
          <mesh position={[pos[0], wh, pos[2]]}>
            <boxGeometry args={[Math.max(half[0] * 2, 0.12), 0.12, Math.max(half[2] * 2, 0.12)]} />
            <meshStandardMaterial color="#ffffff" />
          </mesh>
        </group>
      ))}

      {/* 보이지 않는 천장 — 점프로 벽을 넘는 것을 원천 차단 */}
      <CuboidCollider args={[depth / 2, 0.2, width / 2]} position={[0, ch, 0]} />

      {pads.map((p) => (
        <ThrowPad key={p.index} index={p.index} local={p.local} />
      ))}
      {pads.map((p) => (
        <Launcher key={p.index} position={[depth / 2, wh + 0.1, p.local[1]]} />
      ))}

      <Html position={[-depth / 4, wh + 0.8, 0]} center zIndexRange={[10, 0]}>
        <div className="zone-label">관전석 · 분홍 발판을 밟으면 방해물 발사!</div>
      </Html>
    </RigidBody>
  );
}

/**
 * 투척 발판 — 바닥에 깔린 형광 발판 + sensor 충돌체.
 * 내 캐릭터(LocalPlayer, userData.localPlayer)가 들어오는 순간 throw_item 요청.
 * (원격 플레이어는 탈락 시 센서라 센서-센서 간에는 이벤트가 발생하지 않음)
 * 내 쿨타임 동안은 회색으로 어두워지고, 준비되면 다시 반짝인다.
 */
function ThrowPad({ index, local }: { index: number; local: [number, number] }) {
  const mat = useRef<MeshStandardMaterial>(null);
  const half = THROW_PAD_SIZE / 2;

  useFrame((state) => {
    const m = mat.current;
    if (!m) return;
    const { throwReadyAt, selfId, players } = useGameStore.getState();
    const me = selfId ? players[selfId] : undefined;
    const coolingDown = !!me && !me.alive && Date.now() < throwReadyAt;
    m.color.set(coolingDown ? "#6b6480" : PAD_COLOR);
    m.emissiveIntensity = coolingDown ? 0 : 0.45 + 0.35 * Math.sin(state.clock.elapsedTime * 5 + index);
  });

  return (
    <group position={[local[0], 0, local[1]]}>
      <CuboidCollider
        sensor
        args={[half, 0.6, half]}
        position={[0, 0.6, 0]}
        onIntersectionEnter={({ other }) => {
          if (!(other.rigidBodyObject?.userData as { localPlayer?: boolean } | undefined)?.localPlayer) return;
          const t = other.rigidBody?.translation();
          useGameStore.getState().throwItem(index, t ? [t.x, t.y, t.z] : undefined);
        }}
      />
      <mesh position={[0, 0.03, 0]} rotation-x={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[THROW_PAD_SIZE, THROW_PAD_SIZE]} />
        <meshStandardMaterial ref={mat} color={PAD_COLOR} emissive={PAD_COLOR} emissiveIntensity={0.5} />
      </mesh>
      {/* 보드 방향(로컬 +x) 화살표 */}
      <mesh position={[0.15, 0.05, 0]} rotation-x={-Math.PI / 2} rotation-z={-Math.PI / 2}>
        <circleGeometry args={[0.7, 3]} />
        <meshStandardMaterial color="#ffffff" />
      </mesh>
      <mesh position={[-0.55, 0.05, 0]} rotation-x={-Math.PI / 2}>
        <planeGeometry args={[0.8, 0.35]} />
        <meshStandardMaterial color="#ffffff" />
      </mesh>
    </group>
  );
}

/** 앞 벽 꼭대기의 발사대 — 포구에서 방해물이 튀어나오는 것처럼 보이게 하는 장식(콜라이더 없음) */
function Launcher({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <mesh>
        <cylinderGeometry args={[0.25, 0.32, 0.18, 16]} />
        <meshStandardMaterial color="#3a335c" />
      </mesh>
      {/* 보드 쪽(로컬 +x)으로 45° 기울어진 포신 */}
      <mesh position={[0.22, 0.26, 0]} rotation-z={-Math.PI / 4}>
        <cylinderGeometry args={[0.13, 0.17, 0.6, 16]} />
        <meshStandardMaterial color={PAD_COLOR} emissive={PAD_COLOR} emissiveIntensity={0.3} />
      </mesh>
    </group>
  );
}
