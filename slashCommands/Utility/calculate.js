const { SlashCommandBuilder } = require('@discordjs/builders');
const Discord = require("discord.js")
const fs = require('fs');
const yaml = require("js-yaml")
const axios = require("axios");
const config = yaml.load(fs.readFileSync('./config.yml', 'utf8'))
const commands = yaml.load(fs.readFileSync('./commands.yml', 'utf8'))

module.exports = {
    enabled: commands.Utility.Calculate.Enabled,
    data: new SlashCommandBuilder()
        .setName('calculate')
        .setDescription(commands.Utility.Calculate.Description)
        .addStringOption(option => option.setName('question').setDescription('question').setRequired(true)),
    async execute(interaction, client) {
        await interaction.deferReply({ flags: Discord.MessageFlags.Ephemeral });

        try {
            let question = interaction.options.getString("question");
            let question2 = question.replace(/x/g, "*");
            const encodedInput = encodeURIComponent(question2);
            
            const response = await axios.get(`http://api.mathjs.org/v4/?expr=${encodedInput}`);
            const result = response.data;

            const embed = new Discord.EmbedBuilder()
            .setColor(config.EmbedColors)
            .setTimestamp();
            
            let calculationContent = '';
            calculationContent += `> **Expression:** \`${question}\`\n`;
            calculationContent += `> **Result:** \`${result}\``;
            
            embed.addFields([
                { 
                    name: '`🧮` **Calculation**', 
                    value: calculationContent 
                }
            ]);
            
            embed.setFooter({ 
                text: `Requested by: ${interaction.user.username}`, 
                iconURL: interaction.user.displayAvatarURL({ format: 'png', dynamic: true, size: 16 }) 
            });
            
            interaction.editReply({ embeds: [embed] });
        } catch (error) {
            console.error('Calculation error:', error);
            interaction.editReply({ content: 'An error occurred while calculating the result.', flags: Discord.MessageFlags.Ephemeral });
        }
    }
}