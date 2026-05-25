const { SlashCommandBuilder } = require('@discordjs/builders');
const Discord = require('discord.js');
const fs = require('fs');
const yaml = require('js-yaml');
const config = yaml.load(fs.readFileSync('./config.yml', 'utf8'));
const commands = yaml.load(fs.readFileSync('./commands.yml', 'utf8'));
const ticketModel = require("../../models/ticketModel");
const utils = require("../../utils.js");

function formatCooldown(cooldownTime) {
    const seconds = Math.floor(cooldownTime / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    const formattedSeconds = seconds % 60;
    const formattedMinutes = minutes % 60;

    const parts = [];

    if (hours > 0) {
        parts.push(`${hours} ${hours === 1 ? 'hour' : 'hours'}`);
    }

    if (formattedMinutes > 0) {
        parts.push(`${formattedMinutes} ${formattedMinutes === 1 ? 'minute' : 'minutes'}`);
    }

    if (formattedSeconds > 0) {
        parts.push(`${formattedSeconds} ${formattedSeconds === 1 ? 'second' : 'seconds'}`);
    }

    return parts.join(', ');
}

module.exports = {
    enabled: commands.Ticket.Priority.Enabled,
    data: new SlashCommandBuilder()
        .setName('priority')
        .setDescription(commands.Ticket.Priority.Description)
        .addSubcommand(subcommand =>
            subcommand
                .setName('set')
                .setDescription('Set the priority of a ticket')
                .addStringOption(option => {
                    option.setName('level')
                        .setDescription('Priority level')
                        .setRequired(true);
                    
                    for (let priorityLevel of config.PrioritySettings.Levels) {
                        option.addChoices({ name: priorityLevel.priority, value: priorityLevel.priority.toLowerCase() });
                    }
                    
                    return option;
                })
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('clear')
                .setDescription('Clear the priority of a ticket')),
    async execute(interaction, client) {
        await interaction.deferReply({ flags: Discord.MessageFlags.Ephemeral });

        let supportRole = await utils.checkIfUserHasSupportRoles(interaction, null);
        if (!supportRole) return interaction.editReply({ content: config.Locale.NoPermsMessage, flags: Discord.MessageFlags.Ephemeral });

        const ticketDB = await ticketModel.findOne({ channelID: interaction.channel.id });
        if (!ticketDB) return interaction.editReply({ content: config.Locale.NotInTicketChannel, flags: Discord.MessageFlags.Ephemeral });

        if (interaction.options.getSubcommand() === 'set') {
            const level = interaction.options.getString('level');

            if (ticketDB.priority) return interaction.editReply({ content: 'This ticket already has a priority set.', flags: Discord.MessageFlags.Ephemeral });

        const cooldownTimeLeft = ticketDB.priorityCooldown - Date.now();
        if (cooldownTimeLeft > 0) {
            const formattedCooldown = formatCooldown(cooldownTimeLeft);

            const cooldownEmbed = new Discord.EmbedBuilder()
                .setTitle('Cooldown')
                .setColor("Yellow")
                .setDescription(`You cannot set the priority right now. Please wait \`\`${formattedCooldown}\`\`.`)
                .setTimestamp()
                .setFooter({ text: `${interaction.user.username}`, iconURL: `${interaction.user.displayAvatarURL({ dynamic: true })}` });

            return interaction.editReply({ embeds: [cooldownEmbed], flags: Discord.MessageFlags.Ephemerale });
        }

            const selectedLevel = config.PrioritySettings.Levels.find(l => l.priority.toLowerCase() === level);

            const cooldownDuration = 10 * 60 * 1000;
            const cooldownEndDate = Date.now() + cooldownDuration;

            await ticketModel.findOneAndUpdate(
                { channelID: interaction.channel.id },
                {
                    priorityCooldown: cooldownEndDate,
                    priority: selectedLevel.priority,
                    priorityName: interaction.channel.name,
                }
            );

            const newChannelName = selectedLevel.channelName ? `${selectedLevel.channelName}${interaction.channel.name}` : `${interaction.channel.name}`;
            if(selectedLevel.channelName) await interaction.channel.setName(newChannelName);
            if(selectedLevel.moveToTop) await interaction.channel.setPosition(1);

            let supp = selectedLevel.rolesToMention.map((r) => {
                let findRole = interaction.guild.roles.cache.get(r)
  
                if (findRole) return findRole;
            });

        const successEmbed = new Discord.EmbedBuilder()
            .setColor("Green")
            .setDescription(`Priority set to \`\`${selectedLevel.priority}\`\` for this ticket.`)
            .setTimestamp()
            .setFooter({ text: `${interaction.user.username}`, iconURL: `${interaction.user.displayAvatarURL({ dynamic: true })}` });

            interaction.channel.send({ embeds: [successEmbed], content: `${supp.join(" ")}` })
            interaction.editReply({ content: `You successfully set the priority for this ticket!` })
        } else if (interaction.options.getSubcommand() === 'clear') {
            if (!ticketDB.priority) return interaction.editReply({ content: 'This ticket has no priority!', flags: Discord.MessageFlags.Ephemeral });

        const cooldownTimeLeft = ticketDB.priorityCooldown - Date.now();
        if (cooldownTimeLeft > 0) {
            const formattedCooldown = formatCooldown(cooldownTimeLeft);

            const cooldownEmbed = new Discord.EmbedBuilder()
                .setTitle('Cooldown')
                .setColor("Yellow")
                .setDescription(`You cannot clear the priority right now. Please wait \`\`${formattedCooldown}\`\`.`)
                .setTimestamp()
                .setFooter({ text: `${interaction.user.username}`, iconURL: `${interaction.user.displayAvatarURL({ dynamic: true })}` });

            return interaction.editReply({ embeds: [cooldownEmbed], flags: Discord.MessageFlags.Ephemeral });
        }

            const selectedLevel = config.PrioritySettings.Levels.find(level => level.priority.toLowerCase() === ticketDB.priority.toLowerCase());

            if(selectedLevel.channelName) await interaction.channel.setName(ticketDB.priorityName);
            const channelsInCategory = interaction.guild.channels.cache.filter(channel => channel.type === 0 && channel.parentId === interaction.channel.parentId).size;
            const newPosition = channelsInCategory + 1;
            if(selectedLevel.moveToTop) await interaction.channel.setPosition(newPosition);

            await ticketModel.findOneAndUpdate({ channelID: interaction.channel.id }, { $unset: { priority: 1, priorityCooldown: 1, priorityName: 1 } });

            const successEmbed = new Discord.EmbedBuilder()
                .setColor("Red")
                .setDescription(`Priority cleared from this ticket.`)
                .setTimestamp()

            interaction.editReply({ embeds: [successEmbed], flags: Discord.MessageFlags.Ephemeral });
        }
    }
};
