import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import {
  CapsuleCollider,
  RigidBody,
  useRapier,
  type RapierCollider,
  type RapierRigidBody,
} from "@react-three/rapier";
import { Vector3, type Group } from "three";
import { FELL_Y, type Vec3 } from "@quiz/shared";
import { useGameStore } from "../store/useGameStore";
import { usePlayerInput } from "./input/usePlayerInput";
import { Character } from "./Character";
import {
  CAMERA_OFFSET,
  CAPSULE_HALF_HEIGHT,
  CAPSULE_RADIUS,
  CHARACTER_CENTER_Y,
  FALL_LIMIT_Y,
  JUMP_VELOCITY,
  MOVE_SPEED,
} from "./constants";

/** 최단 경로로 각도 보간 */
function lerpAngle(a: number, b: number, t: number) {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

interface Props {
  spawn: Vec3;
  color: string;
  name: string;
  alive: boolean;
}

/** 탈락 후 관전 카메라 위치 */
const SPECTATOR_CAMERA = new Vector3(0, 24, 28);

/**
 * 내 캐릭터 — dynamic 강체. 위치의 "권한"은 로컬 물리엔진이 가진다.
 * 매 프레임: 입력 → 속도 설정 → (물리 스텝) → 위치 읽어 sendMove + 카메라 추적
 */
export function LocalPlayer({ spawn, color, name, alive }: Props) {
  const body = useRef<RapierRigidBody>(null);
  const collider = useRef<RapierCollider>(null);
  const visual = useRef<Group>(null);
  const getInput = usePlayerInput();
  const { world, rapier } = useRapier();

  const rotY = useRef(0);
  const jumpHeld = useRef(false);
  const camLook = useMemo(() => new Vector3(spawn[0], spawn[1], spawn[2]), [spawn]);
  const camWanted = useMemo(() => new Vector3(), []);
  const tmp = useMemo(() => new Vector3(), []);
  const spawnPos = useMemo(() => ({ x: spawn[0], y: Math.max(spawn[1], CHARACTER_CENTER_Y + 0.5), z: spawn[2] }), [spawn]);

  // 탈락 → 충돌체를 센서로 전환: 바닥을 통과해 떨어지고 다른 캐릭터와도 부딪히지 않음
  useEffect(() => {
    collider.current?.setSensor(!alive);
  }, [alive]);

  useFrame((state, delta) => {
    const rb = body.current;
    if (!rb) return;
    const dt = Math.min(delta, 0.1); // 탭 전환 후 큰 delta 방지
    const pos = rb.translation();

    // ── 탈락 상태: 조작 불가, 자유 낙하 후 관전 카메라 ──
    if (!alive) {
      if (rb.isEnabled() && pos.y < FALL_LIMIT_Y) {
        useGameStore.getState().sendMove(pos.x, pos.y, pos.z, rotY.current);
        rb.setEnabled(false); // 더 이상 물리 계산/전송 안 함
      } else if (rb.isEnabled()) {
        useGameStore.getState().sendMove(pos.x, pos.y, pos.z, rotY.current);
      }
      const k = 1 - Math.exp(-dt * (pos.y < FELL_Y ? 1.5 : 3));
      state.camera.position.lerp(SPECTATOR_CAMERA, k);
      camLook.lerp(tmp.set(0, 0, 0), k);
      state.camera.lookAt(camLook);
      return;
    }

    const input = getInput();
    const vel = rb.linvel();

    // ── 접지 판정: 캡슐 바닥 바로 아래로 레이캐스트 ──
    const ray = new rapier.Ray({ x: pos.x, y: pos.y, z: pos.z }, { x: 0, y: -1, z: 0 });
    const hit = world.castRay(ray, CAPSULE_HALF_HEIGHT + CAPSULE_RADIUS + 0.08, true, undefined, undefined, undefined, rb);
    const grounded = hit !== null;

    // ── 수평 이동: 목표 속도로 부드럽게 가속 (공중에서는 조작감 낮춤) ──
    const accel = 1 - Math.exp(-dt * (grounded ? 14 : 4));
    const vx = vel.x + (input.x * MOVE_SPEED - vel.x) * accel;
    const vz = vel.z + (input.z * MOVE_SPEED - vel.z) * accel;

    // ── 점프: 키를 누르는 순간(엣지)에만, 접지 상태에서 ──
    let vy = vel.y;
    if (input.jump && !jumpHeld.current && grounded) vy = JUMP_VELOCITY;
    jumpHeld.current = input.jump;

    rb.setLinvel({ x: vx, y: vy, z: vz }, true);

    // ── 바라보는 방향: 이동 입력 방향으로 회전 (강체는 회전 잠금, 외형만 회전) ──
    if (Math.hypot(input.x, input.z) > 0.1) {
      rotY.current = lerpAngle(rotY.current, Math.atan2(input.x, input.z), 1 - Math.exp(-dt * 12));
    }
    if (visual.current) visual.current.rotation.y = rotY.current;

    // ── 낙사 처리 ──
    const phase = useGameStore.getState().game.phase;
    if (phase === "waiting") {
      // 대기 중에는 탈락 없이 리스폰
      if (pos.y < FALL_LIMIT_Y) {
        rb.setTranslation(spawnPos, true);
        rb.setLinvel({ x: 0, y: 0, z: 0 }, true);
      }
    } else if (pos.y < FELL_Y) {
      // 문제 진행 중 보드 밖으로 떨어짐 → 탈락 보고 (낙관적으로 alive=false 처리됨)
      useGameStore.getState().reportFell();
    }

    // ── 3인칭 카메라 추적 ──
    const p = rb.translation();
    camLook.lerp(tmp.set(p.x, Math.max(p.y, 0), p.z), 1 - Math.exp(-dt * 8));
    camWanted.set(camLook.x + CAMERA_OFFSET[0], camLook.y + CAMERA_OFFSET[1], camLook.z + CAMERA_OFFSET[2]);
    state.camera.position.lerp(camWanted, 1 - Math.exp(-dt * 6));
    state.camera.lookAt(camLook.x, camLook.y + 1, camLook.z);

    // ── 서버 전송: 스토어에서 20Hz 스로틀링 + 변화량(ε) 체크 ──
    useGameStore.getState().sendMove(p.x, p.y, p.z, rotY.current);
  });

  return (
    <RigidBody
      ref={body}
      type="dynamic"
      colliders={false}
      position={[spawnPos.x, spawnPos.y, spawnPos.z]}
      enabledRotations={[false, false, false]}
      canSleep={false}
      ccd
    >
      {/* friction 0: 속도를 직접 제어하므로 벽/다른 캐릭터에 달라붙지 않게 */}
      <CapsuleCollider ref={collider} args={[CAPSULE_HALF_HEIGHT, CAPSULE_RADIUS]} friction={0} />
      <group ref={visual}>
        <Character color={color} name={name} isSelf />
      </group>
    </RigidBody>
  );
}
