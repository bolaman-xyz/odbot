const { SlashCommandBuilder } = require('@discordjs/builders');
const Discord = require ("discord.js")
const fs = require('fs');
const yaml = require("js-yaml")
const config = yaml.load(fs.readFileSync('./config.yml', 'utf8'))
const commands = yaml.load(fs.readFileSync('./commands.yml', 'utf8'))
const utils = require("../../utils.js");
const ticketModel = require("../../models/ticketModel");
const dashboardModel = require("../../models/dashboardModel");

module.exports = {
    enabled: commands.Ticket.Delete.Enabled,
    data: new SlashCommandBuilder()
        .setName('delete')
        .setDescription(commands.Ticket.Delete.Description),
    async execute(interaction, client) {
        await interaction.deferReply({ flags: Discord.MessageFlags.Ephemeral });
        const ticketDB = await ticketModel.findOne({ channelID: interaction.channel.id });
        if(!ticketDB) return interaction.editReply({ content: config.Locale.NotInTicketChannel, flags: Discord.MessageFlags.Ephemeral })
    
        let supportRole = await utils.checkIfUserHasSupportRoles(interaction, null);
        
        if (!supportRole) {
          return interaction.editReply({ content: config.Locale.NoPermsMessage, flags: Discord.MessageFlags.Ephemeral });
        }

        let ticketAuthor = client.users.cache.get(ticketDB.userID)
        const logEmbed = new Discord.EmbedBuilder()
          .setColor('#FF5D5D')
          .setAuthor({ name: `${config.Locale.ticketForceDeleted}` }) 
          .setThumbnail(interaction.user.displayAvatarURL({ format: 'png', dynamic: true, size: 1024 }))
          .setTimestamp();
        
        let mainContent = '';
        
        mainContent += `> **${config.Locale.logsDeletedBy}:** <@!${interaction.user.id}> \`${interaction.user.username}\`\n`;
        mainContent += `> **${config.Locale.logsTicketAuthor}:** <@!${ticketAuthor.id}> \`${ticketAuthor.username}\`\n`;
        mainContent += `> **${config.Locale.logsTicket}:** #${interaction.channel.name} \`${ticketDB.ticketType}\`\n`;
        
        logEmbed.addFields([
          { 
            name: `\`📋\` **${config.Locale.ticketDetails}**`, 
            value: mainContent 
          }
        ]);
        
        if(ticketDB.participants && ticketDB.participants.length > 0) {
          let participantsContent = '';
          
          const sortedParticipants = [...ticketDB.participants].sort((a, b) => b.messageCount - a.messageCount);
          
          for(const participant of sortedParticipants) {
            participantsContent += `> <@!${participant.userID}> — **${participant.messageCount}** messages\n`;
          }
          
          logEmbed.addFields([
            {
              name: `\`👥\` **${config.Locale.ticketParticipants}**`,
              value: participantsContent
            }
          ]);
        }
        
        logEmbed.setFooter({ 
          text: `#${ticketDB.identifier} | ${config.Locale.totalMessagesLog} ${ticketDB.messages}`, 
          iconURL: interaction.user.displayAvatarURL({ format: 'png', dynamic: true, size: 16 })
        });
    
        const { attachment, timestamp } = await utils.saveTranscript(interaction)

        const dashboardExists = await utils.checkDashboard();
        const dashboardDB = await dashboardModel.findOne({ guildID: config.GuildID });

        const logsChannel = await utils.getCategoryLogsChannel(interaction.channel.id);
    
        const embedOptions = { embeds: [logEmbed] };

        const shouldIncludeAttachment = ticketDB.messages >= config.TicketTranscriptSettings.MessagesRequirement && !dashboardExists && !config.TicketSettings.DeleteCommandTranscript

        if (shouldIncludeAttachment) {
            embedOptions.files = [attachment];
        }

              if (dashboardExists && ticketDB.messages >= config.TicketTranscriptSettings.MessagesRequirement && config.TicketTranscriptSettings.TranscriptType === "HTML" && config.TicketTranscriptSettings.SaveInFolder === true ) {
                const viewTranscriptButton = new Discord.ButtonBuilder()
                    .setLabel(config.Locale.viewTranscriptButton)
                    .setStyle('Link')
                    .setURL(`${dashboardDB.url}/transcript?channelId=${ticketDB.channelID}&dateNow=${timestamp}`)
                    .setEmoji('📝');
        
                const row = new Discord.ActionRowBuilder().addComponents(viewTranscriptButton);
        
                embedOptions.components = [row];
            }
        
        if(logsChannel) await logsChannel.send(embedOptions)

        let dTime = config.TicketSettings.DeleteTime * 1000 
        let deleteTicketCountdown = config.Locale.deletingTicketMsg.replace(/{time}/g, `${config.TicketSettings.DeleteTime}`);
        const delEmbed = new Discord.EmbedBuilder()
            .setDescription(deleteTicketCountdown)
            .setColor("Red")
        await interaction.editReply({ embeds: [delEmbed] })
    
        await setTimeout(() => interaction.channel.delete().catch(e => {}), dTime);

    }

}