import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import {
  CapsuleCollider,
  CoefficientCombineRule,
  RigidBody,
  useRapier,
  type RapierCollider,
  type RapierRigidBody,
} from "@react-three/rapier";
import { Vector3, type Group } from "three";
import { FELL_Y, SPECTATOR_ZONES, isLobbyPhase, type CharacterShape, type Vec3 } from "@quiz/shared";
import { useGameStore } from "../store/useGameStore";
import { usePlayerInput } from "./input/usePlayerInput";
import { audio } from "../audio/AudioManager";
import { Character } from "./Character";
import {
  CAMERA_OFFSET,
  CAPSULE_HALF_HEIGHT,
  CAPSULE_RADIUS,
  AIR_ACCEL,
  CHARACTER_CENTER_Y,
  FALL_EXTRA_GRAVITY,
  FALL_LIMIT_Y,
  GROUND_ACCEL,
  JUMP_VELOCITY,
  MOVE_SPEED,
  randomSpectatorSpawn,
} from "./constants";
import type { CharacterMotion } from "./Character";

/** 최단 경로로 각도 보간 */
function lerpAngle(a: number, b: number, t: number) {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

interface Props {
  spawn: Vec3;
  color: string;
  shape: CharacterShape;
  name: string;
  alive: boolean;
}

/**
 * playing    : 생존 — 퀴즈 보드 위에서 조작
 * falling    : 막 탈락 — 조작 불가, 센서 상태로 바닥을 뚫고 낙하
 * spectating : 관전 구역으로 순간이동 — 다시 조작 가능 (유리 상자 안에서만)
 */
type Mode = "playing" | "falling" | "spectating" | "lobbyStand";
/** lobbyStand : 생존자지만 로비(대기·게임 종료) 동안 관전석에서 노는 중 — 게임이 시작되면 보드로 재배치됨 */
const isStandMode = (m: Mode) => m === "spectating" || m === "lobbyStand";

/** 낙하 중 카메라 위치 (보드 전체를 내려다봄) */
const FALLING_CAMERA = new Vector3(0, 24, 28);
const BOARD_CENTER = new Vector3(0, 0, 0);

/**
 * 내 캐릭터 — dynamic 강체. 위치의 "권한"은 로컬 물리엔진이 가진다.
 * 매 프레임: 입력(카메라 기준) → 속도 설정 → (물리 스텝) → 위치 읽어 sendMove + 카메라 추적
 */
export function LocalPlayer({ spawn, color, shape, name, alive }: Props) {
  const body = useRef<RapierRigidBody>(null);
  const collider = useRef<RapierCollider>(null);
  const visual = useRef<Group>(null);
  const getInput = usePlayerInput();
  const { world, rapier } = useRapier();

  // 처음부터 탈락 상태(진행 중 난입)라면 관전석에서 시작.
  // 로비에서 "관전석" 을 골랐다면 생존자라도 관전석에서 시작
  const [initialMode] = useState<Mode>(() => {
    if (!alive) return "spectating";
    const s = useGameStore.getState();
    return isLobbyPhase(s.game.phase) && s.lobbySpot === "stand" ? "lobbyStand" : "playing";
  });
  const mode = useRef<Mode>(initialMode);
  /** 내가 있는 관전석 번호 (관전 카메라 방향 결정) */
  const spectatorZone = useRef(0);
  /** 보드 위 스폰 위치 (서버가 정해 준 값) */
  const boardSpawn = useMemo(
    () => ({ x: spawn[0], y: Math.max(spawn[1], CHARACTER_CENTER_Y + 0.5), z: spawn[2] }),
    [spawn],
  );
  const spawnPos = useMemo(() => {
    if (isStandMode(initialMode)) {
      const s = randomSpectatorSpawn();
      spectatorZone.current = s.zone;
      return s.pos;
    }
    return boardSpawn;
  }, [boardSpawn, initialMode]);
  /** 외형 애니메이션(팔다리 흔들기, 착지 찌그러짐)에 넘겨줄 움직임 정보 */
  const motion = useRef<CharacterMotion>({ speed: 0, airborne: false, vy: 0 });

  const rotY = useRef(0);
  const jumpHeld = useRef(false);
  /** 방해물에 맞은 뒤 미끄러지는(조작이 둔해지는) 시간 */
  const stunUntil = useRef(0);
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
        const s = randomSpectatorSpawn(); // 두 관전석 중 무작위
        spectatorZone.current = s.zone;
        rb.setTranslation(s.pos, true);
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

    // ── 로비 중 보드 ↔ 관전석 이동 (HUD 버튼 / 입장 시 선택) ──
    if (alive) {
      const lobby = isLobbyPhase(store.game.phase);
      const wantStand = lobby && store.lobbySpot === "stand";
      if (wantStand && mode.current === "playing") {
        const s = randomSpectatorSpawn();
        spectatorZone.current = s.zone;
        rb.setTranslation(s.pos, true);
        rb.setLinvel({ x: 0, y: 0, z: 0 }, true);
        mode.current = "lobbyStand";
      } else if (!wantStand && mode.current === "lobbyStand") {
        // 보드로 (게임이 시작돼도 서버가 재배치하지만, 혹시 남아 있으면 여기서 복귀)
        rb.setTranslation(boardSpawn, true);
        rb.setLinvel({ x: 0, y: 0, z: 0 }, true);
        mode.current = "playing";
      }
    }

    // ── 입력을 카메라 기준 방향으로 변환 (관전석에서는 카메라가 옆을 보므로 필요) ──
    const input = getInput();
    if (isStandMode(mode.current)) {
      // 관전석: 카메라가 따라오며 잠깐 비스듬해져도 W 는 정확히 관전석 정면(보드 방향) — 발판 겨냥이 쉽도록
      const [fx, fz] = SPECTATOR_ZONES[spectatorZone.current].forward;
      camDir.set(fx, 0, fz);
    } else {
      state.camera.getWorldDirection(camDir);
      camDir.y = 0;
      if (camDir.lengthSq() < 1e-6) camDir.set(0, 0, -1);
      camDir.normalize();
    }
    // forward = camDir, right = (-fz, fx)
    const moveX = -camDir.z * input.x + camDir.x * -input.z;
    const moveZ = camDir.x * input.x + camDir.z * -input.z;

    const vel = rb.linvel();

    // ── 접지 판정: 캡슐 바닥 바로 아래로 레이캐스트 ──
    const ray = new rapier.Ray({ x: pos.x, y: pos.y, z: pos.z }, { x: 0, y: -1, z: 0 });
    const hit = world.castRay(ray, CAPSULE_HALF_HEIGHT + CAPSULE_RADIUS + 0.08, true, undefined, undefined, undefined, rb);
    const grounded = hit !== null;

    // ── 수평 이동: 목표 속도로 부드럽게 가속 (공중에서는 조작감 낮춤) ──
    // 방해물에 맞은 직후에는 거의 조작이 안 먹혀서 밀려난 속도가 유지됨 (넉백 연출)
    const stunned = performance.now() < stunUntil.current;
    const accel = 1 - Math.exp(-dt * (stunned ? 0.8 : grounded ? GROUND_ACCEL : AIR_ACCEL));
    const vx = vel.x + (moveX * MOVE_SPEED - vel.x) * accel;
    const vz = vel.z + (moveZ * MOVE_SPEED - vel.z) * accel;

    // ── 묵직한 낙하: 내려오는 중에는 추가 중력 (올라갈 땐 가볍고 떨어질 땐 툭) ──
    let vy = vel.y;
    if (!grounded && vy < 0) vy -= FALL_EXTRA_GRAVITY * dt;

    rb.setLinvel({ x: vx, y: vy, z: vz }, true);

    // ── 점프: 키를 누르는 순간(엣지)에만, 접지 상태에서 — 수직 속도를 JUMP_VELOCITY 로 만드는 임펄스 ──
    if (input.jump && !jumpHeld.current && grounded && !stunned) {
      rb.applyImpulse({ x: 0, y: (JUMP_VELOCITY - vy) * rb.mass(), z: 0 }, true);
      audio.playSfx("jump", { rate: 0.93 + Math.random() * 0.14 }); // 매번 살짝 다른 높이
    }
    jumpHeld.current = input.jump;

    // 외형 애니메이션용
    motion.current.speed = Math.hypot(vx, vz);
    motion.current.airborne = !grounded;
    motion.current.vy = vy;

    // ── 바라보는 방향: 이동 방향으로 회전 (강체는 회전 잠금, 외형만 회전) ──
    if (Math.hypot(moveX, moveZ) > 0.1) {
      rotY.current = lerpAngle(rotY.current, Math.atan2(moveX, moveZ), 1 - Math.exp(-dt * 12));
    }
    if (visual.current) visual.current.rotation.y = rotY.current;

    // ── 낙사 처리 ──
    if (isStandMode(mode.current)) {
      // 관전 구역은 밀폐되어 있지만 만약을 대비
      if (pos.y < FALL_LIMIT_Y) {
        const s = randomSpectatorSpawn();
        spectatorZone.current = s.zone;
        rb.setTranslation(s.pos, true);
        rb.setLinvel({ x: 0, y: 0, z: 0 }, true);
      }
    } else if (isLobbyPhase(store.game.phase)) {
      // 로비(대기·게임 종료) 중 보드에서 떨어짐 → 탈락 없이 관전석으로 (게임이 시작되면 다시 보드로)
      if (pos.y < FALL_LIMIT_Y) {
        const s = randomSpectatorSpawn();
        spectatorZone.current = s.zone;
        rb.setTranslation(s.pos, true);
        rb.setLinvel({ x: 0, y: 0, z: 0 }, true);
        mode.current = "lobbyStand";
        store.setLobbySpot("stand"); // 버튼 상태도 맞춤 ([보드로] 로 돌아갈 수 있음)
      }
    } else if (pos.y < FELL_Y) {
      // 게임 중(문제 진행·라운드 결과) 보드 밖으로 떨어짐 → 탈락 보고 (낙관적으로 alive=false → 관전석으로)
      store.reportFell();
    }

    // ── 카메라 ──
    const p = rb.translation();
    if (isStandMode(mode.current)) {
      // 관전: 내 캐릭터 뒤 위에서 관전석의 정면(보드 중심 방향)을 곧게 바라봄
      // → W = 보드(투척 발판) 쪽 직진, A/D = 좌우 이동이라 발판을 겨냥하기 쉬움
      const [fx, fz] = SPECTATOR_ZONES[spectatorZone.current].forward;
      camWanted.set(p.x - fx * 9, p.y + 6, p.z - fz * 9);
      state.camera.position.lerp(camWanted, 1 - Math.exp(-dt * 4));
      camLook.lerp(tmp.set(p.x + fx * 14, 0.5, p.z + fz * 14), 1 - Math.exp(-dt * 4));
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
      userData={{ localPlayer: true }}
      onCollisionEnter={({ other }) => {
        // 생존 중 방해물에 맞으면 잠깐 경직 + 효과음 (관전석에서는 방해물이 오지 않음)
        if (mode.current !== "playing") return;
        if (!(other.rigidBodyObject?.userData as { obstacle?: boolean } | undefined)?.obstacle) return;
        const now = performance.now();
        if (now < stunUntil.current - 300) return; // 연속 충돌 시 효과음 중복 방지
        stunUntil.current = now + 700;
        audio.playSfx("bonk", { rate: 0.9 + Math.random() * 0.2 });
      }}
    >
      {/* 외형과 무관하게 모두 같은 캡슐 충돌체 (공평성).
          friction 0: 속도를 직접 제어하므로 벽/다른 캐릭터에 달라붙지 않게 */}
      <CapsuleCollider
        ref={collider}
        args={[CAPSULE_HALF_HEIGHT, CAPSULE_RADIUS]}
        friction={0}
        // 마찰 합산 기본값은 "평균"이라 바닥(마찰 1)과 만나면 0.5 가 되어 속도가 깎임 → 최솟값(0)으로
        frictionCombineRule={CoefficientCombineRule.Min}
      />
      <group ref={visual}>
        <Character color={color} shape={shape} name={name} isSelf motion={motion} />
      </group>
    </RigidBody>
  );
}
