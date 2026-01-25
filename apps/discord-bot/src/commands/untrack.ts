/**
 * /untrack command - Remove token from watchlist
 */

import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import { supabase } from '../index.js';

export const data = new SlashCommandBuilder()
  .setName('untrack')
  .setDescription('Remove a token from your watchlist')
  .addStringOption(option =>
    option
      .setName('address')
      .setDescription('Token mint address')
      .setRequired(true)
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  const address = interaction.options.getString('address', true);

  await interaction.deferReply({ ephemeral: true });

  try {
    const userId = interaction.user.id;

    const { error } = await supabase
      .from('discord_watchlist')
      .delete()
      .eq('user_id', userId)
      .eq('token_mint', address);

    if (error) throw error;

    await interaction.editReply({
      content: `✅ Removed from watchlist\n\`${address}\``
    });
  } catch (error) {
    console.error('Error in /untrack command:', error);
    await interaction.editReply({
      content: '❌ An error occurred while removing the token from your watchlist.'
    });
  }
}
