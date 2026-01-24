/**
 * Model Versioning
 * Manage ML model versions with A/B testing support
 */

import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger';
import { ML_TRAINING } from '../constants';

// ============================================
// Types
// ============================================

export interface ModelVersion {
  version: string;
  featureVersion: string;
  createdAt: number;
  activatedAt?: number;
  deactivatedAt?: number;
  metrics: {
    accuracy: number;
    precision: number;
    recall: number;
    f1Score: number;
    auc?: number;
  };
  samplesUsed: number;
  isActive: boolean;
  isChallenger: boolean;
  modelPath: string;
}

export interface ABTestConfig {
  enabled: boolean;
  challengerVersion?: string;
  trafficSplit: number; // Percentage of traffic to challenger (0-1)
  startedAt?: number;
  predictions: {
    champion: number;
    challenger: number;
  };
  outcomes: {
    champion: { correct: number; total: number };
    challenger: { correct: number; total: number };
  };
}

// ============================================
// Model Version Manager
// ============================================

export class ModelVersionManager extends EventEmitter {
  private modelDir: string;
  private versions: Map<string, ModelVersion> = new Map();
  private activeVersion: string | null = null;
  private abTest: ABTestConfig = {
    enabled: false,
    trafficSplit: ML_TRAINING.AB_TEST_TRAFFIC_SPLIT,
    predictions: { champion: 0, challenger: 0 },
    outcomes: {
      champion: { correct: 0, total: 0 },
      challenger: { correct: 0, total: 0 },
    },
  };

  constructor(modelDir?: string) {
    super();
    this.modelDir = modelDir || path.join(process.cwd(), 'data', ML_TRAINING.MODEL_DIR);
  }

  /**
   * Initialize the version manager
   */
  async initialize(): Promise<void> {
    // Ensure model directory exists
    if (!fs.existsSync(this.modelDir)) {
      fs.mkdirSync(this.modelDir, { recursive: true });
    }

    // Load version manifest if exists
    const manifestPath = path.join(this.modelDir, 'manifest.json');
    if (fs.existsSync(manifestPath)) {
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
        for (const version of manifest.versions || []) {
          this.versions.set(version.version, version);
        }
        this.activeVersion = manifest.activeVersion || null;
        this.abTest = manifest.abTest || this.abTest;
        logger.info('ModelVersioning', `Loaded ${this.versions.size} model versions`);
      } catch (error) {
        logger.error('ModelVersioning', 'Failed to load manifest', error as Error);
      }
    }
  }

  /**
   * Generate a new version string
   */
  generateVersionString(): string {
    const timestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    return `v2_${timestamp}`;
  }

  /**
   * Register a new model version
   */
  registerVersion(
    version: string,
    metrics: ModelVersion['metrics'],
    samplesUsed: number,
    featureVersion: string = 'v2'
  ): ModelVersion {
    const modelPath = path.join(this.modelDir, `model_${version}`);

    const modelVersion: ModelVersion = {
      version,
      featureVersion,
      createdAt: Date.now(),
      metrics,
      samplesUsed,
      isActive: false,
      isChallenger: false,
      modelPath,
    };

    this.versions.set(version, modelVersion);
    this.saveManifest();

    logger.info('ModelVersioning', `Registered new model version: ${version}`);
    this.emit('versionRegistered', modelVersion);

    return modelVersion;
  }

  /**
   * Activate a model version
   */
  activateVersion(version: string): boolean {
    const modelVersion = this.versions.get(version);
    if (!modelVersion) {
      logger.warn('ModelVersioning', `Version ${version} not found`);
      return false;
    }

    // Deactivate current active version
    if (this.activeVersion) {
      const current = this.versions.get(this.activeVersion);
      if (current) {
        current.isActive = false;
        current.deactivatedAt = Date.now();
      }
    }

    // Activate new version
    modelVersion.isActive = true;
    modelVersion.activatedAt = Date.now();
    this.activeVersion = version;

    this.saveManifest();

    logger.info('ModelVersioning', `Activated model version: ${version}`);
    this.emit('versionActivated', modelVersion);

    return true;
  }

  /**
   * Get active model version
   */
  getActiveVersion(): ModelVersion | null {
    if (!this.activeVersion) return null;
    return this.versions.get(this.activeVersion) || null;
  }

  /**
   * Get all versions
   */
  getAllVersions(): ModelVersion[] {
    return Array.from(this.versions.values())
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * Get a specific version
   */
  getVersion(version: string): ModelVersion | null {
    return this.versions.get(version) || null;
  }

  /**
   * Check if a new model should be promoted based on metrics
   */
  shouldPromote(newMetrics: ModelVersion['metrics']): boolean {
    const active = this.getActiveVersion();

    // Always promote if no active version
    if (!active) return true;

    // Check minimum thresholds
    if (newMetrics.accuracy < ML_TRAINING.MIN_ACCURACY_FOR_PROMOTION) return false;
    if (newMetrics.f1Score < ML_TRAINING.MIN_F1_FOR_PROMOTION) return false;

    // Compare with active version
    return (
      newMetrics.accuracy > active.metrics.accuracy ||
      newMetrics.f1Score > active.metrics.f1Score
    );
  }

  // ============================================
  // A/B Testing
  // ============================================

  /**
   * Start A/B test with challenger model
   */
  startABTest(challengerVersion: string, trafficSplit?: number): boolean {
    const challenger = this.versions.get(challengerVersion);
    if (!challenger) {
      logger.warn('ModelVersioning', `Challenger version ${challengerVersion} not found`);
      return false;
    }

    if (!this.activeVersion) {
      logger.warn('ModelVersioning', 'No active version to test against');
      return false;
    }

    challenger.isChallenger = true;
    this.abTest = {
      enabled: true,
      challengerVersion,
      trafficSplit: trafficSplit ?? ML_TRAINING.AB_TEST_TRAFFIC_SPLIT,
      startedAt: Date.now(),
      predictions: { champion: 0, challenger: 0 },
      outcomes: {
        champion: { correct: 0, total: 0 },
        challenger: { correct: 0, total: 0 },
      },
    };

    this.saveManifest();

    logger.info('ModelVersioning', `Started A/B test: ${this.activeVersion} vs ${challengerVersion}`);
    this.emit('abTestStarted', this.abTest);

    return true;
  }

  /**
   * Stop A/B test
   */
  stopABTest(promoteChallenger: boolean = false): void {
    if (!this.abTest.enabled) return;

    if (promoteChallenger && this.abTest.challengerVersion) {
      this.activateVersion(this.abTest.challengerVersion);
    }

    // Reset challenger flag
    if (this.abTest.challengerVersion) {
      const challenger = this.versions.get(this.abTest.challengerVersion);
      if (challenger) {
        challenger.isChallenger = false;
      }
    }

    this.abTest = {
      enabled: false,
      trafficSplit: ML_TRAINING.AB_TEST_TRAFFIC_SPLIT,
      predictions: { champion: 0, challenger: 0 },
      outcomes: {
        champion: { correct: 0, total: 0 },
        challenger: { correct: 0, total: 0 },
      },
    };

    this.saveManifest();

    logger.info('ModelVersioning', 'A/B test stopped');
    this.emit('abTestStopped');
  }

  /**
   * Select which model to use for a prediction (for A/B testing)
   */
  selectModelForPrediction(): 'champion' | 'challenger' {
    if (!this.abTest.enabled || !this.abTest.challengerVersion) {
      return 'champion';
    }

    // Random selection based on traffic split
    const useChallenger = Math.random() < this.abTest.trafficSplit;

    if (useChallenger) {
      this.abTest.predictions.challenger++;
      return 'challenger';
    } else {
      this.abTest.predictions.champion++;
      return 'champion';
    }
  }

  /**
   * Record outcome for A/B test
   */
  recordOutcome(model: 'champion' | 'challenger', wasCorrect: boolean): void {
    if (!this.abTest.enabled) return;

    this.abTest.outcomes[model].total++;
    if (wasCorrect) {
      this.abTest.outcomes[model].correct++;
    }
  }

  /**
   * Get A/B test statistics
   */
  getABTestStats(): {
    champion: { predictions: number; accuracy: number };
    challenger: { predictions: number; accuracy: number };
    duration: number;
  } | null {
    if (!this.abTest.enabled) return null;

    const championAcc = this.abTest.outcomes.champion.total > 0
      ? this.abTest.outcomes.champion.correct / this.abTest.outcomes.champion.total
      : 0;

    const challengerAcc = this.abTest.outcomes.challenger.total > 0
      ? this.abTest.outcomes.challenger.correct / this.abTest.outcomes.challenger.total
      : 0;

    return {
      champion: {
        predictions: this.abTest.predictions.champion,
        accuracy: championAcc,
      },
      challenger: {
        predictions: this.abTest.predictions.challenger,
        accuracy: challengerAcc,
      },
      duration: Date.now() - (this.abTest.startedAt || Date.now()),
    };
  }

  // ============================================
  // Cleanup
  // ============================================

  /**
   * Clean up old model versions (keep last N)
   */
  cleanupOldVersions(keepCount: number = ML_TRAINING.MAX_MODELS_TO_KEEP): void {
    const versions = this.getAllVersions();

    // Keep active, challenger, and most recent
    const toKeep = new Set<string>();
    if (this.activeVersion) toKeep.add(this.activeVersion);
    if (this.abTest.challengerVersion) toKeep.add(this.abTest.challengerVersion);

    let kept = toKeep.size;
    for (const version of versions) {
      if (kept >= keepCount) break;
      if (!toKeep.has(version.version)) {
        toKeep.add(version.version);
        kept++;
      }
    }

    // Delete versions not in keep set
    for (const [version, model] of this.versions) {
      if (!toKeep.has(version)) {
        // Delete model files
        try {
          if (fs.existsSync(model.modelPath)) {
            fs.rmSync(model.modelPath, { recursive: true });
          }
        } catch (error) {
          logger.warn('ModelVersioning', `Failed to delete model files for ${version}`);
        }

        this.versions.delete(version);
        logger.debug('ModelVersioning', `Cleaned up old version: ${version}`);
      }
    }

    this.saveManifest();
  }

  /**
   * Save manifest to disk
   */
  private saveManifest(): void {
    const manifestPath = path.join(this.modelDir, 'manifest.json');
    const manifest = {
      activeVersion: this.activeVersion,
      abTest: this.abTest,
      versions: Array.from(this.versions.values()),
    };

    try {
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    } catch (error) {
      logger.error('ModelVersioning', 'Failed to save manifest', error as Error);
    }
  }
}

// Export singleton
export const modelVersionManager = new ModelVersionManager();
