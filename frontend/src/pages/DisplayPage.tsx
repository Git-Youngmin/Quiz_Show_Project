import { Suspense } from "react";
import { Canvas } from "@react-three/fiber";
import { Physics } from "@react-three/rapier";
import { ConnectionNotice } from "../components/ConnectionNotice";
import { QuizBanner } from "../components/QuizBanner";
import { SoundToggle } from "../components/SoundToggle";
import { ThrowFeed } from "../components/ThrowFeed";
import { useGameAudio } from "../audio/useGameAudio";
import { useRoomConnection } from "../lib/useRoomConnection";
import { stageButtonGuard } from "../lib/stageButtonGuard";
import { World } from "../game/World";
import { PHYSICS_GRAVITY } from "../game/constants";
import { RemotePlayers } from "../game/RemotePlayers";
import { CameraDirector } from "../game/CameraDirector";

/**
 * 방송 송출 뷰 — UI 최소화, 3D 월드 + 게임 단계별 다이나믹 카메라.
 * 모든 플레이어를 원격 플레이어로 렌더링한다.
 */
export default function DisplayPage() {
  useRoomConnection("display");
  useGameAudio("display");

  return (
    <div className="stage" {...stageButtonGuard}>
      <Canvas shadows dpr={[1, 2]}>
        <CameraDirector />
        <Suspense fallback={null}>
          <Physics gravity={PHYSICS_GRAVITY}>
            <World />
            <RemotePlayers />
          </Physics>
        </Suspense>
      </Canvas>
      <QuizBanner />
      <SoundToggle />
      <ThrowFeed />
      <ConnectionNotice />
    </div>
  );
}
