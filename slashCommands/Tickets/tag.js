const { SlashCommandBuilder } = require('@discordjs/builders');
const Discord = require('discord.js');
const fs = require('fs');
const yaml = require('js-yaml');
const config = yaml.load(fs.readFileSync('./config.yml', 'utf8'));
const commands = yaml.load(fs.readFileSync('./commands.yml', 'utf8'));
const ticketModel = require("../../models/ticketModel");
const utils = require("../../utils.js");

module.exports = {
   enabled: commands.Ticket.Tag.Enabled,
   data: new SlashCommandBuilder()
       .setName('tag')
       .setDescription(commands.Ticket.Tag.Description)
       .addStringOption(option => {
           option.setName('name')
               .setDescription('Tag to send')
               .setRequired(true);
           
           if (config.Tags?.TagsList) {
               for (const [tagId, tagInfo] of Object.entries(config.Tags.TagsList)) {
                   option.addChoices({ name: tagInfo.Title, value: tagId });
               }
           }
           
           return option;
       }),
   async execute(interaction, client) {
       if (!config.Tags?.Enabled) {
           return interaction.reply({
               content: 'The tag system is currently disabled.',
               flags: Discord.MessageFlags.Ephemeral
           });
       }

       const tagId = interaction.options.getString('name');
       const tag = config.Tags.TagsList?.[tagId];

       if (!tag) {
           return interaction.reply({
               content: 'This tag does not exist.',
               flags: Discord.MessageFlags.Ephemeral
           });
       }

       if (tag.RestrictToSupportRoles) {
           let supportRole = await utils.checkIfUserHasSupportRoles(interaction, null);
           if (!supportRole) {
               return interaction.reply({
                   content: config.Locale.NoPermsMessage,
                   flags: Discord.MessageFlags.Ephemeral
               });
           }
       }

       let ticketDB = null;
       if (tag.OnlyInTickets) {
           ticketDB = await ticketModel.findOne({ channelID: interaction.channel.id });
           if (!ticketDB) {
               return interaction.reply({
                   content: config.Locale.NotInTicketChannel,
                   flags: Discord.MessageFlags.Ephemeral
               });
           }
       } else {
           ticketDB = await ticketModel.findOne({ channelID: interaction.channel.id });
       }

       await interaction.deferReply({ ephemeral: false });
       
       try {
           let content = tag.Content;
           
           const now = new Date();
           const formattedDate = now.toLocaleDateString('en-US', { 
               year: 'numeric', 
               month: 'long', 
               day: 'numeric' 
           });
           const formattedTime = now.toLocaleTimeString('en-US', { 
               hour: '2-digit', 
               minute: '2-digit',
               timeZoneName: 'short'
           });
           
           content = content
               .replace(/{server}/g, interaction.guild.name)
               .replace(/{date}/g, formattedDate)
               .replace(/{time}/g, formattedTime);
               
           if (ticketDB) {
               const ticketCreatedDate = new Date(ticketDB.ticketCreationDate);
               const formattedTicketDate = ticketCreatedDate.toLocaleDateString('en-US', { 
                   year: 'numeric', 
                   month: 'long', 
                   day: 'numeric'
               });
               
               let ticketAuthor = `<@${ticketDB.userID}>`;
               
               content = content
                   .replace(/{ticket}/g, `<#${interaction.channel.id}>`)
                   .replace(/{ticket_name}/g, interaction.channel.name)
                   .replace(/{ticket_id}/g, ticketDB.identifier || 'Unknown')
                   .replace(/{ticket_author}/g, ticketAuthor)
                   .replace(/{ticket_category}/g, ticketDB.ticketType || 'Unknown')
                   .replace(/{ticket_created}/g, formattedTicketDate);
           }
           
           const isEmbed = (tag.Type || 'text').toLowerCase() === 'embed';
           
           if (isEmbed) {
               const tagEmbed = new Discord.EmbedBuilder()
                   .setColor(tag.Color || config.EmbedColors)
                   .setDescription(content)
                   .setAuthor({ 
                       name: tag.Title
                   });

               await interaction.editReply({ embeds: [tagEmbed] });
           } else {
               let message = content;
               
               await interaction.editReply({ content: message });
           }
       } catch (error) {
           console.error('Error sending tag:', error);
           await interaction.editReply({
               content: 'There was an error sending this tag. Please contact an administrator.',
               flags: Discord.MessageFlags.Ephemeral
           });
       }
   }
};