import { Html } from "@react-three/drei";
import { CAPSULE_HALF_HEIGHT, CAPSULE_RADIUS } from "./constants";

/**
 * 젤리빈 스타일 캐릭터 외형 (물리 X, 순수 시각).
 * 원점 = 캡슐 중심. 기본 정면은 +z 방향.
 */
export function Character({ color, name, isSelf = false }: { color: string; name: string; isSelf?: boolean }) {
  const eyeY = CAPSULE_HALF_HEIGHT * 0.9;
  const eyeZ = CAPSULE_RADIUS * 0.85;

  return (
    <group>
      <mesh castShadow>
        <capsuleGeometry args={[CAPSULE_RADIUS, CAPSULE_HALF_HEIGHT * 2, 8, 16]} />
        <meshStandardMaterial color={color} roughness={0.4} />
      </mesh>

      {/* 눈 */}
      {[-0.17, 0.17].map((x) => (
        <group key={x} position={[x, eyeY, eyeZ]}>
          <mesh>
            <sphereGeometry args={[0.12, 16, 16]} />
            <meshStandardMaterial color="white" />
          </mesh>
          <mesh position={[0, 0, 0.08]}>
            <sphereGeometry args={[0.06, 12, 12]} />
            <meshStandardMaterial color="#111" />
          </mesh>
        </group>
      ))}

      {/* 이름표 */}
      <Html position={[0, CAPSULE_HALF_HEIGHT + CAPSULE_RADIUS + 0.45, 0]} center zIndexRange={[10, 0]}>
        <div className={`nameplate${isSelf ? " self" : ""}`}>{name}</div>
      </Html>
    </group>
  );
}
