const fs = require('fs');
const yaml = require("js-yaml")
const config = yaml.load(fs.readFileSync('./config.yml', 'utf8'))
const color = require('ansi-colors');
const botVersion = require('../package.json');
const utils = require("../utils.js");
const Discord = require("discord.js");
const { Collection } = Discord;
const ms = require('ms');
const moment = require('moment-timezone');
const mongoose = require("mongoose");
const guildModel = require("../models/guildModel");
const ticketModel = require("../models/ticketModel");
const reviewsModel = require("../models/reviewsModel");
const dashboardModel = require("../models/dashboardModel");

const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v10');
const { glob } = require('glob');
const path = require('path');

module.exports = async client => {
  client.commands = new Collection();
  client.slashCommands = new Collection();

    let guild = await client.guilds.cache.get(config.GuildID)
    if(!guild) {
        await console.log('\x1b[31m%s\x1b[0m', `[ERROR] The guild ID specified in the config is invalid or the bot is not in the server!\nYou can use the link below to invite the bot to your server:\nhttps://discord.com/api/oauth2/authorize?client_id=${client.user.id}&permissions=8&scope=bot%20applications.commands`)
        await process.exit()
    }

    const connectToMongoDB = async () => {
      try {
        if (config.MongoURI) await mongoose.set('strictQuery', false);
    
        if (config.MongoURI) {
          await mongoose.connect(config.MongoURI);
        } else {
          throw new Error('[ERROR] MongoDB Connection String is not specified in the config! (MongoURI)');
        }
      } catch (error) {
        console.error('\x1b[31m%s\x1b[0m', `[ERROR] Failed to connect to MongoDB: ${error.message}\n${error.stack}`);
    
        if (error.message.includes('authentication failed')) {
          await console.error('Authentication failed. Make sure to check if you entered the correct username and password in the connection URL.');
          await process.exit(1)
        } else if (error.message.includes('network error')) {
          await console.error('Network error. Make sure the MongoDB server is reachable and the connection URL is correct.');
          await process.exit(1)
        } else if (error.message.includes('permission denied')) {
          await console.error('Permission denied. Make sure the MongoDB cluster has the necessary permissions to read and write.');
          await process.exit(1)
        } else {
          await console.error('An unexpected error occurred. Check the MongoDB connection URL and credentials.');
          await process.exit(1)
        }
      }
    };
    connectToMongoDB();


// ================ SLASH COMMANDS LOADING SYSTEM ================
if(config.GuildID) {
  try {
      console.log(`${color.cyan(`[SLASH] Loading slash commands...`)}`);
      const slashCommands = [];
      
      try {
          const files = await glob('./slashCommands/**/*.js');
          
          for (const file of files) {
              try {
                  const command = require(path.resolve(file));
                  
                  const fileName = path.basename(file, '.js');
                  const pathParts = file.split(/[\/\\]/);
                  const category = pathParts[pathParts.length - 2];
                  
                  if (category === 'contextMenu') {
                      if (!command.data && !command.execute) {
                          console.log(`${color.yellow(`[WARNING] Context menu at ${file} is missing required "data" and "execute" properties.`)}`);
                          continue;
                      }
                      
                      if (command.enabled === false) {
                          console.log(`${color.yellow(`[CONTEXT MENU]`)} ${fileName} ${color.yellow('is disabled, skipping.')}`);
                          continue;
                      }
                      
                      if (command.data) {
                          slashCommands.push(command.data.toJSON());
                          client.slashCommands.set(command.data.name, command);
                      }
                      console.log(`${color.green(`[CONTEXT MENU]`)} ${fileName} ${color.green('loaded!')}`);
                  } 
                  else {
                      if (!command.data || !command.execute) {
                          console.log(`${color.yellow(`[WARNING] Command at ${file} is missing required "data" or "execute" property.`)}`);
                          continue;
                      }
                      
                      if (command.enabled === false) {
                          console.log(`${color.yellow(`[SLASH COMMAND]`)} ${fileName} ${color.yellow('is disabled, skipping.')}`);
                          continue;
                      }
                      
                      slashCommands.push(command.data.toJSON());
                      client.slashCommands.set(command.data.name, command);
                      console.log(`${color.green(`[SLASH COMMAND]`)} ${fileName} ${color.green('loaded!')}`);
                  }
              } catch (error) {
                  console.error(`${color.red(`[ERROR] Failed to load command ${file}:`)}`, error);
              }
          }
      } catch (err) {
          console.error(`${color.red(`[ERROR] Failed to load command files:`)}`, err);
      }
      
      const loadedAddons = new Set();
      
      const eventHandler = {
          on: (event, callback) => client.on(event, callback),
          emit: (event, ...args) => client.emit(event, ...args)
      };
      
      try {
          const files = await glob('./addons/**/*.js');
          
          for (const file of files) {
              if (file.endsWith('.js')) {
                  const pathParts = file.split(/[\/\\]/);
                  const addonsIndex = pathParts.findIndex(part => part === 'addons');
                  
                  if (addonsIndex === -1 || addonsIndex + 1 >= pathParts.length) {
                      console.error(`${color.red(`[ERROR] Could not extract addon name from path: ${file}`)}`);
                      continue;
                  }
                  
                  const folderName = pathParts[addonsIndex + 1];
                  
                  if (!loadedAddons.has(folderName)) {
                      loadedAddons.add(folderName);
                      console.log(`${color.green(`[ADDON] ${folderName} loaded!`)}`);
                  }
                  
                  try {
                      if (fs.existsSync(file)) {
                          const addon = require(path.resolve(file));
                          
                          if (addon && typeof addon.register === 'function') {
                              addon.register({
                                  on: eventHandler.on,
                                  emit: eventHandler.emit,
                                  client,
                              });
                          }
                          
                          if (addon && addon.data && addon.data.toJSON) {
                              const slashCommandData = addon.data.toJSON();
                              client.slashCommands.set(slashCommandData.name, addon);
                              slashCommands.push(slashCommandData);
                              console.log(`${color.green(`[COMMAND] ${slashCommandData.name} registered from ${folderName}`)}`);
                          }
                      }
                  } catch (addonError) {
                      console.error(`${color.red(`[ERROR] ${folderName}: ${addonError.message}`)}`);
                      console.error(addonError.stack);
                  }
              }
          }
      } catch (err) {
          console.error(`${color.red(`[ERROR] Failed to load addons:`)}`, err);
      }
      
      if (slashCommands.length > 0) {
          console.log(`${color.cyan(`[SLASH] Registering ${slashCommands.length} slash commands...`)}`);
          
          try {
              const rest = new REST({ version: '10' }).setToken(config.Token);
              
              const response = await rest.put(
                  Routes.applicationGuildCommands(client.user.id, config.GuildID),
                  { body: slashCommands }
              );
              
              console.log(`${color.green(`[SLASH] Successfully registered ${response.length} commands.`)}`);
          } catch (error) {
              if (error.message?.includes('Missing Access') || error.code === 50001) {
                  let logMsg = `\n\n[${new Date().toLocaleString()}] [ERROR] ${error.stack}`;
                  await fs.appendFile("./logs.txt", logMsg, (e) => { 
                      if(e) console.log(e);
                  });
                  await console.log(error)
                  await console.log('\x1b[31m%s\x1b[0m', `[ERROR] Slash commands are unavailable because application.commands scope wasn't selected when inviting the bot. Please use the link below to re-invite your bot.`)
                  await console.log('\x1b[31m%s\x1b[0m', `https://discord.com/api/oauth2/authorize?client_id=${client.user.id}&permissions=8&scope=bot%20applications.commands`)
              } else {
                  const timestamp = new Date().toLocaleString();
                  const errorMessage = `\n\n[${timestamp}] [ERROR] Command registration: ${error.stack || error.message || error}`;
                  
                  console.error('\x1b[31m%s\x1b[0m', `[ERROR] Command registration:`, error);
                  
                  try {
                      await fs.promises.appendFile("./logs.txt", errorMessage);
                  } catch (e) {
                      console.error('[ERROR] Failed to write to log file:', e);
                  }
              }
          }
      } else {
          console.log(`${color.yellow(`[WARNING] No commands to register`)}`);
      }
  } catch (error) {
      console.error(`${color.red(`[ERROR] Failed to load slash commands system:`)}`, error);
      let logMsg = `\n\n[${new Date().toLocaleString()}] [ERROR] ${error.stack}`;
      await fs.appendFile("./logs.txt", logMsg, (e) => { 
          if(e) console.log(e);
      });
  }
}
// ================ END OF SLASH COMMANDS LOADING SYSTEM ================

// Create guild model if it doesn't exist and save to db
const gModel = await guildModel.findOne({ guildID: config.GuildID });
if (!gModel || gModel?.length == 0) {
  const newModel = new guildModel({
    guildID: config.GuildID,
    totalTickets: 0,
    openTickets: 0,
    totalClaims: 0,
    totalMessages: 0,
    totalSuggestions: 0,
    totalSuggestionUpvotes: 0,
    totalSuggestionDownvotes: 0,
    totalReviews: 0,
    averageRating: 0.0,
    timesBotStarted: 0,
    averageCompletion: "N/A",
    averageResponse: "N/A",
    ratings: []
  });
  await newModel.save();
}


    const statsDB = await guildModel.findOne({ guildID: config.GuildID });

    // Sync globalStats.openTickets
    const openNow = await ticketModel.countDocuments({ status: 'Open', guildID: config.GuildID });

    if (statsDB.openTickets !== openNow) {
        statsDB.openTickets = openNow;
        await statsDB.save();
    }
    //


// bot activity
let activType;
let userStatus = 'online';

const statusMap = {
  "ONLINE": 'online',
  "IDLE": 'idle',
  "DND": 'dnd',
  "INVISIBLE": 'invisible'
};

const activityTypeMap = {
  "WATCHING": Discord.ActivityType.Watching,
  "PLAYING": Discord.ActivityType.Playing,
  "COMPETING": Discord.ActivityType.Competing,
  "LISTENING": Discord.ActivityType.Listening
};

activType = activityTypeMap[config.BotActivitySettings.ActivityType] || Discord.ActivityType.Playing;
userStatus = statusMap[config.BotActivitySettings.Status] || 'online';

if (config.BotActivitySettings.Enabled && config.BotActivitySettings.Statuses?.length > 0) {
  let index = 0;
  
  const setActivity = async () => {
    const activityMessage = config.BotActivitySettings.Statuses[index]
      .replace(/{total-users}/g, `${guild.memberCount.toLocaleString('en-US')}`)
      .replace(/{total-tickets}/g, `${statsDB.totalTickets.toLocaleString('en-US')}`)
      .replace(/{total-channels}/g, `${client.channels.cache.size}`)
      .replace(/{open-tickets}/g, `${statsDB.openTickets.toLocaleString('en-US')}`)
      .replace(/{total-messages}/g, `${statsDB.totalMessages.toLocaleString('en-US')}`)
      .replace(/{average-rating}/g, `${await utils.averageRating(client)}`)
      .replace(/{average-completion}/g, `${statsDB.averageCompletion}`)
      .replace(/{average-response}/g, `${statsDB.averageResponse}`);

    client.user.setPresence({
      activities: [{ name: activityMessage, type: activType }],
      status: userStatus
    });

    index = (index + 1) % config.BotActivitySettings.Statuses.length;
  };

  setActivity(); // Set initial activity

  setInterval(setActivity, config.BotActivitySettings.Interval * 1000);
}
//

    client.guilds.cache.forEach(guild => {
        if(!config.GuildID.includes(guild.id)) {
        guild.leave();
        console.log('\x1b[31m%s\x1b[0m', `[INFO] Someone tried to invite the bot to another server! I automatically left it (${guild.name})`)
        }
    })
    if (guild && !guild.members.me.permissions.has("Administrator")) {
        console.log('\x1b[31m%s\x1b[0m', `[ERROR] The bot doesn't have enough permissions! Please give the bot ADMINISTRATOR permissions in your server or it won't function properly!`)
    }

let dashboardExists = await utils.checkDashboard();
let holidayMessage = await utils.getHolidayMessage();
    // BETA NOTICE
    // console.log(color.yellow.bold("NOTICE:"));
    // console.log(color.yellow.bold("You are currently using a beta version of Plex Tickets."));
    // console.log(color.yellow.bold("Please report bugs and provide feedback in our Discord server"));

    await console.log("――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――");
    await console.log("                                                                          ");
    if(config.LicenseKey) await console.log(`${color.green.bold.underline(`Plex Tickets v${botVersion.version} is now Online!`)} (${color.gray(`${config.LicenseKey.slice(0, -10)}`)})`);
    if(!config.LicenseKey) await console.log(`${color.green.bold.underline(`Plex Tickets v${botVersion.version} is now Online! `)}`);
    if(holidayMessage) await console.log("                                                                          ");
    if(holidayMessage) await console.log(holidayMessage)
    if(holidayMessage) await console.log("                                                                          ");
    await console.log(`• Join our discord server for support, ${color.cyan(`discord.gg/plexdev`)}`);
    await console.log(`• By using this bot you agree to all terms located here, ${color.yellow(`plexdevelopment.net/tos`)}`);
    await console.log(`• Addons for the bot can be found here, ${color.yellow(`plexdevelopment.net/products`)}`);
    if(config.Statistics) await console.log("                                                                          ");
    if(config.Statistics) await console.log(`${color.green.bold.underline(`Statistics:`)}`);
    if(config.Statistics) await console.log(`• The bot has been started a total of ${color.cyan.underline(`${statsDB.timesBotStarted.toLocaleString('en-US')}` )} times.`);
    if(config.Statistics) await console.log(`• A total of ${color.cyan.underline(`${statsDB.totalTickets.toLocaleString('en-US')}` )} tickets have been created.`);
    if(config.Statistics) await console.log(`• There are currently ${color.cyan.underline(`${statsDB.openTickets}` )} open tickets.`);
    if(config.Statistics) await console.log(`• A total of ${color.cyan.underline(`${statsDB.totalMessages.toLocaleString('en-US')}` )} messages have been sent in tickets.`);
    if(config.LicenseKey) await console.log("                                                                          ");
    if(config.LicenseKey) await console.log(`${color.green.bold.underline(`Source Code:`)}`);
    if(config.LicenseKey) await console.log(`• You can buy the full source code at ${color.yellow(`plexdevelopment.net/products/ptsourcecode`)}`);
    if(config.LicenseKey) await console.log(`• Use code ${color.green.bold.underline(`PLEX`)} for 10% OFF!`);
    if(dashboardExists) await console.log("                                                                          ");
    if(dashboardExists) await console.log(`${color.green.bold.underline(`Dashboard:`)}`);
    if(dashboardExists) await console.log(`• Dashboard addon has been detected and successfully loaded.`);
    if(!dashboardExists) await console.log("                                                                          ");
    if (!dashboardExists) await console.log(`${color.red.bold.underline(`Dashboard not detected:`)}`);
    if (!dashboardExists) await console.log(`• The dashboard unlocks additional features, including:`);
    if (!dashboardExists) await console.log(`  - User interface`);
    if (!dashboardExists) await console.log(`  - View tickets on the dashboard in real-time`);
    if (!dashboardExists) await console.log(`  - Respond to tickets from the dashboard`);
    if (!dashboardExists) await console.log(`  - Manage tickets from the dashboard`);
    if (!dashboardExists) await console.log(`  - Viewing ticket transcripts online`);
    if (!dashboardExists) await console.log(`  - Viewing ticket history`);
    if (!dashboardExists) await console.log(`  - Viewing ticket reviews`);
    if (!dashboardExists) await console.log(`  - Managing user/role blacklists`);
    if (!dashboardExists) await console.log(`  - and more..`);
    if (!dashboardExists) await console.log(`• Explore these features and more by purchasing the dashboard addon at ${color.yellow(`plexdevelopment.net/products/dashboard`)}`);
    //const expirationDate = new Date("2023-07-31");
    //if(config.LicenseKey && new Date() <= expirationDate) await console.log(`\n${color.blue.bold.underline(`LIMITED TIME (07/31/2023):`)} \nGet all of our bot's full source codes in a bundle for a discounted price! \n- Plex Tickets\n- Plex Bot\n- Plex Licenses\n${color.yellow(`plexdevelopment.net/store/bundle`)}`);
    await console.log("                                                                          ");
    await console.log("――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――");
    await utils.checkConfig(client)

    let logMsg = `\n\n[${new Date().toLocaleString()}] [READY] Bot is now ready!`;
    fs.appendFile("./logs.txt", logMsg, (e) => { 
      if(e) console.log(e);
    });

// Update channel stats
setInterval(async function() {

const statsDB = await guildModel.findOne({ guildID: config.GuildID });

if(config.TotalTickets.Enabled) {
  let channel = guild.channels.cache.get(config.TotalTickets.ChannelID)
  let totalTicketsCountMsg = config.TotalTickets.ChannelName.replace(/{total-tickets}/g, `${statsDB.totalTickets.toLocaleString('en-US')}`)
  if (channel) channel.setName(totalTicketsCountMsg).catch(error => console.log(error));
}

if(config.OpenTickets.Enabled) {
  let channel = guild.channels.cache.get(config.OpenTickets.ChannelID)
  let openTicketsCountMsg = config.OpenTickets.ChannelName.replace(/{open-tickets}/g, `${statsDB.openTickets.toLocaleString('en-US')}`)
  if (channel) channel.setName(openTicketsCountMsg).catch(error => console.log(error));
}

if(config.AverageRating.Enabled) {
  const averageRating = await utils.averageRating(client);

  let channel = guild.channels.cache.get(config.AverageRating.ChannelID)
  let averageRatingMsg = config.AverageRating.ChannelName.replace(/{average-rating}/g, `${averageRating}`)
  if (channel) channel.setName(averageRatingMsg).catch(error => console.log(error));
}

if(config.AverageCompletion.Enabled) {
  let channel = guild.channels.cache.get(config.AverageCompletion.ChannelID)
  let averageCompletiongMsg = config.AverageCompletion.ChannelName.replace(/{average-completion}/g, `${statsDB.averageCompletion}`)
  if (channel) channel.setName(averageCompletiongMsg).catch(error => console.log(error));
}

if(config.AverageResponse.Enabled) {
  let channel = guild.channels.cache.get(config.AverageResponse.ChannelID)
  let averageResponsegMsg = config.AverageResponse.ChannelName.replace(/{average-response}/g, `${statsDB.averageResponse}`)
  if (channel) channel.setName(averageResponsegMsg).catch(error => console.log(error));
}

if(config.MemberCount.Enabled) {
  let channel = guild.channels.cache.get(config.MemberCount.ChannelID)
  let MemberCountMsg = config.MemberCount.ChannelName.replace(/{member-count}/g, `${guild.memberCount.toLocaleString('en-US')}`)
  if (channel) channel.setName(MemberCountMsg).catch(error => console.log(error));
}

// Calculate average ticket completion/response time
const formatDuration = (milliseconds) => {
  const seconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    const roundedDays = hours % 24 >= 12 ? days + 1 : days;
    return `${roundedDays} day${roundedDays > 1 ? 's' : ''}`;
  } else if (hours > 0) {
    const roundedHours = minutes % 60 >= 30 ? hours + 1 : hours;
    return `${roundedHours} hour${roundedHours > 1 ? 's' : ''}`;
  } else if (minutes > 0) {
    const roundedMinutes = seconds % 60 >= 30 ? minutes + 1 : minutes;
    return `${roundedMinutes} minute${roundedMinutes > 1 ? 's' : ''}`;
  } else {
    return `${seconds} second${seconds > 1 ? 's' : ''}`;
  }
};

const calculateAverageResponseTime = async () => {
  const result = await ticketModel.aggregate([
    {
      $match: {
        firstStaffResponse: { $exists: true, $type: 'date' },
        ticketCreationDate: { $exists: true, $type: 'date' },
      },
    },
    {
      $project: {
        responseTime: {
          $subtract: ['$firstStaffResponse', '$ticketCreationDate'],
        },
      },
    },
    {
      $group: {
        _id: null,
        totalResponseTime: { $sum: '$responseTime' },
        count: { $sum: 1 },
      },
    },
    {
      $project: {
        averageResponseTime: { $divide: ['$totalResponseTime', '$count'] },
      },
    },
  ]);


  if (result.length > 0) {
    const averageResponseTime = result[0].averageResponseTime;
    const formattedDuration = formatDuration(averageResponseTime);
    return formattedDuration;
  }

  return null;
};

const calculateAverageCompletionTime = async () => {
  const result = await ticketModel.aggregate([
    {
      $match: {
        closedAt: { $exists: true, $type: 'date' },
        ticketCreationDate: { $exists: true, $type: 'date' },
      },
    },
    {
      $group: {
        _id: null,
        total: { $sum: { $subtract: ['$closedAt', '$ticketCreationDate'] } },
        count: { $sum: 1 },
      },
    },
    {
      $project: {
        average: { $divide: ['$total', '$count'] },
      },
    },
  ]);

  if (result.length > 0) {
    const averageCompletionTime = result[0].average;
    const formattedDuration = formatDuration(averageCompletionTime);
    return formattedDuration;
  }

  return null;
};

let completionTime = await calculateAverageCompletionTime();
let responseTime = await calculateAverageResponseTime();

// Save "Unknown" if the calculated values are null
statsDB.averageCompletion = completionTime ? `${completionTime}` : "Unknown";
statsDB.averageResponse = responseTime ? `${responseTime}` : "Unknown";

await statsDB.save();


if (config.TicketAlert.Enabled && config.TicketAlert.AutoAlert.Enabled) {

  // Fetch all open tickets
  const openTickets = await ticketModel.find({ status: "Open" });
  if (!openTickets || openTickets.length === 0) return;

  // Iterate through open tickets to find inactive ones
  openTickets.forEach(async (ticket) => {
    if (!ticket || !ticket.channelID || !ticket.lastMessageSent) return;

    // Skip if the ticket already has an alert active
    if (ticket.closeNotificationTime > 0) return;

    // Calculate inactivity time
    const lastMessageDate = new Date(ticket.lastMessageSent);
    const currentDate = new Date();
    const timeDifference = Math.abs(currentDate - lastMessageDate);
    const minutesSinceLastMessage = Math.floor(timeDifference / (1000 * 60));

    // Convert AutoAlert inactive time from config to minutes
    const inactiveTimeInMinutes = ms(config.TicketAlert.AutoAlert.InactiveTime) / (1000 * 60);

    // Check if the ticket is inactive and waiting for a user reply, If so, send alert
    if (minutesSinceLastMessage >= inactiveTimeInMinutes && ticket.waitingReplyFrom !== "staff") {

      let ticketCreator = await client.users.cache.get(ticket.userID)
      let ticketChannel = await guild.channels.cache.get(ticket.channelID)
      if(!ticketChannel) return;

      function formatTimeDifference(msDifference) {
        const totalSeconds = Math.floor(msDifference / 1000);
        const days = Math.floor(totalSeconds / (24 * 3600));
        const hours = Math.floor((totalSeconds % (24 * 3600)) / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
    
        const parts = [];
        if (days > 0) parts.push(`${days} day${days > 1 ? 's' : ''}`);
        if (hours > 0) parts.push(`${hours} hour${hours > 1 ? 's' : ''}`);
        if (minutes > 0) parts.push(`${minutes} minute${minutes > 1 ? 's' : ''}`);
    
        return parts.join(', ');
    }

    const lastMessageSent = ticket.lastMessageSent ? new Date(ticket.lastMessageSent) : new Date(ticket.ticketCreationDate);
  
    const now = new Date();
    const inactiveTime = formatTimeDifference(now - lastMessageSent);

const ticketDeleteButton = new Discord.ButtonBuilder()
    .setCustomId('closeTicket')
    .setLabel(config.Locale.CloseTicketButton)
    .setStyle(config.ButtonColors.closeTicket)
    .setEmoji(config.ButtonEmojis.closeTicket);

const cancelClosureButton = new Discord.ButtonBuilder()
    .setCustomId('cancelClosure')
    .setLabel("Cancel Closure")
    .setStyle("Secondary")
    .setEmoji("🚫");
    
let row = new Discord.ActionRowBuilder().addComponents(ticketDeleteButton, cancelClosureButton);

      const ticketLinkButton = new Discord.ButtonBuilder()
      .setLabel("View Ticket")
      .setStyle("Link")
      .setURL(`https://discord.com/channels/${guild.id}/${ticketChannel.id}`);

      let row2 = new Discord.ActionRowBuilder().addComponents(ticketLinkButton);

      const durationInSeconds = Math.floor(ms(config.TicketAlert.Time) / 1000);
      const unixTimestamp = Math.floor(Date.now() / 1000) + durationInSeconds;

      let descLocale = config.TicketAlert.Message.replace(/{time}/g, `<t:${unixTimestamp}:R>`).replace(/{inactive-time}/g, inactiveTime);;
      const embed = new Discord.EmbedBuilder()
      .setColor(config.EmbedColors)
      .setDescription(descLocale)
      .setTimestamp()

      let DMdescLocale = config.TicketAlert.DMMessage.replace(/{time}/g, `<t:${unixTimestamp}:R>`).replace(/{server}/g, `${guild.name}`).replace(/{inactive-time}/g, inactiveTime);;
      const DMembed = new Discord.EmbedBuilder()
      .setColor(config.EmbedColors)
      .setDescription(DMdescLocale)
      .setTimestamp()

      if(config.TicketAlert.DMUser) try {
        await ticketCreator.send({ embeds: [DMembed], components: [row2] });
      }catch(e){
          console.log('\x1b[33m%s\x1b[0m', "[INFO] I tried to DM a user, but their DM's are locked.");
          let logMsg = `\n\n[${new Date().toLocaleString()}] [ERROR] ${e.stack}`;
          await fs.appendFile("./logs.txt", logMsg, (e) => { 
            if(e) console.log(e);
          });
          }

          ticketChannel.send({ content: `<@!${ticketCreator.id}>`, embeds: [embed], components: [row], fetchReply: true }).then(async function(msg) {

            try {
                const filter = { channelID: ticketChannel.id };
                const update = {
                  closeNotificationTime: Date.now(),
                  closeNotificationMsgID: msg.id,
                  closeNotificationUserID: client.user.id,
                  channelID: ticketChannel.id,
                  closeUserID: client.user.id,
                  closeReason: "Closed automatically after time has passed with no response (Alert command)"
                };
              
                const options = { upsert: true, new: true, setDefaultsOnInsert: true };
              
                await ticketModel.findOneAndUpdate(filter, update, options);
              } catch (error) {
                console.error('Error updating ticket:', error);
              }
            })
    }
  });
}

// Alert Command notification automatically close ticket
if(config.TicketAlert.Enabled) {

const filtered = await ticketModel.find({ closeNotificationTime: { $exists: true } });
if (!filtered || filtered.length === 0) return;

if(!filtered) return
filtered.forEach(async time => {
  if(!time) return;
  if(!time.channelID) return;
  if(time.closeNotificationTime === 0 || !time.closeNotificationTime) return

  let date1 = new Date(time.closeNotificationTime);
  let date2 = new Date();

  let timeDifference = Math.abs(date1 - date2);
  let minutes = Math.floor(timeDifference / (1000 * 60));
  let ticketAlertTime = config.TicketAlert.Time;
  let timeValue = ms(ticketAlertTime) / (1000 * 60);

if(minutes > timeValue) {

  let ticketAuthor = await client.users.cache.get(time.userID)
  let closeUserID = await client.users.cache.get(time.closeUserID)
  let claimUser = await client.users.cache.get(time.claimUser)
  let totalMessages = time.messages
  //let ticketCloseReason = await time.closeReason
  let channel = await guild.channels.cache.get(time.channelID)

  if(!channel || !closeUserID || !ticketAuthor) return

  const { attachment, timestamp } = await utils.saveTranscriptAlertCmd(channel)

let aiSummary = null;
if (config.AI?.TicketCloseSummaries?.Enabled && config.AI?.TicketCloseSummaries?.IncludeInLogs) {
  try {
    aiSummary = await utils.generateTicketCloseSummary(time.channelID);
  } catch (error) {
    console.error('[TICKET ALERT] Error generating AI summary:', error);
    aiSummary = config.AI?.TicketCloseSummaries?.DefaultMessage || null;
  }
}

  const logEmbed = new Discord.EmbedBuilder()
  .setColor('#FF5D5D')
  .setAuthor({ name: `${config.Locale.ticketCloseTitle}` }) 
  .setThumbnail(closeUserID.displayAvatarURL({ format: 'png', dynamic: true, size: 1024 }))
  .setTimestamp();

let mainContent = '';

mainContent += `> **${config.Locale.logsTicketAuthor}:** <@!${ticketAuthor.id}> \`${ticketAuthor.username}\`\n`;

if(closeUserID) {
  mainContent += `> **${config.Locale.logsClosedBy}:** <@!${closeUserID.id}> \`${closeUserID.username}\`\n`;
  mainContent += `> 🕑 ${config.Locale.autoClose}\n`;
}

if(claimUser && config.ClaimingSystem.Enabled) {
  mainContent += `> **${config.Locale.ticketClaimedBy}:** <@!${claimUser.id}> \`${claimUser.username}\`\n`;
}

mainContent += `> **${config.Locale.ticketCategory}:** \`${time.ticketType}\`\n`;

  logEmbed.addFields([
    {
      name: `\`📋\` **${config.Locale.ticketDetails}**`,
      value: mainContent
    }
  ]);

  if (aiSummary && aiSummary.trim() !== '') {
    logEmbed.addFields([
      {
        name: `\`🤖\` **${config.Locale.aiSummary}**`,
        value: `> ${aiSummary}`
      }
    ]);
  }

if(time.participants && time.participants.length > 0) {
  let participantsContent = '';
  
  const sortedParticipants = [...time.participants].sort((a, b) => b.messageCount - a.messageCount);
  
  for(const participant of sortedParticipants) {
    participantsContent += `> <@!${participant.userID}> — **${participant.messageCount}** messages\n`;
  }
  
  logEmbed.addFields([
    {
      name: `\`👥\` **${config.Locale.ticketParticipants}**`,
      value: participantsContent
    }
  ]);
}

logEmbed.setFooter({ 
  text: `${config.Locale.totalMessagesLog} ${totalMessages}`, 
  iconURL: closeUserID.displayAvatarURL({ format: 'png', dynamic: true, size: 16 })
});

    const embedOptions = { embeds: [logEmbed] };
    const dashboardDB = await dashboardModel.findOne({ guildID: config.GuildID });

    const shouldIncludeAttachment = totalMessages >= config.TicketTranscriptSettings.MessagesRequirement && !dashboardExists

    if (shouldIncludeAttachment) {
      embedOptions.files = [attachment];
  }

              // Add "View Transcript" button if the dashboard exists
              if (dashboardExists && totalMessages >= config.TicketTranscriptSettings.MessagesRequirement && config.TicketTranscriptSettings.TranscriptType === "HTML" && config.TicketTranscriptSettings.SaveInFolder === true ) {
                const viewTranscriptButton = new Discord.ButtonBuilder()
                    .setLabel(config.Locale.viewTranscriptButton)
                    .setStyle('Link')
                    .setURL(`${dashboardDB.url}/transcript?channelId=${time.channelID}&dateNow=${timestamp}`)
                    .setEmoji('📝');
        
                const row = new Discord.ActionRowBuilder().addComponents(viewTranscriptButton);
        
                embedOptions.components = [row];
            }

    let closeLogMsgID;
    const logsChannel = await utils.getCategoryLogsChannel(channel.id);

    if(logsChannel) await logsChannel.send(embedOptions).then(async function(msg) { closeLogMsgID = msg.id })

    client.emit('sendUserDM', time, attachment, closeLogMsgID);

    await channel.delete().catch(e => {})

    await ticketModel.updateOne(
      { channelID: time.channelID },
      {
        $set: {
          closeUserID: "alert", 
        },
        $unset: {
          closeNotificationTime: 1,
          closeNotificationMsgID: 1,
          closeNotificationUserID: 1
        }
      }
    );

}
})
}
}, 300000);

// Check and update ticket statuses on bot start
try {
  const channelsInServer = guild.channels.cache.filter(c => c.type === 0);
  const ticketChannelsInDB = await ticketModel.find({ guildID: config.GuildID });

  for (const ticketInDB of ticketChannelsInDB) {
    const channelExists = channelsInServer.some(c => String(c.id) === String(ticketInDB.channelID));

    // Check if a ticket is found in the database for the current channel
    if (!channelExists) {
      // If the ticket channel doesn't exist in the server, update its status to closed
      ticketInDB.status = 'Closed';
      await ticketInDB.save();
    }
  }
} catch (error) {
  console.error('Error checking and updating ticket statuses on bot start:', error);
}

// Check if the InactivityMonitor is enabled
if (config.InactivityMonitor && config.InactivityMonitor.Enabled) {
  // Parse check interval (convert to milliseconds)
  const interval = ms(config.InactivityMonitor.CheckInterval);

  setInterval(async () => {
    try {
      // Get all open tickets
      const openTickets = await ticketModel.find({ status: 'Open', inactivityWarningSent: false });

      for (const ticket of openTickets) {
        // Check if the ticket is waiting for a staff response
        if (ticket.waitingReplyFrom === 'staff') {
          const now = moment();
          const lastMessageTime = moment(ticket.lastMessageSent);
          const unrespondedThreshold = ms(config.InactivityMonitor.UnrespondedDuration);

          // Check if the ticket exceeds the unresponded duration threshold
          if (now.diff(lastMessageTime, 'milliseconds') > unrespondedThreshold) {
            // Construct the log message
            const logChannel = client.channels.cache.get(config.InactivityMonitor.LogChannel);
            if (!logChannel) {
              console.log(`[ERROR] Log channel with ID ${config.InactivityMonitor.LogChannel} not found.`);
              return;
            }

            // Calculate human-readable unresponded duration
            const duration = now.diff(lastMessageTime, 'milliseconds');
            const durationDays = Math.floor(duration / (1000 * 60 * 60 * 24));
            const durationHours = Math.floor((duration % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
            const durationMinutes = Math.floor((duration % (1000 * 60 * 60)) / (1000 * 60));

            let unrespondedDuration = '';
            if (durationDays > 0) unrespondedDuration += `${durationDays} day${durationDays > 1 ? 's' : ''}`;
            if (durationHours > 0) unrespondedDuration += `${unrespondedDuration ? ', ' : ''}${durationHours} hour${durationHours > 1 ? 's' : ''}`;
            if (durationMinutes > 0 || unrespondedDuration === '') unrespondedDuration += `${unrespondedDuration ? ', ' : ''}${durationMinutes} minute${durationMinutes > 1 ? 's' : ''}`;

            const ticketCreationTimestamp = `<t:${Math.floor(moment(ticket.ticketCreationDate).unix())}:F>`;
            const ticketLink = `https://discord.com/channels/${ticket.guildID}/${ticket.channelID}`;

            const logMessage = config.InactivityMonitor.LogMessage
              .replace(/{ticketLink}/g, ticketLink)
              .replace(/{channel}/g, `<#${ticket.channelID}>`)
              .replace(/{ticketCreationDate}/g, ticketCreationTimestamp)
              .replace(/{unrespondedDuration}/g, unrespondedDuration);

            const embed = new Discord.EmbedBuilder()
              .setColor('Red')
              .setDescription(logMessage)
              .setFooter({ text: `#${ticket.identifier}` })
              .setTimestamp();

              const rolesToPing = config.InactivityMonitor.RolesToPing
              .map(roleId => `<@&${roleId}>`)
              .join(' ');

            await logChannel.send({ 
              content: rolesToPing,
              embeds: [embed] 
            });

            ticket.inactivityWarningSent = true;
            await ticket.save();
          }
        }
      }
    } catch (err) {
      console.error(`[ERROR] InactivityMonitor encountered an error: ${err.message}`);
    }
  }, interval);
}

    // Increase timesBotStarted by 1 everytime the bot starts
    statsDB.timesBotStarted++;
    await statsDB.save();

    // Send first start message
    if(statsDB.timesBotStarted === 1) {
      console.log(``)
      console.log(``)
      console.log(`Thank you for choosing ${color.yellow('Plex Tickets')}!`)
      console.log(`Since this is your first time starting the bot, Here is some important information:`)
      console.log(``)
      console.log(`If you need any help, Create a ticket in our discord server.`)
      console.log(`You can also look at our documentation for help, ${color.yellow(`docs.plexdevelopment.net`)}`)
      console.log(``)
      console.log(`${color.bold.red(`WARNING:\n Leaking, redistributing or re-selling any of our products is not allowed \nYour actions may have legal consequences if you violate our terms.\nif you are found doing it, your license will be permanently disabled!`)}`)
      console.log(`By using this bot you agree to all terms located here, ${color.yellow(`plexdevelopment.net/tos`)}`)
    }
}