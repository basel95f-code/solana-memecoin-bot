/**
 * IDiscoverySource Interface
 * Abstract interface all discovery sources must implement
 */

import type { DiscoveredToken } from './DiscoveryTypes';

export interface IDiscoverySource {
  /**
   * Unique identifier for this source
   */
  readonly id: string;

  /**
   * Human-readable name
   */
  readonly name: string;

  /**
   * Base credibility weight (0-1)
   * Higher weight = more trusted source
   */
  readonly weight: number;

  /**
   * Start the discovery source
   * For polling sources: starts the poll loop
   * For websocket sources: establishes connection
   */
  start(): Promise<void>;

  /**
   * Stop the discovery source
   * Cleanup resources, close connections
   */
  stop(): Promise<void>;

  /**
   * Manually trigger a discovery
   * For polling sources: fetch immediately
   * For websocket sources: may not apply
   */
  discover(): Promise<DiscoveredToken[]>;

  /**
   * Check if source is healthy and operational
   */
  isHealthy(): boolean;

  /**
   * Get last successful discovery timestamp
   */
  getLastSeenTimestamp(): number;
}
