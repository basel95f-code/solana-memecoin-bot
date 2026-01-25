/**
 * /analyze command - Full token analysis
 */

import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { supabase } from '../index.js';

export const data = new SlashCommandBuilder()
  .setName('analyze')
  .setDescription('Full analysis of a token')
  .addStringOption(option =>
    option
      .setName('address')
      .setDescription('Token mint address')
      .setRequired(true)
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  const address = interaction.options.getString('address', true);

  await interaction.deferReply();

  try {
    // Fetch token analysis
    const { data: analysis, error } = await supabase
      .from('analyzed_tokens')
      .select('*')
      .eq('mint', address)
      .order('analyzed_at', { ascending: false })
      .limit(1)
      .single();

    if (error || !analysis) {
      await interaction.editReply({
        content: `❌ Token not found or not analyzed yet.\n\nAddress: \`${address}\``
      });
      return;
    }

    // Fetch sentiment data
    const { data: sentiment } = await supabase
      .from('social_stats_cache')
      .select('*')
      .eq('token_mint', address)
      .single();

    // Build detailed embed
    const riskEmoji = analysis.risk_level === 'LOW' ? '🟢' :
                     analysis.risk_level === 'MEDIUM' ? '🟡' :
                     analysis.risk_level === 'HIGH' ? '🟠' : '🔴';

    const embed = new EmbedBuilder()
      .setColor(analysis.risk_level === 'LOW' ? 0x00FF00 :
               analysis.risk_level === 'MEDIUM' ? 0xFFFF00 :
               analysis.risk_level === 'HIGH' ? 0xFF8800 : 0xFF0000)
      .setTitle(`${riskEmoji} Full Analysis: ${analysis.symbol}`)
      .setDescription(`**${analysis.name}**\n\`${address}\``)
      .addFields(
        {
          name: '📊 Risk Assessment',
          value: `**Score:** ${analysis.risk_score}/100\n**Level:** ${analysis.risk_level}`,
          inline: true
        },
        {
          name: '💧 Liquidity',
          value: `$${(analysis.liquidity_usd || 0).toLocaleString()}\n` +
                 `${analysis.lp_burned_percent > 0 ? `🔥 ${analysis.lp_burned_percent.toFixed(0)}% burned` : ''}` +
                 `${analysis.lp_locked_percent > 0 ? `🔒 ${analysis.lp_locked_percent.toFixed(0)}% locked` : ''}`,
          inline: true
        },
        {
          name: '👥 Holders',
          value: `Total: ${analysis.holder_count || 0}\n` +
                 `Top 10: ${(analysis.top10_percent || 0).toFixed(1)}%`,
          inline: true
        },
        {
          name: '🔐 Security',
          value: 
            `${analysis.mint_revoked ? '✅' : '❌'} Mint revoked\n` +
            `${analysis.freeze_revoked ? '✅' : '❌'} Freeze revoked\n` +
            `${analysis.is_honeypot ? '❌' : '✅'} Not honeypot`,
          inline: true
        },
        {
          name: '🌐 Social',
          value:
            `${analysis.has_twitter ? '✅' : '❌'} Twitter\n` +
            `${analysis.has_telegram ? '✅' : '❌'} Telegram\n` +
            `${analysis.has_website ? '✅' : '❌'} Website`,
          inline: true
        }
      );

    // Add sentiment if available
    if (sentiment) {
      const sentimentEmoji = sentiment.sentiment_score_24h > 0.2 ? '🟢' :
                            sentiment.sentiment_score_24h < -0.2 ? '🔴' : '⚪';
      
      embed.addFields({
        name: '🐦 Twitter Sentiment (24h)',
        value: `${sentimentEmoji} ${sentiment.sentiment_trend || 'Neutral'}\n` +
               `Mentions: ${sentiment.total_mentions_24h || 0}\n` +
               `Influencers: ${sentiment.influencer_mentions_24h || 0}`,
        inline: true
      });
    }

    // ML prediction if available
    if (analysis.ml_rug_probability !== null) {
      const rugRisk = analysis.ml_rug_probability * 100;
      embed.addFields({
        name: '🤖 AI Risk Score',
        value: `Rug probability: ${rugRisk.toFixed(1)}%\n` +
               `Confidence: ${((analysis.ml_confidence || 0) * 100).toFixed(0)}%`,
        inline: true
      });
    }

    embed.setTimestamp(new Date(analysis.analyzed_at));
    embed.setFooter({ text: `Source: ${analysis.source} | Analyzed` });

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error('Error in /analyze command:', error);
    await interaction.editReply({
      content: '❌ An error occurred while analyzing the token.'
    });
  }
}
