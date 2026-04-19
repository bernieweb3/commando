// Tiny logger used across the CLI. Intentionally dependency-free so that the
// bootstrap / postinstall step (which may run before npm finishes wiring deps)
// can still call it safely.

type Level = 'info' | 'warn' | 'error' | 'success' | 'debug';

const PREFIX = '[commando]';

function stamp(level: Level): string {
  switch (level) {
    case 'info':
      return `${PREFIX}`;
    case 'warn':
      return `${PREFIX} WARN`;
    case 'error':
      return `${PREFIX} ERROR`;
    case 'success':
      return `${PREFIX} OK`;
    case 'debug':
      return `${PREFIX} DEBUG`;
  }
}

export const log = {
  info: (...args: unknown[]) => console.log(stamp('info'), ...args),
  warn: (...args: unknown[]) => console.warn(stamp('warn'), ...args),
  error: (...args: unknown[]) => console.error(stamp('error'), ...args),
  success: (...args: unknown[]) => console.log(stamp('success'), ...args),
  debug: (...args: unknown[]) => {
    if (process.env.CMDO_DEBUG) console.log(stamp('debug'), ...args);
  },
};
