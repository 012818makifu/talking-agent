// 瀏覽器端的語音播放器（第五章 5.3、5.5、第六章 6.5）
// - 一句一句排隊播放：Claude 一邊串流回答，這裡一邊把完整句子送去 /api/tts，降低等待時間
// - 下一句的音訊會提前抓（prefetch），句子之間不會卡頓
// - /api/tts 回 501（沒設定 ElevenLabs）或失敗時，自動改用瀏覽器內建語音
// - 提供 getLevel() 讀取即時音量，讓角色依音量張嘴

import { normalizeForSpeech } from "@/lib/speech-normalize";

export type PlayerState = "idle" | "speaking" | "paused";

interface Item {
  text: string;
  audio: Promise<Blob | null> | null;
}

// 0.1 秒的靜音 WAV，用來在使用者點擊時「解鎖」iOS Safari 的自動播放限制
const SILENT_WAV =
  "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQQAAACAgICA";

export class SpeechPlayer {
  private queue: Item[] = [];
  private audio: HTMLAudioElement | null = null;
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private buf: Uint8Array<ArrayBuffer> | null = null;
  private rate = 1;
  private generation = 0;
  private running = false;
  private state: PlayerState = "idle";
  private finishCurrent: (() => void) | null = null;
  private browserVoiceActive = false;

  constructor(
    private onState: (s: PlayerState) => void,
    private useServerTts: boolean,
    private lang = "zh-TW",
  ) {}

  setUseServerTts(v: boolean) {
    this.useServerTts = v;
  }

  /** 必須在使用者「點擊／按下」的事件中呼叫一次（瀏覽器的自動播放政策）。 */
  unlock() {
    if (typeof window === "undefined") return;
    if (!this.audio) {
      this.audio = new Audio();
      this.audio.preload = "auto";
      try {
        const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (Ctx) {
          this.ctx = new Ctx();
          const src = this.ctx.createMediaElementSource(this.audio);
          this.analyser = this.ctx.createAnalyser();
          this.analyser.fftSize = 512;
          src.connect(this.analyser);
          this.analyser.connect(this.ctx.destination);
          this.buf = new Uint8Array(new ArrayBuffer(this.analyser.fftSize));
        }
      } catch {
        this.ctx = null;
        this.analyser = null;
      }
      this.audio.src = SILENT_WAV;
      this.audio.play().catch(() => {});
    }
    this.ctx?.resume().catch(() => {});
    if ("speechSynthesis" in window && !window.speechSynthesis.speaking) {
      // 部分行動瀏覽器需要在手勢中先講一次（空字串）才允許之後發聲
      window.speechSynthesis.speak(new SpeechSynthesisUtterance(""));
    }
  }

  /** 加入一句話到播放佇列。 */
  enqueue(text: string) {
    const clean = text.trim();
    if (!clean) return;
    this.queue.push({ text: clean, audio: this.useServerTts ? this.fetchTts(clean) : null });
    if (!this.running) void this.loop();
  }

  stop() {
    this.generation++;
    this.queue = [];
    this.audio?.pause();
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    this.finishCurrent?.();
    this.finishCurrent = null;
    this.running = false;
    this.setState("idle");
  }

  pause() {
    if (this.state !== "speaking") return;
    if (this.browserVoiceActive) window.speechSynthesis.pause();
    else this.audio?.pause();
    this.setState("paused");
  }

  resume() {
    if (this.state !== "paused") return;
    if (this.browserVoiceActive) window.speechSynthesis.resume();
    else this.audio?.play().catch(() => {});
    this.setState("speaking");
  }

  setRate(rate: number) {
    this.rate = rate;
    if (this.audio) this.audio.playbackRate = rate;
  }

  getState(): PlayerState {
    return this.state;
  }

  /** 0～1 的即時音量；瀏覽器內建語音無法取得音量時回傳 null（角色改用固定節奏張嘴）。 */
  getLevel(): number | null {
    if (this.state !== "speaking" || this.browserVoiceActive || !this.analyser || !this.buf) return null;
    this.analyser.getByteTimeDomainData(this.buf);
    let sum = 0;
    for (const v of this.buf) sum += ((v - 128) / 128) ** 2;
    return Math.sqrt(sum / this.buf.length);
  }

  private setState(s: PlayerState) {
    if (this.state === s) return;
    this.state = s;
    this.onState(s);
  }

  private async fetchTts(text: string): Promise<Blob | null> {
    try {
      const r = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (r.status === 501) this.useServerTts = false; // 沒設定 ElevenLabs，之後都用瀏覽器語音
      if (!r.ok) return null;
      return await r.blob();
    } catch {
      return null;
    }
  }

  private async loop() {
    const gen = this.generation;
    this.running = true;
    this.setState("speaking");
    while (this.queue.length && gen === this.generation) {
      const item = this.queue.shift()!;
      const blob = item.audio ? await item.audio : null;
      if (gen !== this.generation) return;
      if (blob && blob.size > 0 && this.audio) await this.playBlob(blob);
      else await this.speakWithBrowser(item.text);
    }
    if (gen === this.generation) {
      this.running = false;
      this.setState("idle");
    }
  }

  private playBlob(blob: Blob): Promise<void> {
    const audio = this.audio!;
    const url = URL.createObjectURL(blob);
    this.browserVoiceActive = false;
    return new Promise<void>((resolve) => {
      const done = () => {
        audio.onended = null;
        audio.onerror = null;
        URL.revokeObjectURL(url);
        this.finishCurrent = null;
        resolve();
      };
      this.finishCurrent = done;
      audio.onended = done;
      audio.onerror = done;
      audio.src = url;
      audio.playbackRate = this.rate;
      audio.play().catch(done);
    });
  }

  private speakWithBrowser(text: string): Promise<void> {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return Promise.resolve();
    const synth = window.speechSynthesis;
    const u = new SpeechSynthesisUtterance(normalizeForSpeech(text));
    u.lang = this.lang;
    u.rate = this.rate;
    const voice =
      synth.getVoices().find((v) => v.lang === this.lang) ??
      synth.getVoices().find((v) => v.lang.startsWith("zh"));
    if (voice) u.voice = voice;
    this.browserVoiceActive = true;
    return new Promise<void>((resolve) => {
      // 有些瀏覽器沒有中文語音時不會觸發 onend，角色會一直「說話中」；依字數估計時間，逾時就當作念完
      const timer = setTimeout(() => done(), 4000 + (text.length * 350) / this.rate);
      const done = () => {
        clearTimeout(timer);
        this.browserVoiceActive = false;
        this.finishCurrent = null;
        resolve();
      };
      this.finishCurrent = done;
      u.onend = done;
      u.onerror = done;
      synth.speak(u);
    });
  }
}

/**
 * 從串流文字中取出「已經完整」的句子（遇到。！？；或換行）。
 * 太短的句子先留著和下一句合併，太長又沒有句號時在逗號處切開。
 */
export function takeSentences(buffer: string, minLen = 8, maxLen = 90): { sentences: string[]; rest: string } {
  const sentences: string[] = [];
  let rest = buffer;
  let acc = "";
  for (;;) {
    const m = rest.match(/^[\s\S]*?[。！？!?；;\n]+/);
    if (!m) break;
    acc += m[0];
    rest = rest.slice(m[0].length);
    if (acc.trim().length >= minLen) {
      sentences.push(acc.trim());
      acc = "";
    }
  }
  rest = acc + rest;
  if (rest.length > maxLen) {
    const cut = rest.lastIndexOf("，", maxLen);
    if (cut > minLen) {
      sentences.push(rest.slice(0, cut + 1).trim());
      rest = rest.slice(cut + 1);
    }
  }
  return { sentences, rest };
}
