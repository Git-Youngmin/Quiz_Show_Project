/**
 * 가상 조이스틱/점프 버튼의 현재 입력값.
 * 60fps 로 바뀌는 값이라 React state 가 아닌 mutable 객체로 둔다
 * (useFrame 에서 읽기만 하므로 리렌더가 필요 없음).
 */
export const touchInput = {
  /** -1(왼쪽) ~ 1(오른쪽) */
  x: 0,
  /** -1(화면 위 = 앞) ~ 1(화면 아래 = 뒤) — 월드 z 축과 같은 방향 */
  y: 0,
  jump: false,
};

export function resetTouchInput() {
  touchInput.x = 0;
  touchInput.y = 0;
  touchInput.jump = false;
}
