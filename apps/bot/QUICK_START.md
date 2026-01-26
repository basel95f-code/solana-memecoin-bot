# Quick Start Guide

## Starting the Bot

### Option 1: Using the management script (Recommended)
```bash
./bot.sh start    # Start in background
./bot.sh status   # Check if running
./bot.sh logs     # View logs
./bot.sh stop     # Stop bot
./bot.sh restart  # Restart bot
```

### Option 2: Manual start
```bash
npm run dev                    # Development mode
npx tsx src/index.ts          # Direct run
node dist/index.js            # Production build
```

## Configuration

1. **Edit .env file** - Add your API keys
   - `TELEGRAM_BOT_TOKEN` - Your Telegram bot token
   - `TELEGRAM_CHAT_ID` - Your chat/user ID for alerts
   - `SOLANA_RPC_URL` - Solana RPC endpoint
   - Other required keys in `.env.example`

2. **Adjust filters** - Modify settings in your configuration:
   - `MIN_LIQUIDITY_USD` - Minimum liquidity threshold
   - `MIN_HOLDERS` - Minimum number of holders
   - Other filtering parameters

3. **Test in Telegram** - Send `/start` to your bot

## Monitoring

- **Telegram:** Send `/status` to your bot
- **API Health:** http://localhost:3000/health
- **View Logs:** `./bot.sh logs` or `tail -f bot.log`

## Troubleshooting

If bot doesn't start:

1. **Check logs:**
   ```bash
   ./bot.sh logs
   ```

2. **Verify .env configuration:**
   ```bash
   cat .env
   ```

3. **Ensure port 3000 is available:**
   ```bash
   lsof -i :3000
   ```

4. **Check Telegram token is valid**
   - Verify token in `.env`
   - Test token with `/status` command

5. **Clean start:**
   ```bash
   ./bot.sh stop
   rm bot.log .bot.pid
   ./bot.sh start
   ```

## Development

### Run with live reloading
```bash
npm run dev
```

### Build for production
```bash
npm run build
```

### Run tests
```bash
npm test
```

## Commands

### Bot Status
```
/status    - Get bot status and metrics
/start     - Start monitoring
/stop      - Stop monitoring
/help      - Show available commands
```

## Common Issues

| Issue | Solution |
|-------|----------|
| Bot won't start | Check `./bot.sh logs` for errors |
| No alerts received | Verify `TELEGRAM_CHAT_ID` in .env |
| High CPU usage | Check filter thresholds, may be processing too many tokens |
| RPC errors | Verify `SOLANA_RPC_URL` is valid and not rate limited |

## Performance Tips

- Increase `MIN_LIQUIDITY_USD` to reduce false signals
- Increase `MIN_HOLDERS` to focus on established projects
- Run on a VPS for 24/7 monitoring
- Use Telegram's `/status` command to monitor activity

## Getting Help

Check the following files for more information:
- `src/` - Bot source code
- `.env.example` - Configuration template
- `package.json` - Dependencies and scripts
