// Lightweight error types so the CLI can produce friendly messages instead of
// raw stack traces. Each error carries a user-facing `hint` plus the original
// cause for debug mode.

export class CommandoError extends Error {
  constructor(
    message: string,
    public readonly hint?: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'CommandoError';
  }
}

export class BootstrapError extends CommandoError {
  constructor(message: string, hint?: string, cause?: unknown) {
    super(message, hint, cause);
    this.name = 'BootstrapError';
  }
}

export class SafetyError extends CommandoError {
  constructor(message: string, hint?: string) {
    super(message, hint);
    this.name = 'SafetyError';
  }
}

export class PlannerError extends CommandoError {
  constructor(message: string, hint?: string, cause?: unknown) {
    super(message, hint, cause);
    this.name = 'PlannerError';
  }
}
