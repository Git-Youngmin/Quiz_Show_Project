import { Box, Capsule, Cone, Html, Sphere } from "@react-three/drei";
import type { CharacterShape } from "@quiz/shared";
import { CAPSULE_HALF_HEIGHT, CAPSULE_RADIUS, CHARACTER_CENTER_Y } from "./constants";

/**
 * 캐릭터 외형 (순수 시각 — 물리 X).
 *
 * ⚖️ 공평성: 물리 충돌체는 LocalPlayer / RemotePlayer 에서 모양과 무관하게
 *    항상 같은 CapsuleCollider(높이 1.6, 반지름 0.45)를 쓴다.
 *    여기서는 모든 모양이 그 캡슐과 같은 높이(-0.8 ~ +0.8)에 서도록 크기/위치만 맞춘다.
 *
 * 원점 = 충돌체 중심. 기본 정면은 +z 방향 (눈이 붙는 쪽).
 */

const BOTTOM = -CHARACTER_CENTER_Y; // -0.8 : 발바닥 높이

interface EyeLayout {
  /** 눈 높이 */
  y: number;
  /** 표면에 붙는 z 위치 */
  z: number;
  /** 두 눈 사이 반 간격 */
  x: number;
  /** 흰자 반지름 */
  r: number;
}

interface ShapeSpec {
  body: (color: string) => React.ReactNode;
  eyes: EyeLayout;
}

const material = (color: string) => <meshStandardMaterial color={color} roughness={0.4} />;

const SPHERE_R = 0.62;
const CONE_R = 0.62;
const CONE_H = CHARACTER_CENTER_Y * 2;
const BOX = [0.86, 1.5, 0.86] as const;

/** 반지름 r 인 구 표면 위, 높이 dy·가로 dx 지점의 z 좌표 */
const sphereZ = (r: number, dy: number, dx: number) => Math.sqrt(Math.max(0, r * r - dy * dy - dx * dx));

const SHAPES: Record<CharacterShape, ShapeSpec> = {
  // 젤리빈 — 충돌체와 정확히 같은 모양
  capsule: {
    body: (c) => (
      <Capsule args={[CAPSULE_RADIUS, CAPSULE_HALF_HEIGHT * 2, 8, 16]} castShadow>
        {material(c)}
      </Capsule>
    ),
    eyes: { y: CAPSULE_HALF_HEIGHT * 0.9, z: CAPSULE_RADIUS * 0.85, x: 0.17, r: 0.12 },
  },
  // 각진 상자
  box: {
    body: (c) => (
      <Box args={[...BOX]} position={[0, BOTTOM + BOX[1] / 2, 0]} castShadow>
        {material(c)}
      </Box>
    ),
    eyes: { y: 0.3, z: BOX[2] / 2, x: 0.19, r: 0.11 },
  },
  // 동글동글 공 — 바닥에 닿도록 아래로 내림
  sphere: {
    body: (c) => (
      <Sphere args={[SPHERE_R, 32, 24]} position={[0, BOTTOM + SPHERE_R, 0]} castShadow>
        {material(c)}
      </Sphere>
    ),
    eyes: (() => {
      const cy = BOTTOM + SPHERE_R; // 구 중심 높이
      const y = cy + 0.14;
      const x = 0.2;
      return { y, z: sphereZ(SPHERE_R, y - cy, x) - 0.04, x, r: 0.12 };
    })(),
  },
  // 고깔 — 눈은 아래쪽 넓은 부분에
  cone: {
    body: (c) => (
      <Cone args={[CONE_R, CONE_H, 32]} castShadow>
        {material(c)}
      </Cone>
    ),
    eyes: (() => {
      const y = -0.1;
      const radiusAtY = (CONE_R * (CONE_H / 2 - y)) / CONE_H;
      const x = 0.12;
      return { y, z: Math.sqrt(radiusAtY * radiusAtY - x * x) - 0.02, x, r: 0.095 };
    })(),
  },
};

export function Character({
  color,
  name,
  shape = "capsule",
  isSelf = false,
}: {
  color: string;
  name: string;
  shape?: CharacterShape;
  isSelf?: boolean;
}) {
  const spec = SHAPES[shape] ?? SHAPES.capsule;
  const { y, z, x, r } = spec.eyes;

  return (
    <group>
      {spec.body(color)}

      {/* 눈: 흰자 + 검은 눈동자 → 앞뒤 구분 */}
      {[-x, x].map((ex) => (
        <group key={ex} position={[ex, y, z]}>
          <Sphere args={[r, 16, 16]}>
            <meshStandardMaterial color="white" roughness={0.3} />
          </Sphere>
          <Sphere args={[r * 0.5, 12, 12]} position={[0, -r * 0.1, r * 0.68]}>
            <meshStandardMaterial color="#111" roughness={0.2} />
          </Sphere>
        </group>
      ))}

      {/* 이름표 */}
      <Html position={[0, CHARACTER_CENTER_Y + 0.45, 0]} center zIndexRange={[10, 0]}>
        <div className={`nameplate${isSelf ? " self" : ""}`}>{name}</div>
      </Html>
    </group>
  );
}
