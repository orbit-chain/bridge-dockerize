#!/usr/bin/env node
global.ROOT = __dirname;
global.logger = require('./logger');
global.VERSION = process.env.VERSION || "unknown";

console.log(`[DEPLOYED VERSION] ${VERSION}`);

const config = require(ROOT + '/config');
const walletUtils = require('./wallet');

const Monitor = require('./src/monitor');
global.monitor = new Monitor();

const settings = config.requireEnv("./settings");
const validatorAccount = settings.VALIDATOR_ACCOUNT;

let PK;
switch (validatorAccount.TYPE) {
    case 'PK':
        PK = Buffer.from(validatorAccount.DATA.replace("0x",""), 'hex');
        break;
    default:
        throw `Unknown AUTH TYPE offered. ${validatorAccount.TYPE}`;
}

let v3 = walletUtils.getWalletFromPK(PK);
if (!v3)
    throw 'Invalid wallet information.';

let account = {
    address: v3.address,
    pk: v3.pk,
    publicKey: v3.publicKey,
    name: "validatorDocker"
};
global.monitor.validatorAddress = account.address;
global.monitor.publicKey = account.publicKey;

logger.info(`Start Orbit Chain Validator ! : ${account.address}`);

global.instances = {};

let chainList = settings.chainList;
if(!chainList || chainList.length === 0) {
    console.log('No available chain.');
    process.exit(1);
}

let hubInstance = require(ROOT + '/src/hub');
hubInstance = new hubInstance(chainList);
instances['hub'] = hubInstance;

chainList.forEach(key => {
    key = key.replace(/-v[1-9]$/, '').toLowerCase();
    let chain = config.chain[key] || { src: "src/evm" };

    console.log(`[VALIDATOR_CHAIN] key: ${key}, chain: ${JSON.stringify(chain)}`);

    let instance = require(ROOT + '/' + chain.src);
    instance = new instance(key, account);

    instances[key] = instance;
});

const gov = require(`${ROOT}/src/gov`);
instances["gov"] = new gov();

const express = require('express');
const app = express();
const PORT = process.env.PORT || 8984;

const indexRouter = require("./routes/index");
app.use('/', indexRouter);
app.use("/v1/gov", require("./routes/v1/gov").setGovInstance(instances["gov"]));

app.listen(PORT, () => {
    logger.info('Listening on port ' + PORT);
});
