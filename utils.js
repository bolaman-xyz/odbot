const { Collection, Client, Discord, Intents, AttachmentBuilder, ActionRowBuilder, EmbedBuilder, ButtonBuilder } = require('discord.js');
const fs = require('fs');
const yaml = require("js-yaml")
const config = yaml.load(fs.readFileSync('./config.yml', 'utf8'))
const client = require("./index.js")
const color = require('ansi-colors');
const axios = require('axios')
const OpenAI = require('openai');
let discordTranscripts;
if(config.TicketTranscriptSettings.TranscriptType === "HTML") discordTranscripts = require('discord-html-transcripts')

const { EventEmitter } = require('events');
const eventHandler = new EventEmitter();
  
exports.eventHandler = eventHandler;

client.cooldowns = new Collection();

const guildModel = require("./models/guildModel");
const ticketModel = require("./models/ticketModel");

const stripe = require('stripe')(config.StripeSettings.StripeSecretKey, {
  apiVersion: '2020-08-27',
});

client.stripe = stripe;

const paypal = require("paypal-rest-sdk");
paypal.configure({
  'mode': 'live',
  'client_id': config.PayPalSettings.PayPalClientID,
  'client_secret': config.PayPalSettings.PayPalSecretKey
});
client.paypal = paypal;


if(config.CryptoSettings.Enabled) {
    client.getCryptoPrice = async (cryptoCurrency, fiatCurrency, fiatAmount) => {
        try {
            const url = `https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,tether,litecoin&vs_currencies=${fiatCurrency.toLowerCase()}`;
            const response = await axios.get(url);
            
            const cryptoMap = {
                'BTC': 'bitcoin',
                'ETH': 'ethereum', 
                'USDT': 'tether',
                'LTC': 'litecoin'
            };
            
            const coinId = cryptoMap[cryptoCurrency];
            if (!coinId) {
                console.error('Unsupported crypto currency:', cryptoCurrency);
                return null;
            }
            
            const cryptoPrice = response.data[coinId][fiatCurrency.toLowerCase()];
            if (!cryptoPrice) {
                console.error('Could not get price for', cryptoCurrency, 'in', fiatCurrency);
                return null;
            }
            
            const cryptoAmount = fiatAmount / cryptoPrice;
            
            if (cryptoCurrency === 'BTC') return cryptoAmount.toFixed(8);
            if (cryptoCurrency === 'ETH') return cryptoAmount.toFixed(6);
            if (cryptoCurrency === 'USDT') return cryptoAmount.toFixed(2);
            if (cryptoCurrency === 'LTC') return cryptoAmount.toFixed(6);
            
            return cryptoAmount.toFixed(8);
            
        } catch (error) {
            console.error('Error fetching crypto price:', error.message);
            return null;
        }
    };
}


fs.readdir('./events/', (err, files) => {
    if (err) return console.error(err);
  
    console.log(`${color.green(`[SYSTEM] Loading events...`)}`);
    
    let eventCount = 0;
    files.forEach(file => {
      if(!file.endsWith('.js')) return;
      
      const evt = require(`./events/${file}`);
      let evtName = file.split('.')[0];
      client.on(evtName, evt.bind(null, client));
      console.log(`${color.green(`[EVENT]`)} ${file} ${color.green('loaded!')}`);
      eventCount++;
    });
    
    console.log(`${color.green(`[SYSTEM]`)} Loaded ${eventCount} events!`);
  });


// Get average ticket rating
  exports.averageRating = async function (client) {
    try {
      const guild = await guildModel.findOne({ guildID: config.GuildID });
      if (!guild) return "0.0";
  
      const ratings = guild.reviews.map(review => review.rating);
      const nonZeroRatings = ratings.filter(rating => rating !== 0);
      const average = nonZeroRatings.length ? (nonZeroRatings.reduce((a, b) => a + b) / nonZeroRatings.length).toFixed(1) : "0.0";

      guild.averageRating = average;
      await guild.save();

      return average;
    } catch (error) {
      console.error('Error fetching guild data:', error);
      return "0.0";
    }
  };

  exports.createSuggestionButtons = async function (suggestion, disabled = false) {
    const totalVotes = suggestion.upVotes + suggestion.downVotes;
    const upvotePercentage = totalVotes > 0 ? Math.round((suggestion.upVotes / totalVotes) * 100) : 0;
    const downvotePercentage = totalVotes > 0 ? Math.round((suggestion.downVotes / totalVotes) * 100) : 0;
    
    const buttonStyleMap = {
        "Blurple": "Primary",
        "Gray": "Secondary",
        "Green": "Success",
        "Red": "Danger"
    };

    const upvoteStyle = buttonStyleMap[config.SuggestionUpvote.ButtonColor] || "Secondary";
    const downvoteStyle = buttonStyleMap[config.SuggestionDownvote.ButtonColor] || "Secondary";
    const resetvoteStyle = buttonStyleMap[config.SuggestionResetvote.ButtonColor] || "Secondary";
    
    let upvoteLabel = config.SuggestionUpvote.ButtonName;
    let downvoteLabel = config.SuggestionDownvote.ButtonName;
    
    upvoteLabel = upvoteLabel.replace("{count}", suggestion.upVotes).replace("{percentage}", upvotePercentage);
    downvoteLabel = downvoteLabel.replace("{count}", suggestion.downVotes).replace("{percentage}", downvotePercentage);
    
    const upvoteButton = new ButtonBuilder()
        .setCustomId('upvote')
        .setLabel(upvoteLabel)
        .setStyle(upvoteStyle)
        .setEmoji(config.SuggestionUpvote.ButtonEmoji)
        .setDisabled(disabled);

    const downvoteButton = new ButtonBuilder()
        .setCustomId('downvote')
        .setLabel(downvoteLabel)
        .setStyle(downvoteStyle)
        .setEmoji(config.SuggestionDownvote.ButtonEmoji)
        .setDisabled(disabled);

    const resetvoteButton = new ButtonBuilder()
        .setCustomId('resetvote')
        .setLabel(config.SuggestionResetvote.ButtonName)
        .setStyle(resetvoteStyle)
        .setEmoji(config.SuggestionResetvote.ButtonEmoji)
        .setDisabled(disabled);
  
    return new ActionRowBuilder().addComponents(upvoteButton, downvoteButton, resetvoteButton);
}

exports.checkConfig = async function(client) {
    let foundErrors = [];
    try {
      let guild = client.guilds.cache.get(config.GuildID);
      if (!guild) {
        console.log('\x1b[31m%s\x1b[0m', `[CRITICAL ERROR] Invalid GuildID in config! Bot is not in this guild.`);
        foundErrors.push("Invalid GuildID in config! Bot is not in this guild or missing permissions.");
        // Continue checking other config as much as possible even if guild is invalid
      }
  
    // Check for required locale values
    const requiredLocaleKeys = [
      "NoPermsMessage", "RoleBlacklistedTitle", "RoleBlacklistedMsg", "AlreadyOpenTitle", 
      "AlreadyOpenMsg", "CloseTicketButton", "ticketCreatedTitle", "ticketCreatedMsg", 
      "deletingTicketMsg", "PayPalInvoiceMsg", "PayPalUser", "PayPalPrice", "PayPalService", 
      "PayPalPayInvoice", "PayPalLogTitle", "NotInTicketChannel", "ticketUserAdd", "ticketUserRemove", 
      "ticketRenamed", "userAddTitle", "userRemoveTitle", "ticketCloseTitle", "ticketRenameTitle", 
      "logsExecutor", "logsTicket", "logsUser", "logsTicketAuthor", "logsClosedBy", "logsDeletedBy", 
      "restrictTicketClose", "ticketPinned", "ticketAlreadyPinned", "suggestionSubmit", "suggestionTitle", 
      "suggestionStatsTitle", "suggestionsTotal", "suggestionsTotalUpvotes", "suggestionsTotalDownvotes", 
      "suggestionInformation", "suggestionUpvotes", "suggestionDownvotes", "suggestionFrom", "suggestionStatus", 
      "newSuggestionTitle", "suggestionVoteResetTitle", "suggestionVoteReset", "suggestionNoVoteTitle", 
      "suggestionNoVote", "suggestionDownvotedTitle", "suggestionDownvoted", "suggestionAlreadyVotedTitle", 
      "suggestionAlreadyVoted", "suggestionUpvotedTitle", "suggestionUpvoted", "suggestionAcceptedTitle", 
      "suggestionAccepted", "suggestionDeniedTitle", "suggestionDenied", "suggestionNoPerms", 
      "suggestionCantVoteTitle", "suggestionCantVote", "cryptoLogTitle", "restrictTicketClaim", 
      "claimTicketButton", "unclaimTicketButton", "ticketClaimedBy", "ticketUnClaimedBy", 
      "ticketClaimedTitle", "ticketUnClaimedTitle", "ticketNotClaimed", "ticketClaimed", "ticketUnClaimed", 
      "ticketDidntClaim", "ticketClaimedLog", "ticketUnClaimedLog", "claimTicketMsg", "unclaimTicketMsg", 
      "totalMessagesLog", "totalTickets", "openTickets", "totalClaims", "guildStatistics", "statsTickets", 
      "alreadyBlacklisted", "successfullyBlacklisted", "notBlacklisted", "successfullyUnblacklisted", 
      "userBlacklistedTitle", "userBlacklistedMsg", "ticketInformationCloseDM", "categoryCloseDM", 
      "claimedByCloseDM", "ticketClosedCloseDM", "notClaimedCloseDM", "ticketRating", "totalReviews", 
      "averageRating", "cooldownEmbedMsgTitle", "cooldownEmbedMsg", "selectCategory", "selectReview", 
      "explainWhyRating", "ratingsStats", "cryptoQRCode", "userLeftTitle", "userLeftDescription", 
      "reOpenButton", "transcriptButton", "deleteTicketButton", "ticketClosedBy", "ticketReOpenedBy", 
      "ticketTranscriptCategory", "notAllowedDelete", "StripeLogTitle", "ticketForceDeleted", "reason", 
      "requiredRoleMissing", "requiredRoleTitle", "notAnswered", "answeringQuestionsSuccess", 
      "dmTranscriptClickhere", "viewTranscriptButton", "averageCompletionTime", "averageResponseTime", 
      "whyCloseTicket", "ticketCloseReasonTitle", "ticketCategory", "ticketDetails", "autoClose", 
      "ticketParticipants", "userDetails", "oldName", "newName", "renameDetails", "closeReasonDM", 
      "claimDetails", "unclaimDetails", "autoClaimedNote", "transcriptTitle", "transcriptDescription",
      "transcriptFooter", "transcriptGenerationFailed", "transcriptError", "transcriptLogTitle", "transcriptDetails", "aiSummary",
      "archiveDetails", "archivedBy", "archivedAt", "reopenDetails", "reopenedBy", "reopenedAt", "ticketReopened", "archivinTicketTitle",
      "archivingTicket"
    ];
    
    // Check if Locale is defined
    if (!config.Locale) {
      console.log('\x1b[31m%s\x1b[0m', `[CRITICAL ERROR] Missing Locale section in config!`);
      foundErrors.push("Missing Locale section in config!");
    } else {
      // Check for missing locale values
      requiredLocaleKeys.forEach(localeKey => {
        if (config.Locale[localeKey] === undefined) {
          console.log('\x1b[31m%s\x1b[0m', `[WARNING] Locale.${localeKey} is missing! This may cause unexpected behavior.`);
          foundErrors.push(`Locale.${localeKey} is missing! This may cause unexpected behavior.`);
        } else if (typeof config.Locale[localeKey] !== 'string') {
          console.log('\x1b[31m%s\x1b[0m', `[WARNING] Locale.${localeKey} is not a string! All locale values must be text.`);
          foundErrors.push(`Locale.${localeKey} is not a string! All locale values must be text.`);
        }
      });
    }

      // Check basic global settings
      var hexColorRegex = /^#([0-9a-f]{3}){1,2}$/i;
      if (!config.EmbedColors || !hexColorRegex.test(config.EmbedColors)) {
        console.log('\x1b[31m%s\x1b[0m', `[WARNING] EmbedColors is not a valid HEX Color! Should be like: #FF5555`);
        foundErrors.push("EmbedColors is not a valid HEX Color! Should be like: #FF5555");
      }
  
      // Check for required ticket settings
      if (!config.TicketSettings) {
        console.log('\x1b[31m%s\x1b[0m', `[CRITICAL ERROR] Missing TicketSettings section in config!`);
        foundErrors.push("Missing TicketSettings section in config!");
      } else {
        if (!config.TicketSettings.LogsChannelID || config.TicketSettings.LogsChannelID.trim() === "") {
          console.log('\x1b[31m%s\x1b[0m', `[CRITICAL ERROR] TicketSettings.LogsChannelID is required and cannot be empty!`);
          foundErrors.push("TicketSettings.LogsChannelID is required and cannot be empty!");
        } else if (guild && !guild.channels.cache.get(config.TicketSettings.LogsChannelID)) {
          console.log('\x1b[31m%s\x1b[0m', `[CRITICAL ERROR] TicketSettings.LogsChannelID is not a valid channel!`);
          foundErrors.push("TicketSettings.LogsChannelID is not a valid channel!");
        }
        
        // Check MaxTickets is a number
        if (isNaN(config.TicketSettings.MaxTickets) || config.TicketSettings.MaxTickets < 1) {
          console.log('\x1b[31m%s\x1b[0m', `[WARNING] TicketSettings.MaxTickets should be a number greater than 0!`);
          foundErrors.push("TicketSettings.MaxTickets should be a number greater than 0!");
        }
        
        // Check TicketCooldown is a number
        if (isNaN(config.TicketSettings.TicketCooldown) || config.TicketSettings.TicketCooldown < 0) {
          console.log('\x1b[31m%s\x1b[0m', `[WARNING] TicketSettings.TicketCooldown should be a number greater than or equal to 0!`);
          foundErrors.push("TicketSettings.TicketCooldown should be a number greater than or equal to 0!");
        }
      }
      
  
      let dashboardExists = await exports.checkDashboard();
      try {
        if (dashboardExists) {
          if (config.TicketTranscriptSettings.TranscriptType !== "HTML") {
            console.log('\x1b[31m%s\x1b[0m', `[CRITICAL ERROR] Dashboard is enabled but TicketTranscriptSettings.TranscriptType is not set to "HTML"! Transcripts will not be viewable on the dashboard.`);
            foundErrors.push("Dashboard is enabled but TicketTranscriptSettings.TranscriptType is not set to \"HTML\"! Transcripts will not be viewable on the dashboard.");
          }
          
          if (!config.TicketTranscriptSettings.SaveInFolder) {
            console.log('\x1b[31m%s\x1b[0m', `[CRITICAL ERROR] Dashboard is enabled but TicketTranscriptSettings.SaveInFolder is not enabled! Transcripts will not be viewable on the dashboard.`);
            foundErrors.push("Dashboard is enabled but TicketTranscriptSettings.SaveInFolder is not enabled! Transcripts will not be viewable on the dashboard.");
          }
        }
      } catch (error) {
      }

      // Check if TicketPanels exists
      if (!config.TicketPanels || Object.keys(config.TicketPanels).length === 0) {
        console.log('\x1b[31m%s\x1b[0m', `[CRITICAL ERROR] Missing or empty TicketPanels section in config!`);
        foundErrors.push("Missing or empty TicketPanels section in config!");
      } else {
        // Validate each ticket panel
        for (const panelId in config.TicketPanels) {
          const panel = config.TicketPanels[panelId];
          
          if (!panel.Name) {
            console.log('\x1b[31m%s\x1b[0m', `[WARNING] ${panelId}.Name is missing!`);
            foundErrors.push(`${panelId}.Name is missing!`);
          }
          
          if (!panel.Categories || !Array.isArray(panel.Categories) || panel.Categories.length === 0) {
            console.log('\x1b[31m%s\x1b[0m', `[WARNING] ${panelId}.Categories is missing or empty! At least one category is required.`);
            foundErrors.push(`${panelId}.Categories is missing or empty! At least one category is required.`);
          } else {
            // Check that each category in the panel exists in TicketCategories
            panel.Categories.forEach(catId => {
              if (!config.TicketCategories || !config.TicketCategories[catId]) {
                console.log('\x1b[31m%s\x1b[0m', `[WARNING] ${panelId} references non-existent category "${catId}"!`);
                foundErrors.push(`${panelId} references non-existent category "${catId}"!`);
              }
            });
          }
          
          // Check Embed section
          if (!panel.Embed) {
            console.log('\x1b[31m%s\x1b[0m', `[WARNING] ${panelId}.Embed section is missing!`);
            foundErrors.push(`${panelId}.Embed section is missing!`);
          } else {
            if (!panel.Embed.Title) {
              console.log('\x1b[31m%s\x1b[0m', `[WARNING] ${panelId}.Embed.Title is missing!`);
              foundErrors.push(`${panelId}.Embed.Title is missing!`);
            }
            
            if (!panel.Embed.Description) {
              console.log('\x1b[31m%s\x1b[0m', `[WARNING] ${panelId}.Embed.Description is missing!`);
              foundErrors.push(`${panelId}.Embed.Description is missing!`);
            }
            
            if (panel.Embed.Color && !hexColorRegex.test(panel.Embed.Color)) {
              console.log('\x1b[31m%s\x1b[0m', `[WARNING] ${panelId}.Embed.Color is not a valid HEX color! Should be like: #FF5555`);
              foundErrors.push(`${panelId}.Embed.Color is not a valid HEX color! Should be like: #FF5555`);
            }
            
            // Check Footer settings
            if (panel.Embed.Footer && panel.Embed.Footer.Enabled) {
              if (panel.Embed.Footer.CustomIconURL && !panel.Embed.Footer.text) {
                console.log('\x1b[31m%s\x1b[0m', `[WARNING] ${panelId}.Embed.Footer.CustomIconURL requires Footer.text to be set!`);
                foundErrors.push(`${panelId}.Embed.Footer.CustomIconURL requires Footer.text to be set!`);
              }
            }
          }
        }
      }
  
      // Check if TicketCategories exists
      if (!config.TicketCategories || Object.keys(config.TicketCategories).length === 0) {
        console.log('\x1b[31m%s\x1b[0m', `[CRITICAL ERROR] Missing or empty TicketCategories section in config!`);
        foundErrors.push("Missing or empty TicketCategories section in config!");
      } else {
        // Validate each ticket category
        for (const categoryId in config.TicketCategories) {
          const category = config.TicketCategories[categoryId];
          
          // Check for missing required fields
        if (!category.CategoryName) {
          console.log('\x1b[31m%s\x1b[0m', `[WARNING] ${categoryId}.CategoryName is missing!`);
          foundErrors.push(`${categoryId}.CategoryName is missing!`);
        } else if (category.CategoryName.length > 80) {
          console.log('\x1b[31m%s\x1b[0m', `[WARNING] ${categoryId}.CategoryName is too long! Maximum is 80 characters due to Discord button limitations.`);
          foundErrors.push(`${categoryId}.CategoryName is too long! Maximum is 80 characters due to Discord button limitations.`);
        }
          
        if (!category.ParentCategoryID) {
          console.log('\x1b[31m%s\x1b[0m', `[WARNING] ${categoryId}.ParentCategoryID is missing!`);
          foundErrors.push(`${categoryId}.ParentCategoryID is missing!`);
        } else if (guild && guild.channels.cache.get(category.ParentCategoryID)?.type !== 4) {
          console.log('\x1b[31m%s\x1b[0m', `[WARNING] ${categoryId}.ParentCategoryID is not a valid category!`);
          foundErrors.push(`${categoryId}.ParentCategoryID is not a valid category!`);
        }
        
        if (!category.EmbedTitle) {
          console.log('\x1b[31m%s\x1b[0m', `[WARNING] ${categoryId}.EmbedTitle is missing!`);
          foundErrors.push(`${categoryId}.EmbedTitle is missing!`);
        } else if (category.EmbedTitle.length > 256) {
          console.log('\x1b[31m%s\x1b[0m', `[WARNING] ${categoryId}.EmbedTitle is too long! Maximum is 256 characters due to Discord embed title limitations.`);
          foundErrors.push(`${categoryId}.EmbedTitle is too long! Maximum is 256 characters due to Discord embed title limitations.`);
        }
        
        if (!category.EmbedMessage) {
          console.log('\x1b[31m%s\x1b[0m', `[WARNING] ${categoryId}.EmbedMessage is missing!`);
          foundErrors.push(`${categoryId}.EmbedMessage is missing!`);
        } else if (category.EmbedMessage.length > 4000) {
          console.log('\x1b[31m%s\x1b[0m', `[WARNING] ${categoryId}.EmbedMessage is too long! Maximum is 4000 characters due to Discord embed description limitations.`);
          foundErrors.push(`${categoryId}.EmbedMessage is too long! Maximum is 4000 characters due to Discord embed description limitations.`);
        }
          
          if (!category.ChannelName) {
            console.log('\x1b[31m%s\x1b[0m', `[WARNING] ${categoryId}.ChannelName is missing!`);
            foundErrors.push(`${categoryId}.ChannelName is missing!`);
          }
          
          // Check for invalid button colors
          if (!category.ButtonColor) {
            console.log('\x1b[31m%s\x1b[0m', `[WARNING] ${categoryId}.ButtonColor is missing!`);
            foundErrors.push(`${categoryId}.ButtonColor is missing!`);
          } else if (!["Blurple", "Gray", "Green", "Red"].includes(category.ButtonColor)) {
            console.log('\x1b[31m%s\x1b[0m', `[WARNING] ${categoryId}.ButtonColor is not a valid color! Valid colors: Blurple, Gray, Green, Red (CASE SENSITIVE)`);
            foundErrors.push(`${categoryId}.ButtonColor is not a valid color! Valid colors: Blurple, Gray, Green, Red (CASE SENSITIVE)`);
          }
          
          // Check for category descriptions longer than 100 characters
          if (category.Description && category.Description.length > 100) {
            console.log('\x1b[31m%s\x1b[0m', `[WARNING] ${categoryId}.Description can't be longer than 100 characters!`);
            foundErrors.push(`${categoryId}.Description can't be longer than 100 characters!`);
          }
          
          // Check for invalid support roles
        if (!category.SupportRoles || !Array.isArray(category.SupportRoles) || category.SupportRoles.length === 0) {
          console.log('\x1b[31m%s\x1b[0m', `[WARNING] ${categoryId}.SupportRoles is missing or empty! At least one support role is required.`);
          foundErrors.push(`${categoryId}.SupportRoles is missing or empty! At least one support role is required.`);
        } else if (!category.SupportRoles.every(roleid => typeof roleid === 'string')) {
          console.log('\x1b[31m%s\x1b[0m', `[WARNING] ${categoryId}.SupportRoles is not in the correct format! Example of correct format: ["ROLE_ID", "ROLE_ID"] or ["ROLE_ID"]`);
          foundErrors.push(`${categoryId}.SupportRoles is not in the correct format! Example of correct format: ["ROLE_ID", "ROLE_ID"] or ["ROLE_ID"]`);
        } else if (guild) {
          category.SupportRoles.forEach(roleid => {
            const role = guild.roles.cache.get(roleid);
            
            if (!role) {
              console.log('\x1b[31m%s\x1b[0m', `[WARNING] ${categoryId}.SupportRoles contains an invalid role! (${roleid})`);
              foundErrors.push(`${categoryId}.SupportRoles contains an invalid role! (${roleid})`);
            }
          });
          
          if (category.SupportRoles.includes(guild.id)) {
            console.log('\x1b[31m%s\x1b[0m', `[WARNING] ${categoryId}.SupportRoles contains the @everyone role! This can cause privacy issues for tickets.`);
            foundErrors.push(`${categoryId}.SupportRoles contains the @everyone role! This can cause privacy issues for tickets.`);
          }
        }
          
          // Check for invalid RequiredRoles format if present
        if (category.RequiredRoles) {
          if (!Array.isArray(category.RequiredRoles)) {
            console.log('\x1b[31m%s\x1b[0m', `[WARNING] ${categoryId}.RequiredRoles is not in the correct format! Example of correct format: ["ROLE_ID", "ROLE_ID"] or ["ROLE_ID"] or []`);
            foundErrors.push(`${categoryId}.RequiredRoles is not in the correct format! Example of correct format: ["ROLE_ID", "ROLE_ID"] or ["ROLE_ID"] or []`);
          } else if (category.RequiredRoles.length > 0 && !category.RequiredRoles.every(roleid => typeof roleid === 'string')) {
            console.log('\x1b[31m%s\x1b[0m', `[WARNING] ${categoryId}.RequiredRoles contains non-string values! Each role ID must be a string.`);
            foundErrors.push(`${categoryId}.RequiredRoles contains non-string values! Each role ID must be a string.`);
          } else if (guild && category.RequiredRoles.length > 0) {
            category.RequiredRoles.forEach(roleid => {
              const role = guild.roles.cache.get(roleid);
              
              if (!role) {
                console.log('\x1b[31m%s\x1b[0m', `[WARNING] ${categoryId}.RequiredRoles contains an invalid role! (${roleid})`);
                foundErrors.push(`${categoryId}.RequiredRoles contains an invalid role! (${roleid})`);
              }
            });
            
            // Check if @everyone role is used in RequiredRoles
            if (category.RequiredRoles.includes(guild.id)) {
              console.log('\x1b[33m%s\x1b[0m', `[NOTICE] ${categoryId}.RequiredRoles contains the @everyone role. This means everyone can open tickets in this category, which is the same as having no required roles.`);
              foundErrors.push(`${categoryId}.RequiredRoles contains the @everyone role. This means everyone can open tickets in this category, which is the same as having no required roles.`);
            }
          }
        }
          
          // Check for invalid emojis if present
          if (category.CategoryEmoji) {
            const emojiRegex = require('emoji-regex');
            const discordEmojiRegex = /<a?:[a-zA-Z0-9_]+:(\d+)>/;
            const emojiPattern = emojiRegex();
            const emojiMatch = emojiPattern.exec(category.CategoryEmoji);
            const discordEmojiMatch = category.CategoryEmoji.match(discordEmojiRegex);
  
            if (!emojiMatch && !discordEmojiMatch) {
              console.log('\x1b[31m%s\x1b[0m', `[WARNING] ${categoryId}.CategoryEmoji contains an invalid emoji! (${category.CategoryEmoji})`);
              foundErrors.push(`${categoryId}.CategoryEmoji contains an invalid emoji! (${category.CategoryEmoji})`);
            }
          }
          
        if (category.MentionSupportRoles !== undefined && typeof category.MentionSupportRoles !== 'boolean') {
          console.log('\x1b[31m%s\x1b[0m', `[WARNING] ${categoryId}.MentionSupportRoles must be true or false!`);
          foundErrors.push(`${categoryId}.MentionSupportRoles must be true or false!`);
        }

          // Check if questions are present and valid
          if (category.Questions) {
            if (!Array.isArray(category.Questions)) {
              console.log('\x1b[31m%s\x1b[0m', `[WARNING] ${categoryId}.Questions should be an array!`);
              foundErrors.push(`${categoryId}.Questions should be an array!`);
            } else {
              const customIdSet = new Set();
              
              // Check for more than 5 questions
              if (category.Questions.length > 5) {
                console.log('\x1b[31m%s\x1b[0m', `[WARNING] ${categoryId} has more than 5 questions! (Each category can only have a max of 5 questions, due to a Discord limitation)`);
                foundErrors.push(`${categoryId} has more than 5 questions! (Each category can only have a max of 5 questions, due to a Discord limitation)`);
              }
              
              category.Questions.forEach((question, index) => {
                // Check for missing or invalid customId
                if (!question.customId) {
                  console.log('\x1b[31m%s\x1b[0m', `[WARNING] ${categoryId}.Questions[${index}] is missing a customId!`);
                  foundErrors.push(`${categoryId}.Questions[${index}] is missing a customId!`);
                } else if (typeof question.customId !== 'string') {
                  console.log('\x1b[31m%s\x1b[0m', `[WARNING] ${categoryId}.Questions[${index}] customId must be a string!`);
                  foundErrors.push(`${categoryId}.Questions[${index}] customId must be a string!`);
                } else if (/\s/.test(question.customId)) {
                  console.log('\x1b[31m%s\x1b[0m', `[WARNING] ${categoryId}.Questions[${index}] customId cannot contain spaces!`);
                  foundErrors.push(`${categoryId}.Questions[${index}] customId cannot contain spaces!`);
                } else if (customIdSet.has(question.customId)) {
                  console.log('\x1b[31m%s\x1b[0m', `[WARNING] ${categoryId}.Questions[${index}] has a duplicate customId: ${question.customId}!`);
                  foundErrors.push(`${categoryId}.Questions[${index}] has a duplicate customId: ${question.customId}!`);
                } else {
                  customIdSet.add(question.customId);
                }
                
                // Check for missing question text
                if (!question.question) {
                  console.log('\x1b[31m%s\x1b[0m', `[WARNING] ${categoryId}.Questions[${index}] is missing the question text!`);
                  foundErrors.push(`${categoryId}.Questions[${index}] is missing the question text!`);
                } else if (question.question.length > 45) {
                  console.log('\x1b[31m%s\x1b[0m', `[WARNING] ${categoryId}.Questions[${index}] question text is too long! Maximum is 45 characters due to Discord limitations.`);
                  foundErrors.push(`${categoryId}.Questions[${index}] question text is too long! Maximum is 45 characters due to Discord limitations.`);
                }
                
                // Check for valid required parameter
                if (question.required === undefined) {
                  console.log('\x1b[31m%s\x1b[0m', `[WARNING] ${categoryId}.Questions[${index}] is missing the required parameter!`);
                  foundErrors.push(`${categoryId}.Questions[${index}] is missing the required parameter!`);
                } else if (typeof question.required !== 'boolean') {
                  console.log('\x1b[31m%s\x1b[0m', `[WARNING] ${categoryId}.Questions[${index}] required parameter must be true or false!`);
                  foundErrors.push(`${categoryId}.Questions[${index}] required parameter must be true or false!`);
                }
                
                // Check for valid style
                if (!question.style) {
                  console.log('\x1b[31m%s\x1b[0m', `[WARNING] ${categoryId}.Questions[${index}] is missing the style parameter!`);
                  foundErrors.push(`${categoryId}.Questions[${index}] is missing the style parameter!`);
                } else {
                  const validStyles = ['short', 'paragraph'];
                  if (!validStyles.includes(question.style.toLowerCase())) {
                    console.log('\x1b[31m%s\x1b[0m', `[WARNING] ${categoryId}.Questions[${index}] has an invalid style! Style must be one of: ${validStyles.join(', ')}.`);
                    foundErrors.push(`${categoryId}.Questions[${index}] has an invalid style! Style must be one of: ${validStyles.join(', ')}.`);
                  }
                }
                
                // Check minLength if present
                if (question.minLength !== undefined && (isNaN(question.minLength) || question.minLength < 1)) {
                  console.log('\x1b[31m%s\x1b[0m', `[WARNING] ${categoryId}.Questions[${index}] minLength must be a number greater than 0!`);
                  foundErrors.push(`${categoryId}.Questions[${index}] minLength must be a number greater than 0!`);
                }
                
                // Check placeholder length if present
                if (question.placeholder && question.placeholder.length > 100) {
                  console.log('\x1b[31m%s\x1b[0m', `[WARNING] ${categoryId}.Questions[${index}] placeholder is too long! Maximum is 100 characters.`);
                  foundErrors.push(`${categoryId}.Questions[${index}] placeholder is too long! Maximum is 100 characters.`);
                }
              });
            }
          }
        }
      }
  
if (config.SuggestionSettings?.Enabled) {
        if (!config.SuggestionSettings.ChannelID || config.SuggestionSettings.ChannelID.trim() === "") {
          console.log('\x1b[31m%s\x1b[0m', `[CRITICAL ERROR] SuggestionSettings.ChannelID is required when suggestions are enabled!`);
          foundErrors.push("SuggestionSettings.ChannelID is required when suggestions are enabled!");
        } else if (guild && !guild.channels.cache.get(config.SuggestionSettings.ChannelID)) {
          console.log('\x1b[31m%s\x1b[0m', `[CRITICAL ERROR] SuggestionSettings.ChannelID is not a valid channel!`);
          foundErrors.push("SuggestionSettings.ChannelID is not a valid channel!");
        }

        if (config.SuggestionSettings.EnableAcceptDenySystem !== undefined && typeof config.SuggestionSettings.EnableAcceptDenySystem !== 'boolean') {
          console.log('\x1b[31m%s\x1b[0m', `[WARNING] SuggestionSettings.EnableAcceptDenySystem must be true or false!`);
          foundErrors.push("SuggestionSettings.EnableAcceptDenySystem must be true or false!");
        }

        if (config.SuggestionSettings.RemoveAllButtonsIfAcceptedOrDenied !== undefined && typeof config.SuggestionSettings.RemoveAllButtonsIfAcceptedOrDenied !== 'boolean') {
          console.log('\x1b[31m%s\x1b[0m', `[WARNING] SuggestionSettings.RemoveAllButtonsIfAcceptedOrDenied must be true or false!`);
          foundErrors.push("SuggestionSettings.RemoveAllButtonsIfAcceptedOrDenied must be true or false!");
        }

        if (config.SuggestionSettings.CreateThreads !== undefined && typeof config.SuggestionSettings.CreateThreads !== 'boolean') {
          console.log('\x1b[31m%s\x1b[0m', `[WARNING] SuggestionSettings.CreateThreads must be true or false!`);
          foundErrors.push("SuggestionSettings.CreateThreads must be true or false!");
        }

        if (!config.SuggestionSettings.AllowedRoles || !Array.isArray(config.SuggestionSettings.AllowedRoles) || config.SuggestionSettings.AllowedRoles.length === 0) {
          console.log('\x1b[31m%s\x1b[0m', `[WARNING] SuggestionSettings.AllowedRoles is missing or empty! At least one role is required for accepting/denying suggestions.`);
          foundErrors.push("SuggestionSettings.AllowedRoles is missing or empty! At least one role is required for accepting/denying suggestions.");
        } else if (guild) {
          config.SuggestionSettings.AllowedRoles.forEach((roleId, index) => {
            if (!guild.roles.cache.get(roleId)) {
              console.log('\x1b[31m%s\x1b[0m', `[WARNING] SuggestionSettings.AllowedRoles[${index}] contains an invalid role! (${roleId})`);
              foundErrors.push(`SuggestionSettings.AllowedRoles[${index}] contains an invalid role! (${roleId})`);
            }
          });
        }

        if (config.SuggestionSettings.LogsChannel && config.SuggestionSettings.LogsChannel.trim() !== "" && config.SuggestionSettings.LogsChannel !== "CHANNEL_ID") {
          if (guild && !guild.channels.cache.get(config.SuggestionSettings.LogsChannel)) {
            console.log('\x1b[31m%s\x1b[0m', `[WARNING] SuggestionSettings.LogsChannel is not a valid channel!`);
            foundErrors.push("SuggestionSettings.LogsChannel is not a valid channel!");
          }
        }

        if (!config.SuggestionStatuses) {
          console.log('\x1b[31m%s\x1b[0m', `[WARNING] SuggestionStatuses section is missing!`);
          foundErrors.push("SuggestionStatuses section is missing!");
        } else {
          const requiredStatuses = ['Pending', 'Accepted', 'Denied'];
          requiredStatuses.forEach(status => {
            if (!config.SuggestionStatuses[status]) {
              console.log('\x1b[31m%s\x1b[0m', `[WARNING] SuggestionStatuses.${status} is missing!`);
              foundErrors.push(`SuggestionStatuses.${status} is missing!`);
            }
          });
        }

        if (!config.SuggestionStatusesEmbedColors) {
          console.log('\x1b[31m%s\x1b[0m', `[WARNING] SuggestionStatusesEmbedColors section is missing!`);
          foundErrors.push("SuggestionStatusesEmbedColors section is missing!");
        } else {
          const requiredColors = ['Pending', 'Accepted', 'Denied'];
          requiredColors.forEach(status => {
            if (!config.SuggestionStatusesEmbedColors[status]) {
              console.log('\x1b[31m%s\x1b[0m', `[WARNING] SuggestionStatusesEmbedColors.${status} is missing!`);
              foundErrors.push(`SuggestionStatusesEmbedColors.${status} is missing!`);
            } else if (!hexColorRegex.test(config.SuggestionStatusesEmbedColors[status])) {
              console.log('\x1b[31m%s\x1b[0m', `[WARNING] SuggestionStatusesEmbedColors.${status} is not a valid HEX color! Should be like: #FF5555`);
              foundErrors.push(`SuggestionStatusesEmbedColors.${status} is not a valid HEX color! Should be like: #FF5555`);
            }
          });
        }

        const validButtonColors = ["Blurple", "Gray", "Green", "Red"];
        
        if (!config.SuggestionUpvote) {
          console.log('\x1b[31m%s\x1b[0m', `[WARNING] SuggestionUpvote section is missing!`);
          foundErrors.push("SuggestionUpvote section is missing!");
        } else {
          if (!config.SuggestionUpvote.ButtonName) {
            console.log('\x1b[31m%s\x1b[0m', `[WARNING] SuggestionUpvote.ButtonName is missing!`);
            foundErrors.push("SuggestionUpvote.ButtonName is missing!");
          }

          if (!config.SuggestionUpvote.ButtonEmoji) {
            console.log('\x1b[31m%s\x1b[0m', `[WARNING] SuggestionUpvote.ButtonEmoji is missing!`);
            foundErrors.push("SuggestionUpvote.ButtonEmoji is missing!");
          } else {
            const emojiRegex = require('emoji-regex');
            const discordEmojiRegex = /<a?:[a-zA-Z0-9_]+:(\d+)>/;
            const emojiPattern = emojiRegex();
            const emojiMatch = emojiPattern.exec(config.SuggestionUpvote.ButtonEmoji);
            const discordEmojiMatch = config.SuggestionUpvote.ButtonEmoji.match(discordEmojiRegex);

            if (!emojiMatch && !discordEmojiMatch) {
              console.log('\x1b[31m%s\x1b[0m', `[WARNING] SuggestionUpvote.ButtonEmoji contains an invalid emoji! (${config.SuggestionUpvote.ButtonEmoji})`);
              foundErrors.push(`SuggestionUpvote.ButtonEmoji contains an invalid emoji! (${config.SuggestionUpvote.ButtonEmoji})`);
            }
          }

          if (!config.SuggestionUpvote.ButtonColor) {
            console.log('\x1b[31m%s\x1b[0m', `[WARNING] SuggestionUpvote.ButtonColor is missing!`);
            foundErrors.push("SuggestionUpvote.ButtonColor is missing!");
          } else if (!validButtonColors.includes(config.SuggestionUpvote.ButtonColor)) {
            console.log('\x1b[31m%s\x1b[0m', `[WARNING] SuggestionUpvote.ButtonColor is not a valid color! Valid colors: Blurple, Gray, Green, Red (CASE SENSITIVE)`);
            foundErrors.push("SuggestionUpvote.ButtonColor is not a valid color! Valid colors: Blurple, Gray, Green, Red (CASE SENSITIVE)");
          }
        }
        
        if (!config.SuggestionDownvote) {
          console.log('\x1b[31m%s\x1b[0m', `[WARNING] SuggestionDownvote section is missing!`);
          foundErrors.push("SuggestionDownvote section is missing!");
        } else {
          if (!config.SuggestionDownvote.ButtonName) {
            console.log('\x1b[31m%s\x1b[0m', `[WARNING] SuggestionDownvote.ButtonName is missing!`);
            foundErrors.push("SuggestionDownvote.ButtonName is missing!");
          }

          if (!config.SuggestionDownvote.ButtonEmoji) {
            console.log('\x1b[31m%s\x1b[0m', `[WARNING] SuggestionDownvote.ButtonEmoji is missing!`);
            foundErrors.push("SuggestionDownvote.ButtonEmoji is missing!");
          } else {
            const emojiRegex = require('emoji-regex');
            const discordEmojiRegex = /<a?:[a-zA-Z0-9_]+:(\d+)>/;
            const emojiPattern = emojiRegex();
            const emojiMatch = emojiPattern.exec(config.SuggestionDownvote.ButtonEmoji);
            const discordEmojiMatch = config.SuggestionDownvote.ButtonEmoji.match(discordEmojiRegex);

            if (!emojiMatch && !discordEmojiMatch) {
              console.log('\x1b[31m%s\x1b[0m', `[WARNING] SuggestionDownvote.ButtonEmoji contains an invalid emoji! (${config.SuggestionDownvote.ButtonEmoji})`);
              foundErrors.push(`SuggestionDownvote.ButtonEmoji contains an invalid emoji! (${config.SuggestionDownvote.ButtonEmoji})`);
            }
          }

          if (!config.SuggestionDownvote.ButtonColor) {
            console.log('\x1b[31m%s\x1b[0m', `[WARNING] SuggestionDownvote.ButtonColor is missing!`);
            foundErrors.push("SuggestionDownvote.ButtonColor is missing!");
          } else if (!validButtonColors.includes(config.SuggestionDownvote.ButtonColor)) {
            console.log('\x1b[31m%s\x1b[0m', `[WARNING] SuggestionDownvote.ButtonColor is not a valid color! Valid colors: Blurple, Gray, Green, Red (CASE SENSITIVE)`);
            foundErrors.push("SuggestionDownvote.ButtonColor is not a valid color! Valid colors: Blurple, Gray, Green, Red (CASE SENSITIVE)");
          }
        }
        
        if (!config.SuggestionResetvote) {
          console.log('\x1b[31m%s\x1b[0m', `[WARNING] SuggestionResetvote section is missing!`);
          foundErrors.push("SuggestionResetvote section is missing!");
        } else {
          if (!config.SuggestionResetvote.ButtonName) {
            console.log('\x1b[31m%s\x1b[0m', `[WARNING] SuggestionResetvote.ButtonName is missing!`);
            foundErrors.push("SuggestionResetvote.ButtonName is missing!");
          }

          if (!config.SuggestionResetvote.ButtonEmoji) {
            console.log('\x1b[31m%s\x1b[0m', `[WARNING] SuggestionResetvote.ButtonEmoji is missing!`);
            foundErrors.push("SuggestionResetvote.ButtonEmoji is missing!");
          } else {
            const emojiRegex = require('emoji-regex');
            const discordEmojiRegex = /<a?:[a-zA-Z0-9_]+:(\d+)>/;
            const emojiPattern = emojiRegex();
            const emojiMatch = emojiPattern.exec(config.SuggestionResetvote.ButtonEmoji);
            const discordEmojiMatch = config.SuggestionResetvote.ButtonEmoji.match(discordEmojiRegex);

            if (!emojiMatch && !discordEmojiMatch) {
              console.log('\x1b[31m%s\x1b[0m', `[WARNING] SuggestionResetvote.ButtonEmoji contains an invalid emoji! (${config.SuggestionResetvote.ButtonEmoji})`);
              foundErrors.push(`SuggestionResetvote.ButtonEmoji contains an invalid emoji! (${config.SuggestionResetvote.ButtonEmoji})`);
            }
          }

          if (!config.SuggestionResetvote.ButtonColor) {
            console.log('\x1b[31m%s\x1b[0m', `[WARNING] SuggestionResetvote.ButtonColor is missing!`);
            foundErrors.push("SuggestionResetvote.ButtonColor is missing!");
          } else if (!validButtonColors.includes(config.SuggestionResetvote.ButtonColor)) {
            console.log('\x1b[31m%s\x1b[0m', `[WARNING] SuggestionResetvote.ButtonColor is not a valid color! Valid colors: Blurple, Gray, Green, Red (CASE SENSITIVE)`);
            foundErrors.push("SuggestionResetvote.ButtonColor is not a valid color! Valid colors: Blurple, Gray, Green, Red (CASE SENSITIVE)");
          }
        }

        if (!config.SuggestionAccept) {
          console.log('\x1b[31m%s\x1b[0m', `[WARNING] SuggestionAccept section is missing!`);
          foundErrors.push("SuggestionAccept section is missing!");
        } else {
          if (!config.SuggestionAccept.Emoji) {
            console.log('\x1b[31m%s\x1b[0m', `[WARNING] SuggestionAccept.Emoji is missing!`);
            foundErrors.push("SuggestionAccept.Emoji is missing!");
          } else {
            const emojiRegex = require('emoji-regex');
            const discordEmojiRegex = /<a?:[a-zA-Z0-9_]+:(\d+)>/;
            const emojiPattern = emojiRegex();
            const emojiMatch = emojiPattern.exec(config.SuggestionAccept.Emoji);
            const discordEmojiMatch = config.SuggestionAccept.Emoji.match(discordEmojiRegex);

            if (!emojiMatch && !discordEmojiMatch) {
              console.log('\x1b[31m%s\x1b[0m', `[WARNING] SuggestionAccept.Emoji contains an invalid emoji! (${config.SuggestionAccept.Emoji})`);
              foundErrors.push(`SuggestionAccept.Emoji contains an invalid emoji! (${config.SuggestionAccept.Emoji})`);
            }
          }
        }

        if (!config.SuggestionDeny) {
          console.log('\x1b[31m%s\x1b[0m', `[WARNING] SuggestionDeny section is missing!`);
          foundErrors.push("SuggestionDeny section is missing!");
        } else {
          if (!config.SuggestionDeny.Emoji) {
            console.log('\x1b[31m%s\x1b[0m', `[WARNING] SuggestionDeny.Emoji is missing!`);
            foundErrors.push("SuggestionDeny.Emoji is missing!");
          } else {
            const emojiRegex = require('emoji-regex');
            const discordEmojiRegex = /<a?:[a-zA-Z0-9_]+:(\d+)>/;
            const emojiPattern = emojiRegex();
            const emojiMatch = emojiPattern.exec(config.SuggestionDeny.Emoji);
            const discordEmojiMatch = config.SuggestionDeny.Emoji.match(discordEmojiRegex);

            if (!emojiMatch && !discordEmojiMatch) {
              console.log('\x1b[31m%s\x1b[0m', `[WARNING] SuggestionDeny.Emoji contains an invalid emoji! (${config.SuggestionDeny.Emoji})`);
              foundErrors.push(`SuggestionDeny.Emoji contains an invalid emoji! (${config.SuggestionDeny.Emoji})`);
            }
          }
        }
      }
      
if (!config.ButtonEmojis) {
        console.log('\x1b[31m%s\x1b[0m', `[WARNING] ButtonEmojis section is missing!`);
        foundErrors.push("ButtonEmojis section is missing!");
      } else {
        const requiredButtonEmojis = ['deleteTicket', 'closeTicket', 'ticketCreated', 'ticketClaim'];
        
        requiredButtonEmojis.forEach(buttonType => {
          if (!config.ButtonEmojis[buttonType]) {
            console.log('\x1b[31m%s\x1b[0m', `[WARNING] ButtonEmojis.${buttonType} is missing!`);
            foundErrors.push(`ButtonEmojis.${buttonType} is missing!`);
          } else {
            const emojiRegex = require('emoji-regex');
            const discordEmojiRegex = /<a?:[a-zA-Z0-9_]+:(\d+)>/;
            const emojiPattern = emojiRegex();
            const emojiMatch = emojiPattern.exec(config.ButtonEmojis[buttonType]);
            const discordEmojiMatch = config.ButtonEmojis[buttonType].match(discordEmojiRegex);

            if (!emojiMatch && !discordEmojiMatch) {
              console.log('\x1b[31m%s\x1b[0m', `[WARNING] ButtonEmojis.${buttonType} contains an invalid emoji! (${config.ButtonEmojis[buttonType]})`);
              foundErrors.push(`ButtonEmojis.${buttonType} contains an invalid emoji! (${config.ButtonEmojis[buttonType]})`);
            }
          }
        });
      }

      if (!config.ButtonColors) {
        console.log('\x1b[31m%s\x1b[0m', `[WARNING] ButtonColors section is missing!`);
        foundErrors.push("ButtonColors section is missing!");
      } else {
        const requiredButtonColors = ['deleteTicket', 'closeTicket', 'ticketClaim', 'ticketUnclaim'];
        const validButtonColorValues = ['Primary', 'Secondary', 'Success', 'Danger'];
        
        requiredButtonColors.forEach(buttonType => {
          if (!config.ButtonColors[buttonType]) {
            console.log('\x1b[31m%s\x1b[0m', `[WARNING] ButtonColors.${buttonType} is missing!`);
            foundErrors.push(`ButtonColors.${buttonType} is missing!`);
          } else if (!validButtonColorValues.includes(config.ButtonColors[buttonType])) {
            console.log('\x1b[31m%s\x1b[0m', `[WARNING] ButtonColors.${buttonType} has an invalid color! Valid colors: Primary, Secondary, Success, Danger (CASE SENSITIVE)`);
            foundErrors.push(`ButtonColors.${buttonType} has an invalid color! Valid colors: Primary, Secondary, Success, Danger (CASE SENSITIVE)`);
          }
        });
      }

const statsChannelSections = [
        'TotalTickets',
        'OpenTickets', 
        'AverageRating',
        'AverageCompletion',
        'AverageResponse',
        'MemberCount'
      ];

      statsChannelSections.forEach(sectionName => {
        const section = config[sectionName];
        
        if (!section) {
          console.log('\x1b[31m%s\x1b[0m', `[WARNING] ${sectionName} section is missing!`);
          foundErrors.push(`${sectionName} section is missing!`);
        } else {
          if (section.Enabled !== undefined && typeof section.Enabled !== 'boolean') {
            console.log('\x1b[31m%s\x1b[0m', `[WARNING] ${sectionName}.Enabled must be true or false!`);
            foundErrors.push(`${sectionName}.Enabled must be true or false!`);
          }

          if (section.Enabled === true) {
            if (!section.ChannelID || section.ChannelID.trim() === "" || section.ChannelID === "CHANNEL_ID") {
              console.log('\x1b[31m%s\x1b[0m', `[CRITICAL ERROR] ${sectionName}.ChannelID is required when ${sectionName} is enabled!`);
              foundErrors.push(`${sectionName}.ChannelID is required when ${sectionName} is enabled!`);
            } else if (guild) {
              const channel = guild.channels.cache.get(section.ChannelID);
              if (!channel) {
                console.log('\x1b[31m%s\x1b[0m', `[CRITICAL ERROR] ${sectionName}.ChannelID is not a valid channel!`);
                foundErrors.push(`${sectionName}.ChannelID is not a valid channel!`);
              } else if (channel.type !== 2) {
                console.log('\x1b[31m%s\x1b[0m', `[CRITICAL ERROR] ${sectionName}.ChannelID must be a voice channel!`);
                foundErrors.push(`${sectionName}.ChannelID must be a voice channel!`);
              }
            }

            if (!section.ChannelName || section.ChannelName.trim() === "") {
              console.log('\x1b[31m%s\x1b[0m', `[WARNING] ${sectionName}.ChannelName is missing when ${sectionName} is enabled!`);
              foundErrors.push(`${sectionName}.ChannelName is missing when ${sectionName} is enabled!`);
            } else if (section.ChannelName.length > 100) {
              console.log('\x1b[31m%s\x1b[0m', `[WARNING] ${sectionName}.ChannelName is too long! Maximum is 100 characters due to Discord voice channel name limitations.`);
              foundErrors.push(`${sectionName}.ChannelName is too long! Maximum is 100 characters due to Discord voice channel name limitations.`);
            }
          }
        }
      });

if (!config.PrioritySettings) {
        console.log('\x1b[31m%s\x1b[0m', `[WARNING] PrioritySettings section is missing!`);
        foundErrors.push("PrioritySettings section is missing!");
      } else {
        if (config.PrioritySettings.Enabled !== undefined && typeof config.PrioritySettings.Enabled !== 'boolean') {
          console.log('\x1b[31m%s\x1b[0m', `[WARNING] PrioritySettings.Enabled must be true or false!`);
          foundErrors.push("PrioritySettings.Enabled must be true or false!");
        }

        if (config.PrioritySettings.Enabled === true) {
          if (!config.PrioritySettings.Levels || !Array.isArray(config.PrioritySettings.Levels) || config.PrioritySettings.Levels.length === 0) {
            console.log('\x1b[31m%s\x1b[0m', `[CRITICAL ERROR] PrioritySettings.Levels is missing or empty when priority system is enabled!`);
            foundErrors.push("PrioritySettings.Levels is missing or empty when priority system is enabled!");
          } else {
            const priorityNames = new Set();
            
            config.PrioritySettings.Levels.forEach((level, index) => {
              if (!level.priority) {
                console.log('\x1b[31m%s\x1b[0m', `[WARNING] PrioritySettings.Levels[${index}].priority is missing!`);
                foundErrors.push(`PrioritySettings.Levels[${index}].priority is missing!`);
              } else if (typeof level.priority !== 'string') {
                console.log('\x1b[31m%s\x1b[0m', `[WARNING] PrioritySettings.Levels[${index}].priority must be a string!`);
                foundErrors.push(`PrioritySettings.Levels[${index}].priority must be a string!`);
              } else if (priorityNames.has(level.priority)) {
                console.log('\x1b[31m%s\x1b[0m', `[WARNING] PrioritySettings.Levels[${index}].priority "${level.priority}" is duplicated! Priority names must be unique.`);
                foundErrors.push(`PrioritySettings.Levels[${index}].priority "${level.priority}" is duplicated! Priority names must be unique.`);
              } else {
                priorityNames.add(level.priority);
              }

              if (level.moveToTop !== undefined && typeof level.moveToTop !== 'boolean') {
                console.log('\x1b[31m%s\x1b[0m', `[WARNING] PrioritySettings.Levels[${index}].moveToTop must be true or false!`);
                foundErrors.push(`PrioritySettings.Levels[${index}].moveToTop must be true or false!`);
              }

              if (level.channelName !== undefined && typeof level.channelName !== 'string') {
                console.log('\x1b[31m%s\x1b[0m', `[WARNING] PrioritySettings.Levels[${index}].channelName must be a string!`);
                foundErrors.push(`PrioritySettings.Levels[${index}].channelName must be a string!`);
              }

              if (level.rolesToMention) {
                if (!Array.isArray(level.rolesToMention)) {
                  console.log('\x1b[31m%s\x1b[0m', `[WARNING] PrioritySettings.Levels[${index}].rolesToMention should be an array!`);
                  foundErrors.push(`PrioritySettings.Levels[${index}].rolesToMention should be an array!`);
                } else if (guild) {
                  level.rolesToMention.forEach((roleId, roleIndex) => {
                    if (roleId && roleId.trim() !== "" && roleId !== "ROLE_ID" && !guild.roles.cache.get(roleId)) {
                      console.log('\x1b[31m%s\x1b[0m', `[WARNING] PrioritySettings.Levels[${index}].rolesToMention[${roleIndex}] contains an invalid role! (${roleId})`);
                      foundErrors.push(`PrioritySettings.Levels[${index}].rolesToMention[${roleIndex}] contains an invalid role! (${roleId})`);
                    }
                  });
                }
              }
            });
          }
        }
      }

      if (!config.PriorityRoles) {
        console.log('\x1b[31m%s\x1b[0m', `[WARNING] PriorityRoles section is missing!`);
        foundErrors.push("PriorityRoles section is missing!");
      } else {
        if (config.PriorityRoles.Enabled !== undefined && typeof config.PriorityRoles.Enabled !== 'boolean') {
          console.log('\x1b[31m%s\x1b[0m', `[WARNING] PriorityRoles.Enabled must be true or false!`);
          foundErrors.push("PriorityRoles.Enabled must be true or false!");
        }

        if (config.PriorityRoles.Enabled === true) {
          if (!config.PriorityRoles.Roles || !Array.isArray(config.PriorityRoles.Roles) || config.PriorityRoles.Roles.length === 0) {
            console.log('\x1b[31m%s\x1b[0m', `[CRITICAL ERROR] PriorityRoles.Roles is missing or empty when priority roles system is enabled!`);
            foundErrors.push("PriorityRoles.Roles is missing or empty when priority roles system is enabled!");
          } else {
            const roleIds = new Set();
            
            config.PriorityRoles.Roles.forEach((roleConfig, index) => {
              if (!roleConfig.RoleID) {
                console.log('\x1b[31m%s\x1b[0m', `[WARNING] PriorityRoles.Roles[${index}].RoleID is missing!`);
                foundErrors.push(`PriorityRoles.Roles[${index}].RoleID is missing!`);
              } else if (roleConfig.RoleID === "ROLE_ID") {
                console.log('\x1b[31m%s\x1b[0m', `[WARNING] PriorityRoles.Roles[${index}].RoleID is still set to placeholder "ROLE_ID"!`);
                foundErrors.push(`PriorityRoles.Roles[${index}].RoleID is still set to placeholder "ROLE_ID"!`);
              } else if (roleIds.has(roleConfig.RoleID)) {
                console.log('\x1b[31m%s\x1b[0m', `[WARNING] PriorityRoles.Roles[${index}].RoleID "${roleConfig.RoleID}" is duplicated! Each role can only have one priority level.`);
                foundErrors.push(`PriorityRoles.Roles[${index}].RoleID "${roleConfig.RoleID}" is duplicated! Each role can only have one priority level.`);
              } else {
                roleIds.add(roleConfig.RoleID);
                
                if (guild && !guild.roles.cache.get(roleConfig.RoleID)) {
                  console.log('\x1b[31m%s\x1b[0m', `[WARNING] PriorityRoles.Roles[${index}].RoleID is not a valid role! (${roleConfig.RoleID})`);
                  foundErrors.push(`PriorityRoles.Roles[${index}].RoleID is not a valid role! (${roleConfig.RoleID})`);
                }
              }

              if (!roleConfig.PriorityLevel) {
                console.log('\x1b[31m%s\x1b[0m', `[WARNING] PriorityRoles.Roles[${index}].PriorityLevel is missing!`);
                foundErrors.push(`PriorityRoles.Roles[${index}].PriorityLevel is missing!`);
              } else if (config.PrioritySettings?.Levels) {
                const validPriorityLevels = config.PrioritySettings.Levels.map(level => level.priority);
                if (!validPriorityLevels.includes(roleConfig.PriorityLevel)) {
                  console.log('\x1b[31m%s\x1b[0m', `[WARNING] PriorityRoles.Roles[${index}].PriorityLevel "${roleConfig.PriorityLevel}" does not exist in PrioritySettings.Levels!`);
                  foundErrors.push(`PriorityRoles.Roles[${index}].PriorityLevel "${roleConfig.PriorityLevel}" does not exist in PrioritySettings.Levels!`);
                }
              }
            });
          }
        }
      }

// Check working hours config if enabled
if (config.WorkingHours?.Enabled) {
  if (!config.WorkingHours.Timezone) {
    console.log('\x1b[31m%s\x1b[0m', `[WARNING] WorkingHours.Timezone is missing!`);
    foundErrors.push("WorkingHours.Timezone is missing!");
  }
  
  if (config.WorkingHours.ExemptRoles) {
    if (!Array.isArray(config.WorkingHours.ExemptRoles)) {
      console.log('\x1b[31m%s\x1b[0m', `[WARNING] WorkingHours.ExemptRoles must be an array!`);
      foundErrors.push("WorkingHours.ExemptRoles must be an array!");
    } else if (guild && config.WorkingHours.ExemptRoles.length > 0) {
      config.WorkingHours.ExemptRoles.forEach((roleId, index) => {
        if (roleId && roleId.trim() !== "" && roleId !== "ROLE_ID" && !guild.roles.cache.get(roleId)) {
          console.log('\x1b[31m%s\x1b[0m', `[WARNING] WorkingHours.ExemptRoles[${index}] contains an invalid role! (${roleId})`);
          foundErrors.push(`WorkingHours.ExemptRoles[${index}] contains an invalid role! (${roleId})`);
        }
      });
    }
  }

  if (!config.WorkingHours.Schedule || Object.keys(config.WorkingHours.Schedule).length === 0) {
    console.log('\x1b[31m%s\x1b[0m', `[WARNING] WorkingHours.Schedule is missing or empty!`);
    foundErrors.push("WorkingHours.Schedule is missing or empty!");
  } else {
    const daysOfWeek = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    const timeFormat = /^(\d{1,2}:\d{2})-(\d{1,2}:\d{2})$/;
    
    daysOfWeek.forEach(day => {
      if (!config.WorkingHours.Schedule[day]) {
        console.log('\x1b[31m%s\x1b[0m', `[WARNING] WorkingHours.Schedule.${day} is missing!`);
        foundErrors.push(`WorkingHours.Schedule.${day} is missing!`);
      } else {
        // Check if it's a disabled day (case-insensitive)
        const dayValue = config.WorkingHours.Schedule[day];
        const isDisabledDay = typeof dayValue === 'string' && 
          (dayValue.toLowerCase() === 'disabled' || 
           dayValue.toLowerCase() === 'off' || 
           dayValue.toLowerCase() === 'closed');
        
        // If it's not a disabled day, check the time format
        if (!isDisabledDay && !timeFormat.test(dayValue)) {
          console.log('\x1b[31m%s\x1b[0m', `[WARNING] WorkingHours.Schedule.${day} has an invalid format! Should be like: "9:00-17:00" or "disabled"`);
          foundErrors.push(`WorkingHours.Schedule.${day} has an invalid format! Should be like: "9:00-17:00" or "disabled"`);
        }
      }
    });
  }
}

// AI INTEGRATION VALIDATION (Global AI Settings)
if (config.AI) {
  if (config.AI.Enabled !== undefined && typeof config.AI.Enabled !== 'boolean') {
    console.log('\x1b[31m%s\x1b[0m', `[WARNING] AI.Enabled must be true or false!`);
    foundErrors.push("AI.Enabled must be true or false!");
  }

  if (config.AI.Enabled === true) {
    if (!config.AI.OpenAIAPIKey || config.AI.OpenAIAPIKey.trim() === "" || config.AI.OpenAIAPIKey === "YOUR_API_KEY_HERE") {
      console.log('\x1b[31m%s\x1b[0m', `[CRITICAL ERROR] AI.OpenAIAPIKey is required when AI integration is enabled!`);
      foundErrors.push("AI.OpenAIAPIKey is required when AI integration is enabled!");
    } else if (!config.AI.OpenAIAPIKey.startsWith("sk-")) {
      console.log('\x1b[31m%s\x1b[0m', `[WARNING] AI.OpenAIAPIKey appears to be invalid! OpenAI API keys should start with "sk-"`);
      foundErrors.push("AI.OpenAIAPIKey appears to be invalid! OpenAI API keys should start with \"sk-\"");
    }

  }
}

// AI TICKET CLOSE SUMMARIES VALIDATION
if (config.AI?.TicketCloseSummaries?.Enabled) {
  // Check if global AI integration is enabled
  if (!config.AI?.Enabled) {
    console.log('\x1b[31m%s\x1b[0m', `[CRITICAL ERROR] AI.TicketCloseSummaries is enabled but AI.Enabled is not set to true! Global AI integration must be enabled for Ticket Close Summaries to work.`);
    foundErrors.push("AI.TicketCloseSummaries is enabled but AI.Enabled is not set to true! Global AI integration must be enabled for Ticket Close Summaries to work.");
  }

  // Check if global AI API key is configured
  if (!config.AI?.OpenAIAPIKey || config.AI.OpenAIAPIKey.trim() === "" || config.AI.OpenAIAPIKey === "YOUR_API_KEY_HERE") {
    console.log('\x1b[31m%s\x1b[0m', `[CRITICAL ERROR] AI.TicketCloseSummaries is enabled but AI.OpenAIAPIKey is not configured! A valid OpenAI API key is required for Ticket Close Summaries to work.`);
    foundErrors.push("AI.TicketCloseSummaries is enabled but AI.OpenAIAPIKey is not configured! A valid OpenAI API key is required for Ticket Close Summaries to work.");
  }

  // Check if global AI model is configured
  if (!config.AI?.Model) {
    console.log('\x1b[31m%s\x1b[0m', `[CRITICAL ERROR] AI.TicketCloseSummaries is enabled but AI.Model is not configured! A valid model is required for Ticket Close Summaries to work.`);
    foundErrors.push("AI.TicketCloseSummaries is enabled but AI.Model is not configured! A valid model is required for Ticket Close Summaries to work.");
  }

  const summaryConfig = config.AI.TicketCloseSummaries;

  // Validate MaxMessagesToAnalyze
  if (summaryConfig.MaxMessagesToAnalyze !== undefined) {
    if (isNaN(summaryConfig.MaxMessagesToAnalyze) || summaryConfig.MaxMessagesToAnalyze < 1 || summaryConfig.MaxMessagesToAnalyze > 200) {
      console.log('\x1b[31m%s\x1b[0m', `[WARNING] AI.TicketCloseSummaries.MaxMessagesToAnalyze must be a number between 1 and 200!`);
      foundErrors.push("AI.TicketCloseSummaries.MaxMessagesToAnalyze must be a number between 1 and 200!");
    }
    
    if (summaryConfig.MaxMessagesToAnalyze > 100) {
      console.log('\x1b[33m%s\x1b[0m', `[NOTICE] AI.TicketCloseSummaries.MaxMessagesToAnalyze is set to ${summaryConfig.MaxMessagesToAnalyze}. Higher values may result in increased API costs.`);
    }
  }

  // Validate SummaryLength
  if (summaryConfig.SummaryLength !== undefined) {
    const validLengths = ["short", "medium", "long"];
    if (!validLengths.includes(summaryConfig.SummaryLength.toLowerCase())) {
      console.log('\x1b[31m%s\x1b[0m', `[WARNING] AI.TicketCloseSummaries.SummaryLength must be one of: ${validLengths.join(", ")} (case insensitive)`);
      foundErrors.push(`AI.TicketCloseSummaries.SummaryLength must be one of: ${validLengths.join(", ")} (case insensitive)`);
    }
  }

  // Validate IncludeInLogs
  if (summaryConfig.IncludeInLogs !== undefined && typeof summaryConfig.IncludeInLogs !== 'boolean') {
    console.log('\x1b[31m%s\x1b[0m', `[WARNING] AI.TicketCloseSummaries.IncludeInLogs must be true or false!`);
    foundErrors.push("AI.TicketCloseSummaries.IncludeInLogs must be true or false!");
  }

  // Validate Language
  if (summaryConfig.Language !== undefined && typeof summaryConfig.Language !== 'string') {
    console.log('\x1b[31m%s\x1b[0m', `[WARNING] AI.TicketCloseSummaries.Language must be a string!`);
    foundErrors.push("AI.TicketCloseSummaries.Language must be a string!");
  } else if (summaryConfig.Language && summaryConfig.Language.trim() === "") {
    console.log('\x1b[31m%s\x1b[0m', `[WARNING] AI.TicketCloseSummaries.Language cannot be empty!`);
    foundErrors.push("AI.TicketCloseSummaries.Language cannot be empty!");
  }

  // Validate DefaultMessage
  if (summaryConfig.DefaultMessage !== undefined && typeof summaryConfig.DefaultMessage !== 'string') {
    console.log('\x1b[31m%s\x1b[0m', `[WARNING] AI.TicketCloseSummaries.DefaultMessage must be a string!`);
    foundErrors.push("AI.TicketCloseSummaries.DefaultMessage must be a string!");
  } else if (summaryConfig.DefaultMessage && summaryConfig.DefaultMessage.length > 200) {
    console.log('\x1b[31m%s\x1b[0m', `[WARNING] AI.TicketCloseSummaries.DefaultMessage is too long! Maximum is 200 characters.`);
    foundErrors.push("AI.TicketCloseSummaries.DefaultMessage is too long! Maximum is 200 characters.");
  }
}

// AI AUTO RESPONSE VALIDATION (Updated to check dependencies)
if (config.AIAutoResponse?.Enabled) {
  // Check if global AI integration is enabled
  if (!config.AI?.Enabled) {
    console.log('\x1b[31m%s\x1b[0m', `[CRITICAL ERROR] AIAutoResponse is enabled but AI.Enabled is not set to true! Global AI integration must be enabled for AIAutoResponse to work.`);
    foundErrors.push("AIAutoResponse is enabled but AI.Enabled is not set to true! Global AI integration must be enabled for AIAutoResponse to work.");
  }

  // Check if global AI API key is configured
  if (!config.AI?.OpenAIAPIKey || config.AI.OpenAIAPIKey.trim() === "" || config.AI.OpenAIAPIKey === "YOUR_API_KEY_HERE") {
    console.log('\x1b[31m%s\x1b[0m', `[CRITICAL ERROR] AIAutoResponse is enabled but AI.OpenAIAPIKey is not configured! A valid OpenAI API key is required for AIAutoResponse to work.`);
    foundErrors.push("AIAutoResponse is enabled but AI.OpenAIAPIKey is not configured! A valid OpenAI API key is required for AIAutoResponse to work.");
  }

  // Check if global AI model is configured
  if (!config.AI?.Model) {
    console.log('\x1b[31m%s\x1b[0m', `[CRITICAL ERROR] AIAutoResponse is enabled but AI.Model is not configured! A valid model is required for AIAutoResponse to work.`);
    foundErrors.push("AIAutoResponse is enabled but AI.Model is not configured! A valid model is required for AIAutoResponse to work.");
  }

  if (config.AIAutoResponse.ConfidenceThreshold === undefined) {
    console.log('\x1b[31m%s\x1b[0m', `[WARNING] AIAutoResponse.ConfidenceThreshold is missing!`);
    foundErrors.push("AIAutoResponse.ConfidenceThreshold is missing!");
  } else if (isNaN(config.AIAutoResponse.ConfidenceThreshold) || config.AIAutoResponse.ConfidenceThreshold < 0 || config.AIAutoResponse.ConfidenceThreshold > 1) {
    console.log('\x1b[31m%s\x1b[0m', `[WARNING] AIAutoResponse.ConfidenceThreshold must be a number between 0.0 and 1.0!`);
    foundErrors.push("AIAutoResponse.ConfidenceThreshold must be a number between 0.0 and 1.0!");
  }

  if (config.AIAutoResponse.Statistics) {
    if (config.AIAutoResponse.Statistics.Enabled !== undefined && typeof config.AIAutoResponse.Statistics.Enabled !== 'boolean') {
      console.log('\x1b[31m%s\x1b[0m', `[WARNING] AIAutoResponse.Statistics.Enabled must be true or false!`);
      foundErrors.push("AIAutoResponse.Statistics.Enabled must be true or false!");
    }

    if (config.AIAutoResponse.Statistics.Enabled && config.AIAutoResponse.Statistics.LogsChannelID) {
      if (config.AIAutoResponse.Statistics.LogsChannelID.trim() === "" || config.AIAutoResponse.Statistics.LogsChannelID === "CHANNEL_ID") {
        console.log('\x1b[31m%s\x1b[0m', `[WARNING] AIAutoResponse.Statistics.LogsChannelID is required when statistics are enabled!`);
        foundErrors.push("AIAutoResponse.Statistics.LogsChannelID is required when statistics are enabled!");
      } else if (guild && !guild.channels.cache.get(config.AIAutoResponse.Statistics.LogsChannelID)) {
        console.log('\x1b[31m%s\x1b[0m', `[WARNING] AIAutoResponse.Statistics.LogsChannelID is not a valid channel!`);
        foundErrors.push("AIAutoResponse.Statistics.LogsChannelID is not a valid channel!");
      }
    }
  }

  if (config.AIAutoResponse.ChannelFilter) {
    if (!config.AIAutoResponse.ChannelFilter.Mode) {
      console.log('\x1b[31m%s\x1b[0m', `[WARNING] AIAutoResponse.ChannelFilter.Mode is missing!`);
      foundErrors.push("AIAutoResponse.ChannelFilter.Mode is missing!");
    } else {
      const validModes = ["WHITELIST", "BLACKLIST", "DISABLED"];
      if (!validModes.includes(config.AIAutoResponse.ChannelFilter.Mode)) {
        console.log('\x1b[31m%s\x1b[0m', `[WARNING] AIAutoResponse.ChannelFilter.Mode must be one of: ${validModes.join(", ")} (CASE SENSITIVE)`);
        foundErrors.push(`AIAutoResponse.ChannelFilter.Mode must be one of: ${validModes.join(", ")} (CASE SENSITIVE)`);
      }
    }

    if (config.AIAutoResponse.ChannelFilter.Channels && !Array.isArray(config.AIAutoResponse.ChannelFilter.Channels)) {
      console.log('\x1b[31m%s\x1b[0m', `[WARNING] AIAutoResponse.ChannelFilter.Channels must be an array!`);
      foundErrors.push("AIAutoResponse.ChannelFilter.Channels must be an array!");
    } else if (config.AIAutoResponse.ChannelFilter.Channels && guild) {
      config.AIAutoResponse.ChannelFilter.Channels.forEach((channelId, index) => {
        if (channelId && channelId.trim() !== "" && channelId !== "CHANNEL_ID" && !guild.channels.cache.get(channelId)) {
          console.log('\x1b[31m%s\x1b[0m', `[WARNING] AIAutoResponse.ChannelFilter.Channels[${index}] is not a valid channel! (${channelId})`);
          foundErrors.push(`AIAutoResponse.ChannelFilter.Channels[${index}] is not a valid channel! (${channelId})`);
        }
      });
    }

    if (config.AIAutoResponse.ChannelFilter.Categories && !Array.isArray(config.AIAutoResponse.ChannelFilter.Categories)) {
      console.log('\x1b[31m%s\x1b[0m', `[WARNING] AIAutoResponse.ChannelFilter.Categories must be an array!`);
      foundErrors.push("AIAutoResponse.ChannelFilter.Categories must be an array!");
    } else if (config.AIAutoResponse.ChannelFilter.Categories && guild) {
      config.AIAutoResponse.ChannelFilter.Categories.forEach((categoryId, index) => {
        if (categoryId && categoryId.trim() !== "" && categoryId !== "CATEGORY_ID") {
          const category = guild.channels.cache.get(categoryId);
          if (!category || category.type !== 4) {
            console.log('\x1b[31m%s\x1b[0m', `[WARNING] AIAutoResponse.ChannelFilter.Categories[${index}] is not a valid category! (${categoryId})`);
            foundErrors.push(`AIAutoResponse.ChannelFilter.Categories[${index}] is not a valid category! (${categoryId})`);
          }
        }
      });
    }
  }

  if (!config.AIAutoResponse.Responses || Object.keys(config.AIAutoResponse.Responses).length === 0) {
    console.log('\x1b[31m%s\x1b[0m', `[WARNING] AIAutoResponse.Responses is missing or empty! At least one response should be configured.`);
    foundErrors.push("AIAutoResponse.Responses is missing or empty! At least one response should be configured.");
  } else {
    const responseCount = Object.keys(config.AIAutoResponse.Responses).length;
    if (responseCount > 50) {
      console.log('\x1b[31m%s\x1b[0m', `[WARNING] Too many AI responses configured (${responseCount})! Consider reducing for better performance.`);
      foundErrors.push(`Too many AI responses configured (${responseCount})! Consider reducing for better performance.`);
    }

    for (const responseId in config.AIAutoResponse.Responses) {
      const response = config.AIAutoResponse.Responses[responseId];

      if (response.OnlyInTickets !== undefined && typeof response.OnlyInTickets !== 'boolean') {
        console.log('\x1b[31m%s\x1b[0m', `[WARNING] AIAutoResponse.Responses.${responseId}.OnlyInTickets must be true or false!`);
        foundErrors.push(`AIAutoResponse.Responses.${responseId}.OnlyInTickets must be true or false!`);
      }

      if (!response.Triggers || !Array.isArray(response.Triggers) || response.Triggers.length === 0) {
        console.log('\x1b[31m%s\x1b[0m', `[WARNING] AIAutoResponse.Responses.${responseId}.Triggers is missing or empty!`);
        foundErrors.push(`AIAutoResponse.Responses.${responseId}.Triggers is missing or empty!`);
      } else {
        response.Triggers.forEach((trigger, index) => {
          if (!trigger || typeof trigger !== 'string' || trigger.trim() === "") {
            console.log('\x1b[31m%s\x1b[0m', `[WARNING] AIAutoResponse.Responses.${responseId}.Triggers[${index}] is empty or not a string!`);
            foundErrors.push(`AIAutoResponse.Responses.${responseId}.Triggers[${index}] is empty or not a string!`);
          } else if (trigger.length > 100) {
            console.log('\x1b[31m%s\x1b[0m', `[WARNING] AIAutoResponse.Responses.${responseId}.Triggers[${index}] is too long! Maximum is 100 characters.`);
            foundErrors.push(`AIAutoResponse.Responses.${responseId}.Triggers[${index}] is too long! Maximum is 100 characters.`);
          }
        });
      }

      if (!response.Message || response.Message.trim() === "") {
        console.log('\x1b[31m%s\x1b[0m', `[WARNING] AIAutoResponse.Responses.${responseId}.Message is missing or empty!`);
        foundErrors.push(`AIAutoResponse.Responses.${responseId}.Message is missing or empty!`);
      } else if (response.Message.length > 4000) {
        console.log('\x1b[31m%s\x1b[0m', `[WARNING] AIAutoResponse.Responses.${responseId}.Message is too long! Maximum is 4000 characters due to Discord limitations.`);
        foundErrors.push(`AIAutoResponse.Responses.${responseId}.Message is too long! Maximum is 4000 characters due to Discord limitations.`);
      }

      if (!response.Type) {
        console.log('\x1b[31m%s\x1b[0m', `[WARNING] AIAutoResponse.Responses.${responseId}.Type is missing!`);
        foundErrors.push(`AIAutoResponse.Responses.${responseId}.Type is missing!`);
      } else {
        const validTypes = ["EMBED", "TEXT"];
        if (!validTypes.includes(response.Type.toUpperCase())) {
          console.log('\x1b[31m%s\x1b[0m', `[WARNING] AIAutoResponse.Responses.${responseId}.Type must be "EMBED" or "TEXT" (case insensitive)!`);
          foundErrors.push(`AIAutoResponse.Responses.${responseId}.Type must be "EMBED" or "TEXT" (case insensitive)!`);
        }
      }

      if (response.Type?.toUpperCase() === "EMBED" && response.Color && !hexColorRegex.test(response.Color)) {
        console.log('\x1b[31m%s\x1b[0m', `[WARNING] AIAutoResponse.Responses.${responseId}.Color is not a valid HEX color! Should be like: #FF5555`);
        foundErrors.push(`AIAutoResponse.Responses.${responseId}.Color is not a valid HEX color! Should be like: #FF5555`);
      }
    }
  }

  if (config.AIAutoResponse.ButtonSettings) {
    if (config.AIAutoResponse.ButtonSettings.Enabled !== undefined && typeof config.AIAutoResponse.ButtonSettings.Enabled !== 'boolean') {
      console.log('\x1b[31m%s\x1b[0m', `[WARNING] AIAutoResponse.ButtonSettings.Enabled must be true or false!`);
      foundErrors.push("AIAutoResponse.ButtonSettings.Enabled must be true or false!");
    }

    if (config.AIAutoResponse.ButtonSettings.Enabled) {
      if (!config.AIAutoResponse.ButtonSettings.HelpfulButton || config.AIAutoResponse.ButtonSettings.HelpfulButton.trim() === "") {
        console.log('\x1b[31m%s\x1b[0m', `[WARNING] AIAutoResponse.ButtonSettings.HelpfulButton is missing when button settings are enabled!`);
        foundErrors.push("AIAutoResponse.ButtonSettings.HelpfulButton is missing when button settings are enabled!");
      } else if (config.AIAutoResponse.ButtonSettings.HelpfulButton.length > 80) {
        console.log('\x1b[31m%s\x1b[0m', `[WARNING] AIAutoResponse.ButtonSettings.HelpfulButton is too long! Maximum is 80 characters due to Discord limitations.`);
        foundErrors.push("AIAutoResponse.ButtonSettings.HelpfulButton is too long! Maximum is 80 characters due to Discord limitations.");
      }

      if (!config.AIAutoResponse.ButtonSettings.NotHelpfulButton || config.AIAutoResponse.ButtonSettings.NotHelpfulButton.trim() === "") {
        console.log('\x1b[31m%s\x1b[0m', `[WARNING] AIAutoResponse.ButtonSettings.NotHelpfulButton is missing when button settings are enabled!`);
        foundErrors.push("AIAutoResponse.ButtonSettings.NotHelpfulButton is missing when button settings are enabled!");
      } else if (config.AIAutoResponse.ButtonSettings.NotHelpfulButton.length > 80) {
        console.log('\x1b[31m%s\x1b[0m', `[WARNING] AIAutoResponse.ButtonSettings.NotHelpfulButton is too long! Maximum is 80 characters due to Discord limitations.`);
        foundErrors.push("AIAutoResponse.ButtonSettings.NotHelpfulButton is too long! Maximum is 80 characters due to Discord limitations.");
      }

      if (config.AIAutoResponse.ButtonSettings.RestrictToOriginalUser !== undefined && typeof config.AIAutoResponse.ButtonSettings.RestrictToOriginalUser !== 'boolean') {
        console.log('\x1b[31m%s\x1b[0m', `[WARNING] AIAutoResponse.ButtonSettings.RestrictToOriginalUser must be true or false!`);
        foundErrors.push("AIAutoResponse.ButtonSettings.RestrictToOriginalUser must be true or false!");
      }
    }
  }
}

if (config.AIAutoResponse && config.AIAutoResponse.Embed) {
  const embedConfig = config.AIAutoResponse.Embed;
  
  if (embedConfig.Title && embedConfig.Title.length > 256) {
    console.log('\x1b[31m%s\x1b[0m', `[WARNING] AIAutoResponse.Embed.Title is too long! Maximum is 256 characters due to Discord limitations.`);
    foundErrors.push("AIAutoResponse.Embed.Title is too long! Maximum is 256 characters due to Discord limitations.");
  }
  
  if (embedConfig.Color && embedConfig.Color.trim() !== "" && !hexColorRegex.test(embedConfig.Color)) {
    console.log('\x1b[31m%s\x1b[0m', `[WARNING] AIAutoResponse.Embed.Color is not a valid HEX color! Should be like: #FF5555`);
    foundErrors.push("AIAutoResponse.Embed.Color is not a valid HEX color! Should be like: #FF5555");
  }
  
  if (embedConfig.ThumbnailURL && embedConfig.ThumbnailURL.trim() !== "") {
    const urlRegex = /^https?:\/\/.+/i;
    if (!urlRegex.test(embedConfig.ThumbnailURL)) {
      console.log('\x1b[31m%s\x1b[0m', `[WARNING] AIAutoResponse.Embed.ThumbnailURL is not a valid URL! Must start with http:// or https://`);
      foundErrors.push("AIAutoResponse.Embed.ThumbnailURL is not a valid URL! Must start with http:// or https://");
    }
  }
  
  if (embedConfig.Footer) {
    if (embedConfig.Footer.Text && embedConfig.Footer.Text.length > 2048) {
      console.log('\x1b[31m%s\x1b[0m', `[WARNING] AIAutoResponse.Embed.Footer.Text is too long! Maximum is 2048 characters due to Discord limitations.`);
      foundErrors.push("AIAutoResponse.Embed.Footer.Text is too long! Maximum is 2048 characters due to Discord limitations.");
    }
    
    if (embedConfig.Footer.ShowUserAvatar !== undefined && typeof embedConfig.Footer.ShowUserAvatar !== 'boolean') {
      console.log('\x1b[31m%s\x1b[0m', `[WARNING] AIAutoResponse.Embed.Footer.ShowUserAvatar must be true or false!`);
      foundErrors.push("AIAutoResponse.Embed.Footer.ShowUserAvatar must be true or false!");
    }
    
    if (embedConfig.Footer.ShowTimestamp !== undefined && typeof embedConfig.Footer.ShowTimestamp !== 'boolean') {
      console.log('\x1b[31m%s\x1b[0m', `[WARNING] AIAutoResponse.Embed.Footer.ShowTimestamp must be true or false!`);
      foundErrors.push("AIAutoResponse.Embed.Footer.ShowTimestamp must be true or false!");
    }
  }
}

if (config.AIAutoResponse && config.AIAutoResponse.Enabled === undefined) {
  console.log('\x1b[33m%s\x1b[0m', `[NOTICE] AIAutoResponse section exists but Enabled field is missing! Assuming disabled.`);
}

// ARCHIVE SYSTEM VALIDATION
if (config.ArchiveSystem?.Enabled) {
  if (config.ArchiveSystem.HideFromCreator !== undefined && typeof config.ArchiveSystem.HideFromCreator !== 'boolean') {
    console.log('\x1b[31m%s\x1b[0m', `[WARNING] ArchiveSystem.HideFromCreator must be true or false!`);
    foundErrors.push("ArchiveSystem.HideFromCreator must be true or false!");
  }

  if (config.ArchiveSystem.MoveToCategory !== undefined && typeof config.ArchiveSystem.MoveToCategory !== 'boolean') {
    console.log('\x1b[31m%s\x1b[0m', `[WARNING] ArchiveSystem.MoveToCategory must be true or false!`);
    foundErrors.push("ArchiveSystem.MoveToCategory must be true or false!");
  }

  // Only validate ArchiveCategoryID if MoveToCategory is enabled
  if (config.ArchiveSystem.MoveToCategory === true) {
    if (!config.ArchiveSystem.ArchiveCategoryID || config.ArchiveSystem.ArchiveCategoryID.trim() === "" || config.ArchiveSystem.ArchiveCategoryID === "CATEGORY_ID") {
      console.log('\x1b[31m%s\x1b[0m', `[CRITICAL ERROR] ArchiveSystem.ArchiveCategoryID is required when MoveToCategory is enabled!`);
      foundErrors.push("ArchiveSystem.ArchiveCategoryID is required when MoveToCategory is enabled!");
    } else if (guild) {
      const archiveCategory = guild.channels.cache.get(config.ArchiveSystem.ArchiveCategoryID);
      if (!archiveCategory) {
        console.log('\x1b[31m%s\x1b[0m', `[CRITICAL ERROR] ArchiveSystem.ArchiveCategoryID is not a valid channel!`);
        foundErrors.push("ArchiveSystem.ArchiveCategoryID is not a valid channel!");
      } else if (archiveCategory.type !== 4) {
        console.log('\x1b[31m%s\x1b[0m', `[CRITICAL ERROR] ArchiveSystem.ArchiveCategoryID must be a category channel!`);
        foundErrors.push("ArchiveSystem.ArchiveCategoryID must be a category channel!");
      }
    }
  }

  // Validate string fields
  const stringFields = [
    'ChannelNamePrefix', 'ArchiveEmbedTitle', 'ArchiveEmbedDescription', 
    'ReopenEmbedTitle', 'ReopenEmbedDescription', 'DeleteConfirmTitle', 
    'DeleteConfirmDescription', 'ArchiveButtonLabel', 'ReopenButtonLabel', 
    'DeleteButtonLabel', 'ConfirmDeleteLabel', 'CancelDeleteLabel'
  ];

  stringFields.forEach(field => {
    if (config.ArchiveSystem[field] !== undefined && typeof config.ArchiveSystem[field] !== 'string') {
      console.log('\x1b[31m%s\x1b[0m', `[WARNING] ArchiveSystem.${field} must be a string!`);
      foundErrors.push(`ArchiveSystem.${field} must be a string!`);
    }
  });

  // Validate button label lengths (Discord limitation)
  const buttonFields = ['ArchiveButtonLabel', 'ReopenButtonLabel', 'DeleteButtonLabel', 'ConfirmDeleteLabel', 'CancelDeleteLabel'];
  
  buttonFields.forEach(field => {
    if (config.ArchiveSystem[field] && config.ArchiveSystem[field].length > 80) {
      console.log('\x1b[31m%s\x1b[0m', `[WARNING] ArchiveSystem.${field} is too long! Maximum is 80 characters due to Discord button limitations.`);
      foundErrors.push(`ArchiveSystem.${field} is too long! Maximum is 80 characters due to Discord button limitations.`);
    }
  });

  // Validate embed description lengths (Discord limitation)
  const embedFields = ['ArchiveEmbedDescription', 'ReopenEmbedDescription', 'DeleteConfirmDescription'];
  
  embedFields.forEach(field => {
    if (config.ArchiveSystem[field] && config.ArchiveSystem[field].length > 4000) {
      console.log('\x1b[31m%s\x1b[0m', `[WARNING] ArchiveSystem.${field} is too long! Maximum is 4000 characters due to Discord embed limitations.`);
      foundErrors.push(`ArchiveSystem.${field} is too long! Maximum is 4000 characters due to Discord embed limitations.`);
    }
  });

  // Validate embed title lengths (Discord limitation)
  const titleFields = ['ArchiveEmbedTitle', 'ReopenEmbedTitle', 'DeleteConfirmTitle'];
  
  titleFields.forEach(field => {
    if (config.ArchiveSystem[field] && config.ArchiveSystem[field].length > 256) {
      console.log('\x1b[31m%s\x1b[0m', `[WARNING] ArchiveSystem.${field} is too long! Maximum is 256 characters due to Discord embed title limitations.`);
      foundErrors.push(`ArchiveSystem.${field} is too long! Maximum is 256 characters due to Discord embed title limitations.`);
    }
  });
}

    // TAG SYSTEM VALIDATION
    // Check if Tags system is enabled and validate configuration
    if (config.Tags?.Enabled) {
      // Check if TagsList exists and is not empty
      if (!config.Tags.TagsList || Object.keys(config.Tags.TagsList).length === 0) {
        console.log('\x1b[31m%s\x1b[0m', `[WARNING] Tags.TagsList is missing or empty!`);
        foundErrors.push("Tags.TagsList is missing or empty!");
      } else {
        // Check if there are more than 25 tags
        const tagCount = Object.keys(config.Tags.TagsList).length;
        if (tagCount > 25) {
          console.log('\x1b[31m%s\x1b[0m', `[WARNING] There are ${tagCount} tags configured, but the maximum allowed is 25!`);
          foundErrors.push(`There are ${tagCount} tags configured, but the maximum allowed is 25!`);
        }

        // Validate each tag
        for (const tagId in config.Tags.TagsList) {
          const tag = config.Tags.TagsList[tagId];
          
          // Check for tag name (key) issues
          if (/\s/.test(tagId)) {
            console.log('\x1b[31m%s\x1b[0m', `[WARNING] Tag name "${tagId}" contains spaces! Tag names should be single words.`);
            foundErrors.push(`Tag name "${tagId}" contains spaces! Tag names should be single words.`);
          }
          
          // Check for required fields
          if (!tag.Title) {
            console.log('\x1b[31m%s\x1b[0m', `[WARNING] Tag "${tagId}" is missing the Title field!`);
            foundErrors.push(`Tag "${tagId}" is missing the Title field!`);
          }
          
          if (!tag.Content) {
            console.log('\x1b[31m%s\x1b[0m', `[WARNING] Tag "${tagId}" is missing the Content field!`);
            foundErrors.push(`Tag "${tagId}" is missing the Content field!`);
          }
          
          // Check for valid tag type
          if (!tag.Type) {
            console.log('\x1b[31m%s\x1b[0m', `[WARNING] Tag "${tagId}" is missing the Type field!`);
            foundErrors.push(`Tag "${tagId}" is missing the Type field!`);
          } else if (!["text", "embed"].includes(tag.Type.toLowerCase())) {
            console.log('\x1b[31m%s\x1b[0m', `[WARNING] Tag "${tagId}" has an invalid Type! Valid types: text, embed (case insensitive)`);
            foundErrors.push(`Tag "${tagId}" has an invalid Type! Valid types: text, embed (case insensitive)`);
          }
          
          // Check for valid options
          if (tag.RestrictToSupportRoles !== undefined && typeof tag.RestrictToSupportRoles !== 'boolean') {
            console.log('\x1b[31m%s\x1b[0m', `[WARNING] Tag "${tagId}.RestrictToSupportRoles" must be true or false!`);
            foundErrors.push(`Tag "${tagId}.RestrictToSupportRoles" must be true or false!`);
          }
          
          if (tag.OnlyInTickets !== undefined && typeof tag.OnlyInTickets !== 'boolean') {
            console.log('\x1b[31m%s\x1b[0m', `[WARNING] Tag "${tagId}.OnlyInTickets" must be true or false!`);
            foundErrors.push(`Tag "${tagId}.OnlyInTickets" must be true or false!`);
          }
          
          // Check for valid color if it's an embed
          if (tag.Type?.toLowerCase() === "embed") {
            if (tag.Color && !hexColorRegex.test(tag.Color)) {
              console.log('\x1b[31m%s\x1b[0m', `[WARNING] Tag "${tagId}" has an invalid Color! Should be like: #FF5555`);
              foundErrors.push(`Tag "${tagId}" has an invalid Color! Should be like: #FF5555`);
            }
          }
          
          // Check for variable placeholders that are only available in tickets when OnlyInTickets is false
          if (tag.OnlyInTickets === false) {
            const ticketOnlyVars = ['{ticket}', '{ticket_name}', '{ticket_id}', '{ticket_author}', '{ticket_category}', '{ticket_created}'];
            const containsTicketVar = ticketOnlyVars.some(varName => tag.Content.includes(varName));
            
            if (containsTicketVar) {
              console.log('\x1b[31m%s\x1b[0m', `[WARNING] Tag "${tagId}" uses ticket variables but OnlyInTickets is set to false! These variables will not work outside tickets.`);
              foundErrors.push(`Tag "${tagId}" uses ticket variables but OnlyInTickets is set to false! These variables will not work outside tickets.`);
            }
          }
        }
      }
    }
  } catch (error) {
    console.error('\x1b[31m%s\x1b[0m', `[CRITICAL ERROR] Error checking config: ${error.message}`);
    foundErrors.push(`Error checking config: ${error.message}`);
  }
  
    // Log all errors found
    if (foundErrors.length > 0) {
      console.log('\x1b[31m%s\x1b[0m', `Found ${foundErrors.length} configuration errors or warnings!`);
      let logMsg = `\n\n[${new Date().toLocaleString()}] [CONFIG ERROR(S)] \n${foundErrors.join("\n ").trim()}`;
      fs.appendFile("./logs.txt", logMsg, (e) => { 
        if (e) console.log(e);
      });
    } else {
      console.log('\x1b[32m%s\x1b[0m', `[SUCCESS] Configuration checked successfully with no errors!`);
    }
  };

const moment = require('moment-timezone');
exports.getHolidayMessage = async function () {
  const today = moment();
  const month = today.month() + 1; 
  const day = today.date();

  function randomMessage(messages) {
    return messages[Math.floor(Math.random() * messages.length)];
  }

  // Christmas (Dec 20-27)
  if (month === 12 && day >= 20 && day <= 27) {
    const messages = [
      `${color.green('🎄 Merry Christmas!')} ${color.red('Happy Holidays!')} 🎅
${color.cyan('Hope your holidays are filled with joy and rest!')}
${color.yellow('Thank you for all your hard work this year!')}`,

      `${color.green('🎄 Season\'s Greetings!')} ${color.red('Merry Christmas!')}
${color.cyan('Wishing you peace, joy, and time with loved ones!')}
${color.magenta('You\'ve been amazing this year - enjoy the holidays!')}`,

      `${color.green('🎅 Ho Ho Ho!')} ${color.red('Merry Christmas!')}
${color.cyan('Take a well-deserved break and enjoy the festive season!')}
${color.yellow('🎁 Your dedication doesn\'t go unnoticed!')}`,

      `${color.green('🎄 Happy Holidays!')} 🎅
${color.cyan('May your Christmas be merry and your New Year bright!')}
${color.magenta('Thank you for being such an important part of our community!')}`
    ];
    return randomMessage(messages);
  }

  // New Year's (Jan 1-3)
  if (month === 1 && day >= 1 && day <= 3) {
    const messages = [
      `${color.yellow('🎆 Happy New Year!')} ${color.blue('2025!')} 🎇
${color.cyan('Here\'s to new beginnings and exciting opportunities!')}
${color.magenta('Wishing you health, happiness, and success this year!')}`,

      `${color.yellow('🎇 Welcome to the New Year!')} ${color.blue('🎉')}
${color.cyan('Thank you for being part of our journey!')}
${color.magenta('Let\'s make this year even better together!')}`,

      `${color.yellow('✨ Happy New Year!')} ${color.blue('🎆')}
${color.cyan('New year, new possibilities, same amazing community!')}
${color.magenta('Here\'s to continued growth and success!')}`,

      `${color.yellow('🎉 Cheers to 2025!')} ${color.blue('🎇')}
${color.cyan('May this year bring you joy and new adventures!')}
${color.magenta('Thank you for making our community special!')}`
    ];
    return randomMessage(messages);
  }

  // Halloween (Oct 31)
  if (month === 10 && day === 31) {
    const messages = [
      `${color.orange('🎃 Happy Halloween!')} ${color.gray('👻')}
${color.cyan('Hope your Halloween is spook-tacular!')}
${color.magenta('Enjoy the tricks, treats, and all the fun!')}`,

      `${color.orange('👻 Boo!')} ${color.cyan('Happy Halloween!')}
${color.magenta('Wishing you a frightfully fun evening!')}
${color.yellow('Stay safe and enjoy all the Halloween festivities!')}`,

      `${color.orange('🎃 Trick or Treat!')} 
${color.cyan('Hope your Halloween is filled with sweet treats!')}
${color.magenta('Have a spook-tacular night!')}`,

      `${color.orange('🦇 Happy Halloween!')} ${color.gray('👻')}
${color.cyan('May your night be filled with fun and frights!')}
${color.yellow('Enjoy the Halloween magic!')}`
    ];
    return randomMessage(messages);
  }

  // Valentine's Day (Feb 14)
  if (month === 2 && day === 14) {
    const messages = [
      `${color.magenta('💖 Happy Valentine\'s Day!')} 
${color.cyan('Hope your day is filled with love and happiness!')}
${color.yellow('Thank you for spreading positivity in our community!')}`,

      `${color.magenta('💕 Happy Valentine\'s Day!')} 
${color.cyan('Wishing you love, joy, and wonderful moments!')}
${color.yellow('You make our community a better place!')}`,

      `${color.magenta('💌 Love is in the air!')} 
${color.cyan('Hope your Valentine\'s Day is extra special!')}
${color.magenta('Thank you for all the care you show our community!')}`,

      `${color.magenta('💝 Happy Valentine\'s Day!')} 
${color.cyan('May your day be filled with love and sweet surprises!')}
${color.yellow('Your kindness makes all the difference!')}`
    ];
    return randomMessage(messages);
  }

  return null;
};


const path = require('path');
exports.checkDashboard = async function () {
  const folderPath = path.join(__dirname, 'addons', 'Dashboard');

  try {
    const files = await new Promise((resolve, reject) => {
      fs.readdir(folderPath, (error, files) => {
        if (error) {
          reject(error);
        } else {
          resolve(files);
        }
      });
    });

    return true;

  } catch (error) {
    if (error.code === 'ENOENT') {
      return false;
    } else {
      throw error;
    }
  }
};

exports.saveTranscript = async function(interaction){
  let dashboardExists = await exports.checkDashboard();
  let attachment;
  let timestamp = "null"
if(interaction) {
  if(config.TicketTranscriptSettings.TranscriptType === "HTML") {
      attachment = await discordTranscripts.createTranscript(interaction.channel, {
        limit: -1,
        minify: false,
        saveImages: config.TicketTranscriptSettings.SaveImages,
        returnType: 'buffer',
        poweredBy: false,
        fileName: `${interaction.channel.name}.html`
      });

      if(config.TicketTranscriptSettings.SaveInFolder && dashboardExists) {
        timestamp = Date.now();
        fs.writeFileSync(`./addons/Dashboard/transcripts/transcript-${interaction.channel.id}-${timestamp}.html`, attachment);

        const ticketDB = await ticketModel.findOne({ channelID: interaction.channel.id });
        ticketDB.transcriptID = `${timestamp}`;
        await ticketDB.save();
      }

      if(config.TicketTranscriptSettings.SaveInFolder && !dashboardExists) {
      fs.writeFileSync(`./transcripts/transcript-${interaction.channel.id}-${timestamp}.html`, attachment);
      }

      attachment = new AttachmentBuilder(Buffer.from(attachment), { name: `${interaction.channel.name}-transcript.html` });
  } else if(config.TicketTranscriptSettings.TranscriptType === "TXT") {
      await interaction.channel.messages.fetch({ limit: 100 }).then(async fetched => {
          let a = fetched.filter(m => m.author.bot !== true).map(m => `${new Date(m.createdTimestamp).toLocaleString()} - ${m.author.username}: ${m.attachments.size > 0 ? m.attachments.first().proxyURL : m.content}`).reverse().join('\n');
          if (a.length < 1) a = "Nothing"
          if(config.TicketTranscriptSettings.SaveInFolder) fs.writeFileSync(`./transcripts/${interaction.channel.name}-transcript-${interaction.channel.id}.txt`, Buffer.from(a));
          attachment = new AttachmentBuilder(Buffer.from(a), { name: `${interaction.channel.name}-transcript.txt` });
  })
}
}

return { attachment, timestamp };
}

exports.saveTranscriptAlertCmd = async function(channel){
  let dashboardExists = await exports.checkDashboard();
  let attachment;
  let timestamp = "null"
  if(channel) {
    if(config.TicketTranscriptSettings.TranscriptType === "HTML") {
        attachment = await discordTranscripts.createTranscript(channel, {
            limit: -1,
            minify: false,
            saveImages: config.TicketTranscriptSettings.SaveImages,
            returnType: 'buffer',
            poweredBy: false,
            fileName: `${channel.name}.html`
        });

        if(config.TicketTranscriptSettings.SaveInFolder && dashboardExists) {
          timestamp = Date.now();
          fs.writeFileSync(`./addons/Dashboard/transcripts/transcript-${channel.id}-${timestamp}.html`, attachment);

          const ticketDB = await ticketModel.findOne({ channelID: channel.id });
          ticketDB.transcriptID = `${timestamp}`;
          await ticketDB.save();
        }

        if(config.TicketTranscriptSettings.SaveInFolder && !dashboardExists) {
          fs.writeFileSync(`./transcripts/transcript-${channel.id}-${timestamp}.html`, attachment);
          }

        attachment = new AttachmentBuilder(Buffer.from(attachment), { name: `${channel.name}-transcript.html` });
    } else if(config.TicketTranscriptSettings.TranscriptType === "TXT") {
        await channel.messages.fetch({ limit: 100 }).then(async fetched => {
            let a = fetched.filter(m => m.author.bot !== true).map(m => `${new Date(m.createdTimestamp).toLocaleString()} - ${m.author.username}: ${m.attachments.size > 0 ? m.attachments.first().proxyURL : m.content}`).reverse().join('\n');
            if (a.length < 1) a = "Nothing"
            if(config.TicketTranscriptSettings.SaveInFolder) fs.writeFileSync(`./transcripts/${channel.name}-transcript-${channel.id}.txt`, Buffer.from(a));
            attachment = new AttachmentBuilder(Buffer.from(a), { name: `${channel.name}-transcript.txt` });
    })
  }
  }
  return { attachment, timestamp };
}

const stripeModel = require('./models/stripeInvoicesModel');
const paypalModel = require('./models/paypalInvoicesModel');

// Check for new payments
    // Stripe payment detection
    exports.checkStripePayments = async function () {
      let guild = client.guilds.cache.get(config.GuildID);
    
      try {
        const filtered = await stripeModel.find({ status: 'open' });
    
        if (!filtered.length) return;
    
        for (const eachPayment of filtered) {
          let channel = guild.channels.cache.get(eachPayment.channelID);
          let user = guild.members.cache.get(eachPayment.userID);
          let session;
    
          if (user) {
            session = await client.stripe.invoices.retrieve(eachPayment.invoiceID);
    
            if (!session || !channel) {
              await stripeModel.deleteMany({ invoiceID: eachPayment.invoiceID });
            }
    
            if (session.status === 'paid') {
              await stripeModel.updateOne({ invoiceID: session.id }, { $set: { status: 'paid' } });
              await stripeModel.updateOne({ invoiceID: session.id }, { $set: { status: 'deleted' } });
            }
          }
    
          if (channel && user && session && session.status === 'paid') {
            await channel.messages.fetch(eachPayment.messageID).then(async msg => {
              const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                  .setStyle('Link')
                  .setURL(`https://stripe.com`)
                  .setLabel(config.Locale.PayPalPayInvoice)
                  .setDisabled(true),
                  new ButtonBuilder()
                  .setCustomId(`${session.id}-paid`)
                  .setStyle('Success')
                  .setLabel(config.StripeSettings.StatusPaid)
                  .setDisabled(true));
    
              let customerRole = guild.roles.cache.get(config.StripeSettings.RoleToGive);
              if(customerRole) user.roles.add(customerRole)

              const embed = msg.embeds[0];
              const embedColor = EmbedBuilder.from(embed);
              embedColor.setColor("Green");
              await msg.edit({ embeds: [embedColor], components: [row] });
            });
          }
        }
      } catch (error) {
        console.error('Error in checkStripePayments:', error);
      }
    };
  
    
    exports.checkPayPalPayments = async function () {
      const guild = client.guilds.cache.get(config.GuildID);
    
      try {
        const filtered = await paypalModel.find({ status: 'DRAFT' });
    
        if (!filtered.length) return;
    
        for (const eachPayment of filtered) {
          const channel = guild.channels.cache.get(eachPayment.channelID);
          const user = guild.members.cache.get(eachPayment.userID);
    
          if (user) {
            client.paypal.invoice.get(eachPayment.invoiceID, async function (error, invoice) {
              if (error) {
                if (error.response.error === "invalid_client") {
                  console.log('\x1b[31m%s\x1b[0m', `[ERROR] The PayPal API Credentials you specified in the config are invalid! Make sure you use the "LIVE" mode!`);
                } else {
                  console.error(`An error occured while checking invoice with ID ${eachPayment.invoiceID}, (${error.message}), It has been automatically deleted from the database.`);
                  await paypalModel.deleteMany({ invoiceID: eachPayment.invoiceID });
                }
              } else {
                if (!channel || !invoice) {
                  await paypalModel.deleteMany({ invoiceID: invoice.id });
                }

                if (invoice.status === 'PAID') {
                  await paypalModel.updateOne({ invoiceID: invoice.id }, { $set: { status: 'paid' } });
                }
    
                if (invoice && channel && user && invoice.status === 'PAID') {
                  channel.messages.fetch(eachPayment.messageID)
                    .catch(e => { })
                    .then(async msg => {
                      const row = new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                          .setStyle('Link')
                          .setURL(`https://paypal.com`)
                          .setLabel(config.Locale.PayPalPayInvoice)
                          .setDisabled(true),
                        new ButtonBuilder()
                          .setCustomId(`${invoice.id}-paid`)
                          .setStyle('Success')
                          .setLabel(config.PayPalSettings.StatusPaid)
                          .setDisabled(true));
    
                      const embed = msg.embeds[0];
                      const embedColor = EmbedBuilder.from(embed)
                        .setColor("Green");
    
                        let customerRole = guild.roles.cache.get(config.PayPalSettings.RoleToGive);
                        if(customerRole) user.roles.add(customerRole)

                      await msg.edit({ embeds: [embedColor], components: [row] });
                    });
                }
              }
            });
          }
        }
      } catch (error) {
        console.error('Error in checkPayPalPayments:', error);
      }
    };
    
exports.getCategoryLogsChannel = async function(channelID) {
  try {
    let guild = await client.guilds.cache.get(config.GuildID)
    if (!channelID) return guild.channels.cache.get(config.TicketSettings.LogsChannelID);

    const ticketDB = await ticketModel.findOne({ channelID: channelID });
    if (!ticketDB) return guild.channels.cache.get(config.TicketSettings.LogsChannelID);

    const categoryId = ticketDB.button;
    if (!categoryId || !config.TicketCategories || !config.TicketCategories[categoryId]) {
      return guild.channels.cache.get(config.TicketSettings.LogsChannelID);
    }

    const categoryConfig = config.TicketCategories[categoryId];
    
    if (categoryConfig.LogsChannelID && categoryConfig.LogsChannelID.trim() !== '') {
      const categoryLogsChannel = guild.channels.cache.get(categoryConfig.LogsChannelID);
      if (categoryLogsChannel) {
        return categoryLogsChannel;
      }
    }

    return guild.channels.cache.get(config.TicketSettings.LogsChannelID);
  } catch (error) {
    console.error('\x1b[31m%s\x1b[0m', `[LOGS CHANNEL] Error getting category logs channel: ${error}`);
    return guild.channels.cache.get(config.TicketSettings.LogsChannelID);
  }
};

exports.generateTicketCloseSummary = async function(channelID) {
  try {
    if (!config.AI?.Enabled || !config.AI?.TicketCloseSummaries?.Enabled) {
      return null;
    }
    
    const ticketDB = await ticketModel.findOne({ channelID: channelID });
    if (!ticketDB) {
      console.error('[TICKET SUMMARY] No ticket found for channel:', channelID);
      return config.AI.TicketCloseSummaries.DefaultMessage || null;
    }

    const guild = await client.guilds.cache.get(config.GuildID);
    const channel = guild.channels.cache.get(channelID);
    
    if (!channel) {
      console.error('[TICKET SUMMARY] Channel not found:', channelID);
      return config.AI.TicketCloseSummaries.DefaultMessage || null;
    }

    const maxMessages = config.AI.TicketCloseSummaries.MaxMessagesToAnalyze || 50;
    const summaryLength = config.AI.TicketCloseSummaries.SummaryLength || "short";
    const language = config.AI.TicketCloseSummaries.Language || "English";

    const messages = await channel.messages.fetch({ limit: maxMessages });
    const messageArray = Array.from(messages.values()).reverse();

    if (messageArray.length === 0) {
      return config.AI.TicketCloseSummaries.DefaultMessage || "No messages found in ticket";
    }

    let conversationText = '';
    
    if (ticketDB.questions && ticketDB.questions.length > 0) {
      conversationText += '=== INITIAL TICKET INFORMATION ===\n';
      ticketDB.questions.forEach(q => {
        conversationText += `Question: ${q.question}\n`;
        if (q.response && q.response.trim() !== '') {
          conversationText += `Answer: ${q.response}\n`;
        } else {
          conversationText += `Answer: No response provided\n`;
        }
        conversationText += '\n';
      });
      conversationText += '=== CONVERSATION ===\n';
    }
    
    messageArray.forEach(msg => {
      if (!msg.author.bot && msg.content.trim() !== '') {
        const username = msg.author.username;
        const content = msg.content.substring(0, 500);
        conversationText += `[${username}]: ${content}\n`;
      }
    });

    if (conversationText.trim() === '' || conversationText.trim() === '=== CONVERSATION ===') {
      return config.AI.TicketCloseSummaries.DefaultMessage || "No user messages found in ticket";
    }

    let lengthInstruction;
    switch (summaryLength.toLowerCase()) {
      case "short":
        lengthInstruction = "1-2 sentences";
        break;
      case "medium":
        lengthInstruction = "3-4 sentences";
        break;
      case "long":
        lengthInstruction = "a detailed paragraph";
        break;
      default:
        lengthInstruction = "1-2 sentences";
    }

const systemPrompt = `You are a professional AI assistant that creates high-quality summaries of resolved customer support tickets.

Instructions:
- Create a ${lengthInstruction} summary in past tense
- Write in ${language}
- Focus on: what the user's issue was, what support actions were taken, and what the final outcome was
- Use professional, easy to understand, clear language
- Always complete your sentences - never cut off mid-sentence
- Include specific details about the problem and solution when available
- Use past tense throughout (e.g., "User experienced...", "Support provided...", "Issue was resolved...")

Structure your summary like this:
- Start with what the user experienced/requested
- Mention what support actions were taken (if any)
- End with the outcome/resolution status

Good examples:
- "User experienced login errors with their account. Support identified the issue as an expired API key and provided a new one. The problem was successfully resolved."
- "User requested help with bot installation and configuration. Support provided detailed setup instructions and troubleshooting steps. User confirmed successful implementation."
- "User reported database connection issues affecting ticket creation. Support diagnosed the problem as incorrect MongoDB configuration and provided the correct settings. Issue was resolved."

Instead, be specific about what was discussed and accomplished.`;

    const openai = new OpenAI({
      apiKey: config.AI.OpenAIAPIKey,
    });

const response = await openai.chat.completions.create({
  model: config.AI.Model,
  messages: [
    {
      role: 'system',
      content: systemPrompt
    },
    {
      role: 'user', 
      content: `Please summarize this support ticket:\n\n${conversationText}`
    }
  ],
  temperature: 0.3,
  max_tokens: summaryLength === "long" ? 300 : summaryLength === "medium" ? 150 : 100
});

    const summary = response.choices[0].message.content.trim();
    
    if (!summary || summary.length === 0) {
      return config.AI.TicketCloseSummaries.DefaultMessage || "Summary could not be generated";
    }

    try {
      await ticketModel.updateOne(
        { channelID: channelID },
        { 
          $set: { 
            aiSummary: summary
          }
        }
      );
    } catch (dbError) {
      console.error('[TICKET SUMMARY] Error saving summary to database:', dbError);
    }

    return summary;

  } catch (error) {
    console.error('[TICKET SUMMARY] Error generating summary:', error);
    return config.AI.TicketCloseSummaries.DefaultMessage || "Summary could not be generated";
  }
};

exports.checkIfUserHasSupportRoles = async function(interaction, message) {
  let supportRole = false;
  let context = interaction || message;
  
  try {
    if (!context || !context.channel || !context.guild || !context.member) {
      return false;
    }
    
    if (context.member.permissions && context.member.permissions.has("Administrator")) {
      return true;
    }
    
    const ticketDB = await ticketModel.findOne({ channelID: context.channel.id });
    
    if (ticketDB) {
      const categoryId = ticketDB.button;
      if (config.TicketCategories && categoryId && config.TicketCategories[categoryId]) {
        const categoryConfig = config.TicketCategories[categoryId];
        
        if (categoryConfig && categoryConfig.SupportRoles && Array.isArray(categoryConfig.SupportRoles)) {
          for (const roleId of categoryConfig.SupportRoles) {
            if (!roleId) continue;
            
            const role = context.guild.roles.cache.get(roleId);
            
            if (role && context.member.roles && context.member.roles.cache && context.member.roles.cache.has(role.id)) {
              supportRole = true;
              break;
            }
          }
        }
      }
    }
  
    if (!supportRole) {
      const allSupportRoles = new Set();
      
      if (config.TicketCategories) {
        for (const categoryId in config.TicketCategories) {
          const category = config.TicketCategories[categoryId];
          
          if (category && category.SupportRoles && Array.isArray(category.SupportRoles)) {
            for (const roleId of category.SupportRoles) {
              if (roleId) allSupportRoles.add(roleId);
            }
          }
        }
      }
      
      for (const roleId of allSupportRoles) {
        if (!roleId) continue;
        
        const role = context.guild.roles.cache.get(roleId);
        
        if (role && context.member.roles && context.member.roles.cache && context.member.roles.cache.has(role.id)) {
          supportRole = true;
          break;
        }
      }
    }
  } catch (error) {
    console.error('\x1b[31m%s\x1b[0m', `[SUPPORT ROLE CHECK] Error checking support roles: ${error}`);
  }
  
  return supportRole;
};

const withTimeout = (promise, timeoutMs = 5000) => {
  return Promise.race([
    promise,
    new Promise((_, reject) => 
      setTimeout(() => reject(new Error(`Operation timed out after ${timeoutMs}ms`)), timeoutMs)
    )
  ]);
};

exports.archiveTicket = async function(interaction, ticketDB, client) {

  const archiveEmbed = new EmbedBuilder()
    .setTitle(`🗃️ ${config.Locale.archivinTicketTitle}`)
    .setColor("#FFA500")
    .setDescription(config.Locale.archivingTicket)
    .setTimestamp();

  let replyMessage;
  if (interaction.deferred) {
    replyMessage = await interaction.editReply({ embeds: [archiveEmbed] });
  } else {
    replyMessage = await interaction.reply({ embeds: [archiveEmbed] });
  }

  setTimeout(async () => {
    try {
      const currentTicketDB = await ticketModel.findOne({ channelID: interaction.channel.id });
      if (!currentTicketDB) {
        return;
      }

      await ticketModel.updateOne(
        { channelID: interaction.channel.id },
        { 
          $set: { 
            archived: true,
            archivedBy: interaction.user.id,
            archivedAt: Date.now(),
            originalCategoryID: interaction.channel.parentId
          }
        }
      );

      try {
        const permissionOverwrites = interaction.channel.permissionOverwrites.cache;
        const userOverwrites = Array.from(permissionOverwrites.entries()).filter(([userId, overwrite]) => overwrite.type === 1);

        for (const [userId, overwrite] of userOverwrites) {
          try {
            if (config.ArchiveSystem.HideFromCreator) {
              await withTimeout(
                interaction.channel.permissionOverwrites.edit(userId, {
                  ViewChannel: false
                }),
                3000
              );
            } else {
              await withTimeout(
                interaction.channel.permissionOverwrites.edit(userId, {
                  SendMessages: false,
                  ViewChannel: true
                }),
                3000
              );
            }
          } catch (error) {
            console.log(`Failed to update user ${userId}: ${error.message}`);
          }
        }
      } catch (error) {
        console.log('Error in permissions handling:', error.message);
      }

      try {
        if (config.ArchiveSystem.MoveToCategory && config.ArchiveSystem.ArchiveCategoryID) {
          const archiveCategory = interaction.guild.channels.cache.get(config.ArchiveSystem.ArchiveCategoryID);
          if (archiveCategory) {
            await withTimeout(
              interaction.channel.setParent(config.ArchiveSystem.ArchiveCategoryID, {
                lockPermissions: false
              }),
              8000
            );
          } else {
            console.log('Archive category not found:', config.ArchiveSystem.ArchiveCategoryID);
          }
        }
      } catch (error) {
        console.log('Error moving to archive category:', error.message);
      }

      try {
        const currentName = interaction.channel.name;
        const prefix = config.ArchiveSystem.ChannelNamePrefix || "archived-";
        if (!currentName.startsWith(prefix)) {
          await withTimeout(
            interaction.channel.setName(`${prefix}${currentName}`),
            5000
          );
        }
      } catch (error) {
        console.log('Error renaming channel:', error.message);
      }

      const finalArchiveEmbed = new EmbedBuilder()
        .setTitle(config.ArchiveSystem.ArchiveEmbedTitle)
        .setColor("#FFA500")
        .setDescription(config.ArchiveSystem.ArchiveEmbedDescription)
        .addFields([
          {
            name: `\`📋\` ${config.Locale.archiveDetails}`,
            value: `> **${config.Locale.archivedBy}:** <@${interaction.user.id}>\n> **${config.Locale.archivedAt}:** <t:${Math.floor(Date.now() / 1000)}:F>\n> **${config.Locale.logsTicketAuthor}:** <@${currentTicketDB.userID}>`
          }
        ])
        .setTimestamp();

      if (currentTicketDB.closeReason && config.TicketSettings.TicketCloseReason) {
        finalArchiveEmbed.addFields([
          {
            name: `\`📝\` ${config.Locale.closeReasonDM}`,
            value: `> ${currentTicketDB.closeReason}`
          }
        ]);
      }

      const reopenButton = new ButtonBuilder()
        .setCustomId('reopenTicket')
        .setLabel(config.ArchiveSystem.ReopenButtonLabel)
        .setStyle('Success')
        .setEmoji('🔓');

      const deleteButton = new ButtonBuilder()
        .setCustomId('confirmDeleteTicket')
        .setLabel(config.ArchiveSystem.DeleteButtonLabel)
        .setStyle('Danger')
        .setEmoji('🗑️');

      const archiveRow = new ActionRowBuilder().addComponents(reopenButton, deleteButton);

      try {
        const originalMsg = await interaction.channel.messages.fetch(currentTicketDB.msgID);
        const archivedTicketButton = new ButtonBuilder()
          .setCustomId('archiveTicket')
          .setLabel(config.ArchiveSystem.ArchiveButtonLabel)
          .setStyle('Secondary')
          .setEmoji('📋')
          .setDisabled(true);

        const archivedRow = new ActionRowBuilder().addComponents(archivedTicketButton);
        await originalMsg.edit({ components: [archivedRow] });
      } catch (error) {
        console.error('Failed to update original ticket message:', error);
      }

      const archiveMsg = await interaction.channel.send({ embeds: [finalArchiveEmbed], components: [archiveRow] });

      await ticketModel.updateOne(
        { channelID: interaction.channel.id },
        { $set: { archiveMsgID: archiveMsg.id } }
      );

    } catch (error) {
      console.error('Error in archive process:', error);
      
      try {
        const errorEmbed = new EmbedBuilder()
          .setTitle("❌ Archive Failed")
          .setColor("#FF0000")
          .setDescription("An error occurred while archiving the ticket. Please try again or contact an administrator.")
          .setTimestamp();

        await interaction.channel.send({ embeds: [errorEmbed] });
      } catch (sendError) {
        console.error('Failed to send error message:', sendError);
      }
    }
  }, 1000);
};

const relayEvents = (client) => {
  const eventsToRelay = [
    'messageCreate',
    'messageDelete',
    'messageDeleteBulk',
    'messageReactionAdd',
    'messageReactionRemove',
    'messageReactionRemoveAll',
    'messageUpdate',
    'channelCreate',
    'channelDelete',
    'channelPinsUpdate',
    'channelUpdate',
    'guildBanAdd',
    'guildBanRemove',
    'guildCreate',
    'guildDelete',
    'guildEmojiCreate',
    'guildEmojiDelete',
    'guildEmojiUpdate',
    'guildIntegrationsUpdate',
    'guildMemberAdd',
    'guildMemberRemove',
    'guildMemberUpdate',
    'guildRoleCreate',
    'guildRoleDelete',
    'guildRoleUpdate',
    'guildUpdate',
    'inviteCreate',
    'inviteDelete',
    'presenceUpdate',
    'threadCreate',
    'threadDelete',
    'threadListSync',
    'threadMembersUpdate',
    'threadUpdate',
    'typingStart',
    'userUpdate',
    'voiceStateUpdate',
    'webhookUpdate',
    'shardDisconnect',
    'shardError',
    'shardReady',
    'shardReconnecting',
    'shardResume',
    'stageInstanceCreate',
    'stageInstanceDelete',
    'stageInstanceUpdate',
    'invalidRequestWarning',
    'rateLimit',
  ];

  eventsToRelay.forEach((eventName) => {
    client.on(eventName, (...args) => {
      eventHandler.emit(eventName, ...args);
    });
  });
};


client.login(config.Token).then(() => {
  relayEvents(client);
}).catch((error) => {
  if (error.message.includes('Used disallowed intents')) {
    console.log(
      '\x1b[31m%s\x1b[0m',
      `Used disallowed intents (READ HOW TO FIX): \n\nYou did not enable Privileged Gateway Intents in the Discord Developer Portal!
To fix this, you have to enable all the privileged gateway intents in your Discord Developer Portal. Open the portal, go to your application, click on "Bot" on the left side, scroll down, and enable Presence Intent, Server Members Intent, and Message Content Intent.`
    );
    process.exit();
  } else if (error.message.includes('An invalid token was provided')) {
    console.log('\x1b[31m%s\x1b[0m', `[ERROR] The bot token specified in the config is incorrect!`);
    process.exit();
  } else {
    console.log('\x1b[31m%s\x1b[0m', `[ERROR] An error occurred while attempting to log in to the bot`);
    console.log(error);
    process.exit();
  }
});
