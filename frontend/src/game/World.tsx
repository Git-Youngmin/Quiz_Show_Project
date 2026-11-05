import { QuizBoard } from "./QuizBoard";
import { Barrier } from "./Barrier";
import { SpectatorZone } from "./SpectatorZone";
import { WinnerCelebration } from "./Confetti";

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
        shadow-camera-left={-34}
        shadow-camera-right={20}
        shadow-camera-top={20}
        shadow-camera-bottom={-20}
      />
      <QuizBoard />
      <Barrier />
      <SpectatorZone />
      <WinnerCelebration />
    </>
  );
}
