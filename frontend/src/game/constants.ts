/** 3D 월드 공용 상수 */
import { GRAVITY, SPECTATOR_ZONES, zoneToWorld } from "@quiz/shared";

/** 퀴즈 보드(바닥) 크기 — 윗면이 y = 0 (서버와 공유하는 값) */
export { BOARD_SIZE } from "@quiz/shared";
export const BOARD_THICKNESS = 1;

/**
 * 캐릭터 충돌 캡슐: 반높이(원기둥) + 반지름 → 전체 높이 1.6, 지름 1.0.
 * 젤리빈 외형(몸통 + 팔 + 다리 + 고글) 전체가 이 캡슐 안에 들어가도록 Character.tsx 에서 맞춘다.
 */
export const CAPSULE_HALF_HEIGHT = 0.3;
export const CAPSULE_RADIUS = 0.5;
export const CHARACTER_CENTER_Y = CAPSULE_HALF_HEIGHT + CAPSULE_RADIUS;

/** ── 조작감 (중력 30 기준으로 튜닝) ── */
export const PHYSICS_GRAVITY: [number, number, number] = [0, -GRAVITY, 0];
export const MOVE_SPEED = 7; // units/s
/** 땅/공중에서 목표 속도에 다가가는 빠르기 (클수록 즉각 반응) */
export const GROUND_ACCEL = 22;
export const AIR_ACCEL = 9;
/** 점프 속도 — 최고 높이 ≈ v² / 2g = 12² / 60 ≈ 2.4 (이전 10.5 → 1.8) */
export const JUMP_VELOCITY = 12;
/** 내려올 때 추가 중력 (총 30 + 22) → 올라갈 땐 가볍게, 떨어질 땐 툭 */
export const FALL_EXTRA_GRAVITY = 22;
/** 이 높이 아래로 떨어지면 리스폰 */
export const FALL_LIMIT_Y = -15;

/** 3인칭 카메라 오프셋 (캐릭터 기준) */
export const CAMERA_OFFSET: [number, number, number] = [0, 9, 13];

/**
 * 관전석 랜덤 리스폰 — 두 관전석 중 하나를 무작위로 고르고,
 * 투척 발판이 있는 앞쪽을 피해 뒤쪽에 생성 (리스폰하자마자 발판을 밟는 일이 없도록)
 */
export function randomSpectatorSpawn(): { zone: number; pos: { x: number; y: number; z: number } } {
  const zone = Math.floor(Math.random() * SPECTATOR_ZONES.length);
  const def = SPECTATOR_ZONES[zone];
  const [depth, width] = def.size;
  const lx = -depth / 2 + 1.2 + Math.random() * Math.max(0.5, depth - 5.5); // 뒤쪽 벽 ~ 버튼 줄 앞까지
  const lz = (Math.random() - 0.5) * (width - 3);
  const [x, z] = zoneToWorld(def, lx, lz);
  return { zone, pos: { x, y: def.center[1] + CHARACTER_CENTER_Y + 0.3, z } };
}
