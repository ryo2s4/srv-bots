const { logError } = require('../utils/log');

const monitor = require('./monitor');
const eventsGameplay = require('./eventsGameplay');
const eventsPanel = require('./eventsPanel');
const adminPanels = require('./adminPanels');
const shop = require('./shop');
const tickets = require('./tickets');
const forumUi = require('./forumUi');
const levelRewards = require('./levelRewards');
const runes = require('./runes');
const adminui = require('./adminui');
const specialchannels = require('./specialchannels');
const games = require('./games');
const modActions = require('../modActions');
const welcome = require('./welcome');

async function routeInteraction({ client, interaction }) {
    try {
        const handlers = [monitor, eventsGameplay, eventsPanel, adminPanels, shop, tickets, forumUi, levelRewards, runes, adminui, specialchannels, games, modActions, welcome];
        for (const h of handlers) {
            if (h && typeof h.handle === 'function') {
                const handled = await h.handle({ client, interaction });
                if (handled) return true;
            }
        }
        return false;
    } catch (err) {
        logError('routeInteraction', err);
        return false;
    }
}

module.exports = { routeInteraction };
