/**
 * /help command - Show command help
 */

import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';

export const data = new SlashCommandBuilder()
  .setName('help')
  .setDescription('Show command help and usage');

export async function execute(interaction: ChatInputCommandInteraction) {
  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('🤖 Solana Memecoin Bot - Commands')
    .setDescription('Monitor and analyze Solana tokens in real-time')
    .addFields(
      {
        name: '/check <address>',
        value: 'Quick safety check for a token',
        inline: false
      },
      {
        name: '/analyze <address>',
        value: 'Full detailed analysis with sentiment and ML predictions',
        inline: false
      },
      {
        name: '/track <address> [threshold]',
        value: 'Add token to your watchlist (alerts on price changes)',
        inline: false
      },
      {
        name: '/untrack <address>',
        value: 'Remove token from your watchlist',
        inline: false
      },
      {
        name: '/watchlist',
        value: 'Show all tokens you\'re tracking',
        inline: false
      },
      {
        name: '/stats',
        value: 'Show bot statistics and activity',
        inline: false
      },
      {
        name: '/help',
        value: 'Show this help message',
        inline: false
      }
    )
    .addFields({
      name: '🔍 Features',
      value: 
        '• Real-time token monitoring (Raydium, Pump.fun, Jupiter)\n' +
        '• Risk scoring and safety checks\n' +
        '• Twitter sentiment analysis\n' +
        '• Influencer tracking (KOL calls)\n' +
        '• ML-based rug detection\n' +
        '• Price alerts and watchlists',
      inline: false
    })
    .setFooter({ text: 'Made for degen traders 🚀' })
    .setTimestamp();

  await interaction.reply({ embeds: [embed], ephemeral: true });
}
