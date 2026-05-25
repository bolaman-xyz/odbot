const { SlashCommandBuilder } = require('@discordjs/builders');
const Discord = require ("discord.js")
const fs = require('fs');
const yaml = require("js-yaml")
const config = yaml.load(fs.readFileSync('./config.yml', 'utf8'))
const commands = yaml.load(fs.readFileSync('./commands.yml', 'utf8'))

module.exports = {
    enabled: commands.General.Ping.Enabled,
    data: new SlashCommandBuilder()
        .setName('ping')
        .setDescription(commands.General.Ping.Description),
    async execute(interaction, client) {
        await interaction.deferReply();

        const ping = new Discord.EmbedBuilder()
        .setColor(config.EmbedColors)
        .setAuthor({ 
            name: '🏓 Pong!',
        })
        .setTimestamp();
        
        let pingContent = '';
        pingContent += `> **API Latency:** \`${client.ws.ping}ms\`\n`;
        pingContent += `> **Bot Latency:** \`${Date.now() - interaction.createdTimestamp}ms\``;
        
        ping.addFields([
          { 
            name: `\`🔍\` **Connection Status**`, 
            value: pingContent 
          }
        ]);
        
        ping.setFooter({ 
          text: `Requested by: ${interaction.user.username}`, 
          iconURL: interaction.user.displayAvatarURL({ dynamic: true, size: 16 }) 
        });
        
        interaction.editReply({ embeds: [ping] });
    }
}