require('dotenv').config({ override: true });
const { REST, Routes } = require('discord.js');
const { DISCORD_TOKEN, CLIENT_ID, CLIENT_SECRET } = process.env;
const fs = require('fs');
const path = require('path');

function requiredEnv(name, value) {
    const v = String(value || '').trim();
    if (!v || v === 'your-token-here') {
        throw new Error(`Missing/invalid ${name} in .env (did you save the file?).`);
    }
    return v;
}

const commands = [];
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs
    .readdirSync(commandsPath)
    .filter(file => file.endsWith('.js'))
    .filter(file => !['pause.js', 'resume.js', 'stop.js', 'volume.js', 'loop.js', 'play.js', 'queue.js', 'skip.js', 'nowplaying.js'].includes(file));

for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    // Skip shortcutsHandler.js as it's not a command
    if (file === 'shortcutsHandler.js') continue;
    const command = require(filePath);
    if (command && command.disabled) continue;
    commands.push(command.data.toJSON());
}

let token;
let clientId;
try {
    token = requiredEnv('DISCORD_TOKEN', DISCORD_TOKEN);
    clientId = requiredEnv('CLIENT_ID', CLIENT_ID);
} catch (e) {
    console.error(e.message);
    process.exit(1);
}

const rest = new REST({ version: '10', timeout: 30_000 }).setToken(token);

(async () => {
    try {
        console.log('Started refreshing application (/) commands.');

        // Global commands, then remove stale guild-scoped copies so the
        // picker never shows the same command twice.
        await rest.put(Routes.applicationCommands(clientId), { body: commands });
        console.log('Global commands reloaded.');
        const guilds = await rest.get(Routes.userGuilds());
        for (const g of guilds) {
            try {
                await rest.put(Routes.applicationGuildCommands(clientId, String(g.id)), { body: [] });
                console.log(`Cleared guild commands: ${g.name} (${g.id})`);
            } catch (err) {
                console.error(`Guild ${g.name} (${g.id}) failed:`, err.rawError?.message || err.message);
            }
        }

        console.log('Successfully reloaded application (/) commands.');
        process.exit(0);
    } catch (error) {
        console.error(error);
        process.exit(1);
    }
})();
