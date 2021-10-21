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
exports.klaytn = require(`./${RUNNING_LEVEL}/klaytn.js`);
exports.governance = require(`./${RUNNING_LEVEL}/governance.js`);
exports.icon = require(`./${RUNNING_LEVEL}/icon.js`);
exports.ripple = require(`./${RUNNING_LEVEL}/ripple.js`);
exports.bsc = require(`./${RUNNING_LEVEL}/bsc.js`);
exports.heco = require(`./${RUNNING_LEVEL}/heco.js`);
exports.matic = require(`./${RUNNING_LEVEL}/matic.js`);
exports.celo = require(`./${RUNNING_LEVEL}/celo.js`);
