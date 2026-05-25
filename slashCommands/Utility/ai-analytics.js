const { SlashCommandBuilder } = require('@discordjs/builders');
const { EmbedBuilder, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const fs = require('fs');
const yaml = require("js-yaml");
const AIAutoResponseModel = require('../../models/aiAutoResponseModel');
const config = yaml.load(fs.readFileSync('./config.yml', 'utf8'))
const commands = yaml.load(fs.readFileSync('./commands.yml', 'utf8'))
const utils = require("../../utils.js");

module.exports = {
    enabled: commands.Utility.AIAnalytics.Enabled,
    data: new SlashCommandBuilder()
        .setName('ai-analytics')
        .setDescription(commands.Utility.AIAnalytics.Description)
        .addSubcommand(subcommand =>
            subcommand
                .setName('overview')
                .setDescription('View overall AI response statistics'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('responses')
                .setDescription('View statistics for each response type'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('accuracy')
                .setDescription('View AI response accuracy and user feedback'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('monthly')
                .setDescription('View monthly AI response report')
                .addIntegerOption(option => 
                    option.setName('month')
                        .setDescription('Month (1-12)')
                        .setRequired(false))
                .addIntegerOption(option => 
                    option.setName('year')
                        .setDescription('Year (e.g., 2024)')
                        .setRequired(false))),

    async execute(interaction) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        let supportRole = await utils.checkIfUserHasSupportRoles(interaction, null);
        if(!supportRole) return interaction.reply({ content: config.Locale.NoPermsMessage, flags: MessageFlags.Ephemeral })

        const subcommand = interaction.options.getSubcommand();

        try {
            switch (subcommand) {
                case 'overview':
                    await handleOverview(interaction, config);
                    break;
                case 'responses':
                    await handleResponses(interaction, config);
                    break;
                case 'accuracy':
                    await handleAccuracy(interaction, config);
                    break;
                case 'monthly':
                    await handleMonthly(interaction, config);
                    break;
            }
        } catch (error) {
            console.error('AI Analytics Error:', error);
            await interaction.editReply({ 
                content: "An error occurred while fetching analytics data.",
                flags: MessageFlags.Ephemeral 
            });
        }
    }
};

async function handleOverview(interaction, config) {
    const totalResponses = await AIAutoResponseModel.countDocuments();
    const totalFeedback = await AIAutoResponseModel.countDocuments({ userFeedback: { $ne: null } });
    const helpfulResponses = await AIAutoResponseModel.countDocuments({ userFeedback: 'helpful' });
    
    const avgConfidence = await AIAutoResponseModel.aggregate([
        { $group: { _id: null, avgConfidence: { $avg: "$aiConfidence" } } }
    ]);

    const thisMonth = new Date();
    const monthlyResponses = await AIAutoResponseModel.countDocuments({
        month: thisMonth.getMonth() + 1,
        year: thisMonth.getFullYear()
    });

    const embed = new EmbedBuilder()
        .setColor('#00FF7F')
        .setTitle('🤖 AI AutoResponse Analytics Overview')
        .setTimestamp();

    let content = '';
    content += `> **Total Responses:** \`${totalResponses}\`\n`;
    content += `> **This Month:** \`${monthlyResponses}\`\n`;
    content += `> **User Feedback:** \`${totalFeedback}\` responses\n`;
    content += `> **Helpful Responses:** \`${helpfulResponses}\` (${totalFeedback > 0 ? ((helpfulResponses / totalFeedback) * 100).toFixed(1) : 0}%)\n`;
    content += `> **Average Confidence:** \`${avgConfidence[0] ? (avgConfidence[0].avgConfidence * 100).toFixed(1) : 0}%\``;

    embed.addFields([{
        name: '`📊` **System Performance**',
        value: content
    }]);

    embed.setFooter({ text: 'AI Analytics • Overall Statistics' });

    await interaction.editReply({ embeds: [embed] });
}

async function handleResponses(interaction, config) {
    const responseStats = await AIAutoResponseModel.aggregate([
        {
            $group: {
                _id: "$responseKey",
                count: { $sum: 1 },
                avgConfidence: { $avg: "$aiConfidence" },
                helpfulCount: {
                    $sum: { $cond: [{ $eq: ["$userFeedback", "helpful"] }, 1, 0] }
                },
                totalFeedback: {
                    $sum: { $cond: [{ $ne: ["$userFeedback", null] }, 1, 0] }
                }
            }
        },
        { $sort: { count: -1 } }
    ]);

    if (responseStats.length === 0) {
        const embed = new EmbedBuilder()
            .setColor('#5865F2')
            .setTitle('📋 AI Response Type Statistics')
            .setDescription('No AI responses recorded yet.')
            .setTimestamp();
        return interaction.editReply({ embeds: [embed] });
    }

    const itemsPerPage = 10;
    const totalPages = Math.ceil(responseStats.length / itemsPerPage);
    let currentPage = 0;

    const generateEmbed = (page) => {
        const start = page * itemsPerPage;
        const end = start + itemsPerPage;
        const pageStats = responseStats.slice(start, end);

        const embed = new EmbedBuilder()
            .setColor('#5865F2')
            .setTitle('📋 AI Response Type Statistics')
            .setTimestamp();

        let content = '';
        pageStats.forEach(stat => {
            const helpfulRate = stat.totalFeedback > 0 ? (stat.helpfulCount / stat.totalFeedback * 100).toFixed(1) : 'N/A';
            content += `> **${stat._id}**\n`;
            content += `> ├ Uses: \`${stat.count}\`\n`;
            content += `> ├ Avg Confidence: \`${(stat.avgConfidence * 100).toFixed(1)}%\`\n`;
            content += `> └ Helpful Rate: \`${helpfulRate}%\` (${stat.helpfulCount}/${stat.totalFeedback})\n\n`;
        });

        embed.addFields([{
            name: '`🎯` **Response Performance**',
            value: content
        }]);

        embed.setFooter({ text: `Page ${page + 1} of ${totalPages} • ${responseStats.length} total responses` });

        return embed;
    };

    const generateButtons = (page) => {
        const row = new ActionRowBuilder();
        
        const prevButton = new ButtonBuilder()
            .setCustomId('prev_page')
            .setLabel('Previous')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('⬅️')
            .setDisabled(page === 0);

        const nextButton = new ButtonBuilder()
            .setCustomId('next_page')
            .setLabel('Next')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('➡️')
            .setDisabled(page === totalPages - 1);

        const pageButton = new ButtonBuilder()
            .setCustomId('page_info')
            .setLabel(`${page + 1}/${totalPages}`)
            .setStyle(ButtonStyle.Primary)
            .setDisabled(true);

        row.addComponents(prevButton, pageButton, nextButton);
        return row;
    };

    const embed = generateEmbed(currentPage);
    const buttons = generateButtons(currentPage);

    const response = await interaction.editReply({ 
        embeds: [embed], 
        components: totalPages > 1 ? [buttons] : [] 
    });

    if (totalPages <= 1) return;

    const collector = response.createMessageComponentCollector({
        time: 300000
    });

    collector.on('collect', async (buttonInteraction) => {
        if (buttonInteraction.user.id !== interaction.user.id) {
            return buttonInteraction.reply({
                content: 'You cannot interact with this button.',
                ephemeral: true
            });
        }

        if (buttonInteraction.customId === 'prev_page') {
            currentPage = Math.max(0, currentPage - 1);
        } else if (buttonInteraction.customId === 'next_page') {
            currentPage = Math.min(totalPages - 1, currentPage + 1);
        }

        const newEmbed = generateEmbed(currentPage);
        const newButtons = generateButtons(currentPage);

        await buttonInteraction.update({
            embeds: [newEmbed],
            components: [newButtons]
        });
    });

    collector.on('end', async () => {
        try {
            const disabledButtons = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('prev_page')
                        .setLabel('Previous')
                        .setStyle(ButtonStyle.Secondary)
                        .setEmoji('⬅️')
                        .setDisabled(true),
                    new ButtonBuilder()
                        .setCustomId('page_info')
                        .setLabel(`${currentPage + 1}/${totalPages}`)
                        .setStyle(ButtonStyle.Primary)
                        .setDisabled(true),
                    new ButtonBuilder()
                        .setCustomId('next_page')
                        .setLabel('Next')
                        .setStyle(ButtonStyle.Secondary)
                        .setEmoji('➡️')
                        .setDisabled(true)
                );

            await interaction.editReply({
                components: [disabledButtons]
            });
        } catch (error) {
            console.error('Error disabling buttons:', error);
        }
    });
}

async function handleAccuracy(interaction, config) {
    const accuracyStats = await AIAutoResponseModel.aggregate([
        {
            $match: { userFeedback: { $ne: null } }
        },
        {
            $group: {
                _id: "$userFeedback",
                count: { $sum: 1 },
                avgConfidence: { $avg: "$aiConfidence" }
            }
        }
    ]);

    const totalWithFeedback = await AIAutoResponseModel.countDocuments({ userFeedback: { $ne: null } });

    const embed = new EmbedBuilder()
        .setColor('#FF6B6B')
        .setTitle('🎯 AI Response Accuracy Analysis')
        .setTimestamp();

    if (accuracyStats.length === 0) {
        embed.setDescription('No user feedback recorded yet.');
        return interaction.editReply({ embeds: [embed] });
    }

    let content = '';
    accuracyStats.forEach(stat => {
        const percentage = ((stat.count / totalWithFeedback) * 100).toFixed(1);
        const emoji = stat._id === 'helpful' ? '✅' : '❌';
        content += `> ${emoji} **${stat._id.replace('_', ' ').toUpperCase()}**\n`;
        content += `> ├ Count: \`${stat.count}\` (${percentage}%)\n`;
        content += `> └ Avg Confidence: \`${(stat.avgConfidence * 100).toFixed(1)}%\`\n\n`;
    });

    embed.addFields([{
        name: '`📈` **User Feedback Breakdown**',
        value: content
    }]);

    embed.setFooter({ text: `Total Feedback Responses: ${totalWithFeedback}` });

    await interaction.editReply({ embeds: [embed] });
}

async function handleMonthly(interaction, config) {
    const month = interaction.options.getInteger('month') || new Date().getMonth() + 1;
    const year = interaction.options.getInteger('year') || new Date().getFullYear();

    const monthlyData = await AIAutoResponseModel.aggregate([
        {
            $match: { month: month, year: year }
        },
        {
            $group: {
                _id: "$responseKey",
                count: { $sum: 1 },
                helpfulCount: {
                    $sum: { $cond: [{ $eq: ["$userFeedback", "helpful"] }, 1, 0] }
                },
                totalFeedback: {
                    $sum: { $cond: [{ $ne: ["$userFeedback", null] }, 1, 0] }
                },
                avgConfidence: { $avg: "$aiConfidence" }
            }
        },
        { $sort: { count: -1 } }
    ]);

    const totalMonthlyResponses = await AIAutoResponseModel.countDocuments({ month: month, year: year });

    const embed = new EmbedBuilder()
        .setColor('#9B59B6')
        .setTitle(`📅 Monthly AI Analytics - ${month}/${year}`)
        .setTimestamp();

    if (monthlyData.length === 0) {
        embed.setDescription(`No AI responses recorded for ${month}/${year}.`);
        return interaction.editReply({ embeds: [embed] });
    }

    let content = '';
    content += `> **Total Responses:** \`${totalMonthlyResponses}\`\n\n`;
    
    monthlyData.forEach(stat => {
        const helpfulRate = stat.totalFeedback > 0 ? (stat.helpfulCount / stat.totalFeedback * 100).toFixed(1) : 'N/A';
        content += `> **${stat._id}**\n`;
        content += `> ├ Uses: \`${stat.count}\`\n`;
        content += `> ├ Helpful Rate: \`${helpfulRate}%\`\n`;
        content += `> └ Avg Confidence: \`${(stat.avgConfidence * 100).toFixed(1)}%\`\n\n`;
    });

    embed.addFields([{
        name: '`📊` **Monthly Response Breakdown**',
        value: content
    }]);

    embed.setFooter({ text: `Analytics for ${month}/${year}` });

    await interaction.editReply({ embeds: [embed] });
}