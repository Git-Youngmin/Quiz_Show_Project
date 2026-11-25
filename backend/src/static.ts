/**
 * frontend/dist 정적 파일 서빙 (SPA fallback 포함).
 * 의존성 없이 node:fs 만 사용. 디렉토리가 없으면 null 을 반환해 비활성화된다.
 */
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";
import type { ServerResponse } from "node:http";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".wasm": "application/wasm",
  ".woff2": "font/woff2",
  ".webmanifest": "application/manifest+json",
  ".mp3": "audio/mpeg",
};

export function createStaticHandler(dir?: string) {
  // 기본: 레포 루트에서 실행하든 backend 에서 실행하든 frontend/dist 를 찾음
  const candidates = dir ? [dir] : ["frontend/dist", "../frontend/dist"];
  const root = candidates.map((d) => resolve(d)).find((d) => existsSync(join(d, "index.html")));
  if (!root) return null;
  const indexHtml = join(root, "index.html");

  return (pathname: string, res: ServerResponse) => {
    // 잘못된 %-인코딩은 decodeURIComponent 가 예외를 던짐 → 400 (미처리 예외로 프로세스가 죽지 않게)
    let decoded: string;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      res.writeHead(400).end("Bad Request");
      return;
    }
    // 경로 탈출(../) 방지
    const safe = normalize(decoded).replace(/^(\.\.[/\\])+/, "");
    let file = join(root, safe);
    const exists = file.startsWith(root + sep) && existsSync(file) && !statSync(file).isDirectory();
    if (!exists) {
      // 해시가 붙은 빌드 산출물이 없으면(재배포 후 옛 청크 요청) index.html 대신 404:
      // HTML 을 JS 로 받으면 동적 import 가 모호하게 실패하므로, 클라이언트가 명확히 감지해 새로고침하게 한다.
      if (safe.replace(/\\/g, "/").startsWith("/assets/")) {
        res.writeHead(404, { "Cache-Control": "no-cache" }).end("Not found");
        return;
      }
      file = indexHtml; // SPA: /play, /admin 등은 index.html
    }
    const isAsset = file.includes(`${join(root, "assets")}`);
    res.writeHead(200, {
      "Content-Type": MIME[extname(file)] ?? "application/octet-stream",
      // 해시가 붙은 빌드 산출물은 오래 캐시, index.html 은 항상 새로
      "Cache-Control": isAsset ? "public, max-age=31536000, immutable" : "no-cache",
    });
    createReadStream(file).pipe(res);
  };
}
