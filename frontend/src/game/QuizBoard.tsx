import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import { CuboidCollider, RigidBody, type RapierRigidBody } from "@react-three/rapier";
import { DoubleSide, Euler, Quaternion, type MeshStandardMaterial } from "three";
import type { Answer } from "@quiz/shared";
import { useGameStore } from "../store/useGameStore";
import { BOARD_THICKNESS } from "./constants";
import { ZONE_STYLE, tileLayouts, type TileLayout } from "./zones";

/** 바닥이 꺼질 때 하강 가속도 — 중력(30)보다 커야 캐릭터가 바닥에서 떨어져 나감 */
const DROP_ACCEL = 48;
const DROP_MIN_Y = -60;

/**
 * 퀴즈 보드 — 현재 퀴즈 유형에 따라 OX 2분할 / 4지선다 십자 4분할.
 * 유형이 바뀌면 key 가 바뀌어 타일이 새 배치로 다시 생성된다 (윗면 높이는 같아 캐릭터는 그대로 서 있음).
 */
export function QuizBoard() {
  const quizType = useGameStore((s) => s.game.quizType);
  const tiles = useMemo(() => tileLayouts(quizType), [quizType]);
  return (
    <group key={quizType}>
      {tiles.map((t) => (
        <FloorTile key={t.zone} layout={t} />
      ))}
    </group>
  );
}

/**
 * 바닥 타일 1개 — kinematicPosition 강체.
 *  - 평소: 제자리에 고정 (fixed 와 동일하게 동작)
 *  - reveal 단계 오답 구역: 흔들림 + 깜빡임 (곧 꺼진다는 예고)
 *  - elimination 단계 droppedZones 에 포함: 가속하며 낙하 + 바깥쪽으로 기울어짐
 *  - waiting 복귀: 아래에서 부드럽게 원위치
 * 상태는 매 프레임 store.getState() 로 읽어 React 리렌더 없이 물리만 갱신한다.
 */
function FloorTile({ layout }: { layout: TileLayout }) {
  const { zone, cx, cz, w, d, sx, sz } = layout;
  const { color } = ZONE_STYLE[zone];
  const t = BOARD_THICKNESS;

  const body = useRef<RapierRigidBody>(null);
  const topMat = useRef<MeshStandardMaterial>(null);
  const sim = useRef({ y: 0, vy: 0, tilt: 0 });
  const euler = useMemo(() => new Euler(), []);
  const quat = useMemo(() => new Quaternion(), []);

  useFrame((state, delta) => {
    const rb = body.current;
    if (!rb) return;
    const dt = Math.min(delta, 0.1);
    const { phase, droppedZones, answer } = useGameStore.getState().game;
    const s = sim.current;
    const time = state.clock.elapsedTime;
    let shakeX = 0;
    let shakeZ = 0;
    let flash = 0;

    if (droppedZones.includes(zone)) {
      // ── 낙하 ──
      s.vy += DROP_ACCEL * dt;
      s.y = Math.max(DROP_MIN_Y, s.y - s.vy * dt);
      s.tilt = Math.min(0.5, s.tilt + dt * 0.35);
    } else {
      // ── 원위치 복구 ──
      s.vy = 0;
      s.y += (0 - s.y) * (1 - Math.exp(-dt * 3));
      if (Math.abs(s.y) < 0.001) s.y = 0;
      s.tilt += (0 - s.tilt) * (1 - Math.exp(-dt * 3));

      // ── 정답 발표 중 오답 구역: 덜덜 떨림 + 깜빡임 ──
      if (phase === "reveal" && answer && answer !== zone) {
        const amp = 0.06;
        shakeX = Math.sin(time * 61) * amp;
        shakeZ = Math.cos(time * 53) * amp;
        flash = 0.35 + 0.35 * Math.sin(time * 18);
      }
    }

    rb.setNextKinematicTranslation({ x: cx + shakeX, y: s.y, z: cz + shakeZ });
    // 바깥쪽 모서리가 먼저 내려가도록: z축 회전은 x 방향, x축 회전은 z 방향 기울기
    euler.set(sz * s.tilt, 0, -sx * s.tilt);
    rb.setNextKinematicRotation(quat.setFromEuler(euler));
    if (topMat.current) topMat.current.emissiveIntensity = flash;
  });

  return (
    <RigidBody ref={body} type="kinematicPosition" colliders={false} position={[cx, 0, cz]} friction={1}>
      {/* 윗면이 y = 0 (body 원점) */}
      <CuboidCollider args={[w / 2, t / 2, d / 2]} position={[0, -t / 2, 0]} />

      <mesh position={[0, -t / 2, 0]} receiveShadow castShadow>
        <boxGeometry args={[w, t, d]} />
        <meshStandardMaterial color="#e9e4ff" />
      </mesh>
      <mesh position={[0, 0.01, 0]} rotation-x={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[w - 0.6, d - 0.6]} />
        <meshStandardMaterial ref={topMat} color={color} emissive="#ffffff" emissiveIntensity={0} />
      </mesh>
      <ZoneMark zone={zone} scale={Math.min(w, d) / 15} />
      {"ABCD".includes(zone) && <ChoiceLabel zone={zone} sx={sx} sz={sz} />}
    </RigidBody>
  );
}

/** 바닥에 그려진 구역 마크 (폰트 로딩 없이 지오메트리로 표현) */
function ZoneMark({ zone, scale }: { zone: Answer; scale: number }) {
  const mark = ZONE_STYLE[zone].mark;
  const mat = <meshStandardMaterial color="#ffffff" transparent opacity={0.85} side={DoubleSide} />;
  return (
    <group position={[0, 0.02, 0]} rotation-x={-Math.PI / 2} scale={scale}>
      {mark === "ring" && (
        <mesh>
          <ringGeometry args={[3, 4.2, 48]} />
          {mat}
        </mesh>
      )}
      {mark === "cross" &&
        [Math.PI / 4, -Math.PI / 4].map((rot) => (
          <mesh key={rot} rotation-z={rot}>
            <planeGeometry args={[9.5, 1.2]} />
            {mat}
          </mesh>
        ))}
      {/* 4지선다: ▲ ◆ ● ■ — 바닥(평면)의 로컬 +y 가 월드 -z(화면 위쪽) */}
      {mark === "triangle" && (
        <mesh rotation-z={Math.PI / 2}>
          <circleGeometry args={[4.2, 3]} />
          {mat}
        </mesh>
      )}
      {mark === "diamond" && (
        <mesh rotation-z={Math.PI / 4}>
          <planeGeometry args={[5.4, 5.4]} />
          {mat}
        </mesh>
      )}
      {mark === "circle" && (
        <mesh>
          <circleGeometry args={[3.6, 48]} />
          {mat}
        </mesh>
      )}
      {mark === "square" && (
        <mesh>
          <planeGeometry args={[6.4, 6.4]} />
          {mat}
        </mesh>
      )}
    </group>
  );
}

/** 4지선다 타일 바깥 모서리 쪽에 뜨는 보기 라벨 (A 화성 …) */
function ChoiceLabel({ zone, sx, sz }: { zone: Answer; sx: number; sz: number }) {
  const choices = useGameStore((s) => s.game.choices);
  const phase = useGameStore((s) => s.game.phase);
  const idx = "ABCD".indexOf(zone);
  const text = choices?.[idx];
  // 카운트다운 중엔 보기를 가려서 긴장감 유지 (배너와 동일)
  const visible = !!text && phase !== "countdown";
  return (
    <Html position={[sx * 4.2, 0.1, sz * 4.2]} center zIndexRange={[5, 0]}>
      <div className={`choice-floor-label zone-${zone}`}>
        <b>{zone}</b>
        {visible && <span>{text}</span>}
      </div>
    </Html>
  );
}
