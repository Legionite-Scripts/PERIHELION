"use client";

import { useEffect, useState } from "react";
import { artifactTest, benchmarkSoundscape, mixAt, soundscape } from "@/audio/soundscape";
import { exposeDevHandles, removeDevHandles } from "@/dev/handles";

/**
 * The one sound control: a small text button, top right, mirroring the
 * wordmark. Off at every load. It says what state sound is in, in words, and
 * exposes it to assistive technology through aria-pressed.
 */
export function SoundToggle() {
  const [on, setOn] = useState(false);

  useEffect(() => {
    const unsubscribe = soundscape.subscribe(setOn);
    return () => {
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (process.env.NODE_ENV !== "production") {
      exposeDevHandles({
        __perihelionAudio: {
          levels: () => soundscape.levels(),
          mixAt,
          benchmark: benchmarkSoundscape,
          artifactTest,
        },
      });
      return () => removeDevHandles("__perihelionAudio");
    }
  }, []);

  return (
    <div className="sound-entrance">
      <button
        type="button"
        className="sound"
        aria-pressed={on}
        onClick={() => soundscape.toggle()}
      >
        <span className="sound__word">Sound</span>
        <span className="sound__state" aria-hidden>
          {on ? "on" : "off"}
        </span>
      </button>
    </div>
  );
}
