exports.settings = require(`./${process.env.PROFILE}/${process.env.CHAIN}`);
exports.chainIds = require(`./${process.env.PROFILE}/chainIds.js`);
exports.endpoints = require(`./${process.env.PROFILE}/endpoints.js`).endpoints;
exports.system = require(`./${process.env.PROFILE}/system.js`);
exports.chain = require(`./chain.json`);
exports.governance = require(`./governance.js`);
exports.info = require(`./info.js`);
exports.orbitHub = require(`./${process.env.PROFILE}/hub.js`);
exports.l2 = require(`./${process.env.PROFILE}/l2.js`)
