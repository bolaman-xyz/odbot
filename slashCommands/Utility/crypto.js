const { SlashCommandBuilder } = require('@discordjs/builders');
const { Discord, ActionRowBuilder, EmbedBuilder, ButtonBuilder, MessageFlags } = require("discord.js");
const fs = require('fs');
const yaml = require("js-yaml")
const config = yaml.load(fs.readFileSync('./config.yml', 'utf8'))
const commands = yaml.load(fs.readFileSync('./commands.yml', 'utf8'))
const ticketModel = require("../../models/ticketModel");

module.exports = {
    enabled: commands.Utility.Crypto.Enabled,
    data: new SlashCommandBuilder()
        .setName('crypto')
        .setDescription(commands.Utility.Crypto.Description)
        .addUserOption((option) => option.setName('user').setDescription('User').setRequired(true))
        .addStringOption((option) => option.setName('currency').setDescription('Crypto Currency to pay in').addChoices(
            { name: 'BTC', value: 'BTC' }, 
            { name: 'ETH', value: 'ETH' }, 
            { name: 'USDT', value: 'USDT' },
            { name: 'LTC', value: 'LTC' },
        ).setRequired(true))
                .addNumberOption((option) => option.setName('price').setDescription(`Price in ${config.CryptoSettings.Currency}`).setRequired(true))
                .addStringOption(option => option.setName('service').setDescription('Service').setRequired(true))
                .addStringOption((option) => option.setName('address').setDescription('Wallet Address')),
    async execute(interaction, client) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const ticketDB = await ticketModel.findOne({ channelID: interaction.channel.id });

        if(config.CryptoSettings.Enabled === false) return interaction.editReply({ content: "This command has been disabled in the config!", flags: MessageFlags.Ephemeral })
        if (config.CryptoSettings.OnlyInTicketChannels && !ticketDB) return interaction.editReply({ content: config.Locale.NotInTicketChannel, flags: MessageFlags.Ephemeral })
    
        let doesUserHaveRole = false
        for(let i = 0; i < config.CryptoSettings.AllowedRoles.length; i++) {
            role = interaction.guild.roles.cache.get(config.CryptoSettings.AllowedRoles[i]);
            if(role && interaction.member.roles.cache.has(config.CryptoSettings.AllowedRoles[i])) doesUserHaveRole = true;
          }
        if(doesUserHaveRole === false) return interaction.editReply({ content: config.Locale.NoPermsMessage, flags: MessageFlags.Ephemeral })


        let user = interaction.options.getUser("user");
        let currency = interaction.options.getString("currency")
        let price = interaction.options.getNumber("price");
        let service = interaction.options.getString("service");
        let address = interaction.options.getString("address");
    
        let address2 = address || "";

        if (!address && currency === "BTC") address2 = config.CryptoAddresses.BTC || "";
        if (!address && currency === "ETH") address2 = config.CryptoAddresses.ETH || "";
        if (!address && currency === "USDT") address2 = config.CryptoAddresses.USDT || "";
        if (!address && currency === "LTC") address2 = config.CryptoAddresses.LTC || "";
    
        if (!address2) return interaction.editReply({ content: `No ${currency} address specified in the command or config!`, flags: MessageFlags.Ephemeral });

const fromCurrency = currency;
        const toCurrency = config.CryptoSettings.Currency;
        const amount = price;
        const convertedAmount = await client.getCryptoPrice(fromCurrency, toCurrency, amount);

        if (!convertedAmount) {
            return interaction.editReply({ 
                content: "Error fetching crypto conversion rates. Please try again later.", 
                flags: MessageFlags.Ephemeral 
            });
        }

        if(currency === "BTC") cryptoFullName = "bitcoin"
        if(currency === "ETH") cryptoFullName = "ethereum"
        if(currency === "USDT") cryptoFullName = "tether"
        if(currency === "LTC") cryptoFullName = "litecoin"

        const row = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setStyle('Link')
                .setURL(`https://quickchart.io/qr?text=${cryptoFullName.toLowerCase()}%3A${address2}%3Famount=${price}`) 
                .setLabel(config.Locale.cryptoQRCode))
  

        const embedSettings = config.CryptoSettings.Embed;
        const embed = new EmbedBuilder()
            if(embedSettings.Title) embed.setTitle(embedSettings.Title.replace('{seller.username}', interaction.user.username).replace('{user.username}', user.username).replace('{currency}', `${currency.toUpperCase()}`))
            if(embedSettings.Color) embed.setColor(embedSettings.Color);
            if(!embedSettings.Color) embed.setColor(config.EmbedColors);
            if(embedSettings.Description) embed.setDescription(embedSettings.Description)
      
    if(embedSettings.ThumbnailEnabled) {
        if (embedSettings.CustomThumbnail && embedSettings.CustomThumbnail !== '') {
            embed.setThumbnail(embedSettings.CustomThumbnail);
        } else {
            embed.setThumbnail(user.displayAvatarURL({ format: 'png', dynamic: true }));
        }
      }
        
        embed.addFields(embedSettings.Fields.map(field => ({
            name: field.name,
            value: field.value
                .replace('{seller}', `<@!${interaction.user.id}>`)
                .replace('{seller.username}', interaction.user.username)
                .replace('{user}', `<@!${user.id}>`)
                .replace('{user.username}', user.username)
                .replace('{service}', service)
                .replace('{price}', `${convertedAmount} (${price} ${config.CryptoSettings.Currency})`)
                .replace('{address}', `${address2}`)
                .replace('{currency}', `${currency.toUpperCase()}`)
        })));
        
        if (embedSettings.Timestamp) {
            embed.setTimestamp();
        }
        
        const footerText = embedSettings.Footer.text
            .replace('{user.username}', user.username)
        
        if (footerText.trim() !== '') {
            if (embedSettings.Footer.Enabled && embedSettings.Footer.CustomIconURL == '' && embedSettings.Footer.IconEnabled) {
                embed.setFooter({
                    text: footerText,
                    iconURL: user.displayAvatarURL({ format: 'png', dynamic: true }),
                });
            } else {
                embed.setFooter({
                    text: footerText,
                });
            }
        }
        
        if (footerText.trim() !== '' && embedSettings.Footer.CustomIconURL !== '' && embedSettings.Footer.IconEnabled) {
            embed.setFooter({
                text: footerText,
                iconURL: embedSettings.Footer.CustomIconURL,
            });
        }

        interaction.editReply({ embeds: [embed], components: [row] })
    
        let logsChannel = interaction.guild.channels.cache.get(config.CryptoSettings.LogsChannelID);

        const log = new EmbedBuilder()
        .setColor('#FFA726')
        .setAuthor({ 
            name: config.Locale.cryptoLogTitle, 
        })
        .setThumbnail(interaction.user.displayAvatarURL({ format: 'png', dynamic: true, size: 1024 }))
        .setTimestamp();
        
        let mainContent = '';
        mainContent += `> **${config.Locale.logsExecutor}:** <@!${interaction.user.id}> \`${interaction.user.username}\`\n`;
        mainContent += `> **${config.Locale.PayPalUser}** <@!${user.id}> \`${user.username}\`\n`;
        mainContent += `> **${config.Locale.PayPalPrice}** \`${config.CryptoSettings.CurrencySymbol}${price}\` • \`${convertedAmount} ${currency}\`\n`;
        mainContent += `> **${config.Locale.PayPalService}** \`${service}\``;
        
        log.addFields([
          { 
            name: `\`💰\` **Crypto Payment Details**`, 
            value: mainContent 
          }
        ]);
        
        log.setFooter({ 
          text: interaction.user.username, 
          iconURL: interaction.user.displayAvatarURL({ format: 'png', dynamic: true, size: 16 }) 
        });
        if (logsChannel) logsChannel.send({ embeds: [log] })
    

    }

}