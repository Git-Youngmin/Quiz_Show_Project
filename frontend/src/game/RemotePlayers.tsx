import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { CapsuleCollider, RigidBody, type RapierCollider, type RapierRigidBody } from "@react-three/rapier";
import { Vector3, type Group } from "three";
import { useGameStore } from "../store/useGameStore";
import { Character, type CharacterMotion } from "./Character";
import { CAPSULE_HALF_HEIGHT, CAPSULE_RADIUS } from "./constants";

/** 이 거리 이상 차이 나면 보간 없이 순간이동 (리스폰 등) */
const TELEPORT_DISTANCE = 6;
/** 보간 속도 — 15Hz 스냅샷 간격(66ms)을 자연스럽게 메우는 값 */
const SMOOTHING = 12;

/**
 * 나를 제외한 플레이어들.
 * playerIds(입·퇴장 시에만 변경)만 구독 → 스냅샷 수신 때 이 컴포넌트는 리렌더되지 않음.
 */
export function RemotePlayers() {
  const playerIds = useGameStore((s) => s.playerIds);
  const selfId = useGameStore((s) => s.selfId);

  return (
    <>
      {playerIds
        .filter((id) => id !== selfId)
        .map((id) => (
          <RemotePlayer key={id} id={id} />
        ))}
    </>
  );
}

/**
 * 원격 플레이어 1명 — kinematicPosition 강체.
 * 서버 위치를 그대로 따라가지만 충돌체는 있으므로 내 캐릭터와 서로 부딪힘(밀치기).
 */
function RemotePlayer({ id }: { id: string }) {
  // 이름/색은 바뀌지 않으므로 원시값만 구독 (위치 변경으로는 리렌더 X)
  const name = useGameStore((s) => s.players[id]?.name ?? "");
  const color = useGameStore((s) => s.players[id]?.color ?? "#ccc");
  const shape = useGameStore((s) => s.players[id]?.characterShape ?? "cat");
  const accessory = useGameStore((s) => s.players[id]?.accessory ?? "none");
  const alive = useGameStore((s) => s.players[id]?.alive ?? true);
  const collider = useRef<RapierCollider>(null);

  // 탈락한 플레이어는 충돌하지 않음 (떨어지는 중 생존자를 밀지 않도록)
  useEffect(() => {
    collider.current?.setSensor(!alive);
  }, [alive]);

  const body = useRef<RapierRigidBody>(null);
  const visual = useRef<Group>(null);
  const initial = useMemo(() => useGameStore.getState().players[id]?.p ?? [0, 2, 0], [id]);
  const current = useMemo(() => new Vector3(...initial), [initial]);
  const target = useMemo(() => new Vector3(), []);
  const rotY = useRef(0);
  /** 보간된 위치 변화량으로 추정한 움직임 (팔다리 애니메이션용) */
  const motion = useRef<CharacterMotion>({ speed: 0, airborne: false, vy: 0 });
  const prev = useMemo(() => new Vector3(...initial), [initial]);

  useFrame((_, delta) => {
    const p = useGameStore.getState().players[id];
    if (!p || !body.current) return;

    target.set(p.p[0], p.p[1], p.p[2]);
    if (current.distanceTo(target) > TELEPORT_DISTANCE) {
      current.copy(target);
    } else {
      current.lerp(target, 1 - Math.exp(-Math.min(delta, 0.1) * SMOOTHING));
    }
    body.current.setNextKinematicTranslation(current);

    // 이번 프레임 이동량 → 속도 추정 (지수 평활로 떨림 제거)
    const dt = Math.max(1e-3, Math.min(delta, 0.1));
    const k = 1 - Math.exp(-dt * 10);
    const m = motion.current;
    if (prev.distanceTo(current) < 2) {
      // (순간이동한 프레임은 건너뜀 — 속도가 튀지 않게)
      m.speed += (Math.hypot(current.x - prev.x, current.z - prev.z) / dt - m.speed) * k;
      m.vy += ((current.y - prev.y) / dt - m.vy) * k;
      m.airborne = Math.abs(m.vy) > 1.2;
    }
    prev.copy(current);

    // 회전도 최단 경로로 보간
    let d = ((p.r - rotY.current + Math.PI) % (Math.PI * 2)) - Math.PI;
    if (d < -Math.PI) d += Math.PI * 2;
    rotY.current += d * (1 - Math.exp(-delta * SMOOTHING));
    if (visual.current) visual.current.rotation.y = rotY.current;
  });

  return (
    <RigidBody ref={body} type="kinematicPosition" colliders={false} position={initial}>
      {/* 외형과 무관하게 동일한 캡슐 충돌체 */}
      <CapsuleCollider ref={collider} args={[CAPSULE_HALF_HEIGHT, CAPSULE_RADIUS]} />
      <group ref={visual}>
        <Character color={color} shape={shape} accessory={accessory} name={name} motion={motion} />
      </group>
    </RigidBody>
  );
}
