# ML Advanced System Documentation

## Overview

The ML Advanced System provides sophisticated machine learning predictions for Solana memecoin trading, including:

- **Price Prediction**: LSTM-based neural network predicting price movements (1h, 6h, 24h)
- **Sentiment Correlation**: Analyzing sentiment → price relationships with time-lag detection
- **Whale Behavior**: Pattern recognition in whale transactions, dump warnings
- **Enhanced Rug Detection**: Improved rug pull predictions with 28 features

## Architecture

### Models

1. **Price Prediction Model** (`pricePrediction.ts`)
   - **Type**: LSTM/GRU neural network
   - **Input**: 28 features + 12-step historical sequence
   - **Output**: Probability distribution (up/down/sideways) for 1h/6h/24h
   - **Performance Target**: >60% accuracy

2. **Sentiment Correlation Model** (`sentimentCorrelation.ts`)
   - **Type**: Dense regression network
   - **Input**: 10 sentiment features
   - **Output**: Predicted price impact %, correlation coefficient
   - **Special**: Time-lag analysis (sentiment leading price)

3. **Whale Behavior Model** (`whaleBehavior.ts`)
   - **Type**: Dense classification + clustering
   - **Input**: 15 wallet features
   - **Output**: Action probabilities (accumulation/distribution/dump/holding)
   - **Special**: Pattern recognition, similar wallet clustering

4. **Neural Network Architectures** (`models/architectures.ts`)
   - Reusable architectures: LSTM, GRU, Dense, Transformer-like, Autoencoder
   - Ensemble model for combining multiple predictions
   - Transfer learning support

### Pipeline

1. **Training Pipeline** (`training/pipeline.ts`)
   - Automated data collection from database
   - Data quality validation (missing values, outliers, class balance)
   - Train/validation/test split (70/15/15)
   - Cross-validation
   - Hyperparameter tracking
   - Performance metrics logging

2. **Inference Server** (`inference/server.ts`)
   - Real-time prediction API
   - Batch processing (up to 32 requests)
   - Caching (1min TTL)
   - Model fallbacks
   - Performance monitoring
   - SHAP-like prediction explanations

## Features (28 Total)

### Core Features (9)
- `liquidityUsd`: Total liquidity in USD
- `riskScore`: Base risk score (0-100)
- `holderCount`: Number of token holders
- `top10Percent`: % held by top 10 wallets
- `mintRevoked`: Mint authority status (boolean)
- `freezeRevoked`: Freeze authority status (boolean)
- `lpBurnedPercent`: LP burn percentage
- `hasSocials`: Social media presence (boolean)
- `tokenAgeHours`: Token age in hours

### Momentum Features (6)
- `priceChange5m`: 5-minute price change %
- `priceChange1h`: 1-hour price change %
- `priceChange24h`: 24-hour price change %
- `volumeChange1h`: 1-hour volume change %
- `volumeChange24h`: 24-hour volume change %
- `buyPressure1h`: Buy/sell ratio (0-1)

### Smart Money Features (3)
- `smartMoneyNetBuys`: Net smart money buys
- `smartMoneyHolding`: Smart money holding %
- `isSmartMoneyBullish`: Smart money sentiment (boolean)

### Trend Features (4)
- `priceVelocity`: Rate of price acceleration
- `volumeAcceleration`: Volume trend acceleration
- `liquidityTrend`: Liquidity change trend
- `holderTrend`: Holder count trend

### Pattern Features (3)
- `hasVolumeSpike`: Volume spike detection (boolean)
- `isPumping`: Pumping pattern (boolean)
- `isDumping`: Dumping pattern (boolean)

### Sentiment Features (3)
- `sentimentScore`: Overall sentiment (-1 to +1)
- `sentimentConfidence`: Sentiment confidence (0-1)
- `hasSentimentData`: Sentiment data available (boolean)

## Database Schema

### `ml_predictions`
Stores all predictions with outcomes for accuracy tracking.

**Key Columns:**
- `token_mint`, `model_type`, `model_version`
- `predicted_direction`, `confidence`, `expected_change`
- `probabilities` (JSONB), `metadata` (JSONB)
- `actual_outcome`, `actual_change`, `was_correct`
- `created_at`, `outcome_measured_at`

### `ml_training_data`
Historical token data with features and known outcomes.

**Key Columns:**
- All 28 feature columns
- `features_json` (JSONB) - flexible storage
- `outcome`, `price_change_*_outcome`, `whale_action`
- `has_outcome` (boolean flag)

### `ml_models`
Model versions with training metrics.

**Key Columns:**
- `model_type`, `version`, `is_active`, `is_production`
- `accuracy`, `precision_score`, `recall`, `f1_score`, `loss`
- `training_samples`, `training_time_seconds`
- `hyperparameters` (JSONB), `metrics` (JSONB)

### `ml_performance_tracking`
Time-series accuracy tracking.

**Key Columns:**
- `model_type`, `model_version`
- `period_start`, `period_end`
- `total_predictions`, `correct_predictions`, `accuracy`
- `predictions_by_class`, `accuracy_by_class` (JSONB)

## Telegram Commands

### `/predict_price <token> [timeframe]`
Predict price movement for 1h, 6h, or 24h.

**Example:**
```
/predict_price ABC123... 6h
```

**Response:**
- Predicted direction (UP/DOWN/SIDEWAYS)
- Expected % change
- Confidence score
- Probability distribution

### `/sentiment_impact <token>`
Analyze sentiment → price correlation.

**Response:**
- Recommendation (BULLISH/BEARISH/NEUTRAL)
- Predicted price impact %
- Correlation strength
- Time lag (sentiment → price)
- Statistical significance

### `/whale_alert <token>`
Whale behavior analysis and dump warning.

**Response:**
- Risk level (LOW/MEDIUM/HIGH/CRITICAL)
- Predicted action (accumulation/distribution/dump/holding)
- Dump probability
- Time to action estimate
- Detected patterns

### `/ml_models`
View all ML models and their performance.

**Response:**
- Server status
- Model initialization status
- Training vs live accuracy
- Total predictions made

### `/ml_explain <token>`
Explain prediction with feature importance.

**Response:**
- Top contributing features
- Feature importance scores
- Impact direction (positive/negative)
- Value analysis

### `/ml_train <model> <admin_key>`
Trigger model training (admin only).

**Example:**
```
/ml_train price_prediction secret123
```

## API Endpoints

### `POST /api/v1/ml/predict`
Get ML prediction for a token.

**Request:**
```json
{
  "model": "price_prediction",
  "tokenMint": "ABC123...",
  "input": {
    "features": { ... }
  },
  "options": {
    "useCache": true,
    "explain": false
  }
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "prediction": { ... },
    "modelVersion": "v1.0.0-1h",
    "confidence": 0.75,
    "inferenceTime": 45,
    "cached": false,
    "explanation": { ... }
  }
}
```

### `POST /api/v1/ml/predict/batch`
Batch prediction for multiple tokens (max 100).

### `GET /api/v1/ml/models`
List all ML models and their status.

### `GET /api/v1/ml/performance`
Get model performance metrics and accuracy.

### `GET /api/v1/ml/predictions/:tokenMint`
Get prediction history for a specific token.

### `POST /api/v1/ml/train`
Trigger model training (admin only).

### `PUT /api/v1/ml/predictions/:id/outcome`
Update prediction outcome for accuracy tracking.

### `GET /api/v1/ml/health`
Health check endpoint.

## Training Workflow

1. **Data Collection**
   - Query historical tokens from `ml_training_data`
   - Filter for records with known outcomes (`has_outcome = true`)
   - Minimum 100 samples required

2. **Data Validation**
   - Check for missing values
   - Detect outliers (>3 std deviations)
   - Analyze class balance
   - Calculate feature statistics

3. **Data Preparation**
   - Normalize features to 0-1 range
   - Create sequences for LSTM models
   - Split: 70% train, 15% validation, 15% test

4. **Model Training**
   - Default: 100 epochs, batch size 32
   - Adam optimizer, learning rate 0.001
   - L2 regularization (0.01)
   - Dropout for regularization

5. **Evaluation**
   - Accuracy, precision, recall, F1-score
   - MAE for regression models
   - ROC-AUC for classification

6. **Model Saving**
   - Save to `data/models/<model_name>/`
   - Version tracking in database
   - Metrics logging

7. **Performance Tracking**
   - Monitor live predictions vs outcomes
   - Calculate accuracy over time windows
   - Detect model drift

## Performance Targets

- **Price Prediction**: >60% accuracy (better than random)
- **Sentiment Correlation**: R² >0.3
- **Whale Dump Detection**: >70% recall
- **Inference Time**: <500ms per token

## Model Versioning

Models are versioned using format: `v<timestamp>` or `v1.0.0-<model_type>`

- **Training metrics** stored in `ml_models` table
- **A/B testing** supported (multiple active versions)
- **Automatic rollback** if live accuracy drops <50%

## Explainability

### SHAP-like Feature Importance
Each prediction can include feature importance scores showing which features contributed most to the decision.

**Top Features Explained:**
1. **liquidityUsd**: Higher liquidity = safer
2. **riskScore**: Lower score = higher rug risk
3. **sentimentScore**: Positive sentiment = price pump likely
4. **dumpProbability**: High dump risk = avoid

## Auto-Retraining

The system supports automated retraining:

1. Check if model needs update (default: every 24h)
2. Collect new training data
3. Retrain model
4. Compare performance to current model
5. Deploy if improvement >5%
6. Archive old model

**Configuration:**
```typescript
{
  model: 'price_prediction',
  autoRetrain: true,
  retrainInterval: 24, // hours
  minSamples: 1000,
  minImprovement: 0.05 // 5%
}
```

## Error Handling

### Fallback Predictions
When a model fails:
- Return uniform probability distribution
- confidence = 0
- recommendation = 'unknown'
- Log error for investigation

### Cache Strategy
- **TTL**: 1 minute for predictions
- **Key**: `ml:<model>:<tokenMint>`
- **Invalidation**: On new training

## Monitoring

### Key Metrics
- Predictions per second
- Average inference time
- Cache hit rate
- Model accuracy (training vs live)
- Error rate

### Alerts
- Inference time >500ms
- Accuracy drops <50%
- Error rate >5%
- Model load failure

## Development Workflow

1. **Add New Feature**
   ```typescript
   // 1. Add to EnhancedFeatures interface
   // 2. Update FEATURE_NAMES array
   // 3. Add extraction logic in featureEngineering.ts
   // 4. Add to database migration
   // 5. Retrain models
   ```

2. **Create New Model**
   ```typescript
   // 1. Create model class in ml/
   // 2. Add to mlInferenceServer
   // 3. Add training config to pipeline
   // 4. Create database migration
   // 5. Add Telegram command
   // 6. Add API endpoint
   ```

3. **Update Model Architecture**
   ```typescript
   // 1. Modify createModel() method
   // 2. Increment version number
   // 3. Retrain from scratch
   // 4. A/B test against old model
   // 5. Deploy if improved
   ```

## Testing

### Unit Tests
```bash
npm test -- ml/pricePrediction.test.ts
```

### Integration Tests
```bash
npm test -- ml/integration.test.ts
```

### Performance Tests
```bash
npm test -- ml/performance.test.ts
```

## Deployment

1. **Initial Setup**
   ```bash
   # Run database migration
   npm run db:migrate
   
   # Initialize models
   npm run ml:init
   
   # Run initial training
   npm run ml:train-all
   ```

2. **Production Checklist**
   - [ ] Database migrations applied
   - [ ] Models trained (accuracy >60%)
   - [ ] API keys configured
   - [ ] Monitoring set up
   - [ ] Backup strategy in place

3. **Updates**
   ```bash
   # Pull latest code
   git pull
   
   # Run migrations
   npm run db:migrate
   
   # Retrain models
   npm run ml:retrain-all
   ```

## Troubleshooting

### Model Won't Load
- Check `data/models/<model>/model.json` exists
- Check file permissions
- Check TensorFlow.js version
- Try deleting and retraining

### Low Accuracy
- Check training data quality
- Increase training samples
- Adjust hyperparameters
- Add more features
- Try different architecture

### Slow Inference
- Enable caching
- Use batch predictions
- Reduce model complexity
- Check CPU/GPU utilization

### Data Quality Issues
- Run data validation report
- Check for missing values
- Remove outliers
- Balance classes

## Future Improvements

1. **Advanced Architectures**
   - Full Transformer implementation
   - Attention mechanisms
   - Graph neural networks

2. **More Features**
   - On-chain metrics (transaction patterns)
   - Social metrics (influencer tracking)
   - Market context (SOL price, overall sentiment)

3. **AutoML**
   - Automated hyperparameter tuning
   - Architecture search
   - Feature selection

4. **Ensemble Methods**
   - Stacking multiple models
   - Boosting algorithms
   - Weighted voting

5. **Real-time Learning**
   - Online learning
   - Continuous model updates
   - Adaptive learning rates

## References

- TensorFlow.js Documentation: https://www.tensorflow.org/js
- LSTM for Time Series: https://colah.github.io/posts/2015-08-Understanding-LSTMs/
- SHAP (Explainability): https://github.com/slundberg/shap
- Model Versioning Best Practices: https://ml-ops.org/

## Support

For issues or questions:
- Check logs in `logs/ml.log`
- Review model stats: `/ml_models` command
- Check database: `ml_model_performance_summary` view
- Contact: ML team

---

**Last Updated:** 2024-03-24  
**Version:** 1.0.0  
**Author:** ML System
