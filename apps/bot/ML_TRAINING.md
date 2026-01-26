# ML Model Training Guide

The bot has automated ML training that improves over time as it learns from real token data.

## How It Works

1. **Data Collection** - Bot tracks all tokens it analyzes and their outcomes
2. **Pattern Learning** - ML models learn which features predict success/rugs
3. **Auto-Retraining** - Models automatically retrain when new data is available
4. **Performance Tracking** - Training runs are logged with accuracy metrics

## Training Requirements

- **Minimum samples:** 100 labeled tokens (success/rug/stable)
- **Recommended:** 500+ samples for good accuracy
- **Current status:** 0 samples (needs real data from monitoring)

## Auto-Training Schedule

The bot automatically checks for retraining every 4 hours when:
- At least 50 new labeled samples collected since last training
- OR 7+ days since last training
- OR model accuracy drops below 70%

## Manual Training

To trigger manual training:
```bash
# Via Telegram (if you have admin access)
/ml train

# Via API
curl http://localhost:3000/api/ml/train -X POST
```

## Monitoring Training

Check training status:
```bash
# Via Telegram
/ml status

# Check logs
tail -f data/bot.db
```

## Training Metrics

After each training run, you'll see:
- **Accuracy** - Overall prediction accuracy
- **Precision** - How often predictions are correct
- **Recall** - How many actual cases were caught
- **F1 Score** - Balance between precision and recall
- **AUC** - Area under ROC curve (discrimination ability)

## Expected Timeline

- **Week 1-2:** 0-50 samples (not enough to train)
- **Week 3-4:** 50-150 samples (first training possible)
- **Month 2:** 200-500 samples (good accuracy expected)
- **Month 3+:** 500+ samples (high accuracy, reliable predictions)

## Tips

1. **Let it run** - The more tokens it analyzes, the smarter it gets
2. **Check outcomes** - Review token performance to verify ML accuracy
3. **Monitor alerts** - ML predictions will improve alert quality over time
4. **Be patient** - Takes 2-3 weeks of data collection before first training
