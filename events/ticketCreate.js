const { Discord, StringSelectMenuBuilder, EmbedBuilder, ActionRowBuilder, TextInputBuilder, ModalBuilder } = require("discord.js");
const fs = require('fs');
const yaml = require("js-yaml")
const config = yaml.load(fs.readFileSync('./config.yml', 'utf8'))
const guildModel = require("../models/guildModel");
const ticketModel = require("../models/ticketModel");
const moment = require('moment-timezone');

const MAX_RETRIES = 2;
const RETRY_DELAY = 3000;
const SECOND_UPDATE_DELAY = 5000;

module.exports = async (client, interaction, channel, buttonConfig) => {
    try {
        const ticket = await ticketModel.findOne({ channelID: channel.id });
        if (!ticket) {
            console.error('No ticket found for channel:', channel.id);
            return;
        }

        // Add 1 to globalStats.totalTickets
        const statsDB = await guildModel.findOne({ guildID: config.GuildID });
        statsDB.totalTickets++;
        await statsDB.save();

        // Sync globalStats.openTickets
        const openNow = await ticketModel.countDocuments({ status: 'Open', guildID: config.GuildID });
        if (statsDB.openTickets !== openNow) {
            statsDB.openTickets = openNow;
            await statsDB.save();
        }

        // Handle ticket overload warning if enabled
        if (config.TicketOverload?.Enabled && openNow >= config.TicketOverload.Threshold) {
            const overloadEmbed = new EmbedBuilder()
                .setColor("Yellow")
                .setDescription(config.TicketOverload.WarningMessage)
                .setFooter({
                    text: interaction.user.username,
                    iconURL: interaction.user.displayAvatarURL({ format: 'png', dynamic: true, size: 1024 }),
                })
                .setTimestamp();

            await channel.send({ embeds: [overloadEmbed] }).catch(console.error);
        }

        await handleWorkingHoursNotice(client, interaction, channel, config);

        if (!ticket.questions || !Array.isArray(ticket.questions) || ticket.questions.length === 0) {
            return;
        }
        
        const formatting = config.TicketQuestionFormatting || {};
        
        if (formatting.UseSeparateEmbed === true) {
            await updateTicketMessage(channel, ticket, interaction, config);
        } else {
            await updateTicketMessage(channel, ticket, interaction, config);

            setTimeout(async () => {
                await updateTicketMessage(channel, ticket, interaction, config);
            }, SECOND_UPDATE_DELAY);
        }

    } catch (error) {
    }
};

async function updateTicketMessage(channel, ticket, interaction, config) {
    try {
        if (!ticket.questions || !Array.isArray(ticket.questions) || ticket.questions.length === 0) {
            return true;
        }

        const formatting = config.TicketQuestionFormatting || {};
        
        if (formatting.UseSeparateEmbed === true) {
            return await handleSeparateEmbed(channel, ticket, interaction, config, formatting);
        } else {
            return await handleOriginalEmbedEdit(channel, ticket, interaction, config, formatting);
        }
    } catch (error) {
        console.error('Error in updateTicketMessage:', error);
        const success = await updateTicketMessageWithRetry(channel, ticket, interaction, config, 0);
        return success;
    }
}

async function handleSeparateEmbed(channel, ticket, interaction, config, formatting) {
    try {
        let questionsEmbed = new EmbedBuilder();
        
        if (formatting.SeparateEmbedTitle) {
            questionsEmbed.setTitle(formatting.SeparateEmbedTitle);
        }
        
        if (formatting.SeparateEmbedColor) {
            questionsEmbed.setColor(formatting.SeparateEmbedColor);
        } else if (config.EmbedColors) {
            questionsEmbed.setColor(config.EmbedColors);
        }
        
        questionsEmbed.setFooter({
            text: interaction.user.username,
            iconURL: interaction.user.displayAvatarURL({ format: 'png', dynamic: true, size: 1024 }),
        }).setTimestamp();

        for (const question of ticket.questions) {
            let questionText = question.question;
            
            if (formatting.QuestionPrefix) {
                questionText = `${formatting.QuestionPrefix} ${questionText}`;
            }
            
            if (formatting.QuestionStyle) {
                if (formatting.QuestionStyle.toLowerCase() === 'bold') {
                    questionText = `**${questionText}**`;
                } else if (formatting.QuestionStyle.toLowerCase() === 'italic') {
                    questionText = `*${questionText}*`;
                }
            }
            
            let answerText;
            const notAnsweredText = formatting.NotAnsweredText || "Not answered";
            
            if (question.response) {
                const style = formatting.AnswerStyle?.toLowerCase() || 'codeblock';
                
                if (style === 'codeblock') {
                    answerText = `\`\`\`\n${question.response}\n\`\`\``;
                } else if (style === 'quoteblock') {
                    answerText = question.response.split('\n')
                        .map(line => `> ${line}`)
                        .join('\n');
                } else if (style === 'bold') {
                    answerText = `**${question.response}**`;
                } else if (style === 'italic') {
                    answerText = `*${question.response}*`;
                } else {
                    answerText = question.response;
                }
            } else {
                answerText = `\`\`\`\n${notAnsweredText}\n\`\`\``;
            }
            
            questionsEmbed.addFields({
                name: questionText,
                value: answerText,
                inline: formatting.DisplaySideBySide === true
            });
        }

        await channel.send({ embeds: [questionsEmbed] });
        return true;

    } catch (error) {
        console.error('Error sending separate questions embed:', error);
        return false;
    }
}

async function handleOriginalEmbedEdit(channel, ticket, interaction, config, formatting) {
    try {
        const ticketMessage = await channel.messages.fetch(ticket.msgID);
        if (!ticketMessage) {
            console.error('Could not find original ticket message');
            return false;
        }

        const originalEmbed = ticketMessage.embeds[0];
        if (!originalEmbed) {
            console.error('No embed found in original message');
            return false;
        }

        const updatedEmbed = EmbedBuilder.from(originalEmbed);

        const hasQuestionsAlready = originalEmbed.fields?.some(field => 
            ticket.questions.some(q => 
                field.name.includes(q.question) || 
                (q.response && field.value.includes(q.response))
            )
        );

        if (hasQuestionsAlready) {
            return true;
        }

        let fieldsToKeep = [];
        if (originalEmbed.fields) {
            fieldsToKeep = originalEmbed.fields.filter(field => {
                return !ticket.questions.some(q => q.question === field.name);
            });
        }
        
        updatedEmbed.setFields(fieldsToKeep);
        
        for (const question of ticket.questions) {
            let questionText = question.question;
            
            if (formatting.QuestionPrefix) {
                questionText = `${formatting.QuestionPrefix} ${questionText}`;
            }
            
            if (formatting.QuestionStyle) {
                if (formatting.QuestionStyle.toLowerCase() === 'bold') {
                    questionText = `**${questionText}**`;
                } else if (formatting.QuestionStyle.toLowerCase() === 'italic') {
                    questionText = `*${questionText}*`;
                }
            }
            
            let answerText;
            const notAnsweredText = formatting.NotAnsweredText || "Not answered";
            
            if (question.response) {
                const style = formatting.AnswerStyle?.toLowerCase() || 'codeblock';
                
                if (style === 'codeblock') {
                    answerText = `\`\`\`\n${question.response}\n\`\`\``;
                } else if (style === 'quoteblock') {
                    answerText = question.response.split('\n')
                        .map(line => `> ${line}`)
                        .join('\n');
                } else if (style === 'bold') {
                    answerText = `**${question.response}**`;
                } else if (style === 'italic') {
                    answerText = `*${question.response}*`;
                } else {
                    answerText = question.response;
                }
            } else {
                answerText = `\`\`\`\n${notAnsweredText}\n\`\`\``;
            }
            
            updatedEmbed.addFields({
                name: questionText,
                value: answerText,
                inline: formatting.DisplaySideBySide === true
            });
        }

        await ticketMessage.edit({ embeds: [updatedEmbed] }).catch(() => {});
        return true;
    } catch (error) {
        console.error('Error editing original embed:', error);
        return false;
    }
}

async function updateTicketMessageWithRetry(channel, ticket, interaction, config, retryCount = 0) {
    try {
        if (!ticket.questions || !Array.isArray(ticket.questions) || ticket.questions.length === 0) {
            return true;
        }

        const ticketMessage = await channel.messages.fetch(ticket.msgID);
        if (!ticketMessage) {
            console.error('Could not find original ticket message');
            return false;
        }

        const originalEmbed = ticketMessage.embeds[0];
        if (!originalEmbed) {
            console.error('No embed found in original message');
            return false;
        }

        const hasQuestionsAlready = originalEmbed.fields?.some(field => 
            ticket.questions.some(q => 
                field.name.includes(q.question) || 
                (q.response && field.value.includes(q.response))
            )
        );

        if (hasQuestionsAlready) {
            return true;
        }

        const updatedEmbed = EmbedBuilder.from(originalEmbed);

        let fieldsToKeep = [];
        if (originalEmbed.fields) {
            fieldsToKeep = originalEmbed.fields.filter(field => {
                return !ticket.questions.some(q => q.question === field.name);
            });
        }
        
        updatedEmbed.setFields(fieldsToKeep);

        const formatting = config.TicketQuestionFormatting || {};
        
        for (const question of ticket.questions) {
            
            let questionText = question.question;
            
            if (formatting.QuestionPrefix) {
                questionText = `${formatting.QuestionPrefix} ${questionText}`;
            }
            
            if (formatting.QuestionStyle) {
                if (formatting.QuestionStyle.toLowerCase() === 'bold') {
                    questionText = `**${questionText}**`;
                } else if (formatting.QuestionStyle.toLowerCase() === 'italic') {
                    questionText = `*${questionText}*`;
                }
            }
            
            let answerText;
            const notAnsweredText = formatting.NotAnsweredText || "Not answered";
            
            if (question.response) {
                const style = formatting.AnswerStyle?.toLowerCase() || 'codeblock';
                
                if (style === 'codeblock') {
                    answerText = `\`\`\`\n${question.response}\n\`\`\``;
                } else if (style === 'quoteblock') {
                    answerText = question.response.split('\n')
                        .map(line => `> ${line}`)
                        .join('\n');
                } else if (style === 'bold') {
                    answerText = `**${question.response}**`;
                } else if (style === 'italic') {
                    answerText = `*${question.response}*`;
                } else {
                    answerText = question.response;
                }
            } else {
                answerText = `\`\`\`\n${notAnsweredText}\n\`\`\``;
            }
            
            updatedEmbed.addFields({
                name: questionText,
                value: answerText,
                inline: formatting.DisplaySideBySide === true
            });
        }

        await ticketMessage.edit({ embeds: [updatedEmbed] }).catch(() => {});
        return true;
    } catch (error) {
        console.error(`Error updating ticket message (attempt ${retryCount + 1}/${MAX_RETRIES}):`, error);
        
        if (retryCount < MAX_RETRIES - 1) {
            await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
            return updateTicketMessageWithRetry(channel, ticket, interaction, config, retryCount + 1);
        } else {
            console.error('Failed to update ticket message after all retry attempts');
            return false;
        }
    }
}

// Working hours notice function for allowed tickets
async function handleWorkingHoursNotice(client, interaction, channel, config) {
  if (!config.WorkingHours?.Enabled || !config.WorkingHours.AllowTicketsOutsideWorkingHours || !config.WorkingHours.SendNoticeInTicket) {
      return;
  }

  let userIsExempt = false;
  
  if (config.WorkingHours.ExemptRoles && Array.isArray(config.WorkingHours.ExemptRoles) && config.WorkingHours.ExemptRoles.length > 0) {
    const userRoles = interaction.member.roles.cache.map(role => role.id);
    userIsExempt = config.WorkingHours.ExemptRoles.some(exemptRoleId => userRoles.includes(exemptRoleId));
  }
  
  if (userIsExempt) {
    return;
  }

  const workingHoursRegex = /^(\d{1,2}:\d{2})-(\d{1,2}:\d{2})$/;
        
  const currentDay = moment().tz(config.WorkingHours.Timezone).format('dddd');
  const workingHours = config.WorkingHours.Schedule[currentDay];
  
  const isDayDisabled = workingHours && 
      (workingHours.toLowerCase() === "disabled" || 
       workingHours.toLowerCase() === "off" ||
       workingHours.toLowerCase() === "closed");
  
  let withinWorkingHours = false;
  
  if (isDayDisabled) {
      withinWorkingHours = false;
  } else if (!workingHours) {
      console.log('\x1b[31m%s\x1b[0m', `[ERROR] Working hours not configured for ${currentDay}. Contact support and provide your config.yml file.`);
      return;
  } else {
      const workingHoursMatch = workingHours.match(workingHoursRegex);
      
      if (!workingHoursMatch) {
          console.log('\x1b[31m%s\x1b[0m', `[ERROR] Invalid working hours configuration for ${currentDay} (format). Contact support and provide your config.yml file.`);
          return;
      }

      const currentTime = moment().tz(config.WorkingHours.Timezone);
      const startDate = currentTime.format('YYYY-MM-DD');
      
      const startTime = moment.tz(startDate + ' ' + workingHoursMatch[1], 'YYYY-MM-DD H:mm', config.WorkingHours.Timezone);
      const endTime = moment.tz(startDate + ' ' + workingHoursMatch[2], 'YYYY-MM-DD H:mm', config.WorkingHours.Timezone);
      
      if (!startTime.isValid() || !endTime.isValid() || startTime.isSameOrAfter(endTime)) {
          console.log('\x1b[31m%s\x1b[0m', `[ERROR] Invalid working hours configuration for ${currentDay}. Contact support and provide your config.yml file.`);
          return;
      }
      
      withinWorkingHours = currentTime.isBetween(startTime, endTime);
  }

  if (!withinWorkingHours) {
      let workingHoursEmbedLocale = config.WorkingHours.outsideWorkingHoursMsg;
      
      if (isDayDisabled) {
          workingHoursEmbedLocale = workingHoursEmbedLocale
              .replace(/{startTime-currentDay} to {endTime-currentDay}/g, "Closed today")
              .replace(/{startTime-currentDay}/g, "Closed")
              .replace(/{endTime-currentDay}/g, "Closed");
      } else {
          const workingHoursMatch = workingHours.match(workingHoursRegex);
          const startDate = moment().tz(config.WorkingHours.Timezone).format('YYYY-MM-DD');
          const startTime = moment.tz(startDate + ' ' + workingHoursMatch[1], 'YYYY-MM-DD H:mm', config.WorkingHours.Timezone);
          const endTime = moment.tz(startDate + ' ' + workingHoursMatch[2], 'YYYY-MM-DD H:mm', config.WorkingHours.Timezone);
          
          workingHoursEmbedLocale = workingHoursEmbedLocale
              .replace(/{startTime-currentDay}/g, `<t:${startTime.unix()}:t>`)
              .replace(/{endTime-currentDay}/g, `<t:${endTime.unix()}:t>`);
      }

      for (const day in config.WorkingHours.Schedule) {
          const hours = config.WorkingHours.Schedule[day];
          
          if (hours && (hours.toLowerCase() === "disabled" || 
                        hours.toLowerCase() === "off" || 
                        hours.toLowerCase() === "closed")) {
              workingHoursEmbedLocale = workingHoursEmbedLocale
                  .replace(new RegExp(`{startTime-${day}} to {endTime-${day}}`, 'g'), "Closed")
                  .replace(new RegExp(`{startTime-${day}}`, 'g'), "Closed")
                  .replace(new RegExp(`{endTime-${day}}`, 'g'), "Closed");
          } else if (hours) {
              const match = hours.match(workingHoursRegex);
              if (match) {
                  const startDate = moment().tz(config.WorkingHours.Timezone).format('YYYY-MM-DD');
                  const start = moment.tz(startDate + ' ' + match[1], 'YYYY-MM-DD H:mm', config.WorkingHours.Timezone);
                  const end = moment.tz(startDate + ' ' + match[2], 'YYYY-MM-DD H:mm', config.WorkingHours.Timezone);
                  
                  workingHoursEmbedLocale = workingHoursEmbedLocale
                      .replace(new RegExp(`{startTime-${day}}`, 'g'), `<t:${start.unix()}:t>`)
                      .replace(new RegExp(`{endTime-${day}}`, 'g'), `<t:${end.unix()}:t>`);
              }
          }
      }

      let workingHoursEmbed = new EmbedBuilder()
          .setTitle(config.WorkingHours.outsideWorkingHoursTitle)
          .setColor("Red")
          .setDescription(workingHoursEmbedLocale)
          .setFooter({
              text: `${interaction.user.username}`,
              iconURL: `${interaction.user.displayAvatarURL({ format: 'png', dynamic: true, size: 1024 })}`
          })
          .setTimestamp();
      
      if (channel) channel.send({ embeds: [workingHoursEmbed] });
  }
}