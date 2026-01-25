# Group Chat Support - Implementation Guide

## 🎯 What Was Built

The Solana Memecoin Bot now supports **multi-context operation** - it works in both private DMs and group chats, with intelligent alert routing and quality filtering.

---

## 📋 Features

### **1. Context-Aware Operation**
- Bot detects if it's in a private chat or group
- Commands adapt based on context
- Settings stored per-chat and per-user

### **2. Selective & Quality-Focused Alerts**
✅ **Group Chats:** High-quality signals only  
✅ **Private DMs:** More permissive, includes personal watchlist  
✅ **Anti-Spam:** Rate limiting, deduplication, quality thresholds  

### **3. Granular Control**
- Admins configure group settings
- Users configure their DM preferences
- Each alert type can be toggled independently

---

## 🚀 How To Use

### **Setting Up in a Group Chat**

1. **Add the bot to your group**
   - Invite @YourBotUsername to the group
   - Make sure the bot has permission to send messages

2. **Initialize group settings**
   ```
   /groupsetup
   ```
   - Only group admins can run this
   - Creates default settings (strict quality filters)

3. **View current configuration**
   ```
   /groupconfig
   ```

4. **Customize settings**
   ```
   /setminrisk 85          - Minimum risk score (default: 80)
   /setminliq 100000       - Minimum liquidity USD (default: 50000)
   /setmaxalerts 10        - Max alerts per hour (default: 5)
   ```

5. **Toggle alert types**
   ```
   /togglesmartmoney       - Enable/disable smart money alerts
   /togglerugs             - Enable/disable rug warnings
   /togglesignals          - Enable/disable trading signals
   /togglevolume           - Enable/disable volume spike alerts
   ```

### **Setting Up Private DM Preferences**

1. **Start a private chat with the bot**
   ```
   /start
   ```

2. **Configure your personal settings**
   ```
   /settings
   ```
   - Set your own risk/liquidity thresholds
   - Enable/disable alert types for DMs
   - More permissive than group settings

---

## 🎚️ Default Settings

### **Group Chats (High Quality)**
| Setting | Default | Purpose |
|---------|---------|---------|
| Min Risk Score | 80/100 | Only LOW risk tokens |
| Min Liquidity | $50,000 | Established tokens only |
| Max Alerts/Hour | 5 | Prevent spam |
| Smart Money Alerts | ✅ Enabled | Track whale moves |
| Rug Warnings | ✅ Enabled | Critical alerts |
| Trading Signals | ✅ Enabled | High-confidence entries |
| Volume Spikes | ❌ Disabled | Can be noisy |

### **Private DMs (More Permissive)**
| Setting | Default | Purpose |
|---------|---------|---------|
| Min Risk Score | 60/100 | MEDIUM risk acceptable |
| Min Liquidity | $10,000 | Earlier stage tokens |
| Watchlist Alerts | ✅ Enabled | Your personal watchlist |
| All Alert Types | ✅ Enabled | Full monitoring |

---

## 🧠 Smart Alert Routing

### **How Alerts Are Routed**

When a new token is discovered or an event occurs:

1. **Bot evaluates the alert metadata:**
   - Alert type (token, smart_money, rug_warning, signal, volume_spike)
   - Token risk score
   - Liquidity amount
   - Rug probability

2. **For each configured group:**
   - Check if alert type is enabled
   - Check if risk score meets minimum
   - Check if liquidity meets minimum
   - Check rate limit (max alerts/hour)
   - Check deduplication (same token in last 4h)
   - ✅ If all pass → send to group

3. **For each user with DMs enabled:**
   - Check if alert type is enabled
   - Check user's personal thresholds
   - ✅ If all pass → send via DM

**Result:** Same token alert might go to:
- All groups (if it's high quality)
- Some groups (if it meets their specific filters)
- No groups (if quality is too low)
- Users' DMs (if they want to see everything)

---

## 📊 Example Scenarios

### **Scenario 1: High-Quality Token Alert**
```
Token: $PUMP
Risk Score: 85/100 (LOW)
Liquidity: $120,000
Smart Money: 3 tracked wallets buying

Result:
✅ Sent to Group Chat (meets all filters)
✅ Sent to User DMs (opt-in users)
```

### **Scenario 2: Medium-Quality Token**
```
Token: $MEH
Risk Score: 65/100 (MEDIUM)
Liquidity: $25,000

Result:
❌ NOT sent to Group (risk score too low)
✅ Sent to User DMs (meets user threshold of 60)
```

### **Scenario 3: Rug Warning (Priority)**
```
Token: $SCAM
Alert: Dev wallet dumped 80%
Risk Score: 20/100 (EXTREME)

Result:
✅ ALWAYS sent to Group (rug warnings bypass filters)
✅ ALWAYS sent to User DMs (critical alert)
```

### **Scenario 4: Rate Limiting**
```
Group has received 5 alerts this hour (max limit)
New high-quality token appears

Result:
❌ NOT sent to Group (rate limited)
✅ Sent to User DMs (no rate limit in DMs)
```

---

## 🔧 Technical Implementation

### **New Components**

#### **1. Chat Context Service** (`services/chatContext.ts`)
- Detects chat type (private/group)
- Manages group settings (per-chat configuration)
- Manages user settings (per-user DM preferences)
- Admin permission checks

#### **2. Alert Router Service** (`services/alertRouter.ts`)
- Routes alerts to appropriate chats
- Applies quality filters per-chat
- Handles rate limiting & deduplication
- Records alert history

#### **3. Group Setup Commands** (`telegram/commands/groupsetup.ts`)
- `/groupsetup` - Initialize group
- `/groupconfig` - View settings
- `/setminrisk` - Adjust min risk
- `/setminliq` - Adjust min liquidity
- `/setmaxalerts` - Adjust rate limit
- `/toggle*` - Enable/disable alert types

#### **4. Database Schema** (`database/schema.ts` - Migration v10)
- `group_settings` - Per-group configuration
- `user_settings` - Per-user DM preferences
- `group_alert_throttle` - Rate limiting & deduplication

---

## 🧪 Testing Checklist

### **Group Chat Testing**
- [ ] Add bot to a test group
- [ ] Run `/groupsetup` as admin
- [ ] Verify default settings appear
- [ ] Change min risk with `/setminrisk 90`
- [ ] Toggle alert types with `/togglesignals`
- [ ] Check that non-admins can't change settings
- [ ] Trigger a token alert and verify it appears
- [ ] Verify rate limiting (max alerts/hour)
- [ ] Verify deduplication (same token not repeated)

### **Private DM Testing**
- [ ] Start private chat with `/start`
- [ ] Configure settings with `/settings`
- [ ] Add tokens to personal watchlist
- [ ] Verify watchlist alerts arrive in DM
- [ ] Verify lower-quality tokens (60-79 risk) arrive in DM
- [ ] Verify DM alerts don't go to group

### **Cross-Context Testing**
- [ ] Send `/check <token>` in group - verify public response
- [ ] Send `/check <token>` in DM - verify detailed private response
- [ ] Verify same user can have different settings in group vs DM

---

## 🚦 Next Steps (Not Yet Implemented)

### **Phase 2 Features (Future)**
- [ ] `/groupwatch <token>` - Shared group watchlist
- [ ] `/hotlist` - Top tokens today (group view)
- [ ] `/stats` - Group analytics (tokens scanned, best finds)
- [ ] Morning briefing (scheduled daily summary)
- [ ] Leaderboard (who found the best tokens - opt-in)

### **Phase 3 Features (Future)**
- [ ] Group-specific filters (save custom filter sets per group)
- [ ] Alert priority levels (critical/high/medium)
- [ ] User mentions in group alerts ("@basel - your watchlist token mooned!")
- [ ] Cross-group analytics (compare group performance)

---

## 📝 Migration Notes

### **Database Migration**
- New migration (v10) automatically runs on bot startup
- Creates 3 new tables: `group_settings`, `user_settings`, `group_alert_throttle`
- No data loss - existing users/groups unaffected
- Existing single-chat bot continues working as before

### **Backwards Compatibility**
- ✅ Existing `config.telegramChatId` still works (fallback for unconfigured users)
- ✅ All existing commands work as before
- ✅ No breaking changes to API or data structures

---

## 🎓 Key Design Decisions

### **Why Strict Group Filters?**
Group chats are shared spaces. Low-quality spam ruins the experience. By defaulting to high thresholds (80+ risk, $50k+ liquidity), we ensure groups only see alpha.

### **Why More Permissive DMs?**
In private chats, users want full control. They might want to monitor riskier plays or earlier-stage tokens. DMs give them that freedom without annoying others.

### **Why Rate Limiting?**
Even with quality filters, a busy market can generate many alerts. Rate limiting (5/hour default) prevents notification fatigue.

### **Why 4-Hour Deduplication?**
If a token passes filters at 2 PM and again at 3 PM (due to new activity), users don't need to be alerted twice. 4 hours is enough to prevent spam while allowing re-alerts if something significant changes.

---

## 🐛 Troubleshooting

### **"Group not configured" error**
→ Admin needs to run `/groupsetup` first

### **Not receiving alerts in group**
→ Check if alert type is enabled: `/groupconfig`  
→ Check if risk/liquidity thresholds are too strict  
→ Check if rate limit was hit (max alerts/hour)

### **Receiving too many alerts**
→ Increase quality thresholds: `/setminrisk 85`, `/setminliq 100000`  
→ Disable noisy alert types: `/togglevolume`  
→ Lower rate limit: `/setmaxalerts 3`

### **Not receiving alerts in DM**
→ Make sure you started the bot: `/start`  
→ Check your personal settings: `/settings`  
→ Verify alert types are enabled

---

## 👨‍💻 Developer Notes

### **Adding a New Alert Type**

1. Add to `AlertType` enum in `services/alertRouter.ts`
2. Add enable flag to both `GroupSettings` and `UserSettings` in `services/chatContext.ts`
3. Add to database schema migration
4. Add toggle command in `telegram/commands/groupsetup.ts`
5. Update `isAlertTypeEnabled()` method in alert router

### **Changing Default Thresholds**

Edit `DEFAULT_GROUP_SETTINGS` and `DEFAULT_USER_SETTINGS` in `services/chatContext.ts`

### **Adding New Commands**

1. Add command handler in `telegram/commands/groupsetup.ts`
2. Register in `telegram/commands/index.ts`
3. Add to bot command menu in same file

---

## ✅ Summary

**What You Get:**
- ✅ Bot works in both private chats and groups
- ✅ Smart alert routing with quality filters
- ✅ Anti-spam protection (rate limiting + deduplication)
- ✅ Granular control (per-chat, per-user, per-alert-type)
- ✅ Selective alerts (users choose what they see)
- ✅ No spam (strict defaults for groups)

**Perfect for:**
- Trading groups who want high-quality alpha
- Individual traders who want full monitoring
- Mixed use (share best finds with friends, track everything personally)

---

**Built:** January 25, 2026  
**Status:** ✅ Phase 1 Complete (Context system, routing, settings)  
**Next:** Phase 2 (Group watchlist, stats, leaderboard)
