import { Suspense } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { Physics } from "@react-three/rapier";
import { ConnectionStatus } from "../components/ConnectionStatus";
import { useRoomConnection } from "../lib/useRoomConnection";
import { World } from "../game/World";
import { RemotePlayers } from "../game/RemotePlayers";

/**
 * 방송 송출 뷰 — 모든 플레이어를 원격 플레이어로 렌더링.
 * 지금은 천천히 도는 OrbitControls 카메라. (다이나믹 카메라 연출은 이후 단계)
 */
export default function DisplayPage() {
  useRoomConnection("display");

  return (
    <div className="stage">
      <Canvas shadows camera={{ position: [0, 26, 30], fov: 45 }} dpr={[1, 2]}>
        <Suspense fallback={null}>
          <Physics>
            <World />
            <RemotePlayers />
          </Physics>
        </Suspense>
        <OrbitControls autoRotate autoRotateSpeed={0.4} maxPolarAngle={Math.PI / 2.2} />
      </Canvas>
      <div className="hud">
        <ConnectionStatus />
      </div>
    </div>
  );
}
