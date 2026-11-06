"use client";

// 語音控制列（第七章 7.1）：播放／暫停、停止、靜音、語速 0.8x／1x／1.2x、只看文字模式

import type { PlayerState } from "@/lib/client/speech-player";

const RATES = [0.8, 1, 1.2] as const;

const btn =
  "rounded-full px-2.5 py-1.5 text-sm sm:px-3 transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold disabled:opacity-40";

export function VoiceControls({
  playerState,
  muted,
  textOnly,
  rate,
  voiceLabel,
  onPauseResume,
  onStop,
  onToggleMute,
  onToggleTextOnly,
  onRate,
}: {
  playerState: PlayerState;
  muted: boolean;
  textOnly: boolean;
  rate: number;
  voiceLabel: string;
  onPauseResume: () => void;
  onStop: () => void;
  onToggleMute: () => void;
  onToggleTextOnly: () => void;
  onRate: (r: number) => void;
}) {
  const voiceOff = muted || textOnly;
  return (
    <div className="flex flex-wrap items-center gap-1.5 sm:gap-2" role="group" aria-label="語音控制">
      <button
        type="button"
        className={`${btn} bg-navy-50 text-navy hover:bg-navy-100`}
        onClick={onPauseResume}
        disabled={playerState === "idle"}
        aria-label={playerState === "paused" ? "繼續播放" : "暫停播放"}
      >
        {playerState === "paused" ? "▶" : "❚❚"}
        <span className="ml-1 hidden sm:inline">{playerState === "paused" ? "繼續" : "暫停"}</span>
      </button>
      <button
        type="button"
        className={`${btn} bg-navy-50 text-navy hover:bg-navy-100`}
        onClick={onStop}
        disabled={playerState === "idle"}
        aria-label="停止播放"
      >
        ■<span className="ml-1 hidden sm:inline">停止</span>
      </button>
      <button
        type="button"
        className={`${btn} ${muted ? "bg-navy text-white" : "bg-navy-50 text-navy hover:bg-navy-100"}`}
        onClick={onToggleMute}
        aria-pressed={muted}
        aria-label={muted ? "取消靜音" : "靜音"}
        disabled={textOnly}
      >
        {muted ? "🔇" : "🔊"}
        <span className="ml-1 hidden sm:inline">{muted ? "已靜音" : "聲音開"}</span>
      </button>
      <div className="flex rounded-full bg-navy-50 p-0.5" role="radiogroup" aria-label="語速">
        {RATES.map((r) => (
          <button
            key={r}
            type="button"
            role="radio"
            aria-checked={rate === r}
            disabled={voiceOff}
            onClick={() => onRate(r)}
            className={`${btn} px-2.5 py-1 ${rate === r ? "bg-navy text-white" : "text-navy hover:bg-navy-100"}`}
          >
            {r}x
          </button>
        ))}
      </div>
      <button
        type="button"
        className={`${btn} ${textOnly ? "bg-navy text-white" : "bg-navy-50 text-navy hover:bg-navy-100"}`}
        onClick={onToggleTextOnly}
        aria-pressed={textOnly}
        aria-label="只看文字模式"
      >
        📝<span className="ml-1 hidden sm:inline">只看文字</span>
      </button>
      <span className="hidden text-xs text-slate-500 lg:inline">{voiceLabel}</span>
    </div>
  );
}
