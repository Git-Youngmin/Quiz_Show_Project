import { useGameStore } from "../store/useGameStore";

/**
 * 연결에 문제가 있을 때만 나타나는 작은 안내 (/play, /display).
 * 평소(연결됨)에는 아무것도 보여주지 않아 화면을 깔끔하게 유지한다.
 */
export function ConnectionNotice() {
  const status = useGameStore((s) => s.status);
  const hasJoined = useGameStore((s) => !!s.selfId);
  if (status === "open" && hasJoined) return null;
  const text = status === "closed" ? "연결이 끊겼어요 · 다시 연결하는 중…" : "연결하는 중…";
  return (
    <div className={`connection-notice ${status === "closed" ? "error" : ""}`} role="status">
      {text}
    </div>
  );
}
