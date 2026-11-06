"use client";

// 角色圖與狀態切換（第六章 6.4、6.5）
// - idle：待機微笑；thinking：思考中（加動畫點點）；talking：說話中
// - 說話時：拿得到音量就「音量大時張嘴」，拿不到（瀏覽器語音）就每 150 毫秒切換一次
// - 平常有輕微的呼吸縮放動畫（使用者設定「減少動態」時自動關閉）
// - public/avatar/ 有 ChatGPT 畫的 *.png 就用 PNG（建置時由 next.config.ts 判斷），否則用內附的 *.svg 暫代圖

import { useEffect, useRef, useState } from "react";
import { AGENT, type AvatarState } from "@/lib/agent";

const STATES = AGENT.avatar.states;

const EXT = process.env.NEXT_PUBLIC_AVATAR_EXT === "png" ? "png" : "svg";

function AvatarImage({ state, visible, alt }: { state: AvatarState; visible: boolean; alt: string }) {
  const ref = useRef<HTMLImageElement>(null);
  const [src, setSrc] = useState(`${AGENT.avatar.basePath}/${state}.${EXT}`);
  const fallback = () => {
    if (!src.endsWith(".svg")) setSrc(`${AGENT.avatar.basePath}/${state}.svg`);
  };
  // 圖片可能在 React 接手（hydration）之前就載入失敗，onError 來不及觸發，所以掛載後再檢查一次
  useEffect(() => {
    const img = ref.current;
    if (img && img.complete && img.naturalWidth === 0) fallback();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      ref={ref}
      src={src}
      alt={visible ? alt : ""}
      aria-hidden={!visible}
      onError={fallback}
      className={`absolute inset-0 h-full w-full object-contain ${
        visible ? "opacity-100" : "opacity-0"
      }`}
      draggable={false}
    />
  );
}

export function Avatar({
  state,
  getLevel,
  className = "",
}: {
  state: AvatarState;
  getLevel?: () => number | null;
  className?: string;
}) {
  const [mouthOpen, setMouthOpen] = useState(false);

  useEffect(() => {
    if (state !== "talking") {
      setMouthOpen(false);
      return;
    }
    let raf = 0;
    let lastToggle = 0;
    let open = false;
    const tick = (t: number) => {
      const level = getLevel?.() ?? null;
      if (level !== null) {
        open = level > 0.04;
      } else if (t - lastToggle > 150) {
        open = !open;
        lastToggle = t;
      }
      setMouthOpen(open);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [state, getLevel]);

  // 說話時在「張嘴（talking）」與「閉嘴（idle）」兩張圖之間切換
  const shown: AvatarState = state === "talking" ? (mouthOpen ? "talking" : "idle") : state;
  const label = { idle: "待機中", thinking: "思考中", talking: "說話中" }[state];

  return (
    <div className={`relative ${className}`}>
      <div className="avatar-breathe relative h-full w-full">
        {STATES.map((s) => (
          <AvatarImage key={s} state={s} visible={s === shown} alt={`AI 代理人「${AGENT.name}」的角色插畫，${label}`} />
        ))}
      </div>
      {state === "thinking" && (
        <div
          className="absolute right-[6%] top-[6%] flex gap-1 rounded-full bg-white/90 px-3 py-2 shadow"
          aria-hidden="true"
        >
          <span className="thinking-dot" />
          <span className="thinking-dot [animation-delay:150ms]" />
          <span className="thinking-dot [animation-delay:300ms]" />
        </div>
      )}
      <span className="sr-only">
        {AGENT.name}{label}
      </span>
    </div>
  );
}
