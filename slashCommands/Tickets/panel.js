const { SlashCommandBuilder } = require('@discordjs/builders');
const { ActionRowBuilder, ButtonBuilder, EmbedBuilder, StringSelectMenuBuilder, ButtonStyle, MessageFlags } = require("discord.js");
const fs = require('fs');
const yaml = require("js-yaml");
const config = yaml.load(fs.readFileSync('./config.yml', 'utf8'));
const commands = yaml.load(fs.readFileSync('./commands.yml', 'utf8'));
const moment = require('moment-timezone');
const ticketPanelModel = require("../../models/ticketPanelModel");

const workingHoursRegex = /^(\d{1,2}:\d{2})-(\d{1,2}:\d{2})$/;

module.exports = {
    enabled: commands.Ticket.Panel.Enabled,
    data: new SlashCommandBuilder()
        .setName('panel')
        .setDescription(commands.Ticket.Panel.Description)
        .addStringOption(option => 
            option.setName('panel_id')
                .setDescription('Select which panel to send')
                .setRequired(true)
                .addChoices(
                    ...Object.keys(config.TicketPanels || {}).map(panelId => ({
                        name: config.TicketPanels[panelId].Name || panelId,
                        value: panelId
                    }))
                )
        ),
    async execute(interaction, client) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        
        if(!interaction.member.permissions.has("ManageMessages")) 
            return interaction.editReply({ content: config.Locale.NoPermsMessage, flags: MessageFlags.Ephemeral });
        
        const panelId = interaction.options.getString('panel_id');
        const panelConfig = config.TicketPanels[panelId];
        
        if (!panelConfig) {
            return interaction.editReply({ 
                content: `Panel with ID ${panelId} not found. Please check your configuration.`, 
                flags: MessageFlags.Ephemeral
            });
        }
        
        const mapButtonColor = (colorName) => {
            const colorMap = {
                "Blurple": ButtonStyle.Primary,
                "Gray": ButtonStyle.Secondary,
                "Green": ButtonStyle.Success,
                "Red": ButtonStyle.Danger
            };
            return colorMap[colorName] || ButtonStyle.Primary;
        };
        
        const buttons = [];
        
        for (const categoryId of panelConfig.Categories) {
            const categoryConfig = config.TicketCategories[categoryId];
            
            if (!categoryConfig) {
                console.log('\x1b[31m%s\x1b[0m', `[WARNING] Category ${categoryId} referenced in panel ${panelId} does not exist!`);
                continue;
            }
            
            categoryConfig.ButtonColor = mapButtonColor(categoryConfig.ButtonColor);
            
            const button = new ButtonBuilder()
                .setCustomId(`ticket-${categoryId}`)
                .setLabel(categoryConfig.CategoryName)
                .setStyle(categoryConfig.ButtonColor);
            
            if (categoryConfig.CategoryEmoji) {
                button.setEmoji(categoryConfig.CategoryEmoji);
            }
            
            buttons.push(button);
        }
        
        const buttonRows = [];
        for (let i = 0; i < buttons.length; i += 5) {
            const row = new ActionRowBuilder().addComponents(...buttons.slice(i, i + 5));
            buttonRows.push(row);
        }
        
// Handle working hours for embed placeholders
let startTimestamp = "Working hours are disabled!";
let endTimestamp = "Working hours are disabled!";

let workingHoursEmbedLocale = panelConfig.Embed.Description;

if (config.WorkingHours && config.WorkingHours.Enabled) {
    const currentDay = moment().tz(config.WorkingHours.Timezone).format('dddd');
    const workingHours = config.WorkingHours.Schedule[currentDay];

    const isDayDisabled = workingHours && 
        (workingHours.toLowerCase() === "disabled" || 
         workingHours.toLowerCase() === "off" ||
         workingHours.toLowerCase() === "closed");

    if (isDayDisabled) {
        startTimestamp = "Closed";
        endTimestamp = "Closed";
    } else if (!workingHours) {
        console.log('\x1b[31m%s\x1b[0m', `[ERROR] Working hours not configured for ${currentDay}. Contact support and provide your config.yml file.`);
        return;
    } else {
        const workingHoursMatch = workingHours.match(workingHoursRegex);

        if (!workingHoursMatch) {
            console.log('\x1b[31m%s\x1b[0m', `[ERROR] Invalid working hours configuration for ${currentDay} (format). Contact support and provide your config.yml file.`);
            return;
        }

        const currentTime = moment().tz(config.WorkingHours.Timezone);
        const startDate = currentTime.format('YYYY-MM-DD');

        const startTime = moment.tz(startDate + ' ' + workingHoursMatch[1], 'YYYY-MM-DD H:mm', config.WorkingHours.Timezone);
        const endTime = moment.tz(startDate + ' ' + workingHoursMatch[2], 'YYYY-MM-DD H:mm', config.WorkingHours.Timezone);

        if (!startTime.isValid() || !endTime.isValid() || startTime.isSameOrAfter(endTime)) {
            console.log('\x1b[31m%s\x1b[0m', `[ERROR] Invalid working hours configuration for ${currentDay}. Contact support and provide your config.yml file.`);
            return;
        }

        startTimestamp = startTime.unix();
        endTimestamp = endTime.unix();
    }
}

workingHoursEmbedLocale = workingHoursEmbedLocale
    .replace(/{workingHours-startTime}/g, `<t:${startTimestamp}:t>`)
    .replace(/{workingHours-endTime}/g, `<t:${endTimestamp}:t>`);

const workingHoursPlaceholders = {};

if (config.WorkingHours && config.WorkingHours.Schedule) {
    for (const day in config.WorkingHours.Schedule) {
        const hours = config.WorkingHours.Schedule[day];
        
        if (hours && (hours.toLowerCase() === "disabled" || 
                     hours.toLowerCase() === "off" || 
                     hours.toLowerCase() === "closed")) {
            workingHoursPlaceholders[`{workingHours-startTime-${day}}`] = "Closed";
            workingHoursPlaceholders[`{workingHours-endTime-${day}}`] = "Closed";
            workingHoursPlaceholders[`{workingHours-startTime-${day}} to {workingHours-endTime-${day}}`] = "Closed";
        } else {
            const match = hours.match(workingHoursRegex);
            if (match) {
                const start = moment.tz(`${moment().format('YYYY-MM-DD')} ${match[1]}`, 'YYYY-MM-DD H:mm', config.WorkingHours.Timezone);
                const end = moment.tz(`${moment().format('YYYY-MM-DD')} ${match[2]}`, 'YYYY-MM-DD H:mm', config.WorkingHours.Timezone);
                workingHoursPlaceholders[`{workingHours-startTime-${day}}`] = `<t:${start.unix()}:t>`;
                workingHoursPlaceholders[`{workingHours-endTime-${day}}`] = `<t:${end.unix()}:t>`;
            } else {
                console.log('\x1b[31m%s\x1b[0m', `[ERROR] Invalid working hours configuration for ${day} (format). Contact support and provide your config.yml file.`);
            }
        }
    }

    function escapeRegExp(string) {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    for (const day in config.WorkingHours.Schedule) {
        const combined = `{workingHours-startTime-${day}} to {workingHours-endTime-${day}}`;
        if (workingHoursPlaceholders[combined]) {
            const pattern = new RegExp(escapeRegExp(combined), 'g');
            workingHoursEmbedLocale = workingHoursEmbedLocale.replace(pattern, workingHoursPlaceholders[combined]);
        }
    }

    for (const [placeholder, value] of Object.entries(workingHoursPlaceholders)) {
        if (!placeholder.includes(" to ")) {
            const pattern = new RegExp(escapeRegExp(placeholder), 'g');
            workingHoursEmbedLocale = workingHoursEmbedLocale.replace(pattern, value);
        }
    }
    
    const currentDay = moment().tz(config.WorkingHours.Timezone).format('dddd');
    const workingHours = config.WorkingHours.Schedule[currentDay];
    const isDayDisabled = workingHours && 
        (workingHours.toLowerCase() === "disabled" || 
         workingHours.toLowerCase() === "off" ||
         workingHours.toLowerCase() === "closed");
         
    if (workingHoursEmbedLocale.includes("{workingHours-currentDay}")) {
        if (isDayDisabled) {
            workingHoursEmbedLocale = workingHoursEmbedLocale
                .replace(/{workingHours-currentDay}/g, "Closed today");
        } else if (workingHours) {
            workingHoursEmbedLocale = workingHoursEmbedLocale
                .replace(/{workingHours-currentDay}/g, workingHours);
        }
    }
}

        const ticketEmbed = new EmbedBuilder();
        if(panelConfig.Embed.Title) ticketEmbed.setTitle(panelConfig.Embed.Title);
        ticketEmbed.setDescription(workingHoursEmbedLocale);
        if(panelConfig.Embed.Color) ticketEmbed.setColor(panelConfig.Embed.Color);
        if(!panelConfig.Embed.Color) ticketEmbed.setColor(config.EmbedColors);
        if(panelConfig.Embed.PanelImage) ticketEmbed.setImage(panelConfig.Embed.PanelImage);
        if(panelConfig.Embed.CustomThumbnailURL) ticketEmbed.setThumbnail(panelConfig.Embed.CustomThumbnailURL);
        if(panelConfig.Embed.Footer.Enabled && panelConfig.Embed.Footer.text) 
            ticketEmbed.setFooter({ text: `${panelConfig.Embed.Footer.text}` });
        if(panelConfig.Embed.Footer.Enabled && panelConfig.Embed.Footer.text && panelConfig.Embed.Footer.CustomIconURL) 
            ticketEmbed.setFooter({ 
                text: `${panelConfig.Embed.Footer.text}`, 
                iconURL: `${panelConfig.Embed.Footer.CustomIconURL}` 
            });
        if(panelConfig.Embed.Timestamp) ticketEmbed.setTimestamp();

        const previewEmbed = EmbedBuilder.from(ticketEmbed).setTitle((ticketEmbed.data.title || 'Ticket Panel') + ' (Preview)');
        
        const options = [];
        let selectMenuEnabled = false;
        
        if (config.TicketSettings.SelectMenu) {
            selectMenuEnabled = true;
            
            for (const categoryId of panelConfig.Categories) {
                const categoryConfig = config.TicketCategories[categoryId];
                
                if (!categoryConfig) continue;
                
                const option = {
                    label: categoryConfig.CategoryName,
                    value: `ticket-${categoryId}`,
                    description: categoryConfig.Description,
                    emoji: categoryConfig.CategoryEmoji
                };
                
                if (!option.emoji) delete option.emoji;
                if (!option.description) delete option.description;
                
                options.push(option);
            }
        }
        
        const sMenu = new StringSelectMenuBuilder()
            .setCustomId("categorySelect")
            .setPlaceholder(config.Locale.selectCategory)
            .setMinValues(1)
            .setMaxValues(1)
            .addOptions(options);
    
        const sRow = new ActionRowBuilder().addComponents(sMenu);
        
        const controlRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('send_panel')
                .setLabel('Send')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId('cancel_panel')
                .setLabel('Cancel')
                .setStyle(ButtonStyle.Danger)
        );
        
        const previewMsg = await interaction.editReply({
            content: '**Panel Preview**\nHere\'s how your ticket panel will look. Use the buttons below to send or cancel.',
            embeds: [previewEmbed],
            components: [
                ...(selectMenuEnabled ? [sRow] : buttonRows),
                controlRow
            ],
            flags: MessageFlags.Ephemeral
        });
        
        const collector = previewMsg.createMessageComponentCollector({ 
            time: 300000,
            filter: i => i.user.id === interaction.user.id
        });
        
        collector.on('collect', async i => {
            if (i.customId === 'send_panel') {
                try {
                    const sentPanel = await interaction.channel.send({ 
                        embeds: [ticketEmbed], 
                        components: selectMenuEnabled ? [sRow] : buttonRows 
                    });
                    
                    if (selectMenuEnabled) {
                        const newDocument = new ticketPanelModel({
                            guildID: config.GuildID,
                            panelId: panelId,
                            selectMenuOptions: options,
                            msgID: sentPanel.id,
                        });
                        
                        await newDocument.save();
                    } else {
                        const newDocument = new ticketPanelModel({
                            guildID: config.GuildID,
                            panelId: panelId,
                            msgID: sentPanel.id,
                        });
                        
                        await newDocument.save();
                    }
                    
                    await i.update({ 
                        content: `✅ Successfully sent the ${panelConfig.Name} panel to this channel!`, 
                        embeds: [], 
                        components: [] 
                    });
                } catch (error) {
                    console.error('[ERROR] Failed to send the ticket panel or save to the database:', error);
                    await i.update({ 
                        content: `❌ Failed to send the panel. It has not been saved to the database and will not work. Try running the command again or contact support.`, 
                        embeds: [], 
                        components: [] 
                    });
                }
                collector.stop();
            } else if (i.customId === 'cancel_panel') {
                await i.update({ 
                    content: `❌ Panel creation cancelled.`, 
                    embeds: [], 
                    components: [] 
                });
                collector.stop();
            }
        });
        
        collector.on('end', collected => {
            if (collected.size === 0) {
                interaction.editReply({ 
                    content: `⏱️ Panel creation timed out.`, 
                    embeds: [], 
                    components: [] 
                }).catch(err => {});
            }
        });
    }
}