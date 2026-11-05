import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Color, DoubleSide, Object3D, type InstancedMesh } from "three";
import { useGameStore } from "../store/useGameStore";
import { audio } from "../audio/AudioManager";

const COUNT = 420;
const COLORS = ["#ff5c8a", "#ffb84d", "#ffe14d", "#7ae582", "#4dd9ff", "#6c8cff", "#b07cff", "#ffffff"];
const GRAVITY = 6; // 종이 조각처럼 천천히 떨어지도록 실제 중력보다 약하게
const DRAG = 1.4;
const HEAD_OFFSET = 1.4;

/**
 * 우승자 머리 위에서 터지는 색종이 — InstancedMesh 1개로 COUNT 개 조각을 그림 (draw call 1회).
 * 첫 프레임에 큰 폭발(burst) 후, 수명이 다한 조각은 우승자 머리 위에서 다시 분수처럼 솟아오른다.
 * 위치는 매 프레임 store 에서 우승자 좌표를 읽어 따라간다.
 */
export function Confetti({ targetId }: { targetId: string }) {
  const mesh = useRef<InstancedMesh>(null);
  const dummy = useMemo(() => new Object3D(), []);

  // 파티클 상태 (Float32Array 로 GC 없이 갱신)
  const sim = useMemo(() => {
    const age = new Float32Array(COUNT);
    for (let i = 0; i < COUNT; i++) {
      // 절반은 즉시 폭발, 나머지는 시간차로 분출 (음수 = 대기)
      age[i] = i < COUNT / 2 ? 0 : -Math.random() * 2.5;
    }
    return {
      pos: new Float32Array(COUNT * 3),
      vel: new Float32Array(COUNT * 3),
      rot: new Float32Array(COUNT * 3),
      spin: new Float32Array(COUNT * 3),
      age,
      life: new Float32Array(COUNT),
      fresh: new Uint8Array(COUNT).fill(1), // 1 = 아직 발사 전
    };
  }, []);

  // 폭죽 펑! — 첫 폭발 + 연달아 몇 발 (언마운트되면 남은 소리는 취소)
  useEffect(() => {
    const ids = [0, 380, 820, 1500, 2300].map((delayMs, i) =>
      setTimeout(() => audio.playSfx("pop", { rate: 0.85 + Math.random() * 0.4, volume: i === 0 ? 1 : 0.7 }), delayMs),
    );
    return () => ids.forEach(clearTimeout);
  }, []);

  // 조각별 색상
  useEffect(() => {
    const m = mesh.current;
    if (!m) return;
    const c = new Color();
    for (let i = 0; i < COUNT; i++) m.setColorAt(i, c.set(COLORS[i % COLORS.length]));
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, []);

  const launch = (i: number, ox: number, oy: number, oz: number, burst: boolean) => {
    const a = Math.random() * Math.PI * 2;
    const h = burst ? 2 + Math.random() * 5 : 0.8 + Math.random() * 2.2;
    sim.pos.set([ox + (Math.random() - 0.5) * 0.3, oy, oz + (Math.random() - 0.5) * 0.3], i * 3);
    sim.vel.set([Math.cos(a) * h, (burst ? 5 : 4.5) + Math.random() * (burst ? 4 : 3.5), Math.sin(a) * h], i * 3);
    sim.rot.set([Math.random() * 6, Math.random() * 6, Math.random() * 6], i * 3);
    sim.spin.set([(Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14], i * 3);
    sim.life[i] = 2.2 + Math.random() * 1.6;
    sim.age[i] = 0;
    sim.fresh[i] = 0;
  };

  useFrame((_, delta) => {
    const m = mesh.current;
    if (!m) return;
    const dt = Math.min(delta, 0.05);
    const target = useGameStore.getState().players[targetId];
    if (!target) return;
    const [ox, oy, oz] = target.p;
    const headY = oy + HEAD_OFFSET;

    for (let i = 0; i < COUNT; i++) {
      // 대기 중인 조각
      if (sim.age[i] < 0) {
        sim.age[i] += dt;
        dummy.scale.setScalar(0);
        dummy.updateMatrix();
        m.setMatrixAt(i, dummy.matrix);
        continue;
      }
      if (sim.fresh[i] || sim.age[i] > sim.life[i]) {
        launch(i, ox, headY, oz, sim.fresh[i] === 1 && i < COUNT / 2);
      }

      const k = i * 3;
      sim.vel[k + 1] -= GRAVITY * dt;
      const drag = Math.exp(-DRAG * dt);
      sim.vel[k] *= drag;
      sim.vel[k + 2] *= drag;
      if (sim.vel[k + 1] < -2.5) sim.vel[k + 1] = -2.5; // 종단 속도 → 하늘하늘
      for (let j = 0; j < 3; j++) {
        sim.pos[k + j] += sim.vel[k + j] * dt;
        sim.rot[k + j] += sim.spin[k + j] * dt;
      }
      sim.age[i] += dt;

      // 수명 끝 무렵 작아지며 사라짐
      const fade = Math.min(1, (sim.life[i] - sim.age[i]) / 0.4);
      dummy.position.set(sim.pos[k], sim.pos[k + 1], sim.pos[k + 2]);
      dummy.rotation.set(sim.rot[k], sim.rot[k + 1], sim.rot[k + 2]);
      dummy.scale.setScalar(Math.max(0, fade));
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
    }
    m.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, COUNT]} frustumCulled={false}>
      <planeGeometry args={[0.14, 0.22]} />
      <meshStandardMaterial side={DoubleSide} roughness={0.5} emissive="#222" />
    </instancedMesh>
  );
}

/** game_over + 우승자가 있으면 폭죽 + 스포트라이트 */
export function WinnerCelebration() {
  const phase = useGameStore((s) => s.game.phase);
  const winnerId = useGameStore((s) => s.game.winnerId);
  const winnerExists = useGameStore((s) => (winnerId ? !!s.players[winnerId] : false));
  if (phase !== "game_over" || !winnerId || !winnerExists) return null;
  return <Confetti key={winnerId} targetId={winnerId} />;
}
