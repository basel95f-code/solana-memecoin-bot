# Topic-Aware Bot for Telegram Forum Groups

This document explains how to use the bot in Telegram forum groups (supergroups with topics enabled).

## Overview

The bot now supports **topic-aware operation** in Telegram forum groups. Each topic can have its own configuration:

- **Command-only topics** - Only bot commands allowed (auto-deletes non-command messages)
- **Normal topics** - All messages allowed (like regular group chat)
- **Read-only topics** - Only the bot can post (perfect for bot-only feeds)

This enables clean organization where:
- **Token Scanner** topic = commands only, no chatter
- **General Chat** topic = normal discussion
- **Aped Tokens** topic = bot-only updates for group watchlist

---

## Quick Start

### 1. Create Forum Group

1. Create a new Telegram supergroup
2. Enable **Topics** in group settings
3. Create topics like:
   - `Token Scanner` - for token analysis
   - `Whale Tracker` - for wallet tracking
   - `Signals` - for trading signals
   - `Aped Tokens` - for group watchlist updates
   - `General Chat` - for discussion

### 2. Add Bot to Group

1. Add the bot to your group
2. Make it an admin (required for message deletion)

### 3. Configure Topics

**Option A: Use Presets (Recommended)**

Go to the topic you want to configure and run:

```
/applypreset token-scanner
```

Available presets:
- `token-scanner` - Token analysis commands
- `whale-tracker` - Whale and wallet tracking
- `signals` - Trading signals
- `aped-tokens` - Bot-only watchlist updates
- `leaderboard` - Leaderboard commands
- `general` - Normal discussion (all messages)
- `market-discovery` - Discovery commands
- `portfolio` - Portfolio tracking
- `backtesting` - Backtesting commands
- `ml-training` - ML and learning commands

**Option B: Manual Configuration**

1. Go to the topic
2. Set mode:
   ```
   /topicmode command_only
   ```
3. Optionally restrict commands:
   ```
   /topiccommands check,scan,watch,holders,lp
   ```

---

## Commands

### Admin Commands

**`/topicsetup`** - Show all configured topics
```
Shows a list of all topics and their current configuration
```

**`/topicmode <mode>`** - Set topic mode
```
/topicmode command_only   - Only commands allowed
/topicmode normal         - All messages allowed
/topicmode read_only      - Only bot can post

Must be used INSIDE the topic you want to configure
```

**`/topiccommands <commands>`** - Set allowed commands
```
/topiccommands check,scan,watch,holders

Comma-separated list of command names (without /)
Only works for command_only topics
```

**`/applypreset <preset>`** - Apply preset configuration
```
/applypreset token-scanner

Quickly configure a topic with a preset
```

**`/topicinfo`** - Show current topic info
```
Shows configuration for the current topic
```

**`/topicpresets`** - List all available presets
```
Shows all preset configurations you can apply
```

### User Commands

All existing bot commands work in topics if allowed by the topic configuration.

---

## Topic Modes

### Command-Only Mode

- **Deletes all non-command messages**
- **Perfect for:** Token Scanner, Whale Tracker, Signals
- Users can only send `/commands`
- Can optionally restrict which commands are allowed

**Example:**
```
User: /check HfYFj...
Bot: [Sends analysis]

User: "wow this is good"
Bot: [Deletes message]
     ⚠️ Only bot commands allowed in Token Scanner.
     Use /help or move to General Chat.
```

### Normal Mode

- **All messages allowed**
- **Perfect for:** General Chat
- Works like a regular group chat
- Default mode if topic is not configured

### Read-Only Mode

- **Only bot can post**
- **Perfect for:** Aped Tokens (group watchlist updates), Announcements
- All user messages are deleted
- Bot can post freely

---

## Alert Routing

When you configure topics, the bot will automatically route alerts to the appropriate topic:

| Alert Type | Routes To |
|------------|-----------|
| Token alerts | `token-scanner` topic |
| Smart money alerts | `whale-tracker` topic |
| Trading signals | `signals` topic |
| Group watchlist updates | `aped-tokens` topic |
| Leaderboard updates | `leaderboard` topic |

If the bot can't find a matching topic, alerts are sent to the main group chat.

---

## Recommended Setup

### Minimal Setup (3 Topics)

1. **Token Scanner** - `command_only` - `/applypreset token-scanner`
2. **General Chat** - `normal` - `/applypreset general`
3. **Aped Tokens** - `read_only` - `/applypreset aped-tokens`

### Full Setup (7+ Topics)

1. **Token Scanner** - Token analysis
2. **Whale Tracker** - Wallet tracking
3. **Signals** - Trading signals
4. **Aped Tokens** - Bot watchlist updates
5. **Leaderboard** - Token discovery competition
6. **Market Discovery** - Trending/new tokens
7. **General Chat** - Open discussion
8. **Portfolio** - Portfolio tracking (optional)
9. **Backtesting** - Strategy testing (optional)

---

## Usage Examples

### Setup Token Scanner Topic

```
[Admin creates "Token Scanner" topic]

Admin (in Token Scanner): /applypreset token-scanner
Bot: ✅ 🤖 Applied preset: token-scanner
     
     Mode: command_only
     Description: Token analysis and scanning commands
     
     Allowed commands:
     /check, /scan, /watch, /unwatch, /risk, /holders, /lp, /socials, /compare, /rug
     ...and 3 more

[Now users can only use these commands in this topic]
```

### User Experience

```
[Token Scanner Topic]
User: /check HfYFjP8QGTjkPk3Z2bjZ6m3Fhp5v1HbDrDZfqfbK9pump
Bot: [Sends full token analysis]

User: "this looks promising!"
Bot: [Deletes message]
     ⚠️ Only bot commands allowed in **Token Scanner**.
     Use /help or move to General Chat for discussion.

[General Chat Topic]
User: "Just checked that token, looks promising!"
[Message stays - normal discussion]
```

### Check Topic Configuration

```
User (in Token Scanner): /topicinfo
Bot: 🤖 Token Scanner
     
     Topic ID: 42
     Mode: command_only
     
     Allowed Commands:
     /check
     /scan
     /watch
     /unwatch
     /risk
     /holders
     /lp
     /socials
     /compare
     /rug
     /contract
     /honeypot
     /diagnose
```

---

## Advanced Configuration

### Custom Command Set

Instead of using presets, create your own:

```
/topicmode command_only
/topiccommands check,scan,risk,holders
```

This allows ONLY these 4 commands in the topic.

### Change Existing Configuration

```
# Change mode
/topicmode normal

# Change allowed commands
/topiccommands check,scan,watch,unwatch,risk

# Apply a different preset
/applypreset whale-tracker
```

### Remove Topic Configuration

To reset a topic to normal mode (all messages allowed):

```
/topicmode normal
```

---

## Preset Configurations

### token-scanner
- **Mode:** command_only
- **Commands:** check, scan, watch, unwatch, risk, holders, lp, socials, compare, rug, contract, honeypot, diagnose

### whale-tracker
- **Mode:** command_only
- **Commands:** whales, track, untrack, wallet, wallets, profile, leaderboard, whale, whaleactivity, accumulating, distributing, style, clusters, sybil, vsleader

### signals
- **Mode:** command_only
- **Commands:** signals, ack, outcome, kelly, correlation

### aped-tokens
- **Mode:** read_only
- **Description:** Bot posts group watchlist updates only

### leaderboard
- **Mode:** command_only
- **Commands:** leaderboard, mystats

### general
- **Mode:** normal
- **Description:** All messages allowed

### market-discovery
- **Mode:** command_only
- **Commands:** trending, new, gainers, losers, volume, scanner

### portfolio
- **Mode:** command_only
- **Commands:** portfolio, buy, sell, pnl

### backtesting
- **Mode:** command_only
- **Commands:** strategies, backtest, btresults, newstrategy, viewstrategy, snapshots

### ml-training
- **Mode:** command_only
- **Commands:** ml, learn, outcomes, sentiment

---

## Troubleshooting

### Messages Still Getting Deleted in General Chat

Make sure the topic is set to `normal` mode:
```
/topicmode normal
```

### Command Not Working in Topic

1. Check topic mode: `/topicinfo`
2. If `command_only`, check if command is allowed
3. If not allowed, ask admin to add it: `/topiccommands check,scan,yourcommand`

### Bot Can't Delete Messages

The bot needs **admin permissions** with "Delete messages" enabled in the group settings.

### Topic Not Showing in `/topicsetup`

Topics only appear after being configured. Use `/topicmode` or `/applypreset` in the topic first.

---

## Best Practices

1. **Use presets** - They're pre-configured with sensible defaults
2. **Keep General Chat normal** - Users need a place to discuss
3. **Use read-only for feeds** - Perfect for bot-only updates
4. **Grant bot admin** - Required for message deletion
5. **Name topics clearly** - "Token Scanner" is better than "Scanner"
6. **Start minimal** - Add more topics as needed

---

## Future Enhancements

Planned features:
- Auto-detect topic names from Telegram
- Per-topic alert settings
- Topic-specific watchlists
- Topic activity analytics
- User-specific topic permissions

---

## Support

For issues or questions:
1. Check `/topicinfo` in the topic
2. Check `/topicsetup` for all topics
3. Use `/help` for command list
4. Contact group admin or bot developer

---

**Enjoy your organized, topic-aware Telegram trading group!** 🚀
