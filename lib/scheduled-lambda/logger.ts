type LogLevel = "info" | "error";

export type Logger = ReturnType<typeof makeLogger>;

export function makeLogger() {
  const logs: { level: LogLevel; line: unknown[] }[] = [];

  const add = (level: LogLevel, ...line: unknown[]) => {
    if (level === "info") {
      console.log(`[info]`, ...line);
    } else {
      console.error(`[error]`, ...line);
    }

    logs.push({ level, line });
  };

  return {
    logs,
    info: (...line: unknown[]) => add("info", ...line),
    error: (...line: unknown[]) => add("error", ...line),
  };
}
