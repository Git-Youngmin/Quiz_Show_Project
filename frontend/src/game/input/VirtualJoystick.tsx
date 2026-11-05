import { useEffect, useRef } from "react";
import { resetTouchInput, touchInput } from "./touchInput";

const RADIUS = 56; // 노브가 움직일 수 있는 최대 거리(px)
const DEAD_ZONE = 0.12;

/**
 * 외부 라이브러리 없이 Pointer Events 로 구현한 가상 조이스틱 + 점프 버튼.
 * 노브 위치는 DOM style 을 직접 갱신해서 드래그 중 React 리렌더가 없다.
 */
export function VirtualJoystick() {
  const baseRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLDivElement>(null);
  const pointerId = useRef<number | null>(null);
  const center = useRef({ x: 0, y: 0 });

  useEffect(() => resetTouchInput, []);

  const update = (clientX: number, clientY: number) => {
    let dx = clientX - center.current.x;
    let dy = clientY - center.current.y;
    const dist = Math.hypot(dx, dy);
    if (dist > RADIUS) {
      dx = (dx / dist) * RADIUS;
      dy = (dy / dist) * RADIUS;
    }
    knobRef.current!.style.transform = `translate(${dx}px, ${dy}px)`;

    const nx = dx / RADIUS;
    const ny = dy / RADIUS;
    const mag = Math.hypot(nx, ny);
    if (mag < DEAD_ZONE) {
      touchInput.x = touchInput.y = 0;
    } else {
      // 데드존 이후 0~1 로 재매핑해서 아날로그 감도 유지
      const scale = (mag - DEAD_ZONE) / (1 - DEAD_ZONE) / mag;
      touchInput.x = nx * scale;
      touchInput.y = ny * scale;
    }
  };

  const release = (e: React.PointerEvent) => {
    if (e.pointerId !== pointerId.current) return;
    pointerId.current = null;
    touchInput.x = touchInput.y = 0;
    knobRef.current!.style.transform = "translate(0px, 0px)";
  };

  return (
    <>
      <div
        ref={baseRef}
        className="joystick"
        onPointerDown={(e) => {
          if (pointerId.current !== null) return;
          pointerId.current = e.pointerId;
          e.currentTarget.setPointerCapture(e.pointerId);
          const rect = baseRef.current!.getBoundingClientRect();
          center.current = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
          update(e.clientX, e.clientY);
        }}
        onPointerMove={(e) => {
          if (e.pointerId === pointerId.current) update(e.clientX, e.clientY);
        }}
        onPointerUp={release}
        onPointerCancel={release}
      >
        <div ref={knobRef} className="joystick-knob" />
      </div>

      <button
        type="button"
        className="jump-button"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          touchInput.jump = true;
        }}
        onPointerUp={() => (touchInput.jump = false)}
        onPointerCancel={() => (touchInput.jump = false)}
      >
        JUMP
      </button>
    </>
  );
}

/** 터치 기기(또는 ?joystick=1)에서만 조이스틱 표시 */
export function shouldShowJoystick(): boolean {
  if (new URLSearchParams(location.search).get("joystick") === "1") return true;
  return window.matchMedia("(pointer: coarse)").matches || navigator.maxTouchPoints > 0;
}
