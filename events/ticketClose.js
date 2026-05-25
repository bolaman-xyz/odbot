const { Discord, ActionRowBuilder, ButtonBuilder, EmbedBuilder, StringSelectMenuBuilder, Message, MessageAttachment, ModalBuilder, TextInputBuilder } = require("discord.js");
const fs = require('fs');
const yaml = require("js-yaml")
const config = yaml.load(fs.readFileSync('./config.yml', 'utf8'))
const utils = require("../utils.js");
const guildModel = require("../models/guildModel");
const ticketModel = require("../models/ticketModel");
const reviewsModel = require("../models/reviewsModel");
const dashboardModel = require("../models/dashboardModel");
const { incrementStat } = require("../staffStats.js");

module.exports = async (client, interaction) => {

  const ticketDB = await ticketModel.findOne({ channelID: interaction.channel.id });
  const dashboardDB = await dashboardModel.findOne({ guildID: config.GuildID });

  async function CloseTicket() {
    let ticketAuthor = await client.users.cache.get(ticketDB.userID);
    let closeUserID = await client.users.cache.get(ticketDB.closeUserID);
    let closeReason = ticketDB.closeReason || "No reason provided.";
    let claimUser = await client.users.cache.get(ticketDB.claimUser);
    let totalMessages = ticketDB.messages;

    let attachment = null;
    let timestamp = Date.now();

    if (totalMessages >= config.TicketTranscriptSettings.MessagesRequirement) {
      const transcriptData = await utils.saveTranscript(interaction);
      attachment = transcriptData.attachment;
      timestamp = transcriptData.timestamp;
    }

    let aiSummary = null;
    if (config.AI?.TicketCloseSummaries?.Enabled && config.AI?.TicketCloseSummaries?.IncludeInLogs) {
      try {
        aiSummary = await utils.generateTicketCloseSummary(interaction.channel.id);
      } catch (error) {
        console.error('[TICKET CLOSE] Error generating AI summary:', error);
        aiSummary = config.AI?.TicketCloseSummaries?.DefaultMessage || null;
      }
    }

    const logEmbed = new EmbedBuilder()
      .setColor('#FF5D5D')
      .setAuthor({ name: `${config.Locale.ticketCloseTitle}` })
      .setThumbnail(`https://cdn.discordapp.com/avatars/${ticketAuthor.id}/${ticketAuthor.avatar}.webp?size=240`)
      .setTimestamp();

    let mainContent = '';

    mainContent += `> **${config.Locale.logsTicketAuthor}:** <@!${ticketAuthor.id}> \`${ticketAuthor.username}\`\n`;

    if (closeUserID) {
      mainContent += `> **${config.Locale.logsClosedBy}:** <@!${closeUserID.id}> \`${closeUserID.username}\`\n`;
    }

    if (claimUser && config.ClaimingSystem.Enabled) {
      mainContent += `> **${config.Locale.ticketClaimedBy}:** <@!${claimUser.id}> \`${claimUser.username}\`\n`;
    }

    mainContent += `> **${config.Locale.ticketCategory}:** \`${ticketDB.ticketType}\`\n`;

    if (config.TicketSettings.TicketCloseReason && closeReason) {
      mainContent += `> **${config.Locale.reason}:** ${closeReason}`;
    }

    logEmbed.addFields([
      {
        name: `\`📋\` **${config.Locale.ticketDetails}**`,
        value: mainContent
      }
    ]);

    if (aiSummary && aiSummary.trim() !== '') {
      logEmbed.addFields([
        {
          name: `\`🤖\` **${config.Locale.aiSummary}**`,
          value: `> ${aiSummary}`
        }
      ]);
    }

    if (ticketDB.participants && ticketDB.participants.length > 0) {
      let participantsContent = '';

      const sortedParticipants = [...ticketDB.participants].sort((a, b) => b.messageCount - a.messageCount);

      for (const participant of sortedParticipants) {
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
      text: `#${ticketDB.identifier} | ${config.Locale.totalMessagesLog} ${totalMessages}`,
      iconURL: `https://cdn.discordapp.com/avatars/${ticketAuthor.id}/${ticketAuthor.avatar}.webp?size=16`
    });

    let closeLogMsgID;
    const logsChannel = await utils.getCategoryLogsChannel(interaction.channel.id);

    const dashboardExists = await utils.checkDashboard();
    const meetsMessageRequirement = totalMessages >= config.TicketTranscriptSettings.MessagesRequirement;

    if (logsChannel) {
      const embedOptions = { embeds: [logEmbed] };

      if (meetsMessageRequirement && !dashboardExists && attachment) {
        embedOptions.files = [attachment];
      }

      if (meetsMessageRequirement && dashboardExists &&
        config.TicketTranscriptSettings.TranscriptType === "HTML" &&
        config.TicketTranscriptSettings.SaveInFolder === true) {
        const viewTranscriptButton = new ButtonBuilder()
          .setLabel(config.Locale.viewTranscriptButton)
          .setStyle('Link')
          .setURL(`${dashboardDB.url}/transcript?channelId=${ticketDB.channelID}&dateNow=${timestamp}`)
          .setEmoji('📝');

        const row = new ActionRowBuilder().addComponents(viewTranscriptButton);

        embedOptions.components = [row];
      }

      await logsChannel.send(embedOptions).then(async function (msg) {
        closeLogMsgID = msg.id;
      });
    }

    client.emit('sendUserDM', ticketDB, attachment, closeLogMsgID, logsChannel.id, timestamp, meetsMessageRequirement);

    let dTime = config.TicketSettings.DeleteTime * 1000
    let deleteTicketCountdown = config.Locale.deletingTicketMsg.replace(/{time}/g, `${config.TicketSettings.DeleteTime}`);
    const delEmbed = new EmbedBuilder()
      .setDescription(deleteTicketCountdown)
      .setColor("Red")

    const ticketDeleteButton = new ButtonBuilder()
      .setCustomId('closeTicket')
      .setLabel(config.Locale.CloseTicketButton)
      .setStyle(config.ButtonColors.closeTicket)
      .setEmoji(config.ButtonEmojis.closeTicket)
      .setDisabled(true)

    let row1 = new ActionRowBuilder().addComponents(ticketDeleteButton);

    await interaction.channel.messages.fetch(ticketDB.msgID).then(msg => {
      msg.edit({ components: [row1] })
    })

if (!interaction.dashboard) {
  if (interaction.customId === "closeReason") {
    if (interaction.deferred) await interaction.followUp({ embeds: [delEmbed] });
    if (!interaction.deferred) await interaction.reply({ embeds: [delEmbed] });
  } else {
    await interaction.editReply({ embeds: [delEmbed] });
  }
}

    setTimeout(async () => {
      await incrementStat(closeUserID, 'close', 1, { ticketID: interaction.channel.id }, interaction, null);
      await interaction.channel.delete().catch(e => { })
    }, dTime)

    let logMsg = `\n\n[${new Date().toLocaleString()}] [TICKET CLOSED] A ticket has been successfully closed`;
    fs.appendFile("./logs.txt", logMsg, (e) => {
      if (e) console.log(e);
    });
  }

  CloseTicket()

};