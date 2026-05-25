const { SlashCommandBuilder } = require('@discordjs/builders');
const Discord = require ("discord.js")
const fs = require('fs');
const yaml = require("js-yaml")
const config = yaml.load(fs.readFileSync('./config.yml', 'utf8'))
const commands = yaml.load(fs.readFileSync('./commands.yml', 'utf8'))
const utils = require("../../utils.js");
const ticketModel = require("../../models/ticketModel");

module.exports = {
    enabled: commands.Ticket.Rename.Enabled,
    data: new SlashCommandBuilder()
        .setName('rename')
        .setDescription(commands.Ticket.Rename.Description)
        .addStringOption(option => option.setName('name').setDescription('name').setRequired(true)),
    async execute(interaction, client) {
        const ticketDB = await ticketModel.findOne({ channelID: interaction.channel.id });
        if(!ticketDB) return interaction.reply({ content: config.Locale.NotInTicketChannel, flags: Discord.MessageFlags.Ephemeral })
    
        let supportRole = await utils.checkIfUserHasSupportRoles(interaction, null);
        if(!supportRole) return interaction.reply({ content: config.Locale.NoPermsMessage, flags: Discord.MessageFlags.Ephemeral })

        await interaction.deferReply();

        let newName = interaction.options.getString("name");
        const oldName = interaction.channel.name;
        interaction.channel.setName(`${newName}`);

        const log = new Discord.EmbedBuilder()
        .setColor('#FFA726')
        .setAuthor({ 
            name: config.Locale.ticketRenameTitle, 
        })
        .setThumbnail(interaction.user.displayAvatarURL({ format: 'png', dynamic: true, size: 1024 }))
        .setTimestamp();
        
        let mainContent = '';
        mainContent += `> **${config.Locale.logsExecutor}:** <@!${interaction.user.id}> \`${interaction.user.username}\`\n`;
        mainContent += `> **${config.Locale.logsTicket}:** <#${interaction.channel.id}> \`#${interaction.channel.name}\`\n`;
        mainContent += `> **${config.Locale.oldName}:** \`${oldName}\`\n`;
        mainContent += `> **${config.Locale.newName}:** \`${newName}\``;
        
        log.addFields([
          { 
            name: `\`✏️\` **${config.Locale.renameDetails}**`, 
            value: mainContent 
          }
        ]);
        
        log.setFooter({ 
          text: interaction.user.username, 
          iconURL: interaction.user.displayAvatarURL({ format: 'png', dynamic: true, size: 16 }) 
        });

        const logsChannel = await utils.getCategoryLogsChannel(interaction.channel.id);

        let renameLocale = config.Locale.ticketRenamed.replace(/{newName}/g, `${newName}`);
        const embed = new Discord.EmbedBuilder()
        .setColor('#4CAF50')
        .setDescription(renameLocale);

        interaction.editReply({ embeds: [embed] });
        if (logsChannel) logsChannel.send({ embeds: [log] });
    }
}