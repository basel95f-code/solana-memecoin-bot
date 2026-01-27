/**
 * Neural Network Architectures
 * Reusable NN architectures: LSTM, Transformer, Dense, Ensemble
 */

import * as tf from '@tensorflow/tfjs';
import { logger } from '../../utils/logger';

export interface ModelConfig {
  inputShape: number | number[];
  outputUnits: number;
  outputActivation?: string;
  learningRate?: number;
  regularization?: number;
}

export interface LSTMConfig extends ModelConfig {
  lstmUnits: number[];
  denseUnits?: number[];
  dropoutRate?: number;
  bidirectional?: boolean;
}

export interface TransformerConfig extends ModelConfig {
  numHeads: number;
  dModel: number;
  dff: number;
  numLayers: number;
  dropoutRate?: number;
}

export interface DenseConfig extends ModelConfig {
  hiddenUnits: number[];
  dropoutRate?: number;
  batchNorm?: boolean;
}

/**
 * LSTM Architecture for time-series prediction
 */
export function createLSTMModel(config: LSTMConfig): tf.LayersModel {
  const model = tf.sequential();

  // Determine input shape
  const inputShape = Array.isArray(config.inputShape)
    ? config.inputShape
    : [config.inputShape];

  // Add LSTM layers
  config.lstmUnits.forEach((units, index) => {
    const isLast = index === config.lstmUnits.length - 1;
    
    const lstmLayer = tf.layers.lstm({
      units,
      returnSequences: !isLast,
      inputShape: index === 0 ? inputShape as [number, number] : undefined,
      kernelRegularizer: config.regularization
        ? tf.regularizers.l2({ l2: config.regularization })
        : undefined,
    });

    if (config.bidirectional && index === 0) {
      model.add(tf.layers.bidirectional({
        layer: lstmLayer as tf.RNN,
      }));
    } else {
      model.add(lstmLayer);
    }

    if (config.dropoutRate) {
      model.add(tf.layers.dropout({ rate: config.dropoutRate }));
    }
  });

  // Add dense layers if specified
  if (config.denseUnits) {
    config.denseUnits.forEach(units => {
      model.add(tf.layers.dense({
        units,
        activation: 'relu',
        kernelRegularizer: config.regularization
          ? tf.regularizers.l2({ l2: config.regularization })
          : undefined,
      }));
      
      if (config.dropoutRate) {
        model.add(tf.layers.dropout({ rate: config.dropoutRate * 0.5 }));
      }
    });
  }

  // Output layer
  model.add(tf.layers.dense({
    units: config.outputUnits,
    activation: (config.outputActivation || 'linear') as any,
  }));

  // Compile
  model.compile({
    optimizer: tf.train.adam(config.learningRate || 0.001),
    loss: config.outputUnits === 1 ? 'meanSquaredError' : 'categoricalCrossentropy',
    metrics: config.outputUnits === 1 ? ['mae'] : ['accuracy'],
  });

  logger.info('ModelArchitecture', `Created LSTM model: ${model.layers.length} layers`);
  return model;
}

/**
 * GRU Architecture (alternative to LSTM, often faster)
 */
export function createGRUModel(config: LSTMConfig): tf.LayersModel {
  const model = tf.sequential();

  const inputShape = Array.isArray(config.inputShape)
    ? config.inputShape
    : [config.inputShape];

  config.lstmUnits.forEach((units, index) => {
    const isLast = index === config.lstmUnits.length - 1;
    
    model.add(tf.layers.gru({
      units,
      returnSequences: !isLast,
      inputShape: index === 0 ? inputShape as [number, number] : undefined,
      kernelRegularizer: config.regularization
        ? tf.regularizers.l2({ l2: config.regularization })
        : undefined,
    }));

    if (config.dropoutRate) {
      model.add(tf.layers.dropout({ rate: config.dropoutRate }));
    }
  });

  if (config.denseUnits) {
    config.denseUnits.forEach(units => {
      model.add(tf.layers.dense({
        units,
        activation: 'relu',
        kernelRegularizer: config.regularization
          ? tf.regularizers.l2({ l2: config.regularization })
          : undefined,
      }));
    });
  }

  model.add(tf.layers.dense({
    units: config.outputUnits,
    activation: (config.outputActivation || 'linear') as any,
  }));

  model.compile({
    optimizer: tf.train.adam(config.learningRate || 0.001),
    loss: config.outputUnits === 1 ? 'meanSquaredError' : 'categoricalCrossentropy',
    metrics: config.outputUnits === 1 ? ['mae'] : ['accuracy'],
  });

  logger.info('ModelArchitecture', `Created GRU model: ${model.layers.length} layers`);
  return model;
}

/**
 * Dense (Feedforward) Architecture for non-sequential data
 */
export function createDenseModel(config: DenseConfig): tf.LayersModel {
  const model = tf.sequential();

  const inputShape = Array.isArray(config.inputShape)
    ? config.inputShape[0]
    : config.inputShape;

  // Add hidden layers
  config.hiddenUnits.forEach((units, index) => {
    model.add(tf.layers.dense({
      units,
      activation: 'relu',
      inputShape: index === 0 ? [inputShape] : undefined,
      kernelRegularizer: config.regularization
        ? tf.regularizers.l2({ l2: config.regularization })
        : undefined,
    }));

    if (config.batchNorm) {
      model.add(tf.layers.batchNormalization());
    }

    if (config.dropoutRate) {
      model.add(tf.layers.dropout({ rate: config.dropoutRate }));
    }
  });

  // Output layer
  model.add(tf.layers.dense({
    units: config.outputUnits,
    activation: (config.outputActivation || 'linear') as any,
  }));

  // Compile
  model.compile({
    optimizer: tf.train.adam(config.learningRate || 0.001),
    loss: config.outputUnits === 1 ? 'meanSquaredError' : 'categoricalCrossentropy',
    metrics: config.outputUnits === 1 ? ['mae'] : ['accuracy'],
  });

  logger.info('ModelArchitecture', `Created Dense model: ${model.layers.length} layers`);
  return model;
}

/**
 * Attention mechanism (simplified)
 */
class MultiHeadAttention extends tf.layers.Layer {
  private numHeads: number;
  private dModel: number;
  private depth: number;
  private wq: tf.Sequential;
  private wk: tf.Sequential;
  private wv: tf.Sequential;
  private dense: tf.layers.Layer;

  constructor(config: { numHeads: number; dModel: number }) {
    super({});
    this.numHeads = config.numHeads;
    this.dModel = config.dModel;
    this.depth = config.dModel / config.numHeads;

    // Query, Key, Value projection layers
    this.wq = tf.sequential();
    this.wq.add(tf.layers.dense({ units: config.dModel }));

    this.wk = tf.sequential();
    this.wk.add(tf.layers.dense({ units: config.dModel }));

    this.wv = tf.sequential();
    this.wv.add(tf.layers.dense({ units: config.dModel }));

    this.dense = tf.layers.dense({ units: config.dModel });
  }

  call(inputs: tf.Tensor | tf.Tensor[]): tf.Tensor | tf.Tensor[] {
    // Simplified attention - full implementation would be more complex
    // For now, just return inputs (placeholder)
    return inputs;
  }

  static get className() {
    return 'MultiHeadAttention';
  }
}

/**
 * Transformer Architecture (simplified for sequence analysis)
 * Note: Full transformer is complex; this is a simplified version
 */
export function createTransformerModel(config: TransformerConfig): tf.LayersModel {
  // TensorFlow.js doesn't have built-in transformer layers
  // We'll create a simplified version using available layers
  
  const model = tf.sequential();

  const inputShape = Array.isArray(config.inputShape)
    ? config.inputShape
    : [config.inputShape];

  // Use LSTM as a substitute for full transformer
  // In production, you'd implement custom transformer layers
  model.add(tf.layers.lstm({
    units: config.dModel,
    returnSequences: true,
    inputShape: inputShape as [number, number],
  }));

  model.add(tf.layers.dropout({ rate: config.dropoutRate || 0.1 }));

  model.add(tf.layers.lstm({
    units: config.dModel / 2,
    returnSequences: false,
  }));

  model.add(tf.layers.dense({
    units: config.dff,
    activation: 'relu',
  }));

  model.add(tf.layers.dropout({ rate: config.dropoutRate || 0.1 }));

  model.add(tf.layers.dense({
    units: config.outputUnits,
    activation: (config.outputActivation || 'linear') as any,
  }));

  model.compile({
    optimizer: tf.train.adam(config.learningRate || 0.001),
    loss: config.outputUnits === 1 ? 'meanSquaredError' : 'categoricalCrossentropy',
    metrics: config.outputUnits === 1 ? ['mae'] : ['accuracy'],
  });

  logger.info('ModelArchitecture', `Created Transformer-like model: ${model.layers.length} layers`);
  return model;
}

/**
 * Ensemble Model - combines predictions from multiple models
 */
export class EnsembleModel {
  private models: tf.LayersModel[] = [];
  private weights: number[] = [];

  constructor(models: tf.LayersModel[], weights?: number[]) {
    this.models = models;
    
    if (weights) {
      this.weights = weights;
    } else {
      // Equal weights by default
      this.weights = new Array(models.length).fill(1 / models.length);
    }
  }

  /**
   * Predict using weighted average of all models
   */
  async predict(input: tf.Tensor): Promise<tf.Tensor> {
    const predictions: tf.Tensor[] = [];

    for (const model of this.models) {
      const pred = model.predict(input) as tf.Tensor;
      predictions.push(pred);
    }

    // Weighted average
    const weighted = predictions.map((pred, i) => tf.mul(pred, this.weights[i]));
    const ensemble = tf.addN(weighted);

    // Clean up
    predictions.forEach(p => p.dispose());
    weighted.forEach(w => w.dispose());

    return ensemble;
  }

  /**
   * Predict and return individual model predictions
   */
  async predictWithDetails(input: tf.Tensor): Promise<{
    ensemble: number[];
    individual: number[][];
    weights: number[];
  }> {
    const predictions: number[][] = [];

    for (const model of this.models) {
      const pred = model.predict(input) as tf.Tensor;
      const values = await pred.data();
      predictions.push(Array.from(values));
      pred.dispose();
    }

    // Calculate weighted ensemble
    const numOutputs = predictions[0].length;
    const ensemble = new Array(numOutputs).fill(0);

    for (let i = 0; i < predictions.length; i++) {
      for (let j = 0; j < numOutputs; j++) {
        ensemble[j] += predictions[i][j] * this.weights[i];
      }
    }

    return {
      ensemble,
      individual: predictions,
      weights: this.weights,
    };
  }

  /**
   * Update weights based on recent performance
   */
  updateWeights(performances: number[]): void {
    // Normalize performances to weights
    const sum = performances.reduce((a, b) => a + b, 0);
    this.weights = performances.map(p => p / sum);
    
    logger.info('EnsembleModel', `Updated weights: ${this.weights.map(w => w.toFixed(3)).join(', ')}`);
  }

  /**
   * Get model count
   */
  getModelCount(): number {
    return this.models.length;
  }

  /**
   * Dispose of all models
   */
  dispose(): void {
    this.models.forEach(m => m.dispose());
    this.models = [];
  }
}

/**
 * Create an autoencoder for anomaly detection / dimensionality reduction
 */
export function createAutoencoderModel(config: {
  inputDim: number;
  encodingDim: number;
  hiddenLayers?: number[];
  learningRate?: number;
}): { encoder: tf.LayersModel; decoder: tf.LayersModel; autoencoder: tf.LayersModel } {
  const inputDim = config.inputDim;
  const encodingDim = config.encodingDim;
  const hiddenLayers = config.hiddenLayers || [64, 32];

  // Build encoder
  const encoderModel = tf.sequential();
  encoderModel.add(tf.layers.inputLayer({ inputShape: [inputDim] }));

  hiddenLayers.forEach(units => {
    encoderModel.add(tf.layers.dense({ units, activation: 'relu' }));
  });

  encoderModel.add(tf.layers.dense({ units: encodingDim, activation: 'relu', name: 'encoding' }));

  // Build decoder
  const decoderModel = tf.sequential();
  decoderModel.add(tf.layers.inputLayer({ inputShape: [encodingDim] }));

  [...hiddenLayers].reverse().forEach(units => {
    decoderModel.add(tf.layers.dense({ units, activation: 'relu' }));
  });

  decoderModel.add(tf.layers.dense({ units: inputDim, activation: 'sigmoid' }));

  // Build autoencoder (encoder + decoder)
  const autoencoderModel = tf.sequential();
  autoencoderModel.add(encoderModel);
  autoencoderModel.add(decoderModel);

  autoencoderModel.compile({
    optimizer: tf.train.adam(config.learningRate || 0.001),
    loss: 'meanSquaredError',
  });

  logger.info('ModelArchitecture', 'Created Autoencoder model');

  return {
    encoder: encoderModel,
    decoder: decoderModel,
    autoencoder: autoencoderModel,
  };
}

/**
 * Transfer learning - fine-tune a pre-trained model
 */
export function createTransferLearningModel(
  baseModel: tf.LayersModel,
  numClasses: number,
  frozenLayers: number = 0
): tf.LayersModel {
  // Freeze base layers
  for (let i = 0; i < Math.min(frozenLayers, baseModel.layers.length); i++) {
    baseModel.layers[i].trainable = false;
  }

  // Add new classification head
  const model = tf.sequential();
  
  // Add all base layers
  baseModel.layers.forEach(layer => {
    model.add(layer);
  });

  // Remove last layer(s) and add new ones
  model.layers.pop(); // Remove old output layer

  model.add(tf.layers.dense({
    units: 64,
    activation: 'relu',
  }));

  model.add(tf.layers.dropout({ rate: 0.3 }));

  model.add(tf.layers.dense({
    units: numClasses,
    activation: 'softmax',
  }));

  model.compile({
    optimizer: tf.train.adam(0.0001), // Lower learning rate for fine-tuning
    loss: 'categoricalCrossentropy',
    metrics: ['accuracy'],
  });

  logger.info('ModelArchitecture', `Created transfer learning model with ${frozenLayers} frozen layers`);
  return model;
}

export default {
  createLSTMModel,
  createGRUModel,
  createDenseModel,
  createTransformerModel,
  createAutoencoderModel,
  createTransferLearningModel,
  EnsembleModel,
};

