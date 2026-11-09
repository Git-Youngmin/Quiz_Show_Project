import { useRef, useMemo, type MutableRefObject } from "react";
import { useFrame } from "@react-three/fiber";
import { Capsule, Cone, Html, RoundedBox, Sphere } from "@react-three/drei";
import type { Group } from "three";
import type { CharacterShape, CharacterAccessory } from "@quiz/shared";
import { CHARACTER_CENTER_Y } from "./constants";

/**
 * 카훗 & 폴가이즈풍 3D 캐릭터 (순수 시각 — 물리 X).
 * 
 * - 20종의 다양한 동물 / 크리처 캐릭터 외형 + 4종 기본 도형(하위 호환)
 * - 9종 꾸미기 악세사리 (왕관, 파티모자, 헤드폰, 스냅백, 천사링, 리본, 선글라스, 안경 등)
 * - 걷기 / 점프 / 착지 바운스 & 스쿼시-스트레치 애니메이션 완벽 연동
 *
 * ⚖️ 공평성: 충돌체는 모양과 무관하게 항상 동일한 CapsuleCollider 를 사용합니다.
 */

export interface CharacterMotion {
  speed: number;
  airborne: boolean;
  vy: number;
}

const FOOT = { x: 0.12, y: -0.66, r: 0.12 };
const ARM_R = 0.12;

interface CharacterProps {
  color: string;
  name: string;
  shape?: CharacterShape;
  accessory?: CharacterAccessory;
  isSelf?: boolean;
  motion?: MutableRefObject<CharacterMotion>;
}

// ──────────────────────────────────────────────
// 악세사리 컴포넌트
// ──────────────────────────────────────────────
function AccessoryMesh({ accessory }: { accessory?: CharacterAccessory }) {
  if (!accessory || accessory === "none") return null;

  switch (accessory) {
    case "crown":
      return (
        <group position={[0, 0.62, 0]}>
          {/* 왕관 베이스 링 */}
          <mesh castShadow>
            <cylinderGeometry args={[0.22, 0.20, 0.08, 16]} />
            <meshStandardMaterial color="#ffd700" metalness={0.7} roughness={0.2} />
          </mesh>
          {/* 5개 뾰족한 스파이크와 보석 */}
          {[0, 1, 2, 3, 4].map((i) => {
            const angle = (i * Math.PI * 2) / 5;
            const x = Math.sin(angle) * 0.20;
            const z = Math.cos(angle) * 0.20;
            return (
              <group key={i} position={[x, 0.08, z]}>
                <mesh castShadow>
                  <coneGeometry args={[0.045, 0.12, 4]} />
                  <meshStandardMaterial color="#ffd700" metalness={0.7} roughness={0.2} />
                </mesh>
                <mesh position={[0, 0.07, 0]}>
                  <sphereGeometry args={[0.025, 8, 8]} />
                  <meshStandardMaterial color={i % 2 === 0 ? "#ff2244" : "#00d2d3"} roughness={0.1} />
                </mesh>
              </group>
            );
          })}
        </group>
      );

    case "party_hat":
      return (
        <group position={[0, 0.76, 0]} rotation={[0.08, 0, -0.05]}>
          {/* 파티 고깔 모자 */}
          <mesh castShadow>
            <coneGeometry args={[0.20, 0.44, 16]} />
            <meshStandardMaterial color="#ff4757" roughness={0.3} />
          </mesh>
          {/* 줄무늬 데코 */}
          <mesh position={[0, -0.06, 0]}>
            <cylinderGeometry args={[0.16, 0.17, 0.05, 16]} />
            <meshBasicMaterial color="#ffe14d" />
          </mesh>
          {/* 꼭대기 폼폼 방울 */}
          <mesh position={[0, 0.23, 0]}>
            <sphereGeometry args={[0.06, 12, 12]} />
            <meshStandardMaterial color="#ffffff" roughness={0.7} />
          </mesh>
        </group>
      );

    case "headphones":
      return (
        <group position={[0, 0.42, 0]}>
          {/* 헤드밴드 */}
          <mesh position={[0, 0.08, 0]} rotation={[0, 0, Math.PI / 2]}>
            <torusGeometry args={[0.39, 0.035, 8, 24, Math.PI]} />
            <meshStandardMaterial color="#2d3436" metalness={0.5} roughness={0.3} />
          </mesh>
          {/* 좌우 이어컵 */}
          {[-0.39, 0.39].map((x) => (
            <group key={x} position={[x, 0.0, 0]} rotation={[0, 0, Math.PI / 2]}>
              <mesh castShadow>
                <cylinderGeometry args={[0.13, 0.13, 0.08, 16]} />
                <meshStandardMaterial color="#1e272e" roughness={0.3} />
              </mesh>
              {/* 네온 링 액센트 */}
              <mesh position={[0, x > 0 ? 0.042 : -0.042, 0]}>
                <torusGeometry args={[0.09, 0.015, 8, 16]} />
                <meshBasicMaterial color="#00d2d3" />
              </mesh>
            </group>
          ))}
        </group>
      );

    case "cap":
      return (
        <group position={[0, 0.58, 0]} rotation={[-0.05, 0, 0]}>
          {/* 모자 돔 */}
          <mesh castShadow>
            <sphereGeometry args={[0.39, 16, 16, 0, Math.PI * 2, 0, Math.PI * 0.46]} />
            <meshStandardMaterial color="#2e86de" roughness={0.4} />
          </mesh>
          {/* 챙 */}
          <mesh position={[0, -0.06, 0.25]} rotation={[0.15, 0, 0]} castShadow>
            <boxGeometry args={[0.42, 0.03, 0.26]} />
            <meshStandardMaterial color="#1b4f8a" roughness={0.4} />
          </mesh>
          {/* 모자 꼭지 버튼 */}
          <mesh position={[0, 0.18, 0]}>
            <sphereGeometry args={[0.04, 8, 8]} />
            <meshStandardMaterial color="#ffffff" />
          </mesh>
        </group>
      );

    case "halo":
      return (
        <group position={[0, 0.88, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <mesh>
            <torusGeometry args={[0.26, 0.032, 12, 32]} />
            <meshBasicMaterial color="#ffeaa7" />
          </mesh>
        </group>
      );

    case "ribbon":
      return (
        <group position={[0.20, 0.60, 0.12]} rotation={[0, -0.2, 0.35]}>
          <mesh>
            <sphereGeometry args={[0.05, 8, 8]} />
            <meshStandardMaterial color="#ff4757" roughness={0.2} />
          </mesh>
          <mesh position={[-0.08, 0.02, 0]} rotation={[0, 0, 0.6]}>
            <coneGeometry args={[0.07, 0.14, 8]} />
            <meshStandardMaterial color="#ff6b81" roughness={0.3} />
          </mesh>
          <mesh position={[0.08, 0.02, 0]} rotation={[0, 0, -0.6]}>
            <coneGeometry args={[0.07, 0.14, 8]} />
            <meshStandardMaterial color="#ff6b81" roughness={0.3} />
          </mesh>
        </group>
      );

    case "sunglasses":
      return (
        <group position={[0, 0.30, 0.39]}>
          {/* 안경테 브릿지 */}
          <mesh>
            <boxGeometry args={[0.54, 0.04, 0.03]} />
            <meshStandardMaterial color="#111111" metalness={0.8} roughness={0.2} />
          </mesh>
          {/* 좌우 선글라스 렌즈 */}
          {[-0.14, 0.14].map((x) => (
            <mesh key={x} position={[x, -0.02, 0.01]}>
              <boxGeometry args={[0.18, 0.13, 0.02]} />
              <meshStandardMaterial color="#151515" roughness={0.1} />
            </mesh>
          ))}
          {/* 렌즈 광택 하이라이트 */}
          <mesh position={[-0.11, 0.02, 0.025]} rotation={[0, 0, 0.5]}>
            <boxGeometry args={[0.08, 0.02, 0.01]} />
            <meshBasicMaterial color="#ffffff" transparent opacity={0.6} />
          </mesh>
        </group>
      );

    case "glasses":
      return (
        <group position={[0, 0.30, 0.39]}>
          {/* 좌우 원형 림 */}
          {[-0.14, 0.14].map((x) => (
            <mesh key={x} position={[x, 0, 0]}>
              <torusGeometry args={[0.11, 0.02, 8, 24]} />
              <meshStandardMaterial color="#2d3436" metalness={0.5} roughness={0.3} />
            </mesh>
          ))}
          {/* 안경 다리 브릿지 */}
          <mesh position={[0, 0, 0]}>
            <boxGeometry args={[0.09, 0.02, 0.02]} />
            <meshStandardMaterial color="#2d3436" metalness={0.5} roughness={0.3} />
          </mesh>
        </group>
      );

    default:
      return null;
  }
}

// ──────────────────────────────────────────────
// 동물 및 크리처별 고유 3D 파츠
// ──────────────────────────────────────────────
function AnimalFeatures({ shape, color }: { shape: CharacterShape; color: string }) {
  const skin = <meshStandardMaterial color={color} roughness={0.35} />;
  const whiteMat = <meshStandardMaterial color="#ffffff" roughness={0.3} />;

  switch (shape) {
    case "cat":
      return (
        <group>
          {/* 쫑긋 고양이 귀 */}
          <group position={[-0.22, 0.62, 0]} rotation={[0, 0, 0.35]}>
            <mesh castShadow><coneGeometry args={[0.12, 0.24, 4]} />{skin}</mesh>
            <mesh position={[0, -0.01, 0.02]}><coneGeometry args={[0.07, 0.17, 4]} /><meshBasicMaterial color="#ffb8d2" /></mesh>
          </group>
          <group position={[0.22, 0.62, 0]} rotation={[0, 0, -0.35]}>
            <mesh castShadow><coneGeometry args={[0.12, 0.24, 4]} />{skin}</mesh>
            <mesh position={[0, -0.01, 0.02]}><coneGeometry args={[0.07, 0.17, 4]} /><meshBasicMaterial color="#ffb8d2" /></mesh>
          </group>
          {/* 핑크 코 */}
          <mesh position={[0, 0.21, 0.38]}>
            <sphereGeometry args={[0.04, 8, 8]} scale={[1.2, 0.8, 0.8]} />
            <meshBasicMaterial color="#ff7597" />
          </mesh>
          {/* 수염 */}
          {[-1, 1].map((s) => (
            <group key={s} position={[s * 0.26, 0.20, 0.34]} rotation={[0, 0, s * -0.1]}>
              <mesh position={[0, 0.03, 0]}><boxGeometry args={[0.14, 0.015, 0.01]} /><meshBasicMaterial color="#333" /></mesh>
              <mesh position={[0, -0.03, 0]}><boxGeometry args={[0.14, 0.015, 0.01]} /><meshBasicMaterial color="#333" /></mesh>
            </group>
          ))}
        </group>
      );

    case "dog":
      return (
        <group>
          {/* 축 처진 멍멍이 귀 */}
          {[-1, 1].map((s) => (
            <mesh key={s} position={[s * 0.38, 0.40, 0]} rotation={[0, 0, s * 0.45]} scale={[1, 1.8, 0.8]} castShadow>
              <capsuleGeometry args={[0.09, 0.22, 8, 12]} />
              <meshStandardMaterial color="#8b5a2b" roughness={0.4} />
            </mesh>
          ))}
          {/* 주둥이 + 블랙 코 */}
          <mesh position={[0, 0.18, 0.35]} scale={[1.3, 0.9, 0.8]} castShadow>
            <sphereGeometry args={[0.12, 12, 12]} />
            <meshStandardMaterial color="#fff4e6" roughness={0.3} />
          </mesh>
          <mesh position={[0, 0.22, 0.43]}>
            <sphereGeometry args={[0.05, 8, 8]} />
            <meshStandardMaterial color="#1a1a1a" roughness={0.1} />
          </mesh>
        </group>
      );

    case "rabbit":
      return (
        <group>
          {/* 길쭉한 토끼 귀 */}
          {[-1, 1].map((s) => (
            <group key={s} position={[s * 0.16, 0.82, 0]} rotation={[0, 0, s * -0.1]}>
              <mesh castShadow><capsuleGeometry args={[0.07, 0.36, 8, 16]} />{skin}</mesh>
              <mesh position={[0, 0, 0.03]}><capsuleGeometry args={[0.04, 0.30, 8, 16]} /><meshBasicMaterial color="#ffb8d2" /></mesh>
            </group>
          ))}
          {/* 핑크 코 & 앞니 */}
          <mesh position={[0, 0.22, 0.38]}><sphereGeometry args={[0.04, 8, 8]} /><meshBasicMaterial color="#ff7597" /></mesh>
          <mesh position={[0, 0.16, 0.37]}><boxGeometry args={[0.06, 0.05, 0.02]} /><meshBasicMaterial color="#ffffff" /></mesh>
        </group>
      );

    case "bear":
      return (
        <group>
          {/* 둥근 곰 귀 */}
          {[-1, 1].map((s) => (
            <group key={s} position={[s * 0.28, 0.58, 0]}>
              <mesh castShadow><sphereGeometry args={[0.12, 12, 12]} />{skin}</mesh>
              <mesh position={[0, 0, 0.04]}><sphereGeometry args={[0.07, 10, 10]} /><meshBasicMaterial color="#e5a970" /></mesh>
            </group>
          ))}
          {/* 주둥이 & 코 */}
          <mesh position={[0, 0.18, 0.34]} scale={[1.3, 1, 0.8]}>
            <sphereGeometry args={[0.13, 12, 12]} />
            <meshStandardMaterial color="#fcebd9" roughness={0.3} />
          </mesh>
          <mesh position={[0, 0.22, 0.43]}><sphereGeometry args={[0.045, 8, 8]} /><meshStandardMaterial color="#222" roughness={0.1} /></mesh>
        </group>
      );

    case "panda":
      return (
        <group>
          {/* 검정 둥근 귀 */}
          {[-1, 1].map((s) => (
            <mesh key={s} position={[s * 0.28, 0.58, 0]} castShadow>
              <sphereGeometry args={[0.12, 12, 12]} />
              <meshStandardMaterial color="#1a1a1a" roughness={0.3} />
            </mesh>
          ))}
          {/* 판다 특유의 눈 주변 블랙 패치 */}
          {[-1, 1].map((s) => (
            <mesh key={s} position={[s * 0.13, 0.30, 0.31]} rotation={[0, 0, s * -0.3]} scale={[1.4, 1.1, 0.4]}>
              <sphereGeometry args={[0.13, 12, 12]} />
              <meshStandardMaterial color="#1a1a1a" roughness={0.3} />
            </mesh>
          ))}
          <mesh position={[0, 0.20, 0.38]}><sphereGeometry args={[0.04, 8, 8]} /><meshStandardMaterial color="#1a1a1a" roughness={0.1} /></mesh>
        </group>
      );

    case "fox":
      return (
        <group>
          {/* 날렵한 여우 귀 */}
          {[-1, 1].map((s) => (
            <group key={s} position={[s * 0.24, 0.64, 0]} rotation={[0, 0, s * -0.3]}>
              <mesh castShadow><coneGeometry args={[0.13, 0.26, 4]} />{skin}</mesh>
              <mesh position={[0, -0.01, 0.02]}><coneGeometry args={[0.08, 0.18, 4]} /><meshBasicMaterial color="#ffffff" /></mesh>
            </group>
          ))}
          {/* 하얀 볼/주둥이 포인트 */}
          <mesh position={[0, 0.17, 0.35]} scale={[1.4, 0.8, 0.8]}>
            <sphereGeometry args={[0.12, 12, 12]} />
            {whiteMat}
          </mesh>
          <mesh position={[0, 0.21, 0.43]}><sphereGeometry args={[0.045, 8, 8]} /><meshStandardMaterial color="#1a1a1a" roughness={0.1} /></mesh>
        </group>
      );

    case "frog":
      return (
        <group>
          {/* 머리 위 커다란 개구리 눈 융기 */}
          {[-1, 1].map((s) => (
            <mesh key={s} position={[s * 0.20, 0.60, 0.08]} castShadow>
              <sphereGeometry args={[0.15, 16, 16]} />
              {skin}
            </mesh>
          ))}
          {/* 노란 배 패치 */}
          <mesh position={[0, -0.10, 0.32]} scale={[1.2, 1.4, 0.3]}>
            <sphereGeometry args={[0.22, 16, 16]} />
            <meshStandardMaterial color="#e8ffaa" roughness={0.4} />
          </mesh>
        </group>
      );

    case "penguin":
      return (
        <group>
          {/* 하얀 배 가슴팍 */}
          <mesh position={[0, 0.05, 0.31]} scale={[1.1, 1.6, 0.3]}>
            <sphereGeometry args={[0.24, 16, 16]} />
            {whiteMat}
          </mesh>
          {/* 주황색 부리 */}
          <mesh position={[0, 0.20, 0.41]} rotation={[Math.PI / 2, 0, 0]} castShadow>
            <coneGeometry args={[0.08, 0.16, 12]} />
            <meshStandardMaterial color="#ff9f1a" roughness={0.3} />
          </mesh>
        </group>
      );

    case "duck":
      return (
        <group>
          {/* 납작한 오리 부리 */}
          <mesh position={[0, 0.20, 0.40]} scale={[1.8, 0.5, 1.4]} castShadow>
            <sphereGeometry args={[0.09, 12, 12]} />
            <meshStandardMaterial color="#ffa502" roughness={0.3} />
          </mesh>
          {/* 볏/머리 깃털 */}
          <mesh position={[0, 0.64, 0]} rotation={[0, 0, 0.2]}>
            <coneGeometry args={[0.05, 0.14, 6]} />
            {skin}
          </mesh>
        </group>
      );

    case "pig":
      return (
        <group>
          {/* 동그란 돼지코 */}
          <group position={[0, 0.18, 0.39]}>
            <mesh scale={[1.4, 1.0, 0.4]}>
              <sphereGeometry args={[0.10, 12, 12]} />
              <meshStandardMaterial color="#ff8fb1" roughness={0.3} />
            </mesh>
            {[-0.04, 0.04].map((x) => (
              <mesh key={x} position={[x, 0, 0.035]}>
                <sphereGeometry args={[0.02, 6, 6]} scale={[0.8, 1.2, 0.5]} />
                <meshBasicMaterial color="#552233" />
              </mesh>
            ))}
          </group>
          {/* 접힌 돼지 귀 */}
          {[-1, 1].map((s) => (
            <mesh key={s} position={[s * 0.25, 0.58, 0.05]} rotation={[0.4, 0, s * -0.4]} castShadow>
              <coneGeometry args={[0.10, 0.18, 4]} />
              <meshStandardMaterial color="#ff8fb1" roughness={0.35} />
            </mesh>
          ))}
        </group>
      );

    case "monkey":
      return (
        <group>
          {/* 옆으로 툭 튀어나온 큰 귀 */}
          {[-1, 1].map((s) => (
            <group key={s} position={[s * 0.42, 0.30, 0]}>
              <mesh scale={[0.4, 1, 1]} castShadow><sphereGeometry args={[0.14, 12, 12]} />{skin}</mesh>
              <mesh position={[s * 0.02, 0, 0.02]} scale={[0.3, 0.8, 0.8]}><sphereGeometry args={[0.09, 10, 10]} /><meshBasicMaterial color="#ffd3b6" /></mesh>
            </group>
          ))}
          {/* 살구색 입가 */}
          <mesh position={[0, 0.15, 0.34]} scale={[1.4, 1, 0.6]}>
            <sphereGeometry args={[0.14, 12, 12]} />
            <meshStandardMaterial color="#ffd3b6" roughness={0.3} />
          </mesh>
        </group>
      );

    case "koala":
      return (
        <group>
          {/* 복슬복슬 큰 털 귀 */}
          {[-1, 1].map((s) => (
            <group key={s} position={[s * 0.36, 0.50, 0]}>
              <mesh scale={[1, 1, 0.6]} castShadow><sphereGeometry args={[0.16, 12, 12]} />{skin}</mesh>
              <mesh position={[0, 0, 0.04]} scale={[1, 1, 0.4]}><sphereGeometry args={[0.10, 10, 10]} />{whiteMat}</mesh>
            </group>
          ))}
          {/* 큼직한 타원형 검정 코 */}
          <mesh position={[0, 0.20, 0.39]} scale={[0.9, 1.4, 0.7]} castShadow>
            <sphereGeometry args={[0.08, 12, 12]} />
            <meshStandardMaterial color="#2d3436" roughness={0.2} />
          </mesh>
        </group>
      );

    case "hamster":
      return (
        <group>
          {/* 빵빵한 볼주머니 */}
          {[-1, 1].map((s) => (
            <mesh key={s} position={[s * 0.22, 0.12, 0.30]} scale={[1.1, 0.9, 0.9]}>
              <sphereGeometry args={[0.12, 12, 12]} />
              {whiteMat}
            </mesh>
          ))}
          {/* 앙증맞은 귀 */}
          {[-1, 1].map((s) => (
            <mesh key={s} position={[s * 0.22, 0.60, 0]} castShadow>
              <sphereGeometry args={[0.08, 10, 10]} />
              {skin}
            </mesh>
          ))}
        </group>
      );

    case "chick":
      return (
        <group>
          {/* 앙증맞은 미니 주황 부리 */}
          <mesh position={[0, 0.20, 0.40]} rotation={[Math.PI / 2, 0, 0]} castShadow>
            <coneGeometry args={[0.06, 0.14, 12]} />
            <meshStandardMaterial color="#ffa502" roughness={0.3} />
          </mesh>
          {/* 머리 위 새싹/깃털 */}
          <mesh position={[0, 0.65, 0]}>
            <coneGeometry args={[0.04, 0.14, 4]} />
            <meshStandardMaterial color="#ffe14d" roughness={0.3} />
          </mesh>
        </group>
      );

    case "tiger":
      return (
        <group>
          {/* 둥근 귀 */}
          {[-1, 1].map((s) => (
            <mesh key={s} position={[s * 0.26, 0.58, 0]} castShadow>
              <sphereGeometry args={[0.10, 10, 10]} />
              {skin}
            </mesh>
          ))}
          {/* 이마 호랑이 줄무늬 */}
          {[0.48, 0.42, 0.36].map((y, idx) => (
            <mesh key={idx} position={[0, y, 0.37]}>
              <boxGeometry args={[0.18 - idx * 0.04, 0.02, 0.01]} />
              <meshBasicMaterial color="#1a1a1a" />
            </mesh>
          ))}
          {/* 코 */}
          <mesh position={[0, 0.20, 0.38]}><sphereGeometry args={[0.04, 8, 8]} /><meshBasicMaterial color="#ff7597" /></mesh>
        </group>
      );

    case "lion":
      return (
        <group>
          {/* 풍성한 사자 갈기 링 */}
          <mesh position={[0, 0.26, -0.06]} castShadow>
            <torusGeometry args={[0.42, 0.15, 12, 28]} />
            <meshStandardMaterial color="#d35400" roughness={0.5} />
          </mesh>
          {/* 귀 */}
          {[-1, 1].map((s) => (
            <mesh key={s} position={[s * 0.28, 0.58, 0]} castShadow>
              <sphereGeometry args={[0.10, 10, 10]} />
              {skin}
            </mesh>
          ))}
          <mesh position={[0, 0.19, 0.38]}><sphereGeometry args={[0.045, 8, 8]} /><meshBasicMaterial color="#333" /></mesh>
        </group>
      );

    case "dragon":
      return (
        <group>
          {/* 머리 위 황금 뿔 2개 */}
          {[-1, 1].map((s) => (
            <mesh key={s} position={[s * 0.18, 0.64, -0.04]} rotation={[-0.3, 0, s * 0.3]} castShadow>
              <coneGeometry args={[0.07, 0.22, 8]} />
              <meshStandardMaterial color="#f5cd79" metalness={0.2} roughness={0.3} />
            </mesh>
          ))}
          {/* 등 뒤 미니 스파이크들 */}
          {[0.3, 0.05, -0.2].map((y, idx) => (
            <mesh key={idx} position={[0, y, -0.38]} rotation={[-Math.PI / 2, 0, 0]} castShadow>
              <coneGeometry args={[0.06, 0.14, 4]} />
              <meshStandardMaterial color="#f5cd79" roughness={0.3} />
            </mesh>
          ))}
        </group>
      );

    case "robot":
      return (
        <group>
          {/* 머리 위 안테나 */}
          <mesh position={[0, 0.68, 0]}>
            <cylinderGeometry args={[0.02, 0.02, 0.16, 8]} />
            <meshStandardMaterial color="#bdc3c7" metalness={0.8} roughness={0.2} />
          </mesh>
          <mesh position={[0, 0.78, 0]}>
            <sphereGeometry args={[0.05, 10, 10]} />
            <meshBasicMaterial color="#00d2d3" />
          </mesh>
          {/* 양 옆 메탈 볼트 귀 */}
          {[-1, 1].map((s) => (
            <mesh key={s} position={[s * 0.40, 0.26, 0]} rotation={[0, 0, Math.PI / 2]}>
              <cylinderGeometry args={[0.06, 0.06, 0.08, 6]} />
              <meshStandardMaterial color="#7f8c8d" metalness={0.8} roughness={0.3} />
            </mesh>
          ))}
        </group>
      );

    case "alien":
      return (
        <group>
          {/* 2개 방울 안테나 */}
          {[-1, 1].map((s) => (
            <group key={s} position={[s * 0.18, 0.66, 0]} rotation={[0, 0, s * -0.2]}>
              <mesh position={[0, 0.06, 0]}><cylinderGeometry args={[0.015, 0.015, 0.14, 8]} /><meshStandardMaterial color={color} /></mesh>
              <mesh position={[0, 0.15, 0]}><sphereGeometry args={[0.055, 10, 10]} /><meshBasicMaterial color="#2ed573" /></mesh>
            </group>
          ))}
          {/* 이마의 제3의 눈! */}
          <group position={[0, 0.44, 0.35]}>
            <mesh><sphereGeometry args={[0.09, 14, 14]} scale={[1, 1.1, 0.6]} /><meshStandardMaterial color="#ffffff" roughness={0.2} /></mesh>
            <mesh position={[0, -0.01, 0.05]}><sphereGeometry args={[0.045, 10, 10]} /><meshStandardMaterial color="#141414" roughness={0.2} /></mesh>
            <mesh position={[0.02, 0.02, 0.07]}><sphereGeometry args={[0.015, 6, 6]} /><meshBasicMaterial color="#ffffff" /></mesh>
          </group>
        </group>
      );

    case "ghost":
      return (
        <group>
          {/* 유령 밑단 펄럭임 장식 */}
          <group position={[0, -0.42, 0]}>
            {[-0.24, -0.08, 0.08, 0.24].map((x, idx) => (
              <mesh key={idx} position={[x, 0, 0]} scale={[1, 1.2, 1]}>
                <sphereGeometry args={[0.08, 8, 8]} />
                {skin}
              </mesh>
            ))}
          </group>
          {/* 놀란 O자 입 */}
          <mesh position={[0, 0.14, 0.37]} scale={[0.8, 1.3, 0.3]}>
            <sphereGeometry args={[0.05, 10, 10]} />
            <meshBasicMaterial color="#1a1a1a" />
          </mesh>
        </group>
      );

    default:
      return null;
  }
}

// ──────────────────────────────────────────────
// 메인 Character 컴포넌트
// ──────────────────────────────────────────────
export function Character({
  color,
  name,
  shape = "cat",
  accessory = "none",
  isSelf = false,
  motion,
}: CharacterProps) {
  const rig = useRef<Group>(null);
  const armL = useRef<Group>(null);
  const armR = useRef<Group>(null);
  const footL = useRef<Group>(null);
  const footR = useRef<Group>(null);
  const anim = useRef({ phase: 0, scaleY: 1, wasAirborne: false, idle: Math.random() * 10 });

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.1);
    const a = anim.current;
    const m = motion?.current ?? { speed: 0, airborne: false, vy: 0 };
    a.idle += dt;

    // 걷기 사이클
    const moving = Math.min(1, m.speed / 4);
    if (!m.airborne) a.phase += dt * (6 + m.speed * 1.6) * (moving > 0.05 ? 1 : 0);
    const swing = Math.sin(a.phase) * 0.14 * moving;
    if (footL.current && footR.current) {
      footL.current.position.set(-FOOT.x, FOOT.y + Math.max(0, Math.sin(a.phase)) * 0.06 * moving, swing);
      footR.current.position.set(FOOT.x, FOOT.y + Math.max(0, -Math.sin(a.phase)) * 0.06 * moving, -swing);
    }

    const armLift = m.airborne ? 0.18 : 0;
    armL.current?.position.set(-0.37, 0.0 + armLift, -swing * 0.8);
    armR.current?.position.set(0.37, 0.0 + armLift, swing * 0.8);

    // 스쿼시 & 스트레치
    if (a.wasAirborne && !m.airborne) a.scaleY = 0.78; // 착지 시 통통
    a.wasAirborne = m.airborne;
    const target = m.airborne ? (m.vy > 0 ? 1.12 : 1.04) : 1;
    a.scaleY += (target - a.scaleY) * (1 - Math.exp(-dt * 14));
    const breathe = m.airborne || moving > 0.05 ? 0 : Math.sin(a.idle * 3) * 0.015;
    const sy = a.scaleY + breathe;
    const sxz = 1 / Math.sqrt(sy);
    if (rig.current) {
      rig.current.scale.set(sxz, sy, sxz);
      rig.current.position.y = -CHARACTER_CENTER_Y * (1 - sy) + Math.abs(Math.sin(a.phase)) * 0.04 * moving;
    }
  });

  const skin = useMemo(() => <meshStandardMaterial color={color} roughness={0.35} />, [color]);

  // 바디 지오메트리 분기 (기존 레거시 형태 대응 및 동물 기본 캡슐)
  const bodyMesh = useMemo(() => {
    switch (shape) {
      case "box":
        return (
          <RoundedBox args={[0.66, 1.1, 0.6]} radius={0.14} smoothness={4} position={[0, 0.08, 0]} castShadow>
            {skin}
          </RoundedBox>
        );
      case "sphere":
        return (
          <Sphere args={[0.46, 32, 24]} position={[0, -0.06, 0]} castShadow>
            {skin}
          </Sphere>
        );
      case "cone":
        return (
          <Cone args={[0.44, 1.25, 32]} position={[0, 0.05, 0]} castShadow>
            {skin}
          </Cone>
        );
      default:
        // 정통 젤리빈 / 동물 베이스
        return (
          <Capsule args={[0.36, 0.52, 12, 22]} position={[0, 0.08, 0]} castShadow>
            {skin}
          </Capsule>
        );
    }
  }, [shape, skin]);

  // 눈 위치 분기 (개구리는 상단 융기 위, 콘 등 특수 케이스)
  const eyesSpec = useMemo(() => {
    if (shape === "frog") return { y: 0.60, z: 0.18, x: 0.20, r: 0.11 };
    if (shape === "sphere") return { y: 0.10, z: 0.38, x: 0.12, r: 0.12 };
    if (shape === "cone") return { y: -0.05, z: 0.20, x: 0.10, r: 0.09 };
    return { y: 0.30, z: 0.31, x: 0.13, r: 0.12 };
  }, [shape]);

  return (
    <group>
      <group ref={rig}>
        {/* 몸통 */}
        {bodyMesh}

        {/* 동물 / 크리처 특화 3D 파츠 (귀, 뿔, 부리, 볼주머니 등) */}
        <AnimalFeatures shape={shape} color={color} />

        {/* 꾸미기 악세사리 (왕관, 파티모자, 헤드폰, 선글라스 등) */}
        <AccessoryMesh accessory={accessory} />

        {/* 팔 */}
        <group ref={armL} position={[-0.37, 0, 0]}>
          <Sphere args={[ARM_R, 16, 12]} castShadow>
            {skin}
          </Sphere>
        </group>
        <group ref={armR} position={[0.37, 0, 0]}>
          <Sphere args={[ARM_R, 16, 12]} castShadow>
            {skin}
          </Sphere>
        </group>

        {/* 발 */}
        {([[-1, footL], [1, footR]] as const).map(([s, ref]) => (
          <group key={s} ref={ref} position={[s * FOOT.x, FOOT.y, 0]}>
            <Sphere args={[FOOT.r, 16, 12]} scale={[1, 0.75, 1.25]} castShadow>
              {skin}
            </Sphere>
          </group>
        ))}

        {/* 초롱초롱 고글 눈 (선글라스 미착용 시에만 표시) */}
        {accessory !== "sunglasses" && (
          <>
            {[-eyesSpec.x, eyesSpec.x].map((ex) => (
              <group key={ex} position={[ex, eyesSpec.y, eyesSpec.z]}>
                <Sphere args={[eyesSpec.r, 20, 16]} scale={[1, 1.1, 0.6]}>
                  <meshStandardMaterial color="#ffffff" roughness={0.2} />
                </Sphere>
                <Sphere args={[eyesSpec.r * 0.46, 12, 12]} position={[0, -eyesSpec.r * 0.08, eyesSpec.r * 0.5]}>
                  <meshStandardMaterial color="#141414" roughness={0.2} />
                </Sphere>
                {/* 눈 하이라이트 반짝임 */}
                <Sphere args={[eyesSpec.r * 0.15, 8, 8]} position={[eyesSpec.r * 0.18, eyesSpec.r * 0.18, eyesSpec.r * 0.72]}>
                  <meshBasicMaterial color="#ffffff" />
                </Sphere>
              </group>
            ))}

            {/* 볼터치 */}
            {[-1, 1].map((s) => (
              <Sphere
                key={s}
                args={[eyesSpec.r * 0.45, 10, 8]}
                position={[s * (eyesSpec.x + eyesSpec.r * 0.9), eyesSpec.y - eyesSpec.r * 1.25, eyesSpec.z - 0.01]}
                scale={[1, 0.6, 0.3]}
              >
                <meshBasicMaterial color="#ff8fb1" transparent opacity={0.7} />
              </Sphere>
            ))}
          </>
        )}
      </group>

      {/* 이름표 */}
      <Html position={[0, CHARACTER_CENTER_Y + 0.45, 0]} center zIndexRange={[10, 0]}>
        <div className={`nameplate${isSelf ? " self" : ""}`}>{name}</div>
      </Html>
    </group>
  );
}
