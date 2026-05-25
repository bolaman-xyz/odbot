const { Discord, ActionRowBuilder, ButtonBuilder, EmbedBuilder, StringSelectMenuBuilder, Message, MessageAttachment, ModalBuilder, TextInputBuilder } = require("discord.js");
const fs = require('fs');
const yaml = require("js-yaml")
const config = yaml.load(fs.readFileSync('./config.yml', 'utf8'))
const utils = require("../utils.js");
const guildModel = require("../models/guildModel");
const ticketModel = require("../models/ticketModel");
const reviewsModel = require("../models/reviewsModel");
const dashboardModel = require("../models/dashboardModel");

module.exports = async (client, ticketDB, attachment, closeLogMsgID, closeLogChannelID, timestamp, meetsMessageRequirement) => {
    let guild = client.guilds.cache.get(config.GuildID);
    let ticketAuthor = await client.users.cache.get(ticketDB.userID);
    let claimUser = await client.users.cache.get(ticketDB.claimUser);
    let closeReason = ticketDB.closeReason || "No reason provided.";
    const dashboardDB = await dashboardModel.findOne({ guildID: config.GuildID });
    const dashboardExists = await utils.checkDashboard();

    let meetRequirement = true;
    if (config.TicketReviewRequirements && config.TicketReviewRequirements.Enabled) {
        if (ticketDB.messages < config.TicketReviewRequirements.TotalMessages) meetRequirement = false;
    }

    const createCloseEmbed = (isReviewEmbed = false) => {
        const closeEmbed = new EmbedBuilder()
            .setColor(config.EmbedColors)
            .setAuthor({ 
                name: config.Locale.ticketClosedCloseDM,
            })
            .setTimestamp();
        
        if (ticketAuthor && ticketAuthor.avatar) {
            closeEmbed.setThumbnail(`https://cdn.discordapp.com/avatars/${ticketAuthor.id}/${ticketAuthor.avatar}.webp?size=240`);
        }
        
        let mainContent = '';
        
        let messageTemplate = config.TicketUserCloseDM.CloseEmbedMsg;
        
        mainContent += messageTemplate
            .replace(/{guildName}/g, `${guild.name}`)
            .replace(/{closedAt}/g, `<t:${(Date.now() / 1000 | 0)}:R>`)
            .replace(/{close-reason}/g, `${closeReason}`);
        
        if (isReviewEmbed && meetRequirement) {
            const reviewPrompt = config.TicketReviewSettings.ReviewPrompt;
            mainContent += `\n\n${reviewPrompt}`;
        }
        
        closeEmbed.setDescription(mainContent);
        
        closeEmbed.setFooter({ 
            text: `#${ticketDB.identifier} | ${config.Locale.totalMessagesLog} ${ticketDB.messages}`, 
            iconURL: ticketAuthor.avatar ? `https://cdn.discordapp.com/avatars/${ticketAuthor.id}/${ticketAuthor.avatar}.webp?size=16` : null
        });
        
        return closeEmbed;
    };

    const addTicketInfoField = (embed) => {
        if (!config.TicketUserCloseDM.TicketInformation) return embed;
        
        let infoContent = '';
        
        infoContent += `> **${config.Locale.ticketCategory}:** \`${ticketDB.ticketType}\`\n`;
        
        if (config.TicketUserCloseDM.ShowCloseReason) {
            infoContent += `> **${config.Locale.closeReasonDM}:** \`${closeReason}\`\n`;
        }
        
        if (config.TicketUserCloseDM.ShowClosedBy && ticketDB.closeUserID) {
            let closerUser = client.users.cache.get(ticketDB.closeUserID);
            let closerInfo = closerUser ? `<@${closerUser.id}> \`${closerUser.username}\`` : `<@${ticketDB.closeUserID}>`;
            infoContent += `> **${config.Locale.logsClosedBy}:** ${closerInfo}\n`;
        }
        
        if (config.ClaimingSystem && config.ClaimingSystem.Enabled) {
            let claimInfo = claimUser || config.Locale.notClaimedCloseDM;
            if (typeof claimInfo !== 'string') claimInfo = `<@${claimInfo.id}>`;
            infoContent += `> **${config.Locale.claimedByCloseDM}** ${claimInfo}\n`;
        }
        
        infoContent += `> **${config.Locale.totalMessagesLog}** \`${ticketDB.messages}\``;
        
        embed.addFields([
            { 
                name: `\`📋\` **${config.Locale.ticketDetails}**`,
                value: infoContent
            }
        ]);
        
        if (config.TicketUserCloseDM.ShowParticipants && ticketDB.participants && ticketDB.participants.length > 0) {
            let participantsContent = '';
            
            const sortedParticipants = [...ticketDB.participants].sort((a, b) => b.messageCount - a.messageCount);
            
            for (const participant of sortedParticipants) {
                participantsContent += `> <@!${participant.userID}> — **${participant.messageCount}** messages\n`;
            }
            
            embed.addFields([
                { 
                    name: `\`👥\` **${config.Locale.ticketParticipants}**`,
                    value: participantsContent
                }
            ]);
        }
        
        return embed;
    };

    const addTranscript = (embedOptions, dashboardExists) => {
        if (!config.TicketUserCloseDM.SendTranscript) return embedOptions;
        
        if (!meetsMessageRequirement) return embedOptions;
        
        if (dashboardExists) {
            const transcriptLink = `> **[${config.Locale.dmTranscriptClickhere}](${dashboardDB.url}/transcript?channelId=${ticketDB.channelID}&dateNow=${timestamp})**`;
            
            embedOptions.embeds[0].addFields([
                { 
                    name: `\`📝\` **${config.Locale.transcriptButton}**`,
                    value: transcriptLink
                }
            ]);
        } else if (attachment) {
            embedOptions.files = [attachment];
        }
        
        return embedOptions;
    };

    if (ticketAuthor && (config.TicketUserCloseDM.Enabled || config.TicketReviewSettings.Enabled)) {
        try {
            const starMenu = config.TicketReviewSettings.Enabled && meetRequirement ? 
                new ActionRowBuilder().addComponents(
                    new StringSelectMenuBuilder()
                        .setCustomId('ratingSelect')
                        .setPlaceholder(config.Locale.selectReview)
                        .setMinValues(1)
                        .setMaxValues(1)
                        .addOptions([
                            { label: '5 Star', value: 'five_star', emoji: '⭐' },
                            { label: '4 Star', value: 'four_star', emoji: '⭐' },
                            { label: '3 Star', value: 'three_star', emoji: '⭐' },
                            { label: '2 Star', value: 'two_star', emoji: '⭐' },
                            { label: '1 Star', value: 'one_star', emoji: '⭐' },
                        ])
                ) : null;

            let reviewDMUserMsg;

            if (config.TicketReviewSettings.Enabled) {
                const dmCloseReviewEmbed = createCloseEmbed(true);
                addTicketInfoField(dmCloseReviewEmbed);
                
                let embedOptionsReview = { embeds: [dmCloseReviewEmbed] };
                embedOptionsReview = addTranscript(embedOptionsReview, dashboardExists);
                
                if (starMenu && meetRequirement) {
                    embedOptionsReview.components = [starMenu];
                }
                
                await ticketAuthor.send(embedOptionsReview).then(async function (msg) {
                    reviewDMUserMsg = msg.id;
                });
                
                const newModelR = new reviewsModel({
                    ticketCreatorID: ticketAuthor.id,
                    guildID: config.GuildID,
                    ticketChannelID: ticketDB.channelID,
                    userID: ticketAuthor.id,
                    tCloseLogMsgID: closeLogMsgID,
                    tCloseLogChannelID: closeLogChannelID,
                    reviewDMUserMsgID: reviewDMUserMsg,
                    category: ticketDB.ticketType,
                    totalMessages: ticketDB.messages,
                    transcriptID: timestamp,
                });
                await newModelR.save();
            } 
            else if (config.TicketUserCloseDM.Enabled) {
                const dmCloseEmbed = createCloseEmbed(false);
                addTicketInfoField(dmCloseEmbed);
                
                let embedOptions = { embeds: [dmCloseEmbed] };
                embedOptions = addTranscript(embedOptions, dashboardExists);
                
                await ticketAuthor.send(embedOptions);
            }
        } catch (e) {
            if (e.code === 50007 || e.message.includes('Cannot send messages to this user') || e.message.includes('missing access')) {
                console.log('\x1b[33m%s\x1b[0m', "[INFO] I tried to DM a user, but their DM's are locked.");
            } else {
                console.error('\x1b[31m%s\x1b[0m', `[ERROR] An error occurred while sending DM: ${e.message}\n${e.stack}`);
            }
            
            let logMsg = `\n\n[${new Date().toLocaleString()}] [ERROR] ${e.stack}`;
            await fs.appendFile("./logs.txt", logMsg, (e) => {
                if (e) console.log(e);
            });
        }
    }
};