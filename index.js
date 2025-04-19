const express = require('express');
const app = express();

app.get('/', (req, res) => {
  res.send('Bot is alive!');
});

app.listen(3000, () => {
  console.log('Web server running on port 3000');
});

require('dotenv').config();
const { Client, IntentsBitField, EmbedBuilder, PermissionsBitField } = require('discord.js');
const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v9');
const fs = require('fs');

const config = require('./config.json');

const client = new Client({
  intents: [
    IntentsBitField.Flags.Guilds,
    IntentsBitField.Flags.GuildMessages,
    IntentsBitField.Flags.GuildMessageReactions,
    IntentsBitField.Flags.DirectMessages,
    IntentsBitField.Flags.GuildMembers
  ]
});

if (!config.allowedRoles) config.allowedRoles = [];
if (!config.prizes) config.prizes = [];
if (!config.embedColor) config.embedColor = "#FFD700";
config.logChannelId = process.env.LOG_CHANNEL || config.logChannelId;

const activeGiveaways = new Map();

const commands = [
  {
    name: 'hostgiveaway',
    description: 'Start instant-win giveaway',
    options: [
      {
        name: 'title',
        description: 'Title for the giveaway',
        type: 3,
        required: true
      },
      {
        name: 'duration',
        description: 'Duration in minutes',
        type: 4,
        required: true,
        minValue: 1
      }
    ]
  },
  {
    name: 'setprize',
    description: 'Add a prize',
    options: [
      {
        name: 'prize',
        description: 'Prize to add',
        type: 3,
        required: true
      },
      {
        name: 'quantity',
        description: 'Number of copies to add (default 1)',
        type: 4,
        required: false,
        minValue: 1,
        maxValue: 100
      }
    ]
  },
  {
    name: 'viewprizes',
    description: 'List all prizes'
  },
  {
    name: 'removeprize',
    description: 'Remove a specific prize',
    options: [
      {
        name: 'index',
        description: 'Prize number to remove (use /viewprizes to see numbers)',
        type: 4,
        required: true
      }
    ]
  },
  {
    name: 'clearprizes',
    description: 'Reset all prizes'
  },
  {
    name: 'addrole',
    description: 'Add manager role',
    options: [
      {
        name: 'role',
        description: 'Role to add',
        type: 8,
        required: true
      }
    ]
  },
  {
    name: 'removerole',
    description: 'Remove manager role',
    options: [
      {
        name: 'role',
        description: 'Role to remove',
        type: 8,
        required: true
      }
    ]
  },
  {
    name: 'viewroles',
    description: 'List manager roles'
  },
  {
    name: 'addlogchannel',
    description: 'Set the channel for logging bot actions',
    options: [
      {
        name: 'channel',
        description: 'Channel to log activities',
        type: 7,
        required: true
      }
    ]
  },
  {
    name: 'end',
    description: 'End a giveaway early',
    options: [
      {
        name: 'messageid',
        description: 'Message ID of the giveaway to end',
        type: 3,
        required: true
      }
    ]
  }
];

const rest = new REST({ version: '9' }).setToken(process.env.DISCORD_TOKEN);

function logAction(message) {
  if (!config.logChannelId) return;
  const channel = client.channels.cache.get(config.logChannelId);
  if (channel) {
    channel.send(message).catch(console.error);
  }
}

// Register commands when bot joins a new guild
client.on('guildCreate', async (guild) => {
  try {
    console.log(`🔧 Registering commands for new guild: ${guild.name} (${guild.id})`);
    await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID, guild.id),
      { body: commands }
    );
    console.log(`✅ Commands registered for ${guild.name}!`);
    logAction(`Joined new guild: ${guild.name} (${guild.id}) - Commands registered`);
  } catch (error) {
    console.error(`❌ Failed to register commands for ${guild.name}:`, error);
  }
});

// Remove commands when bot leaves a guild
client.on('guildDelete', async (guild) => {
  try {
    console.log(`🧹 Removing commands from guild: ${guild.name} (${guild.id})`);
    await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID, guild.id),
      { body: [] }
    );
    console.log(`✅ Commands removed from ${guild.name}!`);
  } catch (error) {
    console.error(`❌ Failed to remove commands from ${guild.name}:`, error);
  }
});

client.on('ready', async () => {
  console.log(`🚀 ${client.user.tag} is online!`);
  fs.writeFileSync('./config.json', JSON.stringify(config, null, 2));
  
  // Register commands for all existing guilds
  for (const [guildId, guild] of client.guilds.cache) {
    try {
      console.log(`🔧 Registering commands for ${guild.name} (${guildId})`);
      await rest.put(
        Routes.applicationGuildCommands(process.env.CLIENT_ID, guildId),
        { body: commands }
      );
      console.log(`✅ Commands registered for ${guild.name}!`);
    } catch (error) {
      console.error(`❌ Failed to register commands for ${guild.name}:`, error);
    }
  }
});

client.on('messageReactionAdd', async (reaction, user) => {
  if (user.bot) return;
  if (reaction.emoji.name !== '🎉') return;

  const messageId = reaction.message.id;
  if (activeGiveaways.has(messageId)) return;

  try {
    const message = await reaction.message.fetch();
    const embed = message.embeds[0];
    
    if (embed?.title) {
      const dm = await user.createDM();
      await dm.send('🎰 Giveaway has ended!\nStay tuned for more opportunities!');
    }
  } catch (error) {
    console.error('Error handling old giveaway reaction:', error);
  }
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isCommand()) return;

  const { commandName, options, member, guild } = interaction;
  const hasPermission = member.permissions.has(PermissionsBitField.Flags.Administrator) || 
                        config.allowedRoles.some(roleId => member.roles.cache.has(roleId));

  if (!hasPermission) {
    return interaction.reply({ content: '❌ No permission!' })
      .then(msg => setTimeout(() => msg.delete(), 3000))
      .catch(console.error);
  }

  switch (commandName) {
    case 'hostgiveaway':
      if (config.prizes.length === 0) {
        return interaction.reply({ 
          content: '❌ No prizes available! Add prizes using /setprize first!',
          ephemeral: true
        });
      }

      const title = options.getString('title');
      const duration = options.getInteger('duration');
      const channel = interaction.channel;

      const endTime = Date.now() + duration * 60000;
      const endTimestamp = Math.floor(endTime / 1000);

      try {
        const initialPrizeCount = config.prizes.length;
        const embed = new EmbedBuilder()
          .setColor(config.embedColor)
          .setTitle(title)
          .setDescription(
            `Giveaway ends <t:${endTimestamp}:R>\n\n` +
            `**Prizes remaining: ${initialPrizeCount}**\n` +
            `React with 🎉 to participate!`
          );

        const message = await channel.send({ embeds: [embed] });
        await message.react('🎉');

        const giveawayData = {
          claimedUsers: new Set(),
          endTime,
          title,
          channelId: channel.id,
          collector: null
        };

        const collector = message.createReactionCollector({
          filter: (reaction, user) => !user.bot && reaction.emoji.name === '🎉',
          time: duration * 60000
        });

        giveawayData.collector = collector;
        activeGiveaways.set(message.id, giveawayData);

        logAction(`📢 Giveaway Started: ${title} | Duration: ${duration} mins | Initial Prizes: ${initialPrizeCount}`);

        collector.on('collect', async (reaction, user) => {
          const giveaway = activeGiveaways.get(message.id);
          if (!giveaway) return;

          try {
            if (giveaway.claimedUsers.has(user.id)) {
              const dm = await user.createDM();
              await dm.send('⚠️ You already claimed a prize from this giveaway!');
              return;
            }

            if (config.prizes.length === 0) {
              const dm = await user.createDM();
              await dm.send('🎰 All prizes have been claimed!\nStay tuned for more opportunities!');
              const updatedEmbed = new EmbedBuilder()
                .setColor(config.embedColor)
                .setTitle(giveaway.title)
                .setDescription('🎰 All prizes have been claimed!\nGiveaway closed!');
              
              await message.edit({ embeds: [updatedEmbed] });
              collector.stop();
              return;
            }

            const randomIndex = Math.floor(Math.random() * config.prizes.length);
            const prize = config.prizes.splice(randomIndex, 1)[0];
            fs.writeFileSync('./config.json', JSON.stringify(config, null, 2));
            giveaway.claimedUsers.add(user.id);
            activeGiveaways.set(message.id, giveaway);

            const dm = await user.createDM();
            await dm.send(
              `🎉 CONGRATULATIONS!\n\n` +
              `You just won: **${prize}**\n\n` +
              `Open a https://discord.com/channels/953638945101578291/1076098403706093639 to claim your prize!`
            );
            
            logAction(`🎉 Prize Claimed: ${user.tag} won ${prize} | Remaining: ${config.prizes.length}`);
            const updatedEmbed = new EmbedBuilder()
              .setColor(config.embedColor)
              .setTitle(giveaway.title)
              .setDescription(
                `Giveaway ends <t:${Math.floor(giveaway.endTime / 1000)}:R>\n\n` +
                `**Prizes remaining: ${config.prizes.length}**\n` +
                `React with 🎉 to participate!`
              );

            await message.edit({ embeds: [updatedEmbed] });

          } catch (error) {
            console.error('Reaction error:', error);
            logAction(`❌ Failed to send dm to ${user.id}`);
          }
        });

        collector.on('end', async (collected, reason) => {
          activeGiveaways.delete(message.id);
          const description = reason === 'manual' 
            ? '🎉 Giveaway was ended manually!' 
            : '🎉 Giveaway has ended!';
          
          const endedEmbed = new EmbedBuilder()
            .setTitle(giveawayData.title)
            .setColor('#808080')
            .setDescription(description);
          
          await message.edit({ embeds: [endedEmbed] }).catch(console.error);
          logAction(`🔚 Giveaway "${giveawayData.title}" ended${reason === 'manual' ? ' manually' : ''}`);
        });

        await interaction.reply({ content: `Giveaway started in ${channel}!` })
          .then(msg => setTimeout(() => msg.delete(), 3000))
          .catch(console.error);

      } catch (error) {
        console.error('Giveaway error:', error);
        interaction.reply({ content: '❌ Failed to start giveaway!' })
          .then(msg => setTimeout(() => msg.delete(), 3000))
          .catch(console.error);
      }
      break;

    case 'setprize':
      const prizeText = options.getString('prize');
      const quantity = options.getInteger('quantity') || 1;
      
      for (let i = 0; i < quantity; i++) {
        config.prizes.push(prizeText);
      }
      fs.writeFileSync('./config.json', JSON.stringify(config, null, 2));
      
      logAction(`🎁 Added ${quantity}x ${prizeText}`);
      interaction.reply({ content: `Added ${quantity} of ${prizeText} prize(s)!` })
        .then(msg => setTimeout(() => msg.delete(), 3000))
        .catch(console.error);
      break;

    case 'viewprizes':
      if (config.prizes.length === 0) {
        return interaction.reply({ content: 'No prizes configured!' })
          .then(msg => setTimeout(() => msg.delete(), 3000))
          .catch(console.error);
      }
      interaction.reply({
        content: `**Current Prizes:**\n${config.prizes.map((p, i) => `${i+1}. ${p}`).join('\n')}`,
        ephemeral: true
      });
      break;

    case 'removeprize':
      const index = options.getInteger('index') - 1;
      if (index < 0 || index >= config.prizes.length) {
        return interaction.reply({ content: 'Invalid prize number!' })
          .then(msg => setTimeout(() => msg.delete(), 3000))
          .catch(console.error);
      }
      const removedPrize = config.prizes.splice(index, 1)[0];
      fs.writeFileSync('./config.json', JSON.stringify(config, null, 2));
      
      logAction(`🗑 Removed prize: ${removedPrize}`);
      interaction.reply({ content: `Removed prize: ${removedPrize}` })
        .then(msg => setTimeout(() => msg.delete(), 3000))
        .catch(console.error);
      break;

    case 'clearprizes':
      config.prizes = [];
      fs.writeFileSync('./config.json', JSON.stringify(config, null, 2));
      
      logAction('🧹 Cleared all prizes');
      interaction.reply({ content: 'All prizes cleared!' })
        .then(msg => setTimeout(() => msg.delete(), 3000))
        .catch(console.error);
      break;

    case 'addrole':
      const roleToAdd = options.getRole('role');
      if (!config.allowedRoles.includes(roleToAdd.id)) {
        config.allowedRoles.push(roleToAdd.id);
        fs.writeFileSync('./config.json', JSON.stringify(config, null, 2));
      }
      logAction(`🛡 Added manager role: ${roleToAdd.name}`);
      interaction.reply({ content: `Added ${roleToAdd.toString()} as manager!` })
        .then(msg => setTimeout(() => msg.delete(), 3000))
        .catch(console.error);
      break;

    case 'removerole':
      const roleToRemove = options.getRole('role');
      config.allowedRoles = config.allowedRoles.filter(id => id !== roleToRemove.id);
      fs.writeFileSync('./config.json', JSON.stringify(config, null, 2));
      
      logAction(`➖ Removed manager role: ${roleToRemove.name}`);
      interaction.reply({ content: `Removed ${roleToRemove.toString()} from managers!` })
        .then(msg => setTimeout(() => msg.delete(), 3000))
        .catch(console.error);
      break;

    case 'viewroles':
      const roles = config.allowedRoles.map(id => guild.roles.cache.get(id)?.toString() || `Unknown (${id})`);
      interaction.reply({
        content: `**Manager Roles:**\n${roles.join('\n') || 'None'}`,
        ephemeral: true
      });
      break;

    case 'addlogchannel':
      const logChannel = options.getChannel('channel');
      config.logChannelId = logChannel.id;
      fs.writeFileSync('./config.json', JSON.stringify(config, null, 2));
      
      logAction(`📜 Log channel set to ${logChannel.toString()}`);
      interaction.reply({ content: `Log channel set to ${logChannel.toString()}!` })
        .then(msg => setTimeout(() => msg.delete(), 3000))
        .catch(console.error);
      break;

    case 'end':
      const messageId = options.getString('messageid');
      const giveaway = activeGiveaways.get(messageId);

      if (!giveaway) {
        return interaction.reply({ 
          content: '❌ No active giveaway found with that message ID!',
          ephemeral: true
        });
      }

      giveaway.collector.stop('manual');
      logAction(`🛑 Giveaway "${giveaway.title}" (ID: ${messageId}) ended manually by ${interaction.user.tag}`);
      
      interaction.reply({ 
        content: '✅ Giveaway ended successfully!',
        ephemeral: true
      });
      break;
  }
});

client.login(process.env.DISCORD_TOKEN)
  .then(() => console.log('🔑 Logging in...'))
  .catch(error => console.error('💥 Login failed:', error));