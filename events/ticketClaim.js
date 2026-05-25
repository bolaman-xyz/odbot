const { Interaction } = require("discord.js");
const fs = require('fs');
const yaml = require("js-yaml");
const config = yaml.load(fs.readFileSync('./config.yml', 'utf8'));
const guildModel = require("../models/guildModel");
const { incrementStat } = require("../staffStats.js");

module.exports = async (client, interactionOrMessage) => {
    const user = interactionOrMessage.user || interactionOrMessage.author;
    const channelID = interactionOrMessage.channel?.id;

    if (!user || !channelID) return;

    const statsDB = await guildModel.findOne({ guildID: config.GuildID });
    if (statsDB) {
        statsDB.totalClaims = (statsDB.totalClaims || 0) + 1;
        await statsDB.save();
    }

    await incrementStat(user, 'claim', 1, { ticketID: channelID }, interactionOrMessage, null);
};