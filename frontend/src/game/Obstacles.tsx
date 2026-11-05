import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import {
  BallCollider,
  CapsuleCollider,
  CuboidCollider,
  RigidBody,
  type RapierRigidBody,
} from "@react-three/rapier";
import type { Group } from "three";
import { ITEM_LIFETIME_MS, type ItemKind } from "@quiz/shared";
import { useGameStore, type ActiveObstacle } from "../store/useGameStore";

/** 이 높이 아래로 떨어지면 제거 */
const REMOVE_BELOW_Y = -20;
/** 수명 끝 무렵 작아지며 사라지는 시간 */
const SHRINK_MS = 400;

/**
 * 탈락자가 던진 방해물들.
 * 서버가 보낸 같은 초기값(발사 위치·방향·속도)으로 각 클라이언트가 물리를 돌린다.
 * 방해물끼리의 세부 궤적은 기기마다 조금 다를 수 있지만, 내 캐릭터를 밀어내는 판정은 내 화면 기준이라 문제없다.
 */
export function Obstacles() {
  const obstacles = useGameStore((s) => s.obstacles);
  return (
    <>
      {obstacles.map((o) => (
        <Obstacle key={o.id} item={o} />
      ))}
    </>
  );
}

/** 종류별 물리 성질 — 밀도가 높을수록 무거워서 캐릭터(질량 약 0.8)를 더 세게 밀어냄 */
const PHYSICS: Record<ItemKind, { density: number; restitution: number; friction: number }> = {
  banana: { density: 3, restitution: 0.3, friction: 0.4 }, // 미끌미끌 굴러다님
  crate: { density: 4, restitution: 0.15, friction: 0.8 }, // 묵직하게 쿵
  ball: { density: 1.8, restitution: 0.85, friction: 0.3 }, // 통통 튐
};

function Obstacle({ item }: { item: ActiveObstacle }) {
  const body = useRef<RapierRigidBody>(null);
  const visual = useRef<Group>(null);
  const launched = useRef(false);
  const removed = useRef(false);
  const phys = PHYSICS[item.kind];
  // 회전 임펄스는 클라이언트마다 달라도 무방 (보기 좋은 텀블링용)
  const spin = useMemo(() => [Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5], []);

  useFrame(() => {
    const rb = body.current;
    if (!rb || removed.current) return;

    // ── 발사: 콜라이더가 붙어 질량이 계산된 첫 프레임에 impulse = 방향 × 속력 × 질량 ──
    if (!launched.current) {
      const m = rb.mass();
      if (m <= 0) return;
      const [dx, dy, dz] = item.direction;
      rb.applyImpulse({ x: dx * item.speed * m, y: dy * item.speed * m, z: dz * item.speed * m }, true);
      rb.applyTorqueImpulse({ x: spin[0] * m * 0.6, y: spin[1] * m * 0.6, z: spin[2] * m * 0.6 }, true);
      launched.current = true;
    }

    // ── 수명 / 낙하 → 제거 ──
    const age = Date.now() - item.receivedAt;
    const y = rb.translation().y;
    if (age > ITEM_LIFETIME_MS || y < REMOVE_BELOW_Y) {
      removed.current = true;
      useGameStore.getState().removeObstacle(item.id);
      return;
    }
    const left = ITEM_LIFETIME_MS - age;
    if (visual.current) visual.current.scale.setScalar(left < SHRINK_MS ? Math.max(0.01, left / SHRINK_MS) : 1);
  });

  return (
    <RigidBody
      ref={body}
      type="dynamic"
      colliders={false}
      position={item.origin}
      ccd
      userData={{ obstacle: true }}
      restitution={phys.restitution}
      friction={phys.friction}
    >
      {/* 바나나는 외형처럼 눕힌 캡슐 (z 축 90° 회전) */}
      {item.kind === "banana" && <CapsuleCollider args={[0.35, 0.3]} rotation={[0, 0, Math.PI / 2]} density={phys.density} />}
      {item.kind === "crate" && <CuboidCollider args={[0.45, 0.45, 0.45]} density={phys.density} />}
      {item.kind === "ball" && <BallCollider args={[0.55]} density={phys.density} />}
      <group ref={visual}>
        <ObstacleVisual kind={item.kind} />
      </group>
    </RigidBody>
  );
}

/** 외부 모델 없이 기본 도형으로 만든 귀여운 방해물 */
function ObstacleVisual({ kind }: { kind: ItemKind }) {
  switch (kind) {
    case "banana":
      return <Banana />;
    case "crate":
      return (
        <group>
          <mesh castShadow>
            <boxGeometry args={[0.9, 0.9, 0.9]} />
            <meshStandardMaterial color="#ffb84d" roughness={0.7} emissive="#ffb84d" emissiveIntensity={0.25} />
          </mesh>
          {/* 나무 상자 테두리 */}
          {[
            [0, 0.42, 0.42, 0.92, 0.08, 0.08],
            [0, -0.42, 0.42, 0.92, 0.08, 0.08],
            [0, 0.42, -0.42, 0.92, 0.08, 0.08],
            [0, -0.42, -0.42, 0.92, 0.08, 0.08],
          ].map(([x, y, z, w, h, d], i) => (
            <mesh key={i} position={[x, y, z]}>
              <boxGeometry args={[w, h, d]} />
              <meshStandardMaterial color="#b36b1e" />
            </mesh>
          ))}
          <Eyes y={0.1} z={0.46} spread={0.17} r={0.09} />
        </group>
      );
    case "ball":
      return (
        <group>
          <mesh castShadow>
            <sphereGeometry args={[0.55, 24, 16]} />
            <meshStandardMaterial color="#ff5c8a" roughness={0.35} emissive="#ff5c8a" emissiveIntensity={0.25} />
          </mesh>
          <mesh rotation-x={Math.PI / 2}>
            <torusGeometry args={[0.55, 0.05, 8, 32]} />
            <meshStandardMaterial color="#ffffff" />
          </mesh>
          <Eyes y={0.15} z={0.5} spread={0.17} r={0.09} />
        </group>
      );
  }
}

/**
 * 휜 바나나: 토러스의 일부(호)로 몸통을 만들고 양 끝에 갈색 꼭지.
 * 호의 무게중심이 원점(충돌 캡슐 중심)에 오도록 아래로 내림.
 */
const BANANA = { R: 0.5, tube: 0.17, arc: Math.PI * 0.75 };
const BANANA_SHIFT = (BANANA.R * Math.sin(BANANA.arc / 2)) / (BANANA.arc / 2); // 호의 무게중심 거리
function Banana() {
  const { R, tube, arc } = BANANA;
  const start = Math.PI / 2 - arc / 2; // 호가 +y 를 중심으로 좌우 대칭이 되도록
  const tip = (a: number): [number, number, number] => [Math.cos(a) * R, Math.sin(a) * R - BANANA_SHIFT, 0];
  return (
    <group>
      <mesh rotation-z={start} position={[0, -BANANA_SHIFT, 0]} castShadow>
        <torusGeometry args={[R, tube, 12, 24, arc]} />
        <meshStandardMaterial color="#ffe14d" roughness={0.45} emissive="#ffe14d" emissiveIntensity={0.25} />
      </mesh>
      {[start, start + arc].map((a) => (
        <mesh key={a} position={tip(a)}>
          <sphereGeometry args={[tube * 0.75, 10, 8]} />
          <meshStandardMaterial color="#6b4a1f" />
        </mesh>
      ))}
      <Eyes y={R - BANANA_SHIFT + 0.02} z={tube * 0.85} spread={0.09} r={0.07} />
    </group>
  );
}

function Eyes({ y, z, spread, r }: { y: number; z: number; spread: number; r: number }) {
  return (
    <>
      {[-spread, spread].map((x) => (
        <group key={x} position={[x, y, z]}>
          <mesh>
            <sphereGeometry args={[r, 10, 10]} />
            <meshStandardMaterial color="white" />
          </mesh>
          <mesh position={[0, 0, r * 0.65]}>
            <sphereGeometry args={[r * 0.5, 8, 8]} />
            <meshStandardMaterial color="#111" />
          </mesh>
        </group>
      ))}
    </>
  );
}
