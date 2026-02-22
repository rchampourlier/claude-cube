export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

let currentLevel: LogLevel = "info";

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[currentLevel];
}

function formatEntry(level: LogLevel, component: string, message: string, data?: Record<string, unknown>, context?: string): string {
  const ts = new Date().toISOString();
  const ctx = context ? `[${context}] ` : "";
  const base = `[${ts}] [${level.toUpperCase()}] ${ctx}[${component}] ${message}`;
  if (data && Object.keys(data).length > 0) {
    return `${base} ${JSON.stringify(data)}`;
  }
  return base;
}

export function createLogger(component: string) {
  return {
    debug(message: string, data?: Record<string, unknown>, context?: string) {
      if (shouldLog("debug")) console.debug(formatEntry("debug", component, message, data, context));
    },
    info(message: string, data?: Record<string, unknown>, context?: string) {
      if (shouldLog("info")) console.info(formatEntry("info", component, message, data, context));
    },
    warn(message: string, data?: Record<string, unknown>, context?: string) {
      if (shouldLog("warn")) console.warn(formatEntry("warn", component, message, data, context));
    },
    error(message: string, data?: Record<string, unknown>, context?: string) {
      if (shouldLog("error")) console.error(formatEntry("error", component, message, data, context));
    },
  };
}
