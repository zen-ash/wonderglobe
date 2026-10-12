// Development-only console handle (window.__wgRuntime) for trying the
// atmosphere in different places. Does nothing in production builds.

import { useEffect } from "react";
import type { WorldRuntime } from "@/world/runtime";

export function DevRuntimeHandle({ runtime }: { runtime: WorldRuntime }): null {
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    (window as unknown as { __wgRuntime: WorldRuntime }).__wgRuntime = runtime;
  }, [runtime]);
  return null;
}
