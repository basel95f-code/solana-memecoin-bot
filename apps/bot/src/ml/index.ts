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
// Note: Skip re-export to avoid conflict with ./dataCollection
// export * from './outcomes';

// Data Quality Monitoring
// Note: Skip re-export to avoid conflict with ./dataCollection
// export * from './monitoring';

// Training Orchestration
// Note: Skip re-export to avoid DataQualityReport/OutcomeLabel conflicts
// export * from './training';

// Existing ML components (selective exports to avoid conflicts)
export { FeatureEngineering, type EnhancedFeatures } from './featureEngineering';
export * from './rugPredictor';
export * from './pricePrediction';
export * from './whaleBehavior';
export * from './sentimentCorrelation';
export * from './ensemblePredictor';
export { TrainingPipeline } from './trainingPipeline';
export * from './trainingMetrics';
export * from './modelVersioning';
export * from './featureSelection';
export * from './claudeExplainer';

// Export manualLabeling types/classes but skip OutcomeLabel (already exported from dataCollection)
export { ManualLabelingService, type PendingLabel } from './manualLabeling';
