import { useState, type FormEvent } from "react";
import { ADMIN_PASSWORD_LENGTH, ROOM_ID_PATTERN } from "@quiz/shared";
import { createRoom } from "../lib/api";
import type { AdminSession } from "../lib/adminSession";

type Mode = "login" | "create";

/**
 * 관리자 로그인 폼 — 인증 전에는 WebSocket 을 열지 않는다.
 *  - 새 방 만들기 : POST /api/rooms 로 방 + 방장 비밀번호 등록 → 바로 로그인
 *  - 기존 방 관리 : 입력한 비밀번호로 접속 (검증은 서버가 WebSocket 접속 시 수행)
 */
export function AdminLogin({
  initialRoom,
  error: externalError,
  onSubmit,
}: {
  initialRoom: string;
  error: string | null;
  onSubmit: (s: AdminSession) => void;
}) {
  const [mode, setMode] = useState<Mode>(initialRoom ? "login" : "create");
  const [roomId, setRoomId] = useState(initialRoom);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const roomValid = ROOM_ID_PATTERN.test(roomId);
  const pwValid = password.length >= ADMIN_PASSWORD_LENGTH.min && password.length <= ADMIN_PASSWORD_LENGTH.max;
  const shownError = error ?? externalError;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!roomValid || !pwValid || busy) return;
    setError(null);
    if (mode === "create") {
      setBusy(true);
      const res = await createRoom({ roomId, adminPassword: password });
      setBusy(false);
      if (!res.ok) {
        setError(res.error);
        return;
      }
    }
    onSubmit({ roomId, password });
  };

  return (
    <div className="lobby">
      <form className="lobby-card admin-login" onSubmit={submit}>
        <header className="lobby-header">
          <h1>관리자 로그인</h1>
          <p>방장만 문제를 출제하고 게임을 진행할 수 있어요.</p>
        </header>

        <div className="segmented full" role="tablist">
          {(
            [
              ["login", "기존 방 관리"],
              ["create", "새 방 만들기"],
            ] as const
          ).map(([m, label]) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              className={mode === m ? "selected" : ""}
              onClick={() => {
                setMode(m);
                setError(null);
              }}
            >
              {label}
            </button>
          ))}
        </div>

        <label className="field">
          <span>방 코드</span>
          <input
            className="input mono"
            value={roomId}
            maxLength={32}
            placeholder="예) friday-quiz"
            autoCapitalize="off"
            onChange={(e) => setRoomId(e.target.value.trim())}
          />
          {roomId && !roomValid && <small className="field-error">영문, 숫자, -, _ 만 쓸 수 있어요</small>}
        </label>
        <label className="field">
          <span>{mode === "create" ? "방장 비밀번호 정하기" : "방장 비밀번호"}</span>
          <input
            className="input"
            type="password"
            value={password}
            maxLength={ADMIN_PASSWORD_LENGTH.max}
            placeholder={`${ADMIN_PASSWORD_LENGTH.min}자 이상`}
            autoComplete={mode === "create" ? "new-password" : "current-password"}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus={!!initialRoom}
          />
        </label>

        {mode === "create" && (
          <p className="admin-hint">
            비밀번호는 서버 메모리에만 저장돼요. 서버가 재시작되거나 방이 2시간 동안 비어 있으면 사라지니, 그때는 방을 다시 만들어 주세요.
          </p>
        )}
        {shownError && (
          <p className="admin-error" role="alert">
            {shownError}
          </p>
        )}

        <button className="btn lobby-enter" type="submit" disabled={!roomValid || !pwValid || busy}>
          {busy ? "처리 중…" : mode === "create" ? "방 만들고 입장" : "로그인"}
        </button>
      </form>
    </div>
  );
}
