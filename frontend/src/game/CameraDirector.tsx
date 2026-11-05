import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { PerspectiveCamera } from "@react-three/drei";
import { Vector3, type PerspectiveCamera as ThreePerspectiveCamera } from "three";
import type { GamePhase } from "@quiz/shared";
import { useGameStore } from "../store/useGameStore";
import { zonesCenter } from "./zones";

/**
 * 방송용 카메라 디렉터 — 게임 단계에 따라 카메라 위치/시선/화각을 연출한다.
 *
 *  waiting          : 보드 전체를 천천히 도는 와이드 오비트
 *  countdown        : 높은 곳에서 보드 쪽으로 서서히 푸시 인
 *  question_active  : 보드 정면에서 좌우로 천천히 흔들리는 미디엄 샷
 *  reveal           : 생존자 무리를 낮은 앵글로 클로즈업하며 회전 + 긴장감 흔들림
 *  elimination      : ① 꺼지는 구역을 내려다보며 추락 추적 → ② 생존자 클로즈업
 *  round_standings  : 살아남은 플레이어들을 가까이서 천천히 도는 샷
 *  game_over        : 우승자에게 극적으로 줌인하며 천천히 회전
 *
 * 목표값(desired)을 계산한 뒤 지수 보간으로 부드럽게 따라가므로 단계가 바뀌어도 컷이 튀지 않는다.
 */

interface Shot {
  pos: Vector3;
  look: Vector3;
  fov: number;
  /** 카메라 흔들림 세기 */
  shake: number;
  /** 보간 속도 (클수록 빠르게 전환) */
  speed: number;
}

export function CameraDirector() {
  const cam = useRef<ThreePerspectiveCamera>(null);
  const smoothPos = useMemo(() => new Vector3(0, 26, 34), []);
  const smoothLook = useMemo(() => new Vector3(), []);
  const shot = useMemo<Shot>(() => ({ pos: new Vector3(), look: new Vector3(), fov: 45, shake: 0, speed: 2 }), []);
  const centroid = useMemo(() => new Vector3(), []);
  const winnerPos = useMemo(() => new Vector3(), []);
  const phaseRef = useRef<{ phase: GamePhase; since: number }>({ phase: "waiting", since: 0 });

  useFrame((state, delta) => {
    const camera = cam.current;
    if (!camera) return;
    const dt = Math.min(delta, 0.1);
    const t = state.clock.elapsedTime;
    const { game, players } = useGameStore.getState();

    // 단계가 바뀐 시점부터의 경과 시간
    if (phaseRef.current.phase !== game.phase) phaseRef.current = { phase: game.phase, since: t };
    const pt = t - phaseRef.current.since;

    // 보드 위 생존자 무리의 중심과 퍼짐 정도
    let n = 0;
    let spread = 0;
    centroid.set(0, 0, 0);
    for (const id in players) {
      const p = players[id];
      if (!p.alive || p.p[1] < -1) continue;
      centroid.x += p.p[0];
      centroid.z += p.p[2];
      n++;
    }
    if (n > 0) {
      centroid.divideScalar(n);
      for (const id in players) {
        const p = players[id];
        if (!p.alive || p.p[1] < -1) continue;
        spread = Math.max(spread, Math.hypot(p.p[0] - centroid.x, p.p[2] - centroid.z));
      }
    }
    centroid.y = 0.8;

    const winner = game.winnerId ? players[game.winnerId] : undefined;
    const hasWinner = game.phase === "game_over" && !!winner;
    if (winner) winnerPos.set(winner.p[0], winner.p[1], winner.p[2]);

    const dropped = zonesCenter(game.quizType, game.droppedZones);
    planShot(shot, game.phase, dropped, pt, t, centroid, n, spread, hasWinner ? winnerPos : null);

    // ── 부드럽게 따라가기 ──
    const k = 1 - Math.exp(-dt * shot.speed);
    smoothPos.lerp(shot.pos, k);
    smoothLook.lerp(shot.look, k);
    camera.position.copy(smoothPos);
    if (shot.shake > 0) {
      camera.position.x += (Math.sin(t * 37) + Math.sin(t * 23)) * 0.5 * shot.shake;
      camera.position.y += Math.sin(t * 41) * shot.shake;
    }
    camera.lookAt(smoothLook);
    const nextFov = camera.fov + (shot.fov - camera.fov) * k;
    if (Math.abs(nextFov - camera.fov) > 0.01) {
      camera.fov = nextFov;
      camera.updateProjectionMatrix();
    }
  });

  return <PerspectiveCamera ref={cam} makeDefault fov={45} position={[0, 26, 34]} near={0.1} far={300} />;
}

/** 단계별 목표 카메라 샷 계산 (순수 함수 — 연출 튜닝은 여기서) */
function planShot(
  shot: Shot,
  phase: GamePhase,
  /** 꺼지는 구역들의 중심 (x, z) */
  dropped: [number, number],
  pt: number,
  t: number,
  centroid: Vector3,
  survivors: number,
  spread: number,
  winner: Vector3 | null,
) {
  shot.shake = 0;

  switch (phase) {
    case "game_over": {
      if (winner) {
        // 멀리서 시작해 3.5초에 걸쳐 얼굴 앞까지 줌인 → 이후 가까이서 천천히 회전
        const k = Math.min(pt / 3.5, 1);
        const ease = 1 - Math.pow(1 - k, 3);
        const dist = 15 - ease * 7.5; // 15 → 7.5 (우승자 전신 + 머리 위 폭죽이 함께 들어오는 거리)
        const a = 0.3 + pt * 0.32;
        shot.pos.set(winner.x + Math.sin(a) * dist, winner.y + 1.2 + dist * 0.2, winner.z + Math.cos(a) * dist);
        shot.look.set(winner.x, winner.y + 1.3, winner.z);
        shot.fov = 46 - ease * 8; // 화각도 좁혀 더 극적으로
        shot.shake = pt < 0.5 ? 0.05 : 0;
        shot.speed = 2.2;
        break;
      }
      // 우승자 없음 → 대기와 같은 와이드 오비트
      const a = t * 0.08;
      shot.pos.set(Math.sin(a) * 34, 22, Math.cos(a) * 34);
      shot.look.set(0, 0, 0);
      shot.fov = 45;
      shot.speed = 1.2;
      break;
    }
    case "round_standings": {
      // 생존자 무리를 중간 거리에서 천천히 회전
      const dist = Math.max(10, Math.min(20, spread * 1.3 + 10));
      const a = 0.4 + t * 0.12;
      shot.pos.set(centroid.x + Math.sin(a) * dist, 4 + dist * 0.35, centroid.z + Math.cos(a) * dist);
      shot.look.copy(survivors > 0 ? centroid : shot.look.set(0, 0, 0));
      shot.fov = 40;
      shot.speed = 1.5;
      break;
    }
    case "waiting": {
      const a = t * 0.08;
      shot.pos.set(Math.sin(a) * 34, 22, Math.cos(a) * 34);
      shot.look.set(0, 0, 0);
      shot.fov = 45;
      shot.speed = 1.2;
      break;
    }
    case "countdown": {
      // 3초 동안 위에서 앞으로 푸시 인
      const k = Math.min(pt / 3, 1);
      shot.pos.set(0, 34 - k * 10, 30 - k * 4);
      shot.look.set(0, 0, 0);
      shot.fov = 45 - k * 5;
      shot.speed = 2;
      break;
    }
    case "question_active": {
      shot.pos.set(Math.sin(t * 0.25) * 12, 18, 26);
      shot.look.set(0, 0, 0);
      shot.fov = 42;
      shot.speed = 1.5;
      break;
    }
    case "reveal": {
      // 생존자 무리 주위를 낮은 앵글로 돌며 점점 다가감
      const target = survivors > 0 ? centroid : shot.look.set(0, 0, 0);
      const dist = Math.max(9, Math.min(18, spread * 1.4 + 9)) - Math.min(pt, 3) * 0.8;
      const a = 0.6 + pt * 0.35;
      shot.pos.set(target.x + Math.sin(a) * dist, 2.5 + dist * 0.25, target.z + Math.cos(a) * dist);
      shot.look.copy(target);
      shot.fov = 34;
      shot.shake = 0.02 + Math.min(pt / 3, 1) * 0.06; // 긴장감 증가
      shot.speed = 2.5;
      break;
    }
    case "elimination": {
      const [zoneX, zoneZ] = dropped;
      if (pt < 1.8 || survivors === 0) {
        // ① 꺼지는 구역(들)을 앞쪽 위에서 내려다보며 추락 추적
        const fall = Math.min(pt, 1.8) * 4; // 타일이 떨어지는 만큼 시선도 아래로
        shot.pos.set(zoneX * 0.2, 16, 22);
        shot.look.set(zoneX, -fall, zoneZ);
        shot.fov = 40;
        shot.shake = pt < 0.6 ? 0.12 : 0.04; // 꺼지는 순간 강한 흔들림
        shot.speed = 3;
      } else {
        // ② 살아남은 플레이어 클로즈업
        const dist = Math.max(8, Math.min(16, spread * 1.2 + 8));
        shot.pos.set(centroid.x + dist * 0.45, 2.5 + dist * 0.3, centroid.z + dist);
        shot.look.copy(centroid);
        shot.fov = 36;
        shot.speed = 2;
      }
      break;
    }
  }
}
