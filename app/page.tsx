"use client";

import dynamic from "next/dynamic";
import { ScrollProvider } from "@/lib/scroll/ScrollProvider";
import { Grade } from "@/ui/Grade";
import { Opening } from "@/ui/Opening";
import { Narrative } from "@/ui/Narrative";
import { JourneyIndicator } from "@/ui/JourneyIndicator";
import { Wayfinding } from "@/ui/Wayfinding";
import { SceneBoundary } from "@/ui/SceneBoundary";
import { ScrubPanel } from "@/dev/ScrubPanel";

/**
 * One canvas, and a few lines of type over it.
 *
 * The film carries the experience; the words behave like captions on a museum
 * plate — few, exact, placed where the image leaves room.
 */
const Stage = dynamic(() => import("@/scene/Stage").then((m) => m.Stage), {
  ssr: false,
});

export default function Page() {
  return (
    <ScrollProvider>
      <SceneBoundary>
        <Stage />
      </SceneBoundary>
      <Grade />
      <Opening />
      <Narrative />
      <Wayfinding />
      <JourneyIndicator />
      {/* Same test as DEV in @/dev/handles, written literally so the
          production build deletes the panel outright (see handles.ts). */}
      {process.env.NODE_ENV !== "production" && <ScrubPanel />}
    </ScrollProvider>
  );
}
