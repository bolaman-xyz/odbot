const { SlashCommandBuilder } = require('@discordjs/builders');
const Discord = require('discord.js');
const fs = require('fs');
const yaml = require('js-yaml');
const config = yaml.load(fs.readFileSync('./config.yml', 'utf8'));
const commands = yaml.load(fs.readFileSync('./commands.yml', 'utf8'));
const ticketModel = require("../../models/ticketModel");
const utils = require("../../utils.js");

module.exports = {
    enabled: commands.Ticket.ChangeCategory.Enabled,
    data: new SlashCommandBuilder()
        .setName('changecategory')
        .setDescription(commands.Ticket.ChangeCategory.Description)
        .addStringOption(option => {
            option.setName('category')
                .setDescription('Select the new ticket category')
                .setRequired(true);
            
            const categories = Object.entries(config.TicketCategories);
            const maxChoices = Math.min(categories.length, 25);
            
            for (let i = 0; i < maxChoices; i++) {
                const [categoryId, category] = categories[i];
                option.addChoices({ name: category.CategoryName, value: categoryId });
            }
            
            return option;
        }), 
    async execute(interaction, client) {
        await interaction.deferReply({ flags: Discord.MessageFlags.Ephemeral });

        let supportRole = await utils.checkIfUserHasSupportRoles(interaction, null);
        if (!supportRole) return interaction.editReply({ content: config.Locale.NoPermsMessage, flags: Discord.MessageFlags.Ephemeral });

        const ticketDB = await ticketModel.findOne({ channelID: interaction.channel.id });
        if (!ticketDB) return interaction.editReply({ content: config.Locale.NotInTicketChannel, flags: Discord.MessageFlags.Ephemeral });

        const newCategoryId = interaction.options.getString('category');
        const newCategoryConfig = config.TicketCategories[newCategoryId];
        
        if (!newCategoryConfig) {
            return interaction.editReply({ content: "Invalid category selected. Please try again.", flags: Discord.MessageFlags.Ephemeral });
        }
        
        if (ticketDB.button === newCategoryId) {
            return interaction.editReply({ content: "This ticket is already in the selected category.", flags: Discord.MessageFlags.Ephemeral });
        }

        try {
            const currentCategoryId = ticketDB.button;
            const currentCategoryConfig = config.TicketCategories[currentCategoryId];
            if (!currentCategoryConfig) {
                return interaction.editReply({ content: "Could not find current ticket category in config. Please contact an administrator.", flags: Discord.MessageFlags.Ephemeral });
            }

            const ticketAuthor = await interaction.guild.members.fetch(ticketDB.userID).catch(() => null);
            
            const ticketChannel = interaction.channel;
            const newDiscordCategory = interaction.guild.channels.cache.get(newCategoryConfig.ParentCategoryID);
            
            if (!newDiscordCategory) {
                return interaction.editReply({ content: "The new category's Discord category could not be found. Please contact an administrator.", flags: Discord.MessageFlags.Ephemeral });
            }

            const processingEmbed = new Discord.EmbedBuilder()
                .setColor(config.EmbedColors || "#075FFF")
                .setTitle("Changing Ticket Category")
                .setDescription(`Changing this ticket from **${currentCategoryConfig.CategoryName}** to **${newCategoryConfig.CategoryName}**...`)
                .setTimestamp()
                .setFooter({ text: interaction.user.tag, iconURL: interaction.user.displayAvatarURL({ dynamic: true }) });

            await interaction.editReply({ embeds: [processingEmbed], flags: Discord.MessageFlags.Ephemeral });

            const notificationEmbed = new Discord.EmbedBuilder()
                .setColor(config.EmbedColors || "#075FFF")
                .setTitle("Ticket Category Changed")
                .setDescription(`This ticket has been moved from **${currentCategoryConfig.CategoryName}** to **${newCategoryConfig.CategoryName}** by ${interaction.user}.`)
                .setTimestamp();

            await ticketChannel.send({ embeds: [notificationEmbed] });

            await ticketChannel.permissionOverwrites.set([
                {
                    id: interaction.guild.id,
                    deny: [Discord.PermissionFlagsBits.ViewChannel]
                }
            ]);
            
            if (ticketAuthor) {
                await ticketChannel.permissionOverwrites.create(ticketAuthor, {
                    ViewChannel: true,
                    SendMessages: true,
                    ReadMessageHistory: true,
                    AttachFiles: true,
                    EmbedLinks: true,
                    AddReactions: true
                });
            }
            
            for (const roleId of newCategoryConfig.SupportRoles) {
                const role = interaction.guild.roles.cache.get(roleId);
                if (role) {
                    await ticketChannel.permissionOverwrites.create(role, {
                        ViewChannel: true,
                        SendMessages: true,
                        ReadMessageHistory: true,
                        AttachFiles: true,
                        EmbedLinks: true,
                        AddReactions: true,
                        ManageMessages: true
                    });
                }
            }
            
            let channelName = newCategoryConfig.ChannelName;
            
            const ticketCreator = await client.users.fetch(ticketDB.userID).catch(() => null);
            if (ticketCreator) {
                channelName = channelName.replace('{username}', ticketCreator.username.toLowerCase());
                channelName = channelName.replace('{user-id}', ticketCreator.id);
            }
            
            const totalTickets = await ticketModel.countDocuments({ guildID: interaction.guild.id });
            channelName = channelName.replace('{total-tickets}', totalTickets.toString());
            
            await ticketChannel.setName(channelName);
            
            await ticketChannel.setParent(newDiscordCategory.id, { lockPermissions: false });
            
            const newChannelTopic = config.TicketSettings.ChannelTopic
                .replace(/{username}/g, ticketCreator ? `<@!${ticketCreator.id}>` : "Unknown User")
                .replace(/{category}/g, newCategoryConfig.CategoryName);
                
            await ticketChannel.setTopic(newChannelTopic);
            
            await ticketModel.findOneAndUpdate(
                { channelID: ticketChannel.id },
                { 
                    ticketType: newCategoryConfig.CategoryName,
                    button: newCategoryId
                }
            );
            
            if (newCategoryConfig.MentionSupportRoles === true) {
                const supportRoleMentions = newCategoryConfig.SupportRoles
                    .map(roleId => {
                        const role = interaction.guild.roles.cache.get(roleId);
                        return role ? `<@&${roleId}>` : null;
                    })
                    .filter(mention => mention !== null)
                    .join(' ');
                
                if (supportRoleMentions.length > 0) {
                    await ticketChannel.send({ content: supportRoleMentions });
                }
            }
            
            const successEmbed = new Discord.EmbedBuilder()
                .setColor("Green")
                .setTitle("Category Changed Successfully")
                .setDescription(`This ticket has been successfully moved to the **${newCategoryConfig.CategoryName}** category.`)
                .setTimestamp()
                .setFooter({ text: interaction.user.tag, iconURL: interaction.user.displayAvatarURL({ dynamic: true }) });

            await interaction.editReply({ embeds: [successEmbed], flags: Discord.MessageFlags.Ephemeral });

        } catch (error) {
            console.error("Error changing ticket category:", error);
            return interaction.editReply({ content: `An error occurred while changing the ticket category: ${error.message}`, flags: Discord.MessageFlags.Ephemeral });
        }
    }
};