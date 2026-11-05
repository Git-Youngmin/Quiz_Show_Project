/**
 * frontend/dist 정적 파일 서빙 (SPA fallback 포함).
 * 의존성 없이 node:fs 만 사용. 디렉토리가 없으면 null 을 반환해 비활성화된다.
 */
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
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
};

export function createStaticHandler(dir?: string) {
  // 기본: 레포 루트에서 실행하든 backend 에서 실행하든 frontend/dist 를 찾음
  const candidates = dir ? [dir] : ["frontend/dist", "../frontend/dist"];
  const root = candidates.map((d) => resolve(d)).find((d) => existsSync(join(d, "index.html")));
  if (!root) return null;
  const indexHtml = join(root, "index.html");

  return (pathname: string, res: ServerResponse) => {
    // 경로 탈출(../) 방지
    const safe = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, "");
    let file = join(root, safe);
    if (!file.startsWith(root) || !existsSync(file) || statSync(file).isDirectory()) {
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
