import { logger } from '../utils/logger';

/**
 * Function execution profiler
 * Measures execution time and provides detailed profiling information
 */

interface ProfileEntry {
  name: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  children: ProfileEntry[];
  parent?: ProfileEntry;
}

class Profiler {
  private currentEntry: ProfileEntry | null = null;
  private profiles: Map<string, number[]> = new Map();
  private enabled: boolean = true;

  /**
   * Start profiling a function
   */
  start(name: string): void {
    if (!this.enabled) return;

    const entry: ProfileEntry = {
      name,
      startTime: Date.now(),
      children: [],
      parent: this.currentEntry || undefined,
    };

    if (this.currentEntry) {
      this.currentEntry.children.push(entry);
    }

    this.currentEntry = entry;
  }

  /**
   * End profiling for the current function
   */
  end(name: string): number {
    if (!this.enabled || !this.currentEntry) return 0;

    if (this.currentEntry.name !== name) {
      logger.warn('profiler', `Mismatched profile end: expected ${this.currentEntry.name}, got ${name}`);
    }

    this.currentEntry.endTime = Date.now();
    this.currentEntry.duration = this.currentEntry.endTime - this.currentEntry.startTime;

    // Store in history
    const times = this.profiles.get(name) || [];
    times.push(this.currentEntry.duration);
    
    // Keep last 100 measurements
    if (times.length > 100) {
      times.shift();
    }
    
    this.profiles.set(name, times);

    // Log slow operations
    if (this.currentEntry.duration > 3000) {
      logger.warn('profiler', `Slow operation: ${name} took ${this.currentEntry.duration}ms`);
    }

    const duration = this.currentEntry.duration;
    this.currentEntry = this.currentEntry.parent || null;

    return duration;
  }

  /**
   * Profile a function execution
   */
  async profile<T>(name: string, fn: () => Promise<T>): Promise<T> {
    this.start(name);
    try {
      const result = await fn();
      return result;
    } finally {
      this.end(name);
    }
  }

  /**
   * Profile a sync function execution
   */
  profileSync<T>(name: string, fn: () => T): T {
    this.start(name);
    try {
      return fn();
    } finally {
      this.end(name);
    }
  }

  /**
   * Get profiling statistics for a function
   */
  getStats(name: string): {
    count: number;
    avg: number;
    min: number;
    max: number;
    total: number;
  } | null {
    const times = this.profiles.get(name);
    if (!times || times.length === 0) {
      return null;
    }

    const sorted = [...times].sort((a, b) => a - b);
    const total = times.reduce((sum, t) => sum + t, 0);
    const avg = total / times.length;

    return {
      count: times.length,
      avg: Math.round(avg),
      min: sorted[0],
      max: sorted[sorted.length - 1],
      total: Math.round(total),
    };
  }

  /**
   * Get all profiling data
   */
  getAllStats(): Map<string, ReturnType<typeof this.getStats>> {
    const result = new Map();
    
    for (const name of this.profiles.keys()) {
      const stats = this.getStats(name);
      if (stats) {
        result.set(name, stats);
      }
    }

    return result;
  }

  /**
   * Print profiling report
   */
  printReport(): void {
    const stats = this.getAllStats();
    
    if (stats.size === 0) {
      logger.info('profiler', 'No profiling data available');
      return;
    }

    logger.info('profiler', '=== Profiling Report ===');
    
    // Sort by total time
    const sorted = Array.from(stats.entries()).sort((a, b) => b[1]!.total - a[1]!.total);

    for (const [name, data] of sorted) {
      logger.info(
        'profiler',
        `${name}: ${data!.count} calls, avg=${data!.avg}ms, min=${data!.min}ms, max=${data!.max}ms, total=${data!.total}ms`
      );
    }
  }

  /**
   * Clear profiling data
   */
  clear(): void {
    this.profiles.clear();
    this.currentEntry = null;
  }

  /**
   * Enable/disable profiling
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * Check if profiling is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }
}

// Singleton instance
export const profiler = new Profiler();

/**
 * Decorator for profiling async functions
 * Usage: @profile('functionName')
 */
export function profile(name: string) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      return await profiler.profile(name, async () => {
        return await originalMethod.apply(this, args);
      });
    };

    return descriptor;
  };
}

/**
 * Measure a block of code
 * Usage: 
 * const measure = measureBlock('myBlock');
 * // ... code ...
 * const duration = measure.end();
 */
export function measureBlock(name: string): {
  end: () => number;
} {
  const startTime = Date.now();
  profiler.start(name);

  return {
    end: () => {
      return profiler.end(name);
    },
  };
}

/**
 * Simple timer for quick measurements
 */
export class Timer {
  private startTime: number;
  private name: string;

  constructor(name: string) {
    this.name = name;
    this.startTime = Date.now();
  }

  elapsed(): number {
    return Date.now() - this.startTime;
  }

  log(message?: string): void {
    const elapsed = this.elapsed();
    logger.info('timer', `${this.name}${message ? ': ' + message : ''} - ${elapsed}ms`);
  }

  end(): number {
    const elapsed = this.elapsed();
    logger.debug('timer', `${this.name} completed in ${elapsed}ms`);
    return elapsed;
  }
}
