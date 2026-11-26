/**
 * 데스크톱(정밀 포인터)에서만 자동 포커스. 모바일에서 페이지를 열자마자
 * 키보드가 올라와 화면을 가리는 것을 막는다.
 */
export const canAutoFocus = (): boolean =>
  typeof window !== "undefined" && window.matchMedia("(pointer: fine)").matches;
