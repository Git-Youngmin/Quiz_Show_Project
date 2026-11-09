import { useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import type { Group } from "three";
import type { CharacterShape, CharacterAccessory } from "@quiz/shared";
import { Character } from "../game/Character";

function RotatingModel({
  shape,
  accessory,
  color,
}: {
  shape: CharacterShape;
  accessory?: CharacterAccessory;
  color: string;
}) {
  const group = useRef<Group>(null);

  useFrame((_, delta) => {
    if (group.current) {
      group.current.rotation.y += delta * 0.9;
    }
  });

  return (
    <group ref={group} position={[0, -0.4, 0]}>
      <Character color={color} shape={shape} accessory={accessory} name="" />
    </group>
  );
}

/**
 * 로비용 3D 캐릭터 실시간 회전 미리보기.
 * 고른 동물/크리처 종류와 악세사리, 색상이 그대로 3D 로 렌더링됩니다.
 */
export function AvatarPreview({
  shape,
  accessory = "none",
  color,
  size = 140,
}: {
  shape: CharacterShape;
  accessory?: CharacterAccessory;
  color: string;
  size?: number;
}) {
  return (
    <div
      className="avatar-3d-preview"
      style={{
        width: size,
        height: size,
        position: "relative",
        borderRadius: "20px",
        overflow: "hidden",
        background: "radial-gradient(circle at 50% 40%, #2a254a 0%, #12101e 100%)",
        boxShadow: "inset 0 2px 10px rgba(0,0,0,0.5), 0 8px 24px rgba(0,0,0,0.3)",
      }}
      aria-hidden
    >
      <Canvas
        camera={{ position: [0, 0.2, 2.3], fov: 45 }}
        style={{ width: "100%", height: "100%" }}
        gl={{ alpha: true, antialias: true }}
      >
        <ambientLight intensity={1.6} />
        <directionalLight position={[2.5, 4, 3]} intensity={2.2} />
        <directionalLight position={[-2.5, 1, -2]} intensity={0.8} />
        <RotatingModel shape={shape} accessory={accessory} color={color} />
      </Canvas>
    </div>
  );
}
