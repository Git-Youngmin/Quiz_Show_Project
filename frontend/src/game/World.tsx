import { QuizBoard } from "./QuizBoard";
import { Barrier } from "./Barrier";
import { SpectatorZones } from "./SpectatorZone";
import { WinnerCelebration } from "./Confetti";
import { Obstacles } from "./Obstacles";

/** 조명/배경/바닥/차단벽/관전석/우승 연출 등 /play 와 /display 가 공유하는 월드 */
export function World() {
  return (
    <>
      <color attach="background" args={["#87c7ff"]} />
      <fog attach="fog" args={["#87c7ff", 40, 90]} />
      <hemisphereLight args={["#ffffff", "#8a7cff", 0.9]} />
      <directionalLight
        position={[12, 20, 8]}
        intensity={1.6}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-far={80}
        shadow-camera-left={-36}
        shadow-camera-right={36}
        shadow-camera-top={36}
        shadow-camera-bottom={-36}
      />
      <QuizBoard />
      <Barrier />
      <SpectatorZones />
      <WinnerCelebration />
      <Obstacles />
    </>
  );
}
