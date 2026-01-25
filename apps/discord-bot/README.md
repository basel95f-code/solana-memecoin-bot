# Discord Bot for Solana Memecoin Monitoring

Real-time token alerts and analysis via Discord slash commands.

## Features

- **Slash Commands**: `/check`, `/analyze`, `/track`, `/watchlist`, `/stats`, `/help`
- **Interactive Buttons**: Track/untrack tokens with one click
- **Rich Embeds**: Beautiful formatted alerts with color-coded risk levels
- **Personal Watchlists**: Track tokens and get price alerts
- **Social Sentiment**: Twitter mentions and influencer tracking integration

## Setup

### 1. Create Discord Application

1. Go to https://discord.com/developers/applications
2. Click "New Application"
3. Give it a name (e.g., "Solana Memecoin Bot")
4. Go to "Bot" tab → Click "Add Bot"
5. **Important**: Enable these "Privileged Gateway Intents":
   - ✅ Presence Intent
   - ✅ Server Members Intent
   - ✅ Message Content Intent
6. Copy the bot token

### 2. Get Bot Invite Link

1. Go to "OAuth2" → "URL Generator"
2. Select scopes:
   - ✅ `bot`
   - ✅ `applications.commands`
3. Select bot permissions:
   - ✅ Send Messages
   - ✅ Embed Links
   - ✅ Read Message History
   - ✅ Use Slash Commands
4. Copy the generated URL and use it to invite the bot to your server

### 3. Environment Variables

Add to your `.env` file:

```env
# Discord Bot
DISCORD_BOT_TOKEN=your_bot_token_here
DISCORD_CLIENT_ID=your_application_id_here

# Supabase (required)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your_anon_key_here
```

### 4. Install Dependencies

```bash
cd apps/discord-bot
npm install
```

### 5. Run the Bot

Development mode (auto-reload):
```bash
npm run dev
```

Production mode:
```bash
npm start
```

## Commands

### `/check <address>`
Quick safety check for a token.
- Risk score and level
- Liquidity and holder stats
- Safety checks (mint/freeze/LP)
- Interactive track button

### `/analyze <address>`
Full detailed analysis with:
- Complete risk assessment
- Holder distribution
- Security analysis
- Social sentiment (if available)
- ML rug prediction

### `/track <address> [threshold]`
Add token to your watchlist.
- Optional threshold parameter (default: 10%)
- Get alerts on price changes
- Personal watchlist per user

### `/untrack <address>`
Remove token from your watchlist.

### `/watchlist`
Show all tokens you're tracking.
- Displays added date
- Alert thresholds
- Shows up to 10 tokens

### `/stats`
Bot statistics and activity.
- Tokens analyzed (total + last 24h)
- Alerts sent
- Tracked tokens count
- Twitter mentions

### `/help`
Show command help and features.

## Discord Webhook Integration

You can also receive alerts via webhooks:

1. In Discord, go to Server Settings → Integrations → Webhooks
2. Create a webhook, copy the URL
3. Add to `.env`:
```env
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
```

Webhooks can be used alongside or instead of the bot for alerts.

## Architecture

```
apps/discord-bot/
├── src/
│   ├── commands/          # Slash command handlers
│   │   ├── check.ts       # /check command
│   │   ├── analyze.ts     # /analyze command
│   │   ├── track.ts       # /track command
│   │   ├── untrack.ts     # /untrack command
│   │   ├── watchlist.ts   # /watchlist command
│   │   ├── stats.ts       # /stats command
│   │   ├── help.ts        # /help command
│   │   └── index.ts       # Command registry
│   ├── interactions/      # Button/interaction handlers
│   │   └── buttons.ts     # Track/untrack buttons
│   └── index.ts           # Main bot file
├── package.json
├── tsconfig.json
└── README.md
```

## Database Tables Used

- `analyzed_tokens` - Token analysis data
- `discord_alerts` - Alert delivery log
- `discord_watchlist` - User watchlists
- `twitter_mentions` - Social sentiment
- `social_stats_cache` - Cached Twitter stats

## Troubleshooting

**Commands not showing up?**
- Make sure the bot has been invited with the `applications.commands` scope
- Wait a few minutes for Discord to sync commands
- Check bot logs for registration errors

**Bot not responding?**
- Verify the bot token is correct
- Check that the bot has required permissions
- Ensure Supabase credentials are valid

**Can't track tokens?**
- Token must be analyzed first (appears in `analyzed_tokens` table)
- Check database connection

## Development

The bot auto-registers slash commands on startup. When you add/modify commands:

1. Update command files in `src/commands/`
2. Export from `src/commands/index.ts`
3. Restart the bot
4. Commands will sync automatically

## Production Deployment

Use PM2 or Docker:

**PM2:**
```bash
pm2 start npm --name discord-bot -- start
```

**Docker:**
```bash
docker build -t discord-bot .
docker run -d --env-file .env discord-bot
```

## Support

Discord bot built with discord.js v14.
See: https://discord.js.org/
