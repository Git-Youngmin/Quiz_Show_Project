import { useCallback } from "react";
import { useKeyboardControls } from "@react-three/drei";
import { Controls } from "./controls";
import { touchInput } from "./touchInput";

export interface PlayerInput {
  /** 월드 기준 이동 방향 (길이 ≤ 1). x: 오른쪽 +, z: 카메라 쪽(뒤) + */
  x: number;
  z: number;
  jump: boolean;
}

/**
 * 키보드(PC) + 가상 조이스틱(모바일) 입력을 하나로 합친 getter 를 반환.
 * useFrame 안에서 매 프레임 호출해서 사용 → 입력 변화로 리렌더가 일어나지 않음.
 *
 * 반드시 <KeyboardControls> 하위에서 사용해야 함.
 */
export function usePlayerInput(): () => PlayerInput {
  const [, getKeys] = useKeyboardControls<Controls>();

  return useCallback(() => {
    const k = getKeys();
    let x = (k.right ? 1 : 0) - (k.left ? 1 : 0) + touchInput.x;
    let z = (k.backward ? 1 : 0) - (k.forward ? 1 : 0) + touchInput.y;

    // 대각선/동시 입력 시 속도가 빨라지지 않도록 정규화 (조이스틱의 아날로그 크기는 유지)
    const len = Math.hypot(x, z);
    if (len > 1) {
      x /= len;
      z /= len;
    }
    return { x, z, jump: k.jump || touchInput.jump };
  }, [getKeys]);
}
