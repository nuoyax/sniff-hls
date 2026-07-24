// Minimal leveled logger. Verbose output gated behind a debug setting.
const PREFIX = '[m3u8_extra]';
let debug = false;

export function setDebug(v: boolean): void {
  debug = v;
}

type LogFn = (...args: unknown[]) => void;
const noop: LogFn = () => {};

export const log = {
  debug: (...args: unknown[]): void => (debug ? console.debug(PREFIX, ...args) : noop()),
  info: (...args: unknown[]): void => console.info(PREFIX, ...args),
  warn: (...args: unknown[]): void => console.warn(PREFIX, ...args),
  error: (...args: unknown[]): void => console.error(PREFIX, ...args),
};

export default log;
