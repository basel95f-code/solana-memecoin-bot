/**
 * /stats command - Bot statistics
 */

import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { supabase } from '../index.js';

export const data = new SlashCommandBuilder()
  .setName('stats')
  .setDescription('Show bot statistics');

export async function execute(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();

  try {
    // Fetch various stats
    const [tokensResult, alertsResult, watchlistResult, mentionsResult] = await Promise.all([
      supabase.from('analyzed_tokens').select('id', { count: 'exact', head: true }),
      supabase.from('discord_alerts').select('id', { count: 'exact', head: true }),
      supabase.from('discord_watchlist').select('id', { count: 'exact', head: true }),
      supabase.from('twitter_mentions').select('id', { count: 'exact', head: true })
    ]);

    const tokensCount = tokensResult.count || 0;
    const alertsCount = alertsResult.count || 0;
    const watchlistCount = watchlistResult.count || 0;
    const mentionsCount = mentionsResult.count || 0;

    // Get recent activity (last 24h)
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    
    const [recentTokens, recentAlerts] = await Promise.all([
      supabase
        .from('analyzed_tokens')
        .select('id', { count: 'exact', head: true })
        .gte('analyzed_at', yesterday),
      supabase
        .from('discord_alerts')
        .select('id', { count: 'exact', head: true })
        .gte('sent_at', yesterday)
    ]);

    const tokensLast24h = recentTokens.count || 0;
    const alertsLast24h = recentAlerts.count || 0;

    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('📊 Bot Statistics')
      .setDescription('Real-time Solana memecoin monitoring')
      .addFields(
        {
          name: '🔍 Tokens Analyzed',
          value: `**${tokensCount.toLocaleString()}** total\n${tokensLast24h.toLocaleString()} in last 24h`,
          inline: true
        },
        {
          name: '🔔 Alerts Sent',
          value: `**${alertsCount.toLocaleString()}** total\n${alertsLast24h.toLocaleString()} in last 24h`,
          inline: true
        },
        {
          name: '⭐ Tracked Tokens',
          value: `${watchlistCount.toLocaleString()} watching`,
          inline: true
        },
        {
          name: '🐦 Twitter Mentions',
          value: `${mentionsCount.toLocaleString()} tracked`,
          inline: true
        },
        {
          name: '🤖 Features',
          value: 
            '✅ Real-time monitoring\n' +
            '✅ Risk analysis\n' +
            '✅ Social sentiment\n' +
            '✅ Influencer tracking\n' +
            '✅ ML predictions',
          inline: true
        }
      )
      .setTimestamp()
      .setFooter({ text: 'Powered by Solana Memecoin Bot' });

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error('Error in /stats command:', error);
    await interaction.editReply({
      content: '❌ An error occurred while fetching statistics.'
    });
  }
}
