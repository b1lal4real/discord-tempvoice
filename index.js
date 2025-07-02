const { 
  Client, 
  GatewayIntentBits, 
  ChannelType, 
  PermissionFlagsBits, 
  Events, 
  EmbedBuilder, 
  ActionRowBuilder, 
  ButtonBuilder, 
  ButtonStyle,
  TextInputBuilder,
  TextInputStyle,
  StringSelectMenuBuilder
} = require('discord.js');
const fs = require('fs');
const path = require('path');

const client = new Client({
  intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildVoiceStates,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent
  ]
});

const PREFIX = '+';
const SETTINGS_PATH = path.join(__dirname, 'settings.json');
let settings = {};

// Anti-spam tracking
const cooldowns = {
  createChannel: new Map(),
  buttons: new Map()
};

const COOLDOWNS = {
  CREATE_CHANNEL: 15000, 
  BUTTON_PRESS: 3000,    
  KICK: 5000             
};

function loadSettings() {
  try {
      if (fs.existsSync(SETTINGS_PATH)) {
          settings = JSON.parse(fs.readFileSync(SETTINGS_PATH));
      }
  } catch (error) {
      console.error('Error loading settings:', error);
  }
}

function saveSettings() {
  try {
      fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
  } catch (error) {
      console.error('Error saving settings:', error);
  }
}

async function createInterface(guild, category, interfaceChannel) {
  const embed = new EmbedBuilder()
      .setTitle('🎤 Voice Channel Manager')
      .setDescription('**Control your temporary voice channel!**\nUse the buttons below to customize your experience.')
      .setColor('#5865F2')
      .addFields(
          { name: '🔒 Lock/Unlock', value: 'Prevent others from joining your channel', inline: true },
          { name: '👥 User Limit', value: 'Set maximum participants (0 = unlimited)', inline: true },
          { name: '✏️ Rename', value: 'Customize your channel name', inline: true },
          { name: '🚫 Kick', value: 'Remove unwanted participants', inline: true },
          { name: '👑 Claim', value: 'Take ownership if creator leaves', inline: true }
      )
      .setFooter({ text: 'Temporary Voice System', iconURL: 'https://i.imgur.com/AfFp7pu.png' })
      .setTimestamp();

  const row1 = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
          .setCustomId('voice_rename')
          .setLabel('Rename')
          .setStyle(ButtonStyle.Primary)
          .setEmoji('✏️'),
      new ButtonBuilder()
          .setCustomId('voice_limit')
          .setLabel('User Limit')
          .setStyle(ButtonStyle.Primary)
          .setEmoji('👥'),
      new ButtonBuilder()
          .setCustomId('voice_lock')
          .setLabel('Lock/Unlock')
          .setStyle(ButtonStyle.Success)
          .setEmoji('🔒')
  );

  const row2 = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
          .setCustomId('voice_kick')
          .setLabel('Kick User')
          .setStyle(ButtonStyle.Danger)
          .setEmoji('🚫'),
      new ButtonBuilder()
          .setCustomId('voice_claim')
          .setLabel('Claim Ownership')
          .setStyle(ButtonStyle.Secondary)
          .setEmoji('👑')
  );

  const messages = await interfaceChannel.messages.fetch();
  await interfaceChannel.bulkDelete(messages);
  
  const sentMessage = await interfaceChannel.send({
      embeds: [embed],
      components: [row1, row2]
  });
  
  if (settings[guild.id]) {
      settings[guild.id].interfaceMessageId = sentMessage.id;
      saveSettings();
  }
  
  return sentMessage;
}

function checkEmptyChannels() {
  for (const guildId in settings) {
      const config = settings[guildId];
      const guild = client.guilds.cache.get(guildId);
      if (!guild) continue;

      const category = guild.channels.cache.get(config.categoryId);
      if (!category) continue;

      category.children.cache.forEach(channel => {
          if (
              channel.type === ChannelType.GuildVoice &&
              channel.id !== config.joinChannelId &&
              channel.members.size === 0
          ) {
              channel.delete().catch(console.error);
          }
      });
  }
}

function isOnCooldown(userId, type) {
  if (!cooldowns[type]) return false;
  
  const now = Date.now();
  const timestamps = cooldowns[type];
  const cooldownAmount = COOLDOWNS[type.toUpperCase()] || 3000;
  
  if (timestamps.has(userId)) {
      const expirationTime = timestamps.get(userId) + cooldownAmount;
      if (now < expirationTime) {
          return Math.ceil((expirationTime - now) / 1000);
      }
  }
  
  timestamps.set(userId, now);
  setTimeout(() => timestamps.delete(userId), cooldownAmount);
  return false;
}

client.once(Events.ClientReady, () => {
  console.log(`Logged in as ${client.user.tag}!`);
  loadSettings();
  setInterval(checkEmptyChannels, 1800);
});

client.on(Events.MessageCreate, async message => {
  if (!message.content.startsWith(PREFIX) || message.author.bot) return;

  const args = message.content.slice(PREFIX.length).trim().split(/ +/);
  const command = args.shift().toLowerCase();

  if (command === 'setup') {
      if (settings[message.guild.id]) {
          return message.reply('Temporary voice system is already set up!');
      }

      try {
          const category = await message.guild.channels.create({
              name: 'Temporary Voices',
              type: ChannelType.GuildCategory,
              permissionOverwrites: [
                  {
                      id: message.guild.id,
                      allow: [PermissionFlagsBits.ViewChannel],
                      deny: [PermissionFlagsBits.ManageChannels]
                  }
              ]
          });

          const joinChannel = await message.guild.channels.create({
              name: '➕ Join to Create',
              type: ChannelType.GuildVoice,
              parent: category,
              permissionOverwrites: [
                  {
                      id: message.guild.id,
                      allow: [PermissionFlagsBits.Connect, PermissionFlagsBits.ViewChannel]
                  }
              ]
          });

          const interfaceChannel = await message.guild.channels.create({
              name: '🎚️ voice-manager',
              type: ChannelType.GuildText,
              parent: category,
              permissionOverwrites: [
                  {
                      id: message.guild.id,
                      allow: [PermissionFlagsBits.ViewChannel],
                      deny: [PermissionFlagsBits.SendMessages]
                  }
              ]
          });

          settings[message.guild.id] = {
              categoryId: category.id,
              joinChannelId: joinChannel.id,
              interfaceChannelId: interfaceChannel.id
          };
          saveSettings();

          await createInterface(message.guild, category, interfaceChannel);

          message.reply('✅ Temporary voice system has been set up successfully!');
      } catch (error) {
          console.error(error);
          message.reply('❌ Failed to set up temporary voice system. Check bot permissions!');
      }
  }
  
  if (command === 'resend') {
      if (!message.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
          return message.reply('❌ You need the "Manage Channels" permission to use this command!');
      }

      const config = settings[message.guild.id];
      if (!config) {
          return message.reply('❌ Temporary voice system is not set up! Use `+setup` first.');
      }
      
      try {
          const interfaceChannel = message.guild.channels.cache.get(config.interfaceChannelId);
          if (!interfaceChannel) {
              return message.reply('❌ Interface channel not found!');
          }
          
          await createInterface(message.guild, null, interfaceChannel);
          message.reply('✅ Voice manager interface has been resent!');
      } catch (error) {
          console.error('Resend error:', error);
          message.reply('❌ Failed to resend interface. Check bot permissions!');
      }
  }
});

client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
  const config = settings[newState.guild.id];
  if (!config) return;

  if (newState.channelId === config.joinChannelId) {
      const userId = newState.member.id;
      
      const remaining = isOnCooldown(userId, 'createChannel');
      if (remaining) {
          try {
              await newState.member.send(`⏳ Please wait ${remaining} seconds before creating another voice channel!`);
              await newState.setChannel(null);
          } catch (error) {
              console.error('Failed to send cooldown message:', error);
          }
          return;
      }
      
      try {
          const channel = await newState.guild.channels.create({
              name: `${newState.member.displayName}'s Room`,
              type: ChannelType.GuildVoice,
              parent: config.categoryId,
              permissionOverwrites: [
                  {
                      id: newState.member.id,
                      allow: [
                          PermissionFlagsBits.ManageChannels,
                          PermissionFlagsBits.MoveMembers
                      ]
                  },
                  {
                      id: newState.guild.id,
                      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect]
                  }
              ]
          });

          await newState.setChannel(channel);
      } catch (error) {
          console.error('Failed to create voice channel:', error);
      }
  }
});

client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isButton()) return;

  const config = settings[interaction.guild.id];
  if (!config) return;

  const member = interaction.member;
  const voiceChannel = member.voice.channel;
  const userId = interaction.user.id;

  if (!voiceChannel ||
      voiceChannel.parentId !== config.categoryId ||
      voiceChannel.id === config.joinChannelId
  ) {
      return interaction.reply({
          content: '❌ You must be in a temporary voice channel to use this!',
          flags: ['Ephemeral']
      });
  }

  const remaining = isOnCooldown(userId, 'buttons');
  if (remaining) {
      return interaction.reply({
          content: `⏳ Please wait ${remaining} seconds before using another command!`,
          flags: ['Ephemeral']
      });
  }

  const buttonId = interaction.customId;

  try {
      switch (buttonId) {
          case 'voice_rename':
              await interaction.showModal({
                  customId: 'rename_modal',
                  title: 'Rename Channel',
                  components: [
                      new ActionRowBuilder().addComponents(
                          new TextInputBuilder()
                              .setCustomId('new_name')
                              .setLabel('New Channel Name')
                              .setStyle(TextInputStyle.Short)
                              .setMinLength(2)
                              .setMaxLength(100)
                              .setRequired(true)
                      )
                  ]
              });
              break;

          case 'voice_lock':
              const everyonePerms = voiceChannel.permissionOverwrites.cache.get(interaction.guild.id);
              const isLocked = everyonePerms && everyonePerms.deny.has(PermissionFlagsBits.Connect);
              
              await voiceChannel.permissionOverwrites.edit(
                  interaction.guild.id,
                  { Connect: isLocked ? null : false }
              );
              
              interaction.reply({
                  content: `🔒 Channel ${isLocked ? 'unlocked' : 'locked'}!`,
                  flags: ['Ephemeral']
              });
              break;

          case 'voice_limit':
              await interaction.showModal({
                  customId: 'limit_modal',
                  title: 'Set User Limit',
                  components: [
                      new ActionRowBuilder().addComponents(
                          new TextInputBuilder()
                              .setCustomId('user_limit')
                              .setLabel('Max Users (0-99)')
                              .setStyle(TextInputStyle.Short)
                              .setMinLength(1)
                              .setMaxLength(2)
                              .setRequired(true)
                              .setPlaceholder('0 for no limit')
                      )
                  ]
              });
              break;

          case 'voice_claim':
              await voiceChannel.permissionOverwrites.edit(member.id, {
                  ManageChannels: true,
                  MoveMembers: true
              });
              interaction.reply({
                  content: '👑 You now own this channel!',
                  flags: ['Ephemeral']
              });
              break;

          case 'voice_kick':
              const kickCooldown = isOnCooldown(userId, 'kick');
              if (kickCooldown) {
                  return interaction.reply({
                      content: `⏳ Please wait ${kickCooldown} seconds before kicking again!`,
                      flags: ['Ephemeral']
                  });
              }
              
              const members = voiceChannel.members.filter(m => 
                  !m.user.bot && m.id !== member.id
              );
              
              if (members.size === 0) {
                  return interaction.reply({
                      content: '❌ No members available to kick!',
                      flags: ['Ephemeral']
                  });
              }
              
              const selectMenu = new StringSelectMenuBuilder()
                  .setCustomId('kick_select')
                  .setPlaceholder('Select a member to kick')
                  .addOptions(
                      members.map(m => ({
                          label: m.displayName,
                          value: m.id
                      }))
                  );
              
              const actionRow = new ActionRowBuilder().addComponents(selectMenu);
              
              interaction.reply({
                  content: '🚫 Select a member to kick:',
                  components: [actionRow],
                  flags: ['Ephemeral']
              });
              break;
      }
  } catch (error) {
      console.error('Button interaction error:', error);
      interaction.reply({
          content: '❌ An error occurred while processing your request.',
          flags: ['Ephemeral']
      });
  }
});

client.on(Events.InteractionCreate, async interaction => {
  if (interaction.isModalSubmit()) {
      const config = settings[interaction.guild.id];
      if (!config) return;

      const member = interaction.member;
      const voiceChannel = member.voice.channel;

      if (!voiceChannel ||
          voiceChannel.parentId !== config.categoryId ||
          voiceChannel.id === config.joinChannelId
      ) {
          return interaction.reply({
              content: '❌ You must be in a temporary voice channel to use this!',
              flags: ['Ephemeral']
          });
      }

      try {
          if (interaction.customId === 'rename_modal') {
              const newName = interaction.fields.getTextInputValue('new_name');
              await voiceChannel.setName(newName);
              interaction.reply({
                  content: `✏️ Channel renamed to: ${newName}`,
                  flags: ['Ephemeral']
              });
          }
          else if (interaction.customId === 'limit_modal') {
              const limit = parseInt(interaction.fields.getTextInputValue('user_limit'));
              if (isNaN(limit) || limit < 0 || limit > 99) {
                  return interaction.reply({
                      content: '❌ Please enter a valid number between 0-99',
                      flags: ['Ephemeral']
                  });
              }
              await voiceChannel.setUserLimit(limit);
              interaction.reply({
                  content: `👥 User limit set to ${limit === 0 ? 'unlimited' : limit}`,
                  flags: ['Ephemeral']
              });
          }
      } catch (error) {
          console.error('Modal error:', error);
          interaction.reply({
              content: '❌ Failed to update channel settings',
              flags: ['Ephemeral']
          });
      }
  } else if (interaction.isStringSelectMenu()) {
      if (interaction.customId === 'kick_select') {
          const config = settings[interaction.guild.id];
          if (!config) return;

          const member = interaction.member;
          const voiceChannel = member.voice.channel;
          const targetId = interaction.values[0];
          
          if (!voiceChannel ||
              voiceChannel.parentId !== config.categoryId ||
              voiceChannel.id === config.joinChannelId
          ) {
              return interaction.reply({
                  content: '❌ You must be in a temporary voice channel to use this!',
                  flags: ['Ephemeral']
              });
          }
          
          try {
              if (!voiceChannel.permissionsFor(member).has(PermissionFlagsBits.MoveMembers)) {
                  return interaction.reply({
                      content: '❌ You do not have permission to kick members!',
                      flags: ['Ephemeral']
                  });
              }
              
              const targetMember = await interaction.guild.members.fetch(targetId);
              if (targetMember.voice?.channelId === voiceChannel.id) {
                  await targetMember.voice.setChannel(null);
                  interaction.reply({
                      content: `🚫 Kicked ${targetMember.displayName} from the channel!`,
                      flags: ['Ephemeral']
                  });
              } else {
                  interaction.reply({
                      content: '❌ That member is no longer in this voice channel!',
                      flags: ['Ephemeral']
                  });
              }
          } catch (error) {
              console.error('Kick error:', error);
              interaction.reply({
                  content: '❌ Failed to kick member. Do I have permission?',
                  flags: ['Ephemeral']
              });
          }
      }
  }
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

process.on('uncaughtExceptionMonitor', (err, origin) => {
  console.error('Uncaught Exception Monitor:', err, 'Origin:', origin);
});

process.on('multipleResolves', (type, promise, reason) => {
  console.warn('Multiple Resolves:', type, promise, reason);
});


client.login('your_discord_bot_token');