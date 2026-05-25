const { SlashCommandBuilder } = require('@discordjs/builders');
const { ActionRowBuilder, ButtonBuilder, EmbedBuilder, SnowflakeUtil, ModalBuilder, MessageFlags, TextInputBuilder, TextInputStyle } = require("discord.js");
const fs = require('fs');
const yaml = require("js-yaml");
const config = yaml.load(fs.readFileSync('./config.yml', 'utf8'));
const commands = yaml.load(fs.readFileSync('./commands.yml', 'utf8'));
const guildModel = require("../../models/guildModel");
const suggestionModel = require("../../models/suggestionModel");
const utils = require("../../utils.js");

module.exports = {
    enabled: commands.General.Suggest.Enabled,
    data: new SlashCommandBuilder()
        .setName('suggest')
        .setDescription(`Submit a suggestion`),
    async execute(interaction, client) {
        if(config.SuggestionSettings.Enabled === false) {
            return interaction.reply({ content: "This command has been disabled in the config!", flags: MessageFlags.Ephemeral });
        }
        
        const modal = new ModalBuilder()
            .setCustomId('suggestionModal')
            .setTitle('Submit a Suggestion');
            
        const suggestionInput = new TextInputBuilder()
            .setCustomId('suggestionInput')
            .setLabel('What would you like to suggest?')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('Enter your suggestion here...')
            .setRequired(true)
            .setMinLength(10)
            .setMaxLength(1000);
            
        const firstActionRow = new ActionRowBuilder().addComponents(suggestionInput);
        
        modal.addComponents(firstActionRow);
        
        await interaction.showModal(modal);
        
        const filter = i => i.customId === 'suggestionModal' && i.user.id === interaction.user.id;
        
        try {
            const modalSubmission = await interaction.awaitModalSubmit({ filter, time: 300000 });
            
            await modalSubmission.deferReply({ flags: MessageFlags.Ephemeral });
            
            const suggestion = modalSubmission.fields.getTextInputValue('suggestionInput');
            
            const suggestChannel = client.channels.cache.get(config.SuggestionSettings.ChannelID);
            if(!suggestChannel) {
                return modalSubmission.editReply({ content: `Suggestion channel has not been setup! Please contact an administrator.`, flags: MessageFlags.Ephemeral });
            }
            
            const suggestionObj = {
                upVotes: 0,
                downVotes: 0
            };
            
            const row = await utils.createSuggestionButtons(suggestionObj);
            
            const statsDB = await guildModel.findOne({ guildID: config.GuildID });
            const avatarUrl = interaction.user.displayAvatarURL({ format: 'png', dynamic: true, size: 1024 });
            
            const embed = new EmbedBuilder()
                .setColor(config.SuggestionStatusesEmbedColors.Pending)
                .setAuthor({ 
                    name: `${config.Locale.newSuggestionTitle} (#${statsDB.totalSuggestions})`,
                })
                .setTimestamp();
                
            let suggestionContent = '';
            suggestionContent += `\`\`\`${suggestion}\`\`\``;
                
            embed.addFields([
                { 
                    name: `\`📝\` **${config.Locale.suggestionTitle}**`,
                    value: suggestionContent
                }
            ]);
            
            let infoContent = '';
            infoContent += `> **${config.Locale.suggestionFrom}** <@!${interaction.user.id}>\n`;
            infoContent += `> **${config.Locale.suggestionUpvotes}** \`0\`\n`;
            infoContent += `> **${config.Locale.suggestionDownvotes}** \`0\``;
            
            if (config.SuggestionSettings.EnableAcceptDenySystem) {
                infoContent += `\n> **${config.Locale.suggestionStatus}** ${config.SuggestionStatuses.Pending}`;
            }
            
            embed.addFields([
                { 
                    name: `\`ℹ️\` **${config.Locale.suggestionInformation}**`,
                    value: infoContent
                }
            ]);
                
            embed.setThumbnail(avatarUrl);
            embed.setFooter({ 
                text: `${interaction.user.username}`, 
                iconURL: interaction.user.displayAvatarURL({ dynamic: true, size: 16 }) 
            });
        
            const nonce = SnowflakeUtil.generate();

            const suggestionMsg = await suggestChannel.send({ 
                embeds: [embed], 
                components: [row], 
                enforceNonce: true, 
                nonce: nonce.toString() 
            });

            const newModel = new suggestionModel({
                msgID: suggestionMsg.id,
                userID: interaction.user.id,
                suggestion: suggestion,
                upVotes: 0,
                downVotes: 0,
                status: "Pending",
                voters: []
            });
            await newModel.save();

            if(config.SuggestionSettings.CreateThreads) {
                await suggestionMsg.startThread({
                    name: `${interaction.user.username}'s suggestion discussion`,
                    autoArchiveDuration: 10080,
                    type: 'GUILD_PUBLIC_THREAD'
                });
            }
        
            statsDB.totalSuggestions++;
            await statsDB.save();
          
            modalSubmission.editReply({ 
                content: config.Locale.suggestionSubmit, 
                flags: MessageFlags.Ephemeral
            });
            
        } catch (error) {
            if (error.code === 'InteractionCollectorError') {
                return console.log(`Modal for suggestion timed out for user ${interaction.user.tag}`);
            }
            console.error('Error handling suggestion modal:', error);
        }
    }
}