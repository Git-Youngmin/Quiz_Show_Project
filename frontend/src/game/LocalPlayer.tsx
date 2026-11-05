import { useEffect, useMemo, useRef, useState } from "react";
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
  randomSpectatorSpawn,
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

/**
 * playing    : 생존 — 퀴즈 보드 위에서 조작
 * falling    : 막 탈락 — 조작 불가, 센서 상태로 바닥을 뚫고 낙하
 * spectating : 관전 구역으로 순간이동 — 다시 조작 가능 (유리 상자 안에서만)
 */
type Mode = "playing" | "falling" | "spectating";

/** 낙하 중 카메라 위치 (보드 전체를 내려다봄) */
const FALLING_CAMERA = new Vector3(0, 24, 28);
const BOARD_CENTER = new Vector3(0, 0, 0);

/**
 * 내 캐릭터 — dynamic 강체. 위치의 "권한"은 로컬 물리엔진이 가진다.
 * 매 프레임: 입력(카메라 기준) → 속도 설정 → (물리 스텝) → 위치 읽어 sendMove + 카메라 추적
 */
export function LocalPlayer({ spawn, color, name, alive }: Props) {
  const body = useRef<RapierRigidBody>(null);
  const collider = useRef<RapierCollider>(null);
  const visual = useRef<Group>(null);
  const getInput = usePlayerInput();
  const { world, rapier } = useRapier();

  // 처음부터 탈락 상태(진행 중 난입)라면 관전 구역에서 시작
  const [initialMode] = useState<Mode>(() => (alive ? "playing" : "spectating"));
  const mode = useRef<Mode>(initialMode);
  const spawnPos = useMemo(
    () =>
      initialMode === "spectating"
        ? randomSpectatorSpawn()
        : { x: spawn[0], y: Math.max(spawn[1], CHARACTER_CENTER_Y + 0.5), z: spawn[2] },
    [spawn, initialMode],
  );

  const rotY = useRef(0);
  const jumpHeld = useRef(false);
  const camLook = useMemo(() => new Vector3(spawnPos.x, spawnPos.y, spawnPos.z), [spawnPos]);
  const camWanted = useMemo(() => new Vector3(), []);
  const camDir = useMemo(() => new Vector3(), []);
  const tmp = useMemo(() => new Vector3(), []);

  // 탈락 → 센서로 전환해 바닥을 뚫고 떨어지게 (다른 캐릭터와도 충돌 X)
  useEffect(() => {
    if (!alive && mode.current === "playing") {
      mode.current = "falling";
      collider.current?.setSensor(true);
    }
  }, [alive]);

  useFrame((state, delta) => {
    const rb = body.current;
    if (!rb) return;
    const dt = Math.min(delta, 0.1); // 탭 전환 후 큰 delta 방지
    const pos = rb.translation();
    const store = useGameStore.getState();

    // ── 낙하 중: 조작 불가 → 충분히 떨어지면 관전 구역으로 순간이동 ──
    if (mode.current === "falling") {
      if (pos.y < FALL_LIMIT_Y) {
        rb.setTranslation(randomSpectatorSpawn(), true);
        rb.setLinvel({ x: 0, y: 0, z: 0 }, true);
        collider.current?.setSensor(false); // 관전석 바닥/벽과 다시 충돌
        mode.current = "spectating";
      }
      const k = 1 - Math.exp(-dt * (pos.y < FELL_Y ? 1.5 : 3));
      state.camera.position.lerp(FALLING_CAMERA, k);
      camLook.lerp(BOARD_CENTER, k);
      state.camera.lookAt(camLook);
      store.sendMove(pos.x, pos.y, pos.z, rotY.current);
      return;
    }

    // ── 입력을 카메라 기준 방향으로 변환 (관전석에서는 카메라가 옆을 보므로 필요) ──
    const input = getInput();
    state.camera.getWorldDirection(camDir);
    camDir.y = 0;
    if (camDir.lengthSq() < 1e-6) camDir.set(0, 0, -1);
    camDir.normalize();
    // forward = camDir, right = (-fz, fx)
    const moveX = -camDir.z * input.x + camDir.x * -input.z;
    const moveZ = camDir.x * input.x + camDir.z * -input.z;

    const vel = rb.linvel();

    // ── 접지 판정: 캡슐 바닥 바로 아래로 레이캐스트 ──
    const ray = new rapier.Ray({ x: pos.x, y: pos.y, z: pos.z }, { x: 0, y: -1, z: 0 });
    const hit = world.castRay(ray, CAPSULE_HALF_HEIGHT + CAPSULE_RADIUS + 0.08, true, undefined, undefined, undefined, rb);
    const grounded = hit !== null;

    // ── 수평 이동: 목표 속도로 부드럽게 가속 (공중에서는 조작감 낮춤) ──
    const accel = 1 - Math.exp(-dt * (grounded ? 14 : 4));
    const vx = vel.x + (moveX * MOVE_SPEED - vel.x) * accel;
    const vz = vel.z + (moveZ * MOVE_SPEED - vel.z) * accel;

    // ── 점프: 키를 누르는 순간(엣지)에만, 접지 상태에서 ──
    let vy = vel.y;
    if (input.jump && !jumpHeld.current && grounded) vy = JUMP_VELOCITY;
    jumpHeld.current = input.jump;

    rb.setLinvel({ x: vx, y: vy, z: vz }, true);

    // ── 바라보는 방향: 이동 방향으로 회전 (강체는 회전 잠금, 외형만 회전) ──
    if (Math.hypot(moveX, moveZ) > 0.1) {
      rotY.current = lerpAngle(rotY.current, Math.atan2(moveX, moveZ), 1 - Math.exp(-dt * 12));
    }
    if (visual.current) visual.current.rotation.y = rotY.current;

    // ── 낙사 처리 ──
    if (mode.current === "spectating") {
      // 관전 구역은 밀폐되어 있지만 만약을 대비
      if (pos.y < FALL_LIMIT_Y) {
        rb.setTranslation(randomSpectatorSpawn(), true);
        rb.setLinvel({ x: 0, y: 0, z: 0 }, true);
      }
    } else if (store.game.phase === "waiting" || store.game.phase === "game_over") {
      // 진행 중이 아닐 때는 탈락 없이 리스폰
      if (pos.y < FALL_LIMIT_Y) {
        rb.setTranslation(spawnPos, true);
        rb.setLinvel({ x: 0, y: 0, z: 0 }, true);
      }
    } else if (pos.y < FELL_Y) {
      // 문제 진행 중 보드 밖으로 떨어짐 → 탈락 보고 (낙관적으로 alive=false → falling 전환)
      store.reportFell();
    }

    // ── 카메라 ──
    const p = rb.translation();
    if (mode.current === "spectating") {
      // 관전: 보드 반대편 뒤쪽 위에서, 내 캐릭터 너머로 보드를 바라봄
      tmp.set(p.x, 0, p.z).normalize(); // 보드 중심 → 나 방향
      camWanted.set(p.x + tmp.x * 9, p.y + 6, p.z + tmp.z * 9);
      state.camera.position.lerp(camWanted, 1 - Math.exp(-dt * 4));
      camLook.lerp(tmp.set(p.x * 0.45, 0.5, p.z * 0.45), 1 - Math.exp(-dt * 4));
      state.camera.lookAt(camLook);
    } else {
      camLook.lerp(tmp.set(p.x, Math.max(p.y, 0), p.z), 1 - Math.exp(-dt * 8));
      camWanted.set(camLook.x + CAMERA_OFFSET[0], camLook.y + CAMERA_OFFSET[1], camLook.z + CAMERA_OFFSET[2]);
      state.camera.position.lerp(camWanted, 1 - Math.exp(-dt * 6));
      state.camera.lookAt(camLook.x, camLook.y + 1, camLook.z);
    }

    // ── 서버 전송: 스토어에서 20Hz 스로틀링 + 변화량(ε) 체크 ──
    store.sendMove(p.x, p.y, p.z, rotY.current);
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
