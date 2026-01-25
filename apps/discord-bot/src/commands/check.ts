/**
 * /check command - Quick token safety check
 */

import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { supabase } from '../index.js';

export const data = new SlashCommandBuilder()
  .setName('check')
  .setDescription('Quick safety check for a token')
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
    // Fetch token analysis from database
    const { data: analysis, error } = await supabase
      .from('analyzed_tokens')
      .select('*')
      .eq('mint', address)
      .order('analyzed_at', { ascending: false })
      .limit(1)
      .single();

    if (error || !analysis) {
      await interaction.editReply({
        content: `❌ Token not found. Address: \`${address}\`\n\nThis token hasn't been analyzed yet. Try /analyze for a full scan.`
      });
      return;
    }

    // Build embed
    const riskEmoji = analysis.risk_level === 'LOW' ? '🟢' :
                     analysis.risk_level === 'MEDIUM' ? '🟡' :
                     analysis.risk_level === 'HIGH' ? '🟠' : '🔴';

    const embed = new EmbedBuilder()
      .setColor(analysis.risk_level === 'LOW' ? 0x00FF00 :
               analysis.risk_level === 'MEDIUM' ? 0xFFFF00 :
               analysis.risk_level === 'HIGH' ? 0xFF8800 : 0xFF0000)
      .setTitle(`${riskEmoji} ${analysis.symbol || 'Unknown'} - Safety Check`)
      .setDescription(`**${analysis.name || 'Unknown Token'}**\n\`${address}\``)
      .addFields(
        { name: 'Risk Score', value: `**${analysis.risk_score}/100**`, inline: true },
        { name: 'Risk Level', value: analysis.risk_level, inline: true },
        { name: 'Liquidity', value: `$${(analysis.liquidity_usd || 0).toLocaleString()}`, inline: true },
        { name: 'Holders', value: `${analysis.holder_count || 0}`, inline: true },
        { name: 'Top 10%', value: `${(analysis.top10_percent || 0).toFixed(1)}%`, inline: true },
        { name: 'Safety', value: 
          `${analysis.mint_revoked ? '✅' : '❌'} Mint\n` +
          `${analysis.freeze_revoked ? '✅' : '❌'} Freeze\n` +
          `${analysis.lp_burned_percent > 80 ? '✅' : '❌'} LP Burned`,
          inline: true
        }
      )
      .setTimestamp(new Date(analysis.analyzed_at))
      .setFooter({ text: `Source: ${analysis.source}` });

    // Add buttons
    const row = new ActionRowBuilder<ButtonBuilder>()
      .addComponents(
        new ButtonBuilder()
          .setLabel('Track Token')
          .setCustomId(`track_${address}`)
          .setStyle(ButtonStyle.Primary)
          .setEmoji('⭐'),
        new ButtonBuilder()
          .setLabel('View Chart')
          .setURL(`https://dexscreener.com/solana/${address}`)
          .setStyle(ButtonStyle.Link)
          .setEmoji('📊')
      );

    await interaction.editReply({
      embeds: [embed],
      components: [row]
    });
  } catch (error) {
    console.error('Error in /check command:', error);
    await interaction.editReply({
      content: '❌ An error occurred while checking the token.'
    });
  }
}
