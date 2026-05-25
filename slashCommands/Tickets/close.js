const { SlashCommandBuilder } = require('@discordjs/builders');
const { Discord, EmbedBuilder, MessageFlags } = require("discord.js");
const fs = require('fs');
const yaml = require("js-yaml")
const config = yaml.load(fs.readFileSync('./config.yml', 'utf8'))
const commands = yaml.load(fs.readFileSync('./commands.yml', 'utf8'))
const utils = require("../../utils.js");
const ticketModel = require("../../models/ticketModel");

module.exports = {
    enabled: commands.Ticket.Close.Enabled,
    data: new SlashCommandBuilder()
        .setName('close')
        .setDescription(commands.Ticket.Close.Description)
        .addStringOption(option => 
          option.setName('reason')
              .setDescription('Reason for closing the ticket')
              .setRequired(config.TicketSettings.TicketCloseReason)
      ),
    async execute(interaction, client) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      
      const ticketDB = await ticketModel.findOne({ channelID: interaction.channel.id });
      if(!ticketDB) return interaction.editReply({ content: config.Locale.NotInTicketChannel, flags: MessageFlags.Ephemeral })

      let supportRole = await utils.checkIfUserHasSupportRoles(interaction, null);

      if (config.TicketSettings.RestrictTicketClose && !supportRole) {
        return interaction.editReply({ content: config.Locale.restrictTicketClose, flags: MessageFlags.Ephemeral });
      }

      let closeReason = interaction.options.getString('reason') || "No reason provided.";

      await ticketModel.updateOne(
        { channelID: interaction.channel.id },
        { 
            $set: {
                closeUserID: interaction.user.id, 
                closedAt: Date.now(),
                closeReason: closeReason
            }
        }
      );

      if (config.ArchiveSystem?.Enabled) {
        const updatedTicketDB = await ticketModel.findOne({ channelID: interaction.channel.id });
        await utils.archiveTicket(interaction, updatedTicketDB, client);
      } else {
        await client.emit('ticketClose', interaction);
      }
    }
}