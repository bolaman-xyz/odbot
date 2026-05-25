const { SlashCommandBuilder } = require('@discordjs/builders');
const Discord = require("discord.js");
const fs = require('fs');
const yaml = require("js-yaml");
const config = yaml.load(fs.readFileSync('./config.yml', 'utf8'));
const commands = yaml.load(fs.readFileSync('./commands.yml', 'utf8'));
const { getStaffStats, getStaffMemberStats } = require("../../staffStats.js");
const staffStatsModel = require("../../models/staffStatsModel");
const utils = require("../../utils.js");

module.exports = {
    enabled: commands.General.StaffStats.Enabled,
    data: new SlashCommandBuilder()
        .setName('staffstats')
        .setDescription(commands.General.StaffStats.Description)
        .addSubcommand(subcommand =>
            subcommand
                .setName('me')
                .setDescription('View your own support statistics')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('user')
                .setDescription('View statistics for another staff member')
                .addUserOption(option =>
                    option
                        .setName('member')
                        .setDescription('Select a staff member')
                        .setRequired(true)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('leaderboard')
                .setDescription('View staff leaderboard')
                .addStringOption(option =>
                    option
                        .setName('timeframe')
                        .setDescription('Select timeframe')
                        .setRequired(false)
                        .addChoices(
                            { name: 'All Time', value: 'lifetime' },
                            { name: 'This Week', value: 'weekly' },
                            { name: 'This Month', value: 'monthly' },
                            { name: 'This Year', value: 'yearly' }
                        )
                )
                .addStringOption(option =>
                    option
                        .setName('sort')
                        .setDescription('Sort staff by')
                        .setRequired(false)
                        .addChoices(
                            { name: 'Claims', value: 'claims' },
                            { name: 'Messages', value: 'messages' },
                            { name: 'Closed Tickets', value: 'closedTickets' },
                            { name: 'Avg. Response Time', value: 'responseTime' },
                            { name: 'Avg. Rating', value: 'rating' }
                        )
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('reset')
                .setDescription('Reset staff statistics (Admin only)')
                .addStringOption(option =>
                    option
                        .setName('timeframe')
                        .setDescription('Timeframe to reset')
                        .setRequired(true)
                        .addChoices(
                            { name: 'Weekly', value: 'weekly' },
                            { name: 'Monthly', value: 'monthly' },
                            { name: 'Yearly', value: 'yearly' },
                            { name: 'All Data', value: 'lifetime' }
                        )
                )
                .addUserOption(option =>
                    option
                        .setName('member')
                        .setDescription('Reset stats for specific staff member (optional)')
                        .setRequired(false)
                )
        ),
    async execute(interaction, client) {
        await interaction.deferReply({ flags: Discord.MessageFlags.Ephemeral });

        if (!config.StaffRoles || !config.StaffRoles.length) {
            return interaction.editReply({
                content: "❌ Staff roles are not configured in the config.yml file."
            });
        }

        const hasStaffRole = interaction.member.roles.cache.some(role => 
            config.StaffRoles.includes(role.id) || config.StaffRoles.includes(role.name)
        );
        const isAdmin = interaction.member.permissions.has(Discord.PermissionFlagsBits.Administrator);

        const subcommand = interaction.options.getSubcommand();
        
        if (subcommand === 'me') {
            if (!hasStaffRole && !isAdmin) {
                return interaction.editReply({
                    content: "❌ You don't have permission to use this command. Only support staff can view statistics."
                });
            }
        } else {
            if (!hasStaffRole && !isAdmin) {
                return interaction.editReply({
                    content: "❌ You don't have permission to use this command."
                });
            }
        }

        try {
            switch(subcommand) {
                case 'me':
                    await showPersonalStats(interaction);
                    break;
                case 'user':
                    const targetUser = interaction.options.getUser('member');
                    const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);

                    const targetMessage = {
                        member: targetMember,
                        guild: interaction.guild,
                        channel: interaction.channel
                    };

                    const targetSupportRole = await utils.checkIfUserHasSupportRoles(null, targetMessage);

                    if (!targetSupportRole) {
                        return interaction.editReply({
                            content: `❌ ${targetUser.username} is not a support staff member.`
                        });
                    }

                    await showUserStats(interaction, targetUser);
                    break;
                case 'leaderboard':
                    const timeframe = interaction.options.getString('timeframe') || 'lifetime';
                    const sortBy = interaction.options.getString('sort') || 'claims';
                    await showLeaderboard(interaction, timeframe, sortBy);
                    break;
                case 'reset':
                    if (!isAdmin) {
                        return interaction.editReply({
                            content: "❌ Only administrators can reset statistics."
                        });
                    }
                    const resetTimeframe = interaction.options.getString('timeframe');
                    const resetUser = interaction.options.getUser('member');
                    await handleReset(interaction, resetUser, resetTimeframe);
                    break;
            }
        } catch (error) {
            console.error("Error in staffstats command:", error);
            return interaction.editReply({
                content: "❌ An error occurred while processing the command."
            }).catch(() => {});
        }
    }
};

async function showPersonalStats(interaction) {
    const staffMember = await getStaffMemberStats(interaction.user.id);

    if (!staffMember) {
        return interaction.editReply({
            content: `📊 You don't have any statistics recorded yet. Start handling tickets to collect data!`
        });
    }

    const statsEmbed = createStatsEmbed(staffMember, interaction.user);
    return interaction.editReply({ embeds: [statsEmbed] });
}

async function showUserStats(interaction, targetUser) {
    const staffMember = await getStaffMemberStats(targetUser.id);

    if (!staffMember) {
        return interaction.editReply({
            content: `📊 ${targetUser.username} doesn't have any statistics recorded yet.`
        });
    }

    const statsEmbed = createStatsEmbed(staffMember, targetUser);
    return interaction.editReply({ embeds: [statsEmbed] });
}

async function showLeaderboard(interaction, timeframe, sortBy) {
    const staffMembers = await getStaffStats(timeframe, sortBy);
    
    if (!staffMembers || staffMembers.length === 0) {
        return interaction.editReply({
            content: "📊 No staff statistics found yet. Start handling tickets to collect data!"
        });
    }
    
    const leaderboardEmbed = createLeaderboardEmbed(staffMembers, timeframe, sortBy);
    return interaction.editReply({ embeds: [leaderboardEmbed] });
}

async function handleReset(interaction, targetUser, timeframe) {
    if (targetUser) {
        const staffMember = await staffStatsModel.findOne({ userID: targetUser.id });
        
        if (!staffMember) {
            return interaction.editReply({
                content: `❌ No statistics found for ${targetUser.username}.`
            });
        }
        
        await performReset(staffMember, timeframe);
        return interaction.editReply({
            content: `✅ Successfully reset ${timeframe} statistics for ${targetUser.username}.`
        });
    } else {
        if (timeframe === 'lifetime') {
            await staffStatsModel.deleteMany({});
            return interaction.editReply({
                content: "✅ Successfully reset all staff statistics."
            });
        } else {
            const allStaff = await staffStatsModel.find({});
            
            for (const staff of allStaff) {
                await performReset(staff, timeframe);
            }
            
            return interaction.editReply({
                content: `✅ Successfully reset ${timeframe} statistics for all staff members.`
            });
        }
    }
}

async function performReset(staffMember, timeframe) {
    const now = new Date();
    
    if (timeframe === 'weekly') {
        const currentWeek = staffMember.weekly.find(w => {
            const weekEnd = new Date(w.endDate);
            return weekEnd >= now;
        });
        
        if (currentWeek) {
            currentWeek.messages = 0;
            currentWeek.claims = 0;
            currentWeek.closedTickets = 0;
            currentWeek.responseTime = 0;
            currentWeek.ratings = 0;
            currentWeek.ratingScore = 0;
            currentWeek.averageRating = 0;
        }
    } else if (timeframe === 'monthly') {
        const currentMonth = staffMember.monthly.find(m => {
            const monthEnd = new Date(m.endDate);
            return monthEnd >= now;
        });
        
        if (currentMonth) {
            currentMonth.messages = 0;
            currentMonth.claims = 0;
            currentMonth.closedTickets = 0;
            currentMonth.responseTime = 0;
            currentMonth.ratings = 0;
            currentMonth.ratingScore = 0;
            currentMonth.averageRating = 0;
        }
    } else if (timeframe === 'yearly') {
        const currentYear = staffMember.yearly.find(y => {
            const yearEnd = new Date(y.endDate);
            return yearEnd >= now;
        });
        
        if (currentYear) {
            currentYear.messages = 0;
            currentYear.claims = 0;
            currentYear.closedTickets = 0;
            currentYear.responseTime = 0;
            currentYear.ratings = 0;
            currentYear.ratingScore = 0;
            currentYear.averageRating = 0;
        }
    } else if (timeframe === 'lifetime') {
        staffMember.totalMessages = 0;
        staffMember.totalClaims = 0;
        staffMember.totalClosedTickets = 0;
        staffMember.averageResponseTime = 0;
        staffMember.totalRatings = 0;
        staffMember.totalRatingScore = 0;
        staffMember.averageRating = 0;
        staffMember.ticketsHistory = [];
        staffMember.weekly = [];
        staffMember.monthly = [];
        staffMember.yearly = [];
    }
    
    await staffMember.save();
    return staffMember;
}

function createStatsEmbed(staffMember, user) {
    const statsEmbed = new Discord.EmbedBuilder()
        .setColor(config.EmbedColors)
        .setAuthor({
            name: `${user.username}'s Support Statistics`,
            iconURL: user.displayAvatarURL({ dynamic: true })
        })
        .setThumbnail(user.displayAvatarURL({ dynamic: true, size: 256 }))
    
    let lifetimeStats = '';
    lifetimeStats += `> 🎟️ **Claims:** \`${staffMember.totalClaims.toLocaleString('en-US')}\`\n`;
    lifetimeStats += `> ✅ **Closed:** \`${staffMember.totalClosedTickets.toLocaleString('en-US')}\`\n`;
    lifetimeStats += `> 💬 **Messages:** \`${staffMember.totalMessages.toLocaleString('en-US')}\`\n`;
    lifetimeStats += `> ⏱️ **Avg. Response Time:** \`${formatTime(staffMember.averageResponseTime)}\``;
    
    if (staffMember.totalRatings && staffMember.totalRatings > 0) {
        const stars = "⭐".repeat(Math.round(staffMember.averageRating));
        lifetimeStats += `\n> ${stars} **Avg. Rating:** \`${staffMember.averageRating.toFixed(1)}/5\` (${staffMember.totalRatings} reviews)`;
    }
    
    statsEmbed.addFields({
        name: `🏆 All-Time Statistics`,
        value: lifetimeStats
    });
    
    if (staffMember.currentWeek) {
        let weeklyStats = '';
        weeklyStats += `> 🎟️ **Claims:** \`${staffMember.currentWeek.claims.toLocaleString('en-US')}\`\n`;
        weeklyStats += `> ✅ **Closed:** \`${staffMember.currentWeek.closedTickets.toLocaleString('en-US')}\`\n`;
        weeklyStats += `> 💬 **Messages:** \`${staffMember.currentWeek.messages.toLocaleString('en-US')}\`\n`;
        weeklyStats += `> ⏱️ **Avg. Response Time:** \`${formatTime(staffMember.currentWeek.responseTime)}\``;
        
        if (staffMember.currentWeek.ratings && staffMember.currentWeek.ratings > 0) {
            const weekStars = "⭐".repeat(Math.round(staffMember.currentWeek.averageRating));
            weeklyStats += `\n> ${weekStars} **Avg. Rating:** \`${staffMember.currentWeek.averageRating.toFixed(1)}/5\` (${staffMember.currentWeek.ratings} reviews)`;
        }
        
        statsEmbed.addFields({
            name: `📅 This Week's Statistics`,
            value: weeklyStats
        });
    }
    
    if (staffMember.currentMonth) {
        const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
        
        let monthlyStats = '';
        monthlyStats += `> 🎟️ **Claims:** \`${staffMember.currentMonth.claims.toLocaleString('en-US')}\`\n`;
        monthlyStats += `> ✅ **Closed:** \`${staffMember.currentMonth.closedTickets.toLocaleString('en-US')}\`\n`;
        monthlyStats += `> 💬 **Messages:** \`${staffMember.currentMonth.messages.toLocaleString('en-US')}\`\n`;
        monthlyStats += `> ⏱️ **Avg. Response Time:** \`${formatTime(staffMember.currentMonth.responseTime)}\``;
        
        if (staffMember.currentMonth.ratings && staffMember.currentMonth.ratings > 0) {
            const monthStars = "⭐".repeat(Math.round(staffMember.currentMonth.averageRating));
            monthlyStats += `\n> ${monthStars} **Rating:** \`${staffMember.currentMonth.averageRating.toFixed(1)}/5\` (${staffMember.currentMonth.ratings} reviews)`;
        }
        
        statsEmbed.addFields({
            name: `📆 This Month's Statistics (${monthNames[staffMember.currentMonth.month]})`,
            value: monthlyStats
        });
    }
    
    const lastActive = staffMember.lastActive ? 
        `Last active <t:${Math.floor(new Date(staffMember.lastActive).getTime() / 1000)}:R>` :
        'No recent activity';
    
    statsEmbed.setDescription(`${lastActive}\n`)
    
    return statsEmbed;
}

function createLeaderboardEmbed(staffMembers, timeframe, sortBy) {
    const leaderboardEmbed = new Discord.EmbedBuilder()
        .setColor(config.EmbedColors)
        .setAuthor({
            name: `Staff Leaderboard - ${getTimeframeTitle(timeframe)} - ${getSortTitle(sortBy)}`,
        })
        .setTimestamp();
    
    const topStaff = staffMembers.slice(0, 10);
    
    let leaderboardContent = '';
    
    topStaff.forEach((staff, index) => {
        let value;
        
        if (timeframe === 'weekly') {
            if (staff.currentWeek) {
                value = sortBy === 'messages' ? staff.currentWeek.messages : 
                       sortBy === 'claims' ? staff.currentWeek.claims : 
                       sortBy === 'responseTime' ? staff.currentWeek.responseTime : 
                       sortBy === 'rating' ? staff.currentWeek.averageRating :
                       staff.currentWeek.closedTickets;
            } else {
                value = 0;
            }
        } else if (timeframe === 'monthly') {
            if (staff.currentMonth) {
                value = sortBy === 'messages' ? staff.currentMonth.messages : 
                       sortBy === 'claims' ? staff.currentMonth.claims : 
                       sortBy === 'responseTime' ? staff.currentMonth.responseTime : 
                       sortBy === 'rating' ? staff.currentMonth.averageRating :
                       staff.currentMonth.closedTickets;
            } else {
                value = 0;
            }
        } else if (timeframe === 'yearly') {
            if (staff.currentYear) {
                value = sortBy === 'messages' ? staff.currentYear.messages : 
                       sortBy === 'claims' ? staff.currentYear.claims : 
                       sortBy === 'responseTime' ? staff.currentYear.responseTime : 
                       sortBy === 'rating' ? staff.currentYear.averageRating :
                       staff.currentYear.closedTickets;
            } else {
                value = 0;
            }
        } else {
            value = sortBy === 'messages' ? staff.totalMessages : 
                   sortBy === 'claims' ? staff.totalClaims : 
                   sortBy === 'responseTime' ? staff.averageResponseTime : 
                   sortBy === 'rating' ? staff.averageRating :
                   staff.totalClosedTickets;
        }
        
        const medal = index === 0 ? '🥇' : 
                     index === 1 ? '🥈' : 
                     index === 2 ? '🥉' : 
                     `\`${index + 1}.\``;
        
        if (sortBy === 'responseTime') {
            leaderboardContent += `${medal} <@${staff.userID}> • \`${formatTime(value)}\` response time\n`;
        } else if (sortBy === 'rating') {
            if (value === 0) {
                leaderboardContent += `${medal} <@${staff.userID}> • \`No ratings\`\n`;
            } else {
                const stars = "⭐".repeat(Math.round(value));
                leaderboardContent += `${medal} <@${staff.userID}> • ${stars} \`${value.toFixed(1)}/5\`\n`;
            }
        } else {
            const sortLabel = sortBy === 'messages' ? 'messages' : 
                           sortBy === 'claims' ? 'claims' : 'closed tickets';
            
            leaderboardContent += `${medal} <@${staff.userID}> • \`${value.toLocaleString('en-US')}\` ${sortLabel}\n`;
        }
    });
    
    if (leaderboardContent === '') {
        leaderboardContent = '> No staff members found with statistics.';
    }
    
    leaderboardEmbed.setDescription(leaderboardContent);
    
    return leaderboardEmbed;
}

function getTimeframeTitle(timeframe) {
    switch (timeframe) {
        case 'weekly': return 'Weekly';
        case 'monthly': return 'Monthly';
        case 'yearly': return 'Yearly';
        default: return 'All Time';
    }
}

function getSortTitle(sortBy) {
    switch (sortBy) {
        case 'messages': return 'Messages Sent';
        case 'claims': return 'Ticket Claims';
        case 'closedTickets': return 'Tickets Closed';
        case 'responseTime': return 'Response Time';
        case 'rating': return 'Customer Rating';
        default: return 'Ticket Claims';
    }
}

function formatTime(milliseconds) {
    if (!milliseconds) return '0s';
    
    const seconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) {
        return `${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
        return `${minutes}m ${seconds % 60}s`;
    } else {
        return `${seconds}s`;
    }
}