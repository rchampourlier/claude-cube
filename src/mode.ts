import { createLogger } from "./util/logger.js";

const log = createLogger("mode");

export type OperatingMode = "remote" | "local";

export class ModeManager {
  private mode: OperatingMode;

  constructor(defaultMode: OperatingMode = "remote") {
    this.mode = defaultMode;
    log.info("Mode initialized", { mode: this.mode });
  }

  getMode(): OperatingMode {
    return this.mode;
  }

  setMode(mode: OperatingMode): void {
    const prev = this.mode;
    this.mode = mode;
    if (prev !== mode) {
      log.info("Mode changed", { from: prev, to: mode });
    }
  }

  isLocal(): boolean {
    return this.mode === "local";
  }
}
