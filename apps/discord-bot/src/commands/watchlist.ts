/**
 * /watchlist command - Show user's tracked tokens
 */

import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { supabase } from '../index.js';

export const data = new SlashCommandBuilder()
  .setName('watchlist')
  .setDescription('Show your tracked tokens');

export async function execute(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ ephemeral: true });

  try {
    const userId = interaction.user.id;
    const guildId = interaction.guildId;

    const { data: watchlist, error } = await supabase
      .from('discord_watchlist')
      .select('*')
      .eq('user_id', userId)
      .order('added_at', { ascending: false });

    if (error) throw error;

    if (!watchlist || watchlist.length === 0) {
      await interaction.editReply({
        content: '⭐ Your watchlist is empty.\n\nUse `/track <address>` to add tokens!'
      });
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle(`⭐ Your Watchlist (${watchlist.length} tokens)`)
      .setDescription('Tokens you\'re tracking for alerts')
      .setTimestamp();

    for (const item of watchlist.slice(0, 10)) {
      const alertThreshold = item.alert_threshold_percent || 10;
      
      embed.addFields({
        name: `${item.symbol || 'Unknown'}`,
        value: `\`${item.token_mint}\`\n` +
               `Added: <t:${Math.floor(new Date(item.added_at).getTime() / 1000)}:R>\n` +
               `Alert threshold: ±${alertThreshold}%`,
        inline: false
      });
    }

    if (watchlist.length > 10) {
      embed.setFooter({ text: `Showing 10 of ${watchlist.length} tokens` });
    }

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error('Error in /watchlist command:', error);
    await interaction.editReply({
      content: '❌ An error occurred while fetching your watchlist.'
    });
  }
}
