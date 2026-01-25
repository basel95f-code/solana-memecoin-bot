/**
 * Button interaction handler
 */

import { ButtonInteraction } from 'discord.js';
import { supabase } from '../index.js';

export async function handleButtonInteraction(interaction: ButtonInteraction) {
  const customId = interaction.customId;

  // Track button
  if (customId.startsWith('track_')) {
    const address = customId.replace('track_', '');
    await handleTrackButton(interaction, address);
  }
  // Untrack button
  else if (customId.startsWith('untrack_')) {
    const address = customId.replace('untrack_', '');
    await handleUntrackButton(interaction, address);
  }
}

async function handleTrackButton(interaction: ButtonInteraction, address: string) {
  await interaction.deferReply({ ephemeral: true });

  try {
    const userId = interaction.user.id;
    const guildId = interaction.guildId;

    // Check if already tracking
    const { data: existing } = await supabase
      .from('discord_watchlist')
      .select('id')
      .eq('user_id', userId)
      .eq('token_mint', address)
      .single();

    if (existing) {
      await interaction.editReply({
        content: `⭐ You're already tracking this token!`
      });
      return;
    }

    // Get token info
    const { data: token } = await supabase
      .from('analyzed_tokens')
      .select('symbol, name')
      .eq('mint', address)
      .order('analyzed_at', { ascending: false })
      .limit(1)
      .single();

    // Add to watchlist
    await supabase
      .from('discord_watchlist')
      .insert({
        guild_id: guildId,
        user_id: userId,
        token_mint: address,
        symbol: token?.symbol,
        name: token?.name,
        alert_threshold_percent: 10
      });

    await interaction.editReply({
      content: `✅ Added **${token?.symbol || 'token'}** to your watchlist!\n\nYou'll receive alerts for ±10% price changes.`
    });
  } catch (error) {
    console.error('Error handling track button:', error);
    await interaction.editReply({
      content: '❌ Failed to add token to watchlist.'
    });
  }
}

async function handleUntrackButton(interaction: ButtonInteraction, address: string) {
  await interaction.deferReply({ ephemeral: true });

  try {
    const userId = interaction.user.id;

    await supabase
      .from('discord_watchlist')
      .delete()
      .eq('user_id', userId)
      .eq('token_mint', address);

    await interaction.editReply({
      content: `✅ Removed from your watchlist.`
    });
  } catch (error) {
    console.error('Error handling untrack button:', error);
    await interaction.editReply({
      content: '❌ Failed to remove token from watchlist.'
    });
  }
}
