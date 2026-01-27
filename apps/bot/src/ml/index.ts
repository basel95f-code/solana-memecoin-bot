/**
 * ML Module - Self-Learning System
 * 
 * This module provides the complete ML pipeline for:
 * - Automatic data collection
 * - Smart adaptive sampling
 * - Outcome tracking
 * - Data quality monitoring
 * - Distribution drift detection
 * - Auto training orchestration
 */

// Data Collection (primary exports - takes precedence)
export * from './dataCollection';

// Smart Sampling
export * from './sampling';

// Outcome Tracking
export * from './outcomes';

// Data Quality Monitoring
export * from './monitoring';

// Training Orchestration
export * from './training';

// Existing ML components (selective exports to avoid conflicts)
export { FeatureEngineer, type EnhancedFeatures } from './featureEngineering';
export * from './rugPredictor';
export * from './pricePrediction';
export * from './whaleBehavior';
export * from './sentimentCorrelation';
export * from './ensemblePredictor';
export { TrainingPipeline } from './trainingPipeline';
export * from './trainingMetrics';
export * from './modelVersioning';
export * from './manualLabeling';
export * from './featureSelection';
export * from './claudeExplainer';
