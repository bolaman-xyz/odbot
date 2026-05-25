const { SlashCommandBuilder } = require('@discordjs/builders');
const Discord = require ("discord.js")
const fs = require('fs');
const yaml = require("js-yaml")
const config = yaml.load(fs.readFileSync('./config.yml', 'utf8'))
const commands = yaml.load(fs.readFileSync('./commands.yml', 'utf8'))
const ticketModel = require("../../models/ticketModel");
const utils = require("../../utils.js");

module.exports = {
    enabled: commands.Ticket.Remove.Enabled,
    data: new SlashCommandBuilder()
        .setName('remove')
        .setDescription(commands.Ticket.Remove.Description)
        .addUserOption((option) => option.setName('user').setDescription('User').setRequired(true)),
    async execute(interaction, client) {
        const ticketDB = await ticketModel.findOne({ channelID: interaction.channel.id });
        if(!ticketDB) return interaction.reply({ content: config.Locale.NotInTicketChannel, flags: Discord.MessageFlags.Ephemeral })

        let supportRole = await utils.checkIfUserHasSupportRoles(interaction, null);
        if(commands.Ticket.Remove.AllowEveryoneToUse === false && !supportRole) return interaction.reply({ content: config.Locale.NoPermsMessage, flags: Discord.MessageFlags.Ephemeral })

        await interaction.deferReply();

        let user = interaction.options.getUser("user");

        interaction.channel.permissionOverwrites.create(user, {
            SendMessages: false,
            ViewChannel: false,
            ReadMessageHistory: false
        });
        
        const logsChannel = await utils.getCategoryLogsChannel(interaction.channel.id);
    
        const log = new Discord.EmbedBuilder()
        .setColor('#FF5D5D')
        .setAuthor({ 
            name: config.Locale.userRemoveTitle, 
        })
        .setThumbnail(interaction.user.displayAvatarURL({ format: 'png', dynamic: true, size: 1024 }))
        .setTimestamp();
        
        let mainContent = '';
        mainContent += `> **${config.Locale.logsExecutor}:** <@!${interaction.user.id}> \`${interaction.user.username}\`\n`;
        mainContent += `> **${config.Locale.logsUser}:** <@!${user.id}> \`${user.username}\`\n`;
        mainContent += `> **${config.Locale.logsTicket}:** <#${interaction.channel.id}> \`#${interaction.channel.name}\``;
        
        log.addFields([
          { 
            name: `\`👤\` **${config.Locale.userDetails}**`, 
            value: mainContent 
          }
        ]);
        
        log.setFooter({ 
          text: interaction.user.username, 
          iconURL: interaction.user.displayAvatarURL({ format: 'png', dynamic: true, size: 16 }) 
        });

        let removeLocale = config.Locale.ticketUserRemove.replace(/{user}/g, `<@!${user.id}>`).replace(/{username}/g, `${user.username}`);
        const embed = new Discord.EmbedBuilder()
        .setColor('#FF5D5D')
        .setDescription(removeLocale);
    
        interaction.editReply({ embeds: [embed] });
        if (logsChannel) logsChannel.send({ embeds: [log] });
    }
}