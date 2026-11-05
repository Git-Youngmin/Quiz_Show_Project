import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import { CuboidCollider, RigidBody } from "@react-three/rapier";
import type { Group, MeshStandardMaterial } from "three";
import { SPECTATOR_ZONES, THROW_PADS, THROW_PAD_SIZE, isLobbyPhase, type SpectatorZoneDef } from "@quiz/shared";
import { useGameStore } from "../store/useGameStore";
import { audio } from "../audio/AudioManager";

const FLOOR_T = 0.6;
const WALL_T = 0.3;
const PAD_COLOR = "#ff3d9a";

/**
 * 탈락자 관전석 — 보드 정면 앞쪽(+z)에 가로로 길게 뻗은 그랜드스탠드 (type="fixed").
 * 위치/크기/버튼 배치는 서버와 공유 (@quiz/shared 의 SPECTATOR_ZONES / THROW_PADS).
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

      <ZoneLabel position={[depth / 2, wh + 0.9, 0]} />
    </RigidBody>
  );
}

const BUTTON = {
  baseR: 1.05,
  baseH: 0.16,
  capR: 0.72,
  capH: 0.26,
  /** 눌렸을 때 버튼이 내려가는 깊이 */
  travel: 0.2,
};

/**
 * 관전석 앞벽 위 안내 라벨 — 보드 쪽(생존자·송출 화면)에서 보이도록.
 * 관전석 안에 있는 사람에게는 배너/배지로 안내하므로 숨긴다 (보드 한가운데 떠 보이지 않게).
 */
function ZoneLabel({ position }: { position: [number, number, number] }) {
  const inStand = useGameStore((s) => {
    const me = s.selfId ? s.players[s.selfId] : undefined;
    if (!me) return false;
    return !me.alive || (s.lobbySpot === "stand" && isLobbyPhase(s.game.phase));
  });
  if (inStand) return null;
  return (
    <Html position={position} center zIndexRange={[10, 0]}>
      <div className="zone-label">관전석 · 분홍 버튼을 밟으면 방해물 발사!</div>
    </Html>
  );
}

/**
 * 투척 버튼 — 둥근 받침대 위에 튀어나온 입체 버튼 + sensor 충돌체.
 *  - 내 캐릭터(LocalPlayer, userData.localPlayer)가 들어오는 순간 throw_item 요청 + "딸깍" 소리
 *  - 눌림 애니메이션은 내 캐릭터뿐 아니라 버튼 위에 선 모든 탈락자 위치로 판단 → 송출 화면에서도 보임
 *  - 내 쿨타임 동안은 버튼이 회색으로, 준비되면 분홍색으로 반짝임
 * (버튼은 시각 요소라 콜라이더가 없어 걸려 넘어지지 않음)
 */
function ThrowPad({ index, local }: { index: number; local: [number, number] }) {
  const capMat = useRef<MeshStandardMaterial>(null);
  const cap = useRef<Group>(null);
  const localOn = useRef(false);
  const press = useRef({ y: 0, wasDown: false });
  const half = THROW_PAD_SIZE / 2;
  const pad = THROW_PADS[index];
  const floorY = SPECTATOR_ZONES[pad.zone].center[1];

  useFrame((state, delta) => {
    const { throwReadyAt, selfId, players } = useGameStore.getState();

    // 버튼 위에 탈락자가 서 있는지 (내 센서 상태 + 모든 플레이어 위치)
    let down = localOn.current;
    if (!down) {
      // (보드 위 생존자는 관전석에 올 수 없으므로 생존 여부와 관계없이 위치만 봄 — 로비 중 관전석의 생존자 포함)
      for (const id in players) {
        const p = players[id];
        if (Math.abs(p.p[0] - pad.x) < BUTTON.baseR && Math.abs(p.p[2] - pad.z) < BUTTON.baseR && p.p[1] > floorY && p.p[1] < floorY + 2) {
          down = true;
          break;
        }
      }
    }

    // "딸깍": 눌릴 땐 아주 빠르게, 올라올 땐 조금 천천히
    const target = down ? -BUTTON.travel : 0;
    press.current.y += (target - press.current.y) * (1 - Math.exp(-Math.min(delta, 0.1) * (down ? 40 : 14)));
    if (cap.current) cap.current.position.y = BUTTON.baseH + BUTTON.capH / 2 + press.current.y;
    press.current.wasDown = down;

    const m = capMat.current;
    if (m) {
      const me = selfId ? players[selfId] : undefined;
      const coolingDown = !!me && Date.now() < throwReadyAt;
      m.color.set(coolingDown ? "#6b6480" : PAD_COLOR);
      m.emissive.set(coolingDown ? "#000000" : PAD_COLOR);
      m.emissiveIntensity = coolingDown ? 0 : down ? 0.9 : 0.35 + 0.3 * Math.sin(state.clock.elapsedTime * 5 + index);
    }
  });

  return (
    <group position={[local[0], 0, local[1]]}>
      <CuboidCollider
        sensor
        args={[half, 0.6, half]}
        position={[0, 0.6, 0]}
        onIntersectionEnter={({ other }) => {
          if (!(other.rigidBodyObject?.userData as { localPlayer?: boolean } | undefined)?.localPlayer) return;
          localOn.current = true;
          audio.playSfx("tick", { rate: 0.6, volume: 0.8 }); // 딸깍
          const t = other.rigidBody?.translation();
          useGameStore.getState().throwItem(index, t ? [t.x, t.y, t.z] : undefined);
        }}
        onIntersectionExit={({ other }) => {
          if ((other.rigidBodyObject?.userData as { localPlayer?: boolean } | undefined)?.localPlayer) localOn.current = false;
        }}
      />
      {/* 받침대 */}
      <mesh position={[0, BUTTON.baseH / 2, 0]} receiveShadow castShadow>
        <cylinderGeometry args={[BUTTON.baseR * 0.95, BUTTON.baseR, BUTTON.baseH, 32]} />
        <meshStandardMaterial color="#2a2440" metalness={0.3} roughness={0.5} />
      </mesh>
      {/* 받침대 테두리 빛 */}
      <mesh position={[0, BUTTON.baseH + 0.005, 0]} rotation-x={-Math.PI / 2}>
        <ringGeometry args={[BUTTON.capR + 0.06, BUTTON.baseR * 0.93, 32]} />
        <meshBasicMaterial color={PAD_COLOR} toneMapped={false} transparent opacity={0.85} />
      </mesh>
      {/* 눌리는 버튼 */}
      <group ref={cap} position={[0, BUTTON.baseH + BUTTON.capH / 2, 0]}>
        <mesh castShadow>
          <cylinderGeometry args={[BUTTON.capR * 0.92, BUTTON.capR, BUTTON.capH, 32]} />
          <meshStandardMaterial ref={capMat} color={PAD_COLOR} emissive={PAD_COLOR} emissiveIntensity={0.4} roughness={0.3} />
        </mesh>
        {/* 윗면 하이라이트 */}
        <mesh position={[0, BUTTON.capH / 2 + 0.003, 0]} rotation-x={-Math.PI / 2}>
          <circleGeometry args={[BUTTON.capR * 0.55, 24]} />
          <meshBasicMaterial color="#ffffff" transparent opacity={0.35} />
        </mesh>
      </group>
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
