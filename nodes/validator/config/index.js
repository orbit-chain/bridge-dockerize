if(!process.env.RUNNING_LEVEL && process.env.PROFILE)
    process.env.RUNNING_LEVEL = process.env.PROFILE;

const RUNNING_LEVEL = process.env.RUNNING_LEVEL || 'dev';

exports.requireEnv = function (id) {
    return require(`${__dirname}/${RUNNING_LEVEL}/${id}`);
};

exports.contract = require(`./${RUNNING_LEVEL}/contract.js`);
exports.system = require(`./${RUNNING_LEVEL}/system.js`);
exports.chain = require(`./${RUNNING_LEVEL}/chain.json`);
exports.rpc = require(`./${RUNNING_LEVEL}/rpc.js`);
exports.terra = require(`./${RUNNING_LEVEL}/terra.js`);
exports.klaytn = require(`./${RUNNING_LEVEL}/klaytn.js`);
exports.governance = require(`./${RUNNING_LEVEL}/governance.js`);
