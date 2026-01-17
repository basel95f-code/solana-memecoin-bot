/**
 * Structured logging utility
 * Replaces console.log/error with contextual, leveled logging
 */

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  SILENT = 4,
}

const LOG_LEVEL_NAMES: Record<LogLevel, string> = {
  [LogLevel.DEBUG]: 'DEBUG',
  [LogLevel.INFO]: 'INFO',
  [LogLevel.WARN]: 'WARN',
  [LogLevel.ERROR]: 'ERROR',
  [LogLevel.SILENT]: 'SILENT',
};

const LOG_LEVEL_COLORS: Record<LogLevel, string> = {
  [LogLevel.DEBUG]: '\x1b[36m', // Cyan
  [LogLevel.INFO]: '\x1b[32m', // Green
  [LogLevel.WARN]: '\x1b[33m', // Yellow
  [LogLevel.ERROR]: '\x1b[31m', // Red
  [LogLevel.SILENT]: '',
};

const RESET_COLOR = '\x1b[0m';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  context: string;
  message: string;
  error?: Error;
  data?: Record<string, unknown>;
}

class Logger {
  private level: LogLevel;
  private useColors: boolean;
  private logHistory: LogEntry[] = [];
  private maxHistorySize: number = 1000;

  constructor() {
    // Default to INFO, can be overridden via environment
    const envLevel = process.env.LOG_LEVEL?.toUpperCase();
    this.level = this.parseLogLevel(envLevel) ?? LogLevel.INFO;
    this.useColors = process.env.NO_COLOR !== '1' && process.stdout.isTTY !== false;
  }

  private parseLogLevel(level?: string): LogLevel | undefined {
    if (!level) return undefined;
    const levelMap: Record<string, LogLevel> = {
      DEBUG: LogLevel.DEBUG,
      INFO: LogLevel.INFO,
      WARN: LogLevel.WARN,
      ERROR: LogLevel.ERROR,
      SILENT: LogLevel.SILENT,
    };
    return levelMap[level];
  }

  private formatTimestamp(): string {
    const now = new Date();
    return now.toISOString().replace('T', ' ').slice(0, 19);
  }

  private formatMessage(level: LogLevel, context: string, message: string): string {
    const timestamp = this.formatTimestamp();
    const levelName = LOG_LEVEL_NAMES[level];

    if (this.useColors) {
      const color = LOG_LEVEL_COLORS[level];
      return `${timestamp} ${color}[${levelName}]${RESET_COLOR} [${context}] ${message}`;
    }

    return `${timestamp} [${levelName}] [${context}] ${message}`;
  }

  private log(
    level: LogLevel,
    context: string,
    message: string,
    error?: Error,
    data?: Record<string, unknown>
  ): void {
    if (level < this.level) return;

    const entry: LogEntry = {
      timestamp: this.formatTimestamp(),
      level,
      context,
      message,
      error,
      data,
    };

    // Store in history
    this.logHistory.push(entry);
    if (this.logHistory.length > this.maxHistorySize) {
      this.logHistory.shift();
    }

    // Output to console
    const formattedMessage = this.formatMessage(level, context, message);

    switch (level) {
      case LogLevel.DEBUG:
      case LogLevel.INFO:
        console.log(formattedMessage);
        break;
      case LogLevel.WARN:
        console.warn(formattedMessage);
        break;
      case LogLevel.ERROR:
        console.error(formattedMessage);
        if (error) {
          console.error(`  Stack: ${error.stack || error.message}`);
        }
        break;
    }

    // Log additional data at debug level
    if (data && level >= this.level && level === LogLevel.DEBUG) {
      console.log('  Data:', JSON.stringify(data, null, 2));
    }
  }

  /**
   * Debug level - verbose information for development
   */
  debug(context: string, message: string, data?: Record<string, unknown>): void {
    this.log(LogLevel.DEBUG, context, message, undefined, data);
  }

  /**
   * Info level - general operational information
   */
  info(context: string, message: string, data?: Record<string, unknown>): void {
    this.log(LogLevel.INFO, context, message, undefined, data);
  }

  /**
   * Warn level - potentially problematic situations
   */
  warn(context: string, message: string, error?: Error): void {
    this.log(LogLevel.WARN, context, message, error);
  }

  /**
   * Error level - errors that need attention
   */
  error(context: string, message: string, error?: Error): void {
    this.log(LogLevel.ERROR, context, message, error);
  }

  /**
   * Silent error - logs at DEBUG level only
   * Use for expected failures like API 404s, fallback triggers
   */
  silentError(context: string, message: string, error?: Error): void {
    this.log(LogLevel.DEBUG, context, `[Expected] ${message}`, error);
  }

  /**
   * Set the minimum log level
   */
  setLevel(level: LogLevel): void {
    this.level = level;
  }

  /**
   * Get current log level
   */
  getLevel(): LogLevel {
    return this.level;
  }

  /**
   * Get recent log history
   */
  getHistory(count?: number): LogEntry[] {
    if (count) {
      return this.logHistory.slice(-count);
    }
    return [...this.logHistory];
  }

  /**
   * Get errors from history
   */
  getErrors(count?: number): LogEntry[] {
    const errors = this.logHistory.filter((e) => e.level === LogLevel.ERROR);
    if (count) {
      return errors.slice(-count);
    }
    return errors;
  }

  /**
   * Clear log history
   */
  clearHistory(): void {
    this.logHistory = [];
  }

  /**
   * Create a child logger with a fixed context prefix
   */
  child(contextPrefix: string): ContextualLogger {
    return new ContextualLogger(this, contextPrefix);
  }
}

/**
 * Child logger with a fixed context prefix
 */
class ContextualLogger {
  constructor(
    private parent: Logger,
    private contextPrefix: string
  ) {}

  debug(subContext: string, message: string, data?: Record<string, unknown>): void {
    this.parent.debug(`${this.contextPrefix}:${subContext}`, message, data);
  }

  info(subContext: string, message: string, data?: Record<string, unknown>): void {
    this.parent.info(`${this.contextPrefix}:${subContext}`, message, data);
  }

  warn(subContext: string, message: string, error?: Error): void {
    this.parent.warn(`${this.contextPrefix}:${subContext}`, message, error);
  }

  error(subContext: string, message: string, error?: Error): void {
    this.parent.error(`${this.contextPrefix}:${subContext}`, message, error);
  }

  silentError(subContext: string, message: string, error?: Error): void {
    this.parent.silentError(`${this.contextPrefix}:${subContext}`, message, error);
  }
}

// Export singleton instance
export const logger = new Logger();

// Export for testing or multiple instances
export { Logger, ContextualLogger };
