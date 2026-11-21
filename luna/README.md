# Discord Bot with Slash Commands

A simple Discord bot with slash commands built using Discord.js v14.

## Prerequisites

- Node.js 16.9.0 or higher
- A Discord Bot Token from the [Discord Developer Portal](https://discord.com/developers/applications)

## Setup

1. Clone this repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Create a `.env` file in the root directory and add your bot token:
   ```
   DISCORD_TOKEN=your-bot-token-here
   CLIENT_ID=your-client-id-here
   ```
4. Invite the bot to your server using this URL (replace CLIENT_ID with your bot's client ID):
   ```
   https://discord.com/api/oauth2/authorize?client_id=YOUR_CLIENT_ID&permissions=2147485696&scope=bot%20applications.commands
   ```

## Available Commands

- `/ping` - Check bot latency
- `/user @username` - Get information about a user

## Adding New Commands

1. Create a new file in the `src/commands` directory
2. Follow the pattern of existing commands
3. The command will be automatically registered when you run the deploy script

## Running the Bot

1. First, deploy the commands:
   ```bash
   npm run deploy-commands
   ```
2. Then start the bot:
   ```bash
   npm start
   ```

## License

MIT
# LUNA-V1.1-DB
