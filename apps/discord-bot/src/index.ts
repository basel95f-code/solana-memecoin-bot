/**
 * Discord Bot for Solana Memecoin Monitoring
 * Provides slash commands and alert webhooks
 */

import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { commands } from './commands/index.js';
import { handleButtonInteraction } from './interactions/buttons.js';

dotenv.config();

// Environment variables
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN || '';
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID || '';
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';

if (!DISCORD_BOT_TOKEN || !DISCORD_CLIENT_ID) {
  console.error('❌ Missing DISCORD_BOT_TOKEN or DISCORD_CLIENT_ID in environment');
  process.exit(1);
}

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('❌ Missing Supabase credentials in environment');
  process.exit(1);
}

// Initialize Supabase
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Initialize Discord client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
  ],
});

// Register slash commands
async function registerCommands() {
  try {
    console.log('🔄 Registering slash commands...');

    const commandData = Object.values(commands).map(cmd => cmd.data.toJSON());

    const rest = new REST().setToken(DISCORD_BOT_TOKEN);

    await rest.put(
      Routes.applicationCommands(DISCORD_CLIENT_ID),
      { body: commandData }
    );

    console.log('✅ Slash commands registered successfully');
  } catch (error) {
    console.error('❌ Failed to register commands:', error);
  }
}

// Event: Bot ready
client.once('ready', async () => {
  console.log(`✅ Discord bot logged in as ${client.user?.tag}`);
  
  // Register commands
  await registerCommands();

  // Set status
  client.user?.setActivity('Solana memecoins 🚀', { type: 3 }); // 3 = WATCHING
});

// Event: Interaction created (slash commands, buttons, etc.)
client.on('interactionCreate', async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      const command = commands[interaction.commandName as keyof typeof commands];
      
      if (!command) {
        await interaction.reply({ content: '❌ Unknown command', ephemeral: true });
        return;
      }

      await command.execute(interaction);
    } else if (interaction.isButton()) {
      await handleButtonInteraction(interaction);
    }
  } catch (error) {
    console.error('Error handling interaction:', error);
    
    const errorMessage = { content: '❌ An error occurred while executing this command', ephemeral: true };
    
    // Type guard: only certain interaction types have reply capabilities
    if (interaction.isRepliable()) {
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(errorMessage);
      } else {
        await interaction.reply(errorMessage);
      }
    }
  }
});

// Error handling
client.on('error', (error) => {
  console.error('Discord client error:', error);
});

process.on('unhandledRejection', (error) => {
  console.error('Unhandled promise rejection:', error);
});

// Start bot
client.login(DISCORD_BOT_TOKEN);

console.log('🚀 Discord bot starting...');
