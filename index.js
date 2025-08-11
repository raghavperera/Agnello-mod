import 'dotenv/config';
import { Client, GatewayIntentBits } from 'discord.js';
import { joinVoiceChannel } from '@discordjs/voice';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawn } from 'child_process';
import prism from 'prism-media';

// --- Voice moderation code starts here ---

const WHISPER_CLI = process.env.WHISPER_CLI || '/opt/whisper.cpp/build/bin/whisper-cli';
const MUTED_ROLE_ID = '1404284095164448810'; // your muted role id
const TRANSCRIPT_TMP_DIR = path.join(os.tmpdir(), 'vc-moderation');
const BANNED_WORDS = ['examplebadword', 'swear1', 'swear2']; // replace with your banned words

if (!fs.existsSync(TRANSCRIPT_TMP_DIR)) fs.mkdirSync(TRANSCRIPT_TMP_DIR, { recursive: true });

function containsBannedWord(transcript) {
  const t = transcript.toLowerCase();
  for (const w of BANNED_WORDS) {
    const re = new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}\\b`, 'i');
    if (re.test(t)) return w;
  }
  return null;
}

async function recordSingleUser(voiceConnection, userId, guild, onTranscript) {
  try {
    const receiver = voiceConnection.receiver;

    const opusStream = receiver.subscribe(userId, {
      end: { behavior: prism.EndBehaviorType.AfterSilence, duration: 1200 }
    });

    const opusDecoder = new prism.opus.Decoder({ frameSize: 960, channels: 2, rate: 48000 });

    const tmpFile = path.join(TRANSCRIPT_TMP_DIR, `vc_${Date.now()}_${userId}.wav`);

    const ffmpeg = spawn('ffmpeg', [
      '-f', 's16le',
      '-ar', '48000',
      '-ac', '2',
      '-i', 'pipe:0',
      '-ar', '16000',
      '-ac', '1',
      '-y',
      tmpFile
    ], { stdio: ['pipe', 'ignore', 'inherit'] });

    opusStream.pipe(opusDecoder).pipe(ffmpeg.stdin);

    await new Promise((resolve, reject) => {
      ffmpeg.on('close', code => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited with code ${code}`))));
      ffmpeg.on('error', reject);
    });

    // Run whisper CLI
    const whisper = spawn(WHISPER_CLI, ['-f', tmpFile]);

    let out = '';
    whisper.stdout.on('data', d => { out += d.toString(); });
    whisper.stderr.on('data', () => {}); // ignore progress output

    await new Promise((resolve, reject) => {
      whisper.on('close', code => (code === 0 ? resolve() : reject(new Error(`whisper exited with code ${code}`))));
      whisper.on('error', reject);
    });

    const transcript = out.trim();
    await onTranscript(transcript, userId, tmpFile);

  } catch (err) {
    console.error('recordSingleUser error:', err);
  }
}

function startListeningOnConnection(voiceConnection, guild) {
  const receiver = voiceConnection.receiver;

  receiver.speaking.on('start', userId => {
    if (userId === voiceConnection.joinConfig?.selfDeaf) return;

    recordSingleUser(voiceConnection, userId, guild, async (transcript, userId) => {
      if (!transcript) return;

      console.log(`Transcribed for ${userId}:`, transcript);

      const matched = containsBannedWord(transcript);
      if (!matched) return;

      try {
        const member = await guild.members.fetch(userId);
        if (!member) return;

        const botMember = guild.members.me;
        const mutedRole = guild.roles.cache.get(MUTED_ROLE_ID);
        if (!mutedRole) {
          console.warn('Muted role not found');
          return;
        }
        if (botMember.roles.highest.position <= mutedRole.position) {
          console.warn('Bot role too low to assign muted role');
          return;
        }

        if (!member.roles.cache.has(MUTED_ROLE_ID)) {
          await member.roles.add(MUTED_ROLE_ID, `Auto-muted for saying banned word: ${matched}`);
        }

        try {
          await member.send(`You have been muted for saying "${matched}" in voice chat. You will be unmuted in 10 minutes.`).catch(() => {});
        } catch {}

        setTimeout(async () => {
          try {
            const refreshed = await guild.members.fetch(userId);
            if (refreshed && refreshed.roles.cache.has(MUTED_ROLE_ID)) {
              await refreshed.roles.remove(MUTED_ROLE_ID, 'Auto-unmute after timeout');
            }
          } catch (e) {
            console.error('Error unmuting:', e);
          }
        }, 10 * 60 * 1000);
      } catch (e) {
        console.error('Error applying mute role:', e);
      }
    });
  });
}

async function attachModerationToConnection(voiceConnection) {
  try {
    const guildId = voiceConnection.joinConfig.guildId;
    const guild = await voiceConnection.client.guilds.fetch(guildId);
    startListeningOnConnection(voiceConnection, guild);
  } catch (e) {
    console.error('attachModerationToConnection error:', e);
  }
}

// --- Voice moderation code ends here ---

// --- Bot setup ---

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers
  ]
});

const GUILD_ID = process.env.GUILD_ID;
const VOICE_CHANNEL_ID = process.env.VOICE_CHANNEL_ID;
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;

if (!DISCORD_TOKEN || !GUILD_ID || !VOICE_CHANNEL_ID) {
  console.error('Missing DISCORD_TOKEN, GUILD_ID, or VOICE_CHANNEL_ID environment variables');
  process.exit(1);
}

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);

  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    const voiceChannel = await guild.channels.fetch(VOICE_CHANNEL_ID);

    if (!voiceChannel.isVoiceBased()) {
      console.error('Provided channel is not a voice channel');
      process.exit(1);
    }

    const connection = joinVoiceChannel({
      channelId: VOICE_CHANNEL_ID,
      guildId: GUILD_ID,
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf: false,
      selfMute: false,
    });

    await attachModerationToConnection(connection);

    console.log('Voice moderation attached and listening!');
  } catch (err) {
    console.error('Error joining voice channel:', err);
  }
});

client.login(DISCORD_TOKEN).catch(err => {
  console.error('Login error:', err);
  process.exit(1);
});