/**
 * /track command - Add token to watchlist
 */

import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import { supabase } from '../index.js';

export const data = new SlashCommandBuilder()
  .setName('track')
  .setDescription('Add a token to your watchlist')
  .addStringOption(option =>
    option
      .setName('address')
      .setDescription('Token mint address')
      .setRequired(true)
  )
  .addIntegerOption(option =>
    option
      .setName('threshold')
      .setDescription('Alert threshold (% price change, default: 10)')
      .setRequired(false)
      .setMinValue(1)
      .setMaxValue(100)
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  const address = interaction.options.getString('address', true);
  const threshold = interaction.options.getInteger('threshold') || 10;

  await interaction.deferReply({ ephemeral: true });

  try {
    const userId = interaction.user.id;
    const guildId = interaction.guildId;

    // Check if token exists in analyzed_tokens
    const { data: token, error: tokenError } = await supabase
      .from('analyzed_tokens')
      .select('symbol, name')
      .eq('mint', address)
      .order('analyzed_at', { ascending: false })
      .limit(1)
      .single();

    // Check if already tracking
    const { data: existing } = await supabase
      .from('discord_watchlist')
      .select('id')
      .eq('user_id', userId)
      .eq('token_mint', address)
      .single();

    if (existing) {
      await interaction.editReply({
        content: `⭐ You're already tracking this token!\n\`${address}\``
      });
      return;
    }

    // Add to watchlist
    const { error: insertError } = await supabase
      .from('discord_watchlist')
      .insert({
        guild_id: guildId,
        user_id: userId,
        token_mint: address,
        symbol: token?.symbol,
        name: token?.name,
        alert_threshold_percent: threshold
      });

    if (insertError) throw insertError;

    await interaction.editReply({
      content: `✅ Added to watchlist!\n\n` +
               `**${token?.symbol || 'Token'}**${token?.name ? ` • ${token.name}` : ''}\n` +
               `\`${address}\`\n\n` +
               `You'll receive alerts for price changes ≥ ±${threshold}%`
    });
  } catch (error) {
    console.error('Error in /track command:', error);
    await interaction.editReply({
      content: '❌ An error occurred while adding the token to your watchlist.'
    });
  }
}
