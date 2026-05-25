const { SlashCommandBuilder } = require('@discordjs/builders');
const { EmbedBuilder, AttachmentBuilder, MessageFlags } = require('discord.js');
const fs = require('fs');
const yaml = require('js-yaml');
const config = yaml.load(fs.readFileSync('./config.yml', 'utf8'));
const commands = yaml.load(fs.readFileSync('./commands.yml', 'utf8'));
const ticketModel = require("../../models/ticketModel");
const utils = require("../../utils.js");

module.exports = {
    enabled: commands.Ticket.Transcript.Enabled,
    data: new SlashCommandBuilder()
        .setName('transcript')
        .setDescription(commands.Ticket.Transcript.Description),
    async execute(interaction, client) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        let supportRole = await utils.checkIfUserHasSupportRoles(interaction, null);
        if (!supportRole) return interaction.editReply({ content: config.Locale.NoPermsMessage, flags: MessageFlags.Ephemeral });

        const ticketDB = await ticketModel.findOne({ channelID: interaction.channel.id });
        if (!ticketDB) return interaction.editReply({ content: config.Locale.NotInTicketChannel, flags: MessageFlags.Ephemeral });

        try {
            const { attachment, timestamp } = await utils.saveTranscript(interaction);
            
            if (!attachment) {
                return interaction.editReply({ 
                    content: config.Locale.transcriptGenerationFailed,
                    flags: MessageFlags.Ephemeral
                });
            }

            const transcriptEmbed = new EmbedBuilder()
                .setColor(config.EmbedColors)
                .setTitle(config.Locale.transcriptTitle)
                .setDescription(
                    (config.Locale.transcriptDescription)
                    .replace(/{identifier}/g, ticketDB.identifier || interaction.channel.name)
                )
                .addFields([
                    { 
                        name: config.Locale.ticketDetails, 
                        value: 
                        `> **${config.Locale.logsTicket}:** <#${interaction.channel.id}>\n` +
                        `> **${config.Locale.ticketCategory}:** \`${ticketDB.ticketType}\`\n` +
                        `> **${config.Locale.logsTicketAuthor}:** <@${ticketDB.userID}>\n` +
                        `> **${config.Locale.ticketCreatedTitle}:** <t:${Math.floor(new Date(ticketDB.createdAt).getTime() / 1000)}:R>`
                    }
                ])
                .setFooter({ 
                    text: (config.Locale.transcriptFooter)
                        .replace(/{user}/g, interaction.user.tag), 
                    iconURL: interaction.user.displayAvatarURL({ dynamic: true }) 
                })
                .setTimestamp();

            const logMsg = `\n\n[${new Date().toLocaleString()}] [TRANSCRIPT GENERATED] User: ${interaction.user.username}, Channel: ${interaction.channel.name}`;
            fs.appendFile("./logs.txt", logMsg, (e) => { 
                if(e) console.log(e);
            });

            await interaction.editReply({ 
                embeds: [transcriptEmbed],
                files: [attachment],
                flags: MessageFlags.Ephemeral
            });
            
            try {
                const logsChannel = await utils.getCategoryLogsChannel(interaction.channel.id);
                
                if(logsChannel) {
                    const logEmbed = new EmbedBuilder()
                        .setColor('#3498DB')
                        .setAuthor({ 
                            name: config.Locale.transcriptLogTitle
                        })
                        .setThumbnail(interaction.user.displayAvatarURL({ format: 'png', dynamic: true, size: 1024 }))
                        .setTimestamp();
                    
                    let mainContent = '';
                    mainContent += `> **${config.Locale.logsExecutor}:** <@!${interaction.user.id}> \`${interaction.user.username}\`\n`;
                    mainContent += `> **${config.Locale.logsTicket}:** <#${interaction.channel.id}> \`#${interaction.channel.name}\`\n`;
                    mainContent += `> **${config.Locale.ticketCategory}:** \`${ticketDB.ticketType}\`\n`;
                    mainContent += `> **${config.Locale.logsTicketAuthor}:** <@!${ticketDB.userID}> \`${await client.users.fetch(ticketDB.userID).then(u => u.username).catch(() => "Unknown User")}\`\n`;
                    mainContent += `> **${config.Locale.totalMessagesLog}** \`${ticketDB.messages || 0}\``;
                    
                    logEmbed.addFields([
                      { 
                        name: `\`📝\` **${config.Locale.transcriptDetails}**`, 
                        value: mainContent 
                      }
                    ]);
                    
                    logEmbed.setFooter({ 
                      text: interaction.user.username, 
                      iconURL: interaction.user.displayAvatarURL({ format: 'png', dynamic: true, size: 16 }) 
                    });
                    
                    await logsChannel.send({ 
                        embeds: [logEmbed],
                        files: [attachment]
                    });
                }
            } catch (logError) {
                console.error("Error sending transcript log:", logError);
            }

        } catch (error) {
            console.error("Error generating transcript:", error);
            return interaction.editReply({ 
                content: config.Locale.transcriptError || `An error occurred while generating the transcript: ${error.message}`,
                flags: MessageFlags.Ephemeral
            });
        }
    }
};