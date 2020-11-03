#!/usr/bin/env node
global.ROOT = __dirname;
global.logger = require('./logger');

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
    throw 'Invalid wallet information';

let account = {
    address: v3.address,
    pk: v3.pk,
    name: "validatorDocker"
};
global.monitor.validatorAddress = account.address;
console.log('Start Orbit Chain Validator ! : ' + account.address);

if(!config.chain || Object.keys(config.chain).length === 0)
    console.log('No available chain.');

logger.info('Start Orbit Chain Validator!');

const express = require('express');
const app = express();
const PORT = process.env.PORT || 8984;

const indexRouter = require("./routes/index");
app.use('/', indexRouter);

settings.chainList.forEach(key => {
    let chain = config.chain[key];
    console.log(`[VALIDATOR_CHAIN] key: ${key}, chain: ${JSON.stringify(chain)}`);
    let instance = require(ROOT + '/' + chain.src);
    instance.initialize(account);
});

const gov = require(`${ROOT}/src/gov`);
gov.initialize(account);
app.use("/v1/gov", require("./routes/v1/gov").setGovInstance(gov));

app.listen(PORT, () => {
    logger.info('Listening on port ' + PORT);
});
