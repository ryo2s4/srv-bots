const telawa = require('./telawa');
const joinSession = require('./joinSession');
const leaveSession = require('./leaveSession');
const logReading = require('./logReading');
const progress = require('./progress');
const points = require('./points');
const shop = require('./shop');
const buy = require('./buy');
const quiz = require('./quiz');
const answer = require('./answer');
const owner = require('./owner');

const commandModules = [
  telawa,
  joinSession,
  leaveSession,
  logReading,
  progress,
  points,
  shop,
  buy,
  quiz,
  answer,
  owner,
];

const commands = commandModules.filter((m) => m.data);

const handlers = {};
for (const m of commandModules) {
  if (m.data) handlers[m.data.name] = m.execute;
}

module.exports = { commands, handlers, owner };
