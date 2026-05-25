const { SlashCommandBuilder } = require('@discordjs/builders');
const Discord = require ("discord.js")
const fs = require('fs');
const yaml = require("js-yaml")
const config = yaml.load(fs.readFileSync('./config.yml', 'utf8'))
const commands = yaml.load(fs.readFileSync('./commands.yml', 'utf8'))
const utils = require("../../utils.js");
const guildModel = require("../../models/guildModel");

module.exports = {
    enabled: commands.General.Stats.Enabled,
    data: new SlashCommandBuilder()
        .setName('stats')
        .setDescription(commands.General.Stats.Description),
    async execute(interaction, client) {
      await interaction.deferReply();
        let statsDB = await guildModel.findOne({ guildID: interaction.guild.id });

        const statsEmbed = new Discord.EmbedBuilder()
        .setColor(config.EmbedColors)
        .setAuthor({ 
          name: config.Locale.guildStatistics,
          iconURL: interaction.guild.iconURL() || null
        })
        .setTimestamp();

        let ticketStats = '';
        ticketStats += `> **${config.Locale.totalTickets}** \`${statsDB.totalTickets.toLocaleString('en-US')}\`\n`;
        ticketStats += `> **${config.Locale.openTickets}** \`${statsDB.openTickets}\`\n`;
        ticketStats += `> **${config.Locale.totalClaims}** \`${statsDB.totalClaims.toLocaleString('en-US')}\`\n`;
        ticketStats += `> **${config.Locale.totalMessagesLog}** \`${statsDB.totalMessages.toLocaleString('en-US')}\`\n`;
        ticketStats += `> **${config.Locale.averageCompletionTime}** \`${statsDB.averageCompletion}\`\n`;
        ticketStats += `> **${config.Locale.averageResponseTime}** \`${statsDB.averageResponse}\``;

        statsEmbed.addFields([
          { 
            name: `\`🎫\` **${config.Locale.statsTickets}**`, 
            value: ticketStats 
          }
        ]);

        if(config.TicketReviewSettings.Enabled) {
          const averageRating = await utils.averageRating(client);
          
          let ratingStats = '';
          ratingStats += `> **${config.Locale.totalReviews}** \`${statsDB.totalReviews}\`\n`;
          ratingStats += `> **${config.Locale.averageRating}** \`${averageRating}/5.0\``;
          
          statsEmbed.addFields([
            { 
              name: `\`⭐\` **${config.Locale.ratingsStats}**`, 
              value: ratingStats 
            }
          ]);
        }

        if(config.SuggestionSettings.Enabled) {
          let suggestionStats = '';
          suggestionStats += `> **${config.Locale.suggestionsTotal}** \`${statsDB.totalSuggestions}\`\n`;
          suggestionStats += `> **${config.Locale.suggestionsTotalUpvotes}** \`${statsDB.totalSuggestionUpvotes}\`\n`;
          suggestionStats += `> **${config.Locale.suggestionsTotalDownvotes}** \`${statsDB.totalSuggestionDownvotes}\``;
          
          statsEmbed.addFields([
            { 
              name: `\`💡\` **${config.Locale.suggestionStatsTitle}**`, 
              value: suggestionStats 
            }
          ]);
        }

        statsEmbed.setFooter({ 
          text: `Requested by: ${interaction.user.username}`, 
          iconURL: interaction.user.displayAvatarURL({ dynamic: true, size: 16 }) 
        });
        
        interaction.editReply({ embeds: [statsEmbed] });
    }
}