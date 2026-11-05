import { useRef, type MutableRefObject, type ReactNode } from "react";
import { useFrame } from "@react-three/fiber";
import { Capsule, Cone, Html, RoundedBox, Sphere } from "@react-three/drei";
import type { Group } from "three";
import type { CharacterShape } from "@quiz/shared";
import { CHARACTER_CENTER_Y } from "./constants";

/**
 * 폴가이즈풍 젤리빈 캐릭터 (순수 시각 — 물리 X).
 *
 *   몸통(로비에서 고른 모양) + 동글동글 팔 2개 + 발 2개 + 하얀 고글 눈 + 볼터치
 *
 * ⚖️ 공평성: 충돌체는 LocalPlayer / RemotePlayer 에서 모양과 무관하게 항상 같은
 *    CapsuleCollider(반높이 0.3, 반지름 0.5 → 높이 1.6, 지름 1.0)를 쓴다.
 *    아래 치수는 모든 부품이 그 캡슐 안(아래 반구 포함)에 들어가도록 계산한 값이다.
 *
 * 원점 = 충돌체 중심 (발바닥 y = -0.8). 기본 정면은 +z.
 */

/** 부모(LocalPlayer/RemotePlayer)가 매 프레임 채워 주는 움직임 정보 → 팔다리/찌그러짐 애니메이션 */
export interface CharacterMotion {
  /** 수평 속력 */
  speed: number;
  airborne: boolean;
  /** 수직 속도 */
  vy: number;
}

interface ShapeSpec {
  body: (mat: ReactNode) => ReactNode;
  /** 고글 눈 위치 (y, 표면 z, 좌우 간격, 크기) */
  eyes: { y: number; z: number; x: number; r: number };
  /** 팔 위치 (몸통 옆) */
  arm: { x: number; y: number };
}

const SHAPES: Record<CharacterShape, ShapeSpec> = {
  // 정통 젤리빈: 반지름 0.36 캡슐 몸통 (y -0.54 ~ 0.70)
  capsule: {
    body: (m) => (
      <Capsule args={[0.36, 0.52, 10, 20]} position={[0, 0.08, 0]} castShadow>
        {m}
      </Capsule>
    ),
    eyes: { y: 0.3, z: 0.31, x: 0.13, r: 0.12 },
    arm: { x: 0.37, y: 0.0 },
  },
  // 둥근 모서리 상자 몸통
  box: {
    body: (m) => (
      <RoundedBox args={[0.66, 1.1, 0.6]} radius={0.14} smoothness={4} position={[0, 0.08, 0]} castShadow>
        {m}
      </RoundedBox>
    ),
    eyes: { y: 0.3, z: 0.27, x: 0.14, r: 0.12 },
    arm: { x: 0.38, y: 0.0 },
  },
  // 동글동글 공 몸통 (반지름 0.46)
  sphere: {
    body: (m) => (
      <Sphere args={[0.46, 32, 24]} position={[0, -0.06, 0]} castShadow>
        {m}
      </Sphere>
    ),
    eyes: { y: 0.1, z: 0.38, x: 0.12, r: 0.12 },
    arm: { x: 0.4, y: -0.08 },
  },
  // 고깔 몸통 — 눈은 아래쪽 넓은 부분에
  cone: {
    body: (m) => (
      <Cone args={[0.44, 1.25, 32]} position={[0, 0.05, 0]} castShadow>
        {m}
      </Cone>
    ),
    eyes: { y: -0.05, z: 0.2, x: 0.1, r: 0.09 },
    arm: { x: 0.3, y: -0.12 },
  },
};

/** 발: 아래 반구 안에 들어가도록 (|x|=0.12, y=-0.66, r=0.12 → 반구 중심에서 0.495) */
const FOOT = { x: 0.12, y: -0.66, r: 0.12 };
const ARM_R = 0.12;

export function Character({
  color,
  name,
  shape = "capsule",
  isSelf = false,
  motion,
}: {
  color: string;
  name: string;
  shape?: CharacterShape;
  isSelf?: boolean;
  motion?: MutableRefObject<CharacterMotion>;
}) {
  const spec = SHAPES[shape] ?? SHAPES.capsule;
  const { eyes, arm } = spec;

  const rig = useRef<Group>(null);
  const armL = useRef<Group>(null);
  const armR = useRef<Group>(null);
  const footL = useRef<Group>(null);
  const footR = useRef<Group>(null);
  const anim = useRef({ phase: 0, scaleY: 1, wasAirborne: false, idle: Math.random() * 10 });

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.1);
    const a = anim.current;
    const m = motion?.current ?? { speed: 0, airborne: false, vy: 0 };
    a.idle += dt;

    // ── 걷기 사이클: 속도에 비례해 팔다리를 앞뒤로 ──
    const moving = Math.min(1, m.speed / 4);
    if (!m.airborne) a.phase += dt * (6 + m.speed * 1.6) * (moving > 0.05 ? 1 : 0);
    const swing = Math.sin(a.phase) * 0.14 * moving;
    if (footL.current && footR.current) {
      footL.current.position.set(-FOOT.x, FOOT.y + Math.max(0, Math.sin(a.phase)) * 0.06 * moving, swing);
      footR.current.position.set(FOOT.x, FOOT.y + Math.max(0, -Math.sin(a.phase)) * 0.06 * moving, -swing);
    }
    // 공중에선 만세, 걸을 땐 발과 반대로 흔들기
    const armLift = m.airborne ? 0.18 : 0;
    armL.current?.position.set(-arm.x, arm.y + armLift, -swing * 0.8);
    armR.current?.position.set(arm.x, arm.y + armLift, swing * 0.8);

    // ── 스쿼시 & 스트레치: 점프 중 늘어나고, 착지 순간 납작 ──
    if (a.wasAirborne && !m.airborne) a.scaleY = 0.78; // 착지!
    a.wasAirborne = m.airborne;
    const target = m.airborne ? (m.vy > 0 ? 1.12 : 1.04) : 1;
    a.scaleY += (target - a.scaleY) * (1 - Math.exp(-dt * 14));
    // 가만히 있을 때 숨쉬듯 살짝 들썩
    const breathe = m.airborne || moving > 0.05 ? 0 : Math.sin(a.idle * 3) * 0.015;
    const sy = a.scaleY + breathe;
    const sxz = 1 / Math.sqrt(sy); // 부피 보존
    if (rig.current) {
      rig.current.scale.set(sxz, sy, sxz);
      // 발바닥(y=-0.8)을 기준으로 늘고 줄도록 보정 + 걸을 때 통통 튀는 바운스
      rig.current.position.y = -CHARACTER_CENTER_Y * (1 - sy) + Math.abs(Math.sin(a.phase)) * 0.04 * moving;
    }
  });

  const skin = <meshStandardMaterial color={color} roughness={0.35} />;

  return (
    <group>
      <group ref={rig}>
        {spec.body(skin)}

        {/* 팔 */}
        <group ref={armL} position={[-arm.x, arm.y, 0]}>
          <Sphere args={[ARM_R, 16, 12]} castShadow>
            {skin}
          </Sphere>
        </group>
        <group ref={armR} position={[arm.x, arm.y, 0]}>
          <Sphere args={[ARM_R, 16, 12]} castShadow>
            {skin}
          </Sphere>
        </group>

        {/* 발 (살짝 납작한 구) */}
        {(
          [
            [footL, -1],
            [footR, 1],
          ] as const
        ).map(([ref, s]) => (
          <group key={s} ref={ref} position={[s * FOOT.x, FOOT.y, 0]}>
            <Sphere args={[FOOT.r, 16, 12]} scale={[1, 0.75, 1.25]} castShadow>
              {skin}
            </Sphere>
          </group>
        ))}

        {/* 하얀 고글 눈 + 검은 눈동자 */}
        {[-eyes.x, eyes.x].map((ex) => (
          <group key={ex} position={[ex, eyes.y, eyes.z]}>
            <Sphere args={[eyes.r, 20, 16]} scale={[1, 1.1, 0.6]}>
              <meshStandardMaterial color="#ffffff" roughness={0.2} />
            </Sphere>
            <Sphere args={[eyes.r * 0.46, 12, 12]} position={[0, -eyes.r * 0.08, eyes.r * 0.5]}>
              <meshStandardMaterial color="#141414" roughness={0.2} />
            </Sphere>
            {/* 눈 반짝임 */}
            <Sphere args={[eyes.r * 0.14, 8, 8]} position={[eyes.r * 0.18, eyes.r * 0.18, eyes.r * 0.72]}>
              <meshBasicMaterial color="#ffffff" />
            </Sphere>
          </group>
        ))}

        {/* 볼터치 */}
        {[-1, 1].map((s) => (
          <Sphere
            key={s}
            args={[eyes.r * 0.45, 10, 8]}
            position={[s * (eyes.x + eyes.r * 0.9), eyes.y - eyes.r * 1.25, eyes.z - 0.01]}
            scale={[1, 0.6, 0.3]}
          >
            <meshBasicMaterial color="#ff8fb1" transparent opacity={0.7} />
          </Sphere>
        ))}
      </group>

      {/* 이름표 (찌그러짐 영향 없이 고정) */}
      <Html position={[0, CHARACTER_CENTER_Y + 0.45, 0]} center zIndexRange={[10, 0]}>
        <div className={`nameplate${isSelf ? " self" : ""}`}>{name}</div>
      </Html>
    </group>
  );
}
