const { Discord, EmbedBuilder, ButtonBuilder, ActionRowBuilder } = require("discord.js");
const fs = require('fs');
const yaml = require("js-yaml")
const config = yaml.load(fs.readFileSync('./config.yml', 'utf8'))
const color = require('ansi-colors');
const utils = require("../utils.js");
const ticketModel = require("../models/ticketModel");
const guildModel = require("../models/guildModel");
const { incrementStat } = require("../staffStats.js");
const OpenAI = require('openai');
const AIAutoResponseModel = require('../models/aiAutoResponseModel');

module.exports = async (client, message) => {
    if(!message.channel.type === 0) return;
    const ticketDB = await ticketModel.findOne({ channelID: message.channel.id });
    if(message.author.bot) return;

if (ticketDB) {
  if (!message.author.bot) {
    let supportRole = await utils.checkIfUserHasSupportRoles(null, message);

    await incrementStat(message.author, 'message', 1, { ticketID: message.channel.id }, null, message);

    const waitingReplyFrom = supportRole ? "user" : "staff";

   // Auto-claim feature
    if (config.ClaimingSystem?.Enabled && supportRole && config.ClaimingSystem?.AutoClaim?.Enabled) {
      if (message.author.id !== ticketDB.userID) {
        const shouldClaim = 
          !ticketDB.claimed || 
          (config.ClaimingSystem.AutoClaim.OverridePreviousClaims && ticketDB.claimUser !== message.author.id);
        
        if (shouldClaim) {
          await autoClaimTicket(client, message, ticketDB);
        }
      }
    }

if (supportRole && !ticketDB.firstStaffResponse) {
  try {
    const responseTime = Date.now() - new Date(ticketDB.createdAt).getTime();
    
    await incrementStat(message.author, 'responseTime', responseTime, {
      ticketID: message.channel.id,
      responseTime: responseTime
    }, null, message);
    
    await ticketModel.findOneAndUpdate(
      { channelID: message.channel.id },
      { $set: { firstStaffResponse: Date.now() } }
    );
  } catch (error) {
    console.error("Error tracking response time:", error);
    
    await ticketModel.findOneAndUpdate(
      { channelID: message.channel.id },
      { $set: { firstStaffResponse: Date.now() } }
    );
  }
}

    const ticket = await ticketModel.findOne({ channelID: message.channel.id });
    const existingParticipant = ticket.participants ? ticket.participants.find(p => p.userID === message.author.id) : null;
    
    if (existingParticipant) {
      await ticketModel.findOneAndUpdate(
        { 
          channelID: message.channel.id,
          "participants.userID": message.author.id
        },
        {
          $inc: { "participants.$.messageCount": 1 },
          $set: { "participants.$.lastMessage": Date.now() }
        }
      );
    } else {
      await ticketModel.findOneAndUpdate(
        { channelID: message.channel.id },
        {
          $push: {
            participants: {
              userID: message.author.id,
              messageCount: 1,
              firstMessage: Date.now(),
              lastMessage: Date.now()
            }
          }
        }
      );
    }

    await ticketModel.findOneAndUpdate(
      { channelID: message.channel.id },
      {
        $set: {
          lastMessageSent: Date.now(),
          waitingReplyFrom: waitingReplyFrom,
        },
        $inc: { messages: 1 },
      },
      { new: true }
    );
  }

  await guildModel.findOneAndUpdate(
    { guildID: message.guild.id },
    { $inc: { totalMessages: 1 } }
  );

  if (config.TicketAlert.Enabled) {
    const filtered = await ticketModel.find({
      closeNotificationTime: { $exists: true, $ne: null },
      channelID: message.channel.id
    });

    for (const time of filtered) {
      if(!time) return;
      if(!time.channelID) return;
      if(time.closeNotificationTime === 0) return

      if(time.channelID === message.channel.id) {
      await ticketModel.findOneAndUpdate(
        { channelID: message.channel.id },
        { $unset: { closeReason: 1 }, $set: { closeNotificationTime: 0 } }
      );

      if(message) await message.channel.messages.fetch(time.closeNotificationMsgID).then(msg => {
        try {
          msg.delete();
        } catch (error) {
          console.error("Error deleting message:", error);
        }
      });
}

    }
  }
}

// AI AutoResponse System
if (config.AIAutoResponse.Enabled && config.AIAutoResponse.Responses) {
  let supportRole = await utils.checkIfUserHasSupportRoles(null, message);
  if (supportRole) return;

  if (config.AIAutoResponse.ChannelFilter.Mode !== "DISABLED") {
    const channelId = message.channel.id;
    const categoryId = message.channel.parent?.id;
    const filterChannels = config.AIAutoResponse.ChannelFilter.Channels || [];
    const filterCategories = config.AIAutoResponse.ChannelFilter.Categories || [];
    
    const isChannelListed = filterChannels.includes(channelId);
    const isCategoryListed = categoryId && filterCategories.includes(categoryId);
    const isListed = isChannelListed || isCategoryListed;
    
    if (config.AIAutoResponse.ChannelFilter.Mode === "WHITELIST" && !isListed) {
      return;
    }
    
    if (config.AIAutoResponse.ChannelFilter.Mode === "BLACKLIST" && isListed) {
      return;
    }
  }

  const userMessage = message.content;
  const responses = config.AIAutoResponse.Responses;
  
  const isInTicket = !!ticketDB;
  const availableResponses = {};
  
  Object.entries(responses).forEach(([key, response]) => {
    if (response.OnlyInTickets === true && !isInTicket) {
      return; 
    }
    
    availableResponses[key] = response;
  });
  
  if (Object.keys(availableResponses).length === 0) {
    return;
  }
  
  const systemPrompt = `You are a helpful customer support AI for a Discord server. Analyze user messages and determine if they match any of the available responses. You should identify the intent and context of the user's message, not just keywords.
  
  Return a JSON response with:
  - "match": true/false (whether the message matches any response)
  - "response_key": the key of the best matching response (or null if no match)
  - "confidence": a number between 0.0 and 1.0 indicating how confident you are
  - "reasoning": brief explanation of why you chose this response
  
  Available responses and their contexts:`;
  
  let fullSystemPrompt = systemPrompt;
  Object.entries(availableResponses).forEach(([key, response]) => {
    fullSystemPrompt += `\n- "${key}": Triggers for: ${response.Triggers.join(', ')}`;
  });

try {
  const openai = new OpenAI({
    apiKey: config.AI.OpenAIAPIKey,
  });

  const response = await openai.chat.completions.create({
    model: config.AI.Model,
    messages: [
      {
        role: 'system',
        content: fullSystemPrompt + '\n\nIMPORTANT: Respond with ONLY valid JSON, no markdown formatting or code blocks.'
      },
      {
        role: 'user', 
        content: `Analyze this user message: "${userMessage}"`
      }
    ],
    temperature: 0.3,
    max_tokens: 150
  });

  let aiResponseText = response.choices[0].message.content.trim();
  
  if (aiResponseText.startsWith('```json')) {
    aiResponseText = aiResponseText.replace(/^```json\s*/, '').replace(/\s*```$/, '');
  } else if (aiResponseText.startsWith('```')) {
    aiResponseText = aiResponseText.replace(/^```\s*/, '').replace(/\s*```$/, '');
  }
  
  const aiResult = JSON.parse(aiResponseText);
  
  if (aiResult.match && 
      aiResult.confidence >= config.AIAutoResponse.ConfidenceThreshold && 
      availableResponses[aiResult.response_key]) {
    
    const responseConfig = availableResponses[aiResult.response_key];
    const responseMsg = responseConfig.Message;
    const responseType = responseConfig.Type || "TEXT";

    let sentMessage;

    if (responseType === "EMBED") {
      const aiEmbed = new EmbedBuilder();
      
      const embedColor = responseConfig.Color || config.AIAutoResponse.Embed.Color || config.EmbedColors || "#5865F2";
      aiEmbed.setColor(embedColor);
      
      if (config.AIAutoResponse.Embed.Title && config.AIAutoResponse.Embed.Title.trim() !== "") {
        aiEmbed.setTitle(config.AIAutoResponse.Embed.Title);
      }
      
      aiEmbed.setDescription(responseMsg);
      
      if (config.AIAutoResponse.Embed.ThumbnailURL && config.AIAutoResponse.Embed.ThumbnailURL.trim() !== "") {
        aiEmbed.setThumbnail(config.AIAutoResponse.Embed.ThumbnailURL);
      }
      
      if (config.AIAutoResponse.Embed.Footer && config.AIAutoResponse.Embed.Footer.Text && config.AIAutoResponse.Embed.Footer.Text.trim() !== "") {
        const footerOptions = {
          text: config.AIAutoResponse.Embed.Footer.Text
        };
        
        if (config.AIAutoResponse.Embed.Footer.ShowUserAvatar !== false) {
          footerOptions.iconURL = message.author.displayAvatarURL({ dynamic: true });
        }
        
        aiEmbed.setFooter(footerOptions);
      }

      if (config.AIAutoResponse.Embed.Footer && config.AIAutoResponse.Embed.Footer.ShowTimestamp !== false) {
        aiEmbed.setTimestamp();
      }

      if (config.AIAutoResponse.ButtonSettings.Enabled) {
        const row = new ActionRowBuilder()
          .addComponents(
            new ButtonBuilder()
              .setCustomId(`ai_helpful_${message.id}`)
              .setLabel(config.AIAutoResponse.ButtonSettings.HelpfulButton)
              .setStyle('Success'),
            new ButtonBuilder()
              .setCustomId(`ai_not_helpful_${message.id}`)
              .setLabel(config.AIAutoResponse.ButtonSettings.NotHelpfulButton)
              .setStyle('Secondary')
          );

        sentMessage = await message.reply({ 
          embeds: [aiEmbed], 
          components: [row] 
        });
      } else {
        sentMessage = await message.reply({ embeds: [aiEmbed] });
      }

    } else if (responseType === "TEXT") {
      if (config.AIAutoResponse.ButtonSettings.Enabled) {
        const row = new ActionRowBuilder()
          .addComponents(
            new ButtonBuilder()
              .setCustomId(`ai_helpful_${message.id}`)
              .setLabel(config.AIAutoResponse.ButtonSettings.HelpfulButton)
              .setStyle('Success'),
            new ButtonBuilder()
              .setCustomId(`ai_not_helpful_${message.id}`)
              .setLabel(config.AIAutoResponse.ButtonSettings.NotHelpfulButton)
              .setStyle('Secondary')
          );

        sentMessage = await message.reply({ 
          content: responseMsg, 
          components: [row] 
        });
      } else {
        sentMessage = await message.reply({ content: responseMsg });
      }
    }

    if (config.AIAutoResponse.Statistics.Enabled) {
      const now = new Date();
      const aiResponseData = new AIAutoResponseModel({
        messageId: message.id,
        userId: message.author.id,
        channelId: message.channel.id,
        guildId: message.guild.id,
        userMessage: userMessage,
        responseKey: aiResult.response_key,
        aiConfidence: aiResult.confidence,
        aiReasoning: aiResult.reasoning,
        responseType: responseType,
        responseMessage: responseMsg,
        isInTicket: isInTicket,
        month: now.getMonth() + 1,
        year: now.getFullYear()
      });

      await aiResponseData.save();
    }

    if (config.AIAutoResponse.Statistics.LogsChannelID && config.AIAutoResponse.Statistics.LogsChannelID !== "CHANNEL_ID") {
      const logsChannel = message.guild.channels.cache.get(config.AIAutoResponse.Statistics.LogsChannelID);
      if (logsChannel) {
        const logEmbed = new EmbedBuilder()
          .setColor('#00FF7F')
          .setAuthor({ name: '🤖 AI AutoResponse Triggered' })
          .setThumbnail(message.author.displayAvatarURL({ dynamic: true }))
          .setTimestamp();

        let logContent = '';
        logContent += `> **User:** <@!${message.author.id}> \`${message.author.username}\`\n`;
        logContent += `> **Channel:** <#${message.channel.id}>\n`;
        logContent += `> **Response:** \`${aiResult.response_key}\`\n`;
        logContent += `> **Confidence:** \`${(aiResult.confidence * 100).toFixed(1)}%\`\n`;
        logContent += `> **Context:** \`${isInTicket ? 'Ticket' : 'General'}\`\n`;
        logContent += `> **Message:** ${userMessage.substring(0, 100)}${userMessage.length > 100 ? '...' : ''}`;

        logEmbed.addFields([{
          name: '`📊` **AI Analysis Details**',
          value: logContent
        }]);

        logEmbed.setFooter({
          text: `AI Reasoning: ${aiResult.reasoning}`,
          iconURL: message.author.displayAvatarURL({ dynamic: true })
        });

        logsChannel.send({ embeds: [logEmbed] });
      }
    }
  }

} catch (error) {
  console.error('AI AutoResponse Error:', error);
}
}

async function autoClaimTicket(client, message, ticketDB) {
  try {
    let logMsg = `\n\n[${new Date().toLocaleString()}] [AUTO-CLAIM] User: ${message.author.username}`;
    fs.appendFile("./logs.txt", logMsg, (e) => { 
      if(e) console.log(e);
    });
    

    if (config.ClaimingSystem.MaxClaimsPerStaff > 0) {
      const isExempt = config.ClaimingSystem.MaxClaimsExemptRoles?.some(roleId =>
        message.member.roles.cache.has(roleId)
      );

      if (!isExempt) {
        const claimedTickets = await ticketModel.countDocuments({
          claimUser: message.author.id,
          claimed: true,
          status: "Open"
        });

        if (claimedTickets >= config.ClaimingSystem.MaxClaimsPerStaff) {
          return false;
        }
      }
    }

    let autoClaimMessage = config.ClaimingSystem.AutoClaim.Message;
    let embedClaimVar = autoClaimMessage.replace(/{user}/g, `<@!${message.author.id}>`);
    
    const embed = new EmbedBuilder()
      .setTitle(config.Locale.ticketClaimedTitle)
      .setColor("Green")
      .setDescription(embedClaimVar)
      .setTimestamp()
      .setFooter({ 
        text: `${config.Locale.ticketClaimedBy} ${message.author.username}`, 
        iconURL: `${message.author.displayAvatarURL({ dynamic: true })}` 
      });
    
    if (config.ClaimingSystem.AutoClaim.ShowMessage) {
      await message.channel.send({ embeds: [embed], ephemeral: false });
    }
    
    try {
      const msg = await message.channel.messages.fetch(ticketDB.msgID);
      
      if (msg && msg.embeds && msg.embeds.length > 0) {
        const originalEmbed = EmbedBuilder.from(msg.embeds[0]);
        
        originalEmbed.data.fields = originalEmbed.data.fields || [];
        if (originalEmbed.data.fields.length > 0) {
          originalEmbed.data.fields[0] = { 
            name: `${config.Locale.ticketClaimedBy}`, 
            value: `> <@!${message.author.id}> (${message.author.username})` 
          };
        } else {
          originalEmbed.addFields([{
            name: `${config.Locale.ticketClaimedBy}`, 
            value: `> <@!${message.author.id}> (${message.author.username})`
          }]);
        }
        
        const ticketDeleteButton = new ButtonBuilder()
          .setCustomId('closeTicket')
          .setLabel(config.Locale.CloseTicketButton)
          .setStyle(config.ButtonColors.closeTicket)
          .setEmoji(config.ButtonEmojis.closeTicket);
          
        const ticketClaimButton = new ButtonBuilder()
          .setCustomId('ticketclaim')
          .setLabel(config.Locale.claimTicketButton)
          .setEmoji(config.ButtonEmojis.ticketClaim)
          .setStyle(config.ButtonColors.ticketClaim)  
          .setDisabled(true);
          
        const ticketUnClaimButton = new ButtonBuilder()
          .setCustomId('ticketunclaim')
          .setLabel(config.Locale.unclaimTicketButton)
          .setStyle(config.ButtonColors.ticketUnclaim)
          
        const row = new ActionRowBuilder().addComponents(ticketDeleteButton, ticketClaimButton, ticketUnClaimButton);
        
        await msg.edit({ embeds: [originalEmbed], components: [row] });
      }
    } catch (error) {
      console.error("Error updating original ticket message:", error);
    }
    
    if (config.ClaimingSystem?.UserPerms) {
      try {
        const tButton = ticketDB.button;
        const categoryConfig = config.TicketCategories[tButton];
        
        if (categoryConfig && categoryConfig.SupportRoles) {
          await Promise.all(categoryConfig.SupportRoles.map(async (sRoles) => {
            const role = message.guild.roles.cache.get(sRoles);
            if (role) {
              await message.channel.permissionOverwrites.edit(role, {
                SendMessages: config.ClaimingSystem.UserPerms.SendMessages,
                ViewChannel: config.ClaimingSystem.UserPerms.ViewChannel
              });
            }
          }));
        }
        
        await message.channel.permissionOverwrites.edit(message.author, {
          SendMessages: true,
          ViewChannel: true,
          AttachFiles: true,
          EmbedLinks: true,
          ReadMessageHistory: true
        });
      } catch (error) {
        console.error("Error updating permissions:", error);
      }
    }

    if (config.ClaimingSystem.MoveClaimedTickets?.Enabled && 
        config.ClaimingSystem.MoveClaimedTickets?.CategoryID) {
        const claimedCategoryID = config.ClaimingSystem.MoveClaimedTickets.CategoryID;
        const claimedCategory = message.guild.channels.cache.get(claimedCategoryID);
        
        if (claimedCategory && claimedCategory.type === 4) {
            await ticketModel.updateOne(
                { channelID: message.channel.id },
                {
                    $set: {
                        originalCategoryID: message.channel.parentId,
                    },
                }
            );
            
            await message.channel.setParent(claimedCategoryID, {
                lockPermissions: false
            }).catch(error => {
                console.error(`Error moving ticket to claimed category: ${error}`);
            });
        }
    }
    
    await ticketModel.updateOne(
      { channelID: message.channel.id },
      {
        $set: {
          claimed: true,
          claimUser: message.author.id,
        },
      }
    );
    

      try {
        const logsChannel = await utils.getCategoryLogsChannel(message.channel.id);
        
        if (logsChannel) {
          const log = new EmbedBuilder()
            .setColor('#4CAF50')
            .setAuthor({ 
              name: config.Locale.ticketClaimedLog
            })
            .setThumbnail(message.author.displayAvatarURL({ format: 'png', dynamic: true, size: 1024 }))
            .setTimestamp();
            
          let mainContent = '';
          mainContent += `> **${config.Locale.logsExecutor}:** <@!${message.author.id}> \`${message.author.username}\`\n`;
          mainContent += `> **${config.Locale.logsTicket}:** <#${message.channel.id}> \`#${message.channel.name}\`\n`;
          mainContent += `> **${config.Locale.ticketCategory}:** \`${ticketDB.ticketType}\`\n`;
          mainContent += `> **${config.Locale.autoClaimedNote}:** \`Auto-claimed on first response\``;
          
          log.addFields([
            { 
              name: `\`🎫\` **${config.Locale.claimDetails}**`, 
              value: mainContent 
            }
          ]);
          
          log.setFooter({ 
            text: message.author.username, 
            iconURL: message.author.displayAvatarURL({ format: 'png', dynamic: true, size: 16 }) 
          });
          
          await logsChannel.send({ embeds: [log] });
        }
      } catch (error) {
        console.error("Error sending claim log:", error);
      }
    
    try {
      client.emit('ticketClaim', message);
    } catch (error) {
      console.error("Error tracking claim stat:", error);
    }
  } catch (error) {
    console.error("Error in auto-claim function:", error);
  }
}

};