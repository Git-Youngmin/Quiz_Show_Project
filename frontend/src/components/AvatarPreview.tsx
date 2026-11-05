import type { CharacterShape } from "@quiz/shared";

/**
 * 로비용 2D 캐릭터 미리보기 (순수 HTML/CSS — 3D 캔버스 없이 가볍게).
 * 3D 의 Character 와 같은 실루엣/눈 배치를 흉내낸다.
 */
export function AvatarPreview({
  shape,
  color,
  size = 120,
}: {
  shape: CharacterShape;
  color: string;
  size?: number;
}) {
  return (
    <div className={`avatar avatar-${shape}`} style={{ width: size, height: size }} aria-hidden>
      {/* 3D 젤리빈과 같은 구성: 발 2 + 몸통 + 팔 2 + 고글 눈 + 볼터치 */}
      <div className="avatar-foot l" style={{ background: color }} />
      <div className="avatar-foot r" style={{ background: color }} />
      <div className="avatar-body" style={{ background: color }} />
      <div className="avatar-arm l" style={{ background: color }} />
      <div className="avatar-arm r" style={{ background: color }} />
      <div className="avatar-eyes">
        <span />
        <span />
      </div>
      <div className="avatar-cheeks">
        <i />
        <i />
      </div>
    </div>
  );
}
