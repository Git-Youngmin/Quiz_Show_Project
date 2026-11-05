/** 3D 월드 공용 상수 */

/** 퀴즈 보드(바닥) 크기 — 윗면이 y = 0 */
export const BOARD_SIZE = 30;
export const BOARD_THICKNESS = 1;

/** 캐릭터 캡슐: 반높이(원기둥 부분) + 반지름 → 전체 높이 = 2 * (HALF + RADIUS) = 1.6 */
export const CAPSULE_HALF_HEIGHT = 0.35;
export const CAPSULE_RADIUS = 0.45;
export const CHARACTER_CENTER_Y = CAPSULE_HALF_HEIGHT + CAPSULE_RADIUS;

export const MOVE_SPEED = 6; // units/s
export const JUMP_VELOCITY = 7;
/** 이 높이 아래로 떨어지면 리스폰 */
export const FALL_LIMIT_Y = -15;

/** 3인칭 카메라 오프셋 (캐릭터 기준) */
export const CAMERA_OFFSET: [number, number, number] = [0, 9, 13];
