/**
 * 轻量分级日志。级别由 LOG_LEVEL 控制（debug|info|warn|error），非法值回退到 info。
 * Lightweight leveled logger controlled by LOG_LEVEL.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

function resolveLevel(): LogLevel {
  const v = process.env.LOG_LEVEL;
  if (v && v in LEVELS) return v as LogLevel;
  return 'info';
}

const threshold = LEVELS[resolveLevel()];

function emit(level: LogLevel, message: string, ...rest: unknown[]): void {
  if (LEVELS[level] < threshold) return;
  const line = `[${new Date().toISOString()}] ${level.toUpperCase()} ${message}`;
  if (level === 'error') console.error(line, ...rest);
  else if (level === 'warn') console.warn(line, ...rest);
  else console.log(line, ...rest);
}

export const logger = {
  debug: (message: string, ...rest: unknown[]) => emit('debug', message, ...rest),
  info: (message: string, ...rest: unknown[]) => emit('info', message, ...rest),
  warn: (message: string, ...rest: unknown[]) => emit('warn', message, ...rest),
  error: (message: string, ...rest: unknown[]) => emit('error', message, ...rest),
};
