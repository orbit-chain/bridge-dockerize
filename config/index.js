exports.settings = require(`./${process.env.PROFILE}/${process.env.CHAIN}`);
exports.endpoints = require(`./${process.env.PROFILE}/endpoints.js`).endpoints;
exports.system = require(`./${process.env.PROFILE}/system.js`);
exports.chain = require(`./chain.json`);
exports.governance = require(`./governance.js`);
exports.info = require(`./info.js`);
