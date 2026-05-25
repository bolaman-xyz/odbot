const { SlashCommandBuilder } = require('@discordjs/builders');
const { Discord, ActionRowBuilder, ButtonBuilder, EmbedBuilder, MessageSelectMenu, Message, ContextMenuCommandBuilder, ApplicationCommandType, SnowflakeUtil } = require("discord.js");
const fs = require('fs');
const yaml = require("js-yaml")
const config = yaml.load(fs.readFileSync('./config.yml', 'utf8'))
const commands = yaml.load(fs.readFileSync('./commands.yml', 'utf8'))

module.exports = {
    enabled: config.SuggestionSettings.Enabled,
    data: new ContextMenuCommandBuilder()
    .setName("Accept Suggestion")
    .setType(ApplicationCommandType.Message)
}