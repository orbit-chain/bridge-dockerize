if(!process.env.RUNNING_LEVEL && process.env.PROFILE)
    process.env.RUNNING_LEVEL = process.env.PROFILE;

const RUNNING_LEVEL = process.env.RUNNING_LEVEL || 'docker';

exports.requireEnv = function (id) {
    return require(`${__dirname}/${RUNNING_LEVEL}/${id}`);
};

exports.system = require(`./${RUNNING_LEVEL}/system.js`);
exports.chain = require(`./${RUNNING_LEVEL}/chain.json`);
exports.governance = require(`./${RUNNING_LEVEL}/governance.js`);
exports.info = require(`./${RUNNING_LEVEL}/info.js`);
