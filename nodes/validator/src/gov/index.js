global.logger.gov = require('./logger');

const config = require(ROOT + '/config');
const Britto = require(ROOT + '/lib/britto');
const Caver = require('caver-js');
const abiDecoder = require('abi-decoder');

let account = {};
let initialized;

let chainNode = {
    "eth": null,
    "orbit": null,
    "klaytn": null,
    "icon": null
};

const orbit = Britto.getNodeConfigBase('orbit');
const eth = Britto.getNodeConfigBase('eth');
const klaytn = Britto.getNodeConfigBase('klaytn');
const icon = require('./utils/icon.api');

const errmBeforeInitialize = {
    "errm": "Before Initialized",
    "data": "Error: Before Initialized"
};

const errmInvalidChain = {
    "errm": "Invalid Chain",
    "data": "NotFoundError: Invalid Chain"
};

async function initialize(_account) {
    if (initialized)
        throw "Already Intialized";

    if (!_account || !_account.address || !_account.pk)
        throw 'Invalid Ethereum Wallet Account';

    account = _account;

    monitor.address["ORBIT"] = account.address;

    orbit.ws = config.rpc.OCHAIN_WS;
    orbit.rpc = config.rpc.OCHAIN_RPC;
    orbit.abi = Britto.getJSONInterface('MessageMultiSigWallet.abi');
    orbit.method = require('./lib/orbit');

    eth.rpc = config.rpc.ETH_MAINNET_RPC;
    eth.abi = Britto.getJSONInterface('MessageMultiSigWallet.abi');
    eth.method = require('./lib/eth');

    if(config.klaytn.KLAYTN_ISKAS){
        const option = {
            headers: [
                {name: 'Authorization', value: 'Basic ' + Buffer.from(config.klaytn.KLAYTN_KAS.accessKeyId + ':' + config.klaytn.KLAYTN_KAS.secretAccessKey).toString('base64')},
                {name: 'x-chain-id', value: config.klaytn.KLAYTN_KAS.chainId},
            ]
        }

        klaytn.rpc = config.klaytn.KLAYTN_KAS.rpc;
        klaytn.caver = new Caver(new Caver.providers.HttpProvider(config.klaytn.KLAYTN_KAS.rpc, option));
    }
    else{
        klaytn.rpc = config.klaytn.KLAYTN_RPC;
        klaytn.caver = new Caver(config.klaytn.KLAYTN_RPC);
    }
    klaytn.abi = Britto.getJSONInterface('MessageMultiSigWallet.abi');
    klaytn.method = require('./lib/klaytn');

    let isListening = await klaytn.caver.klay.net.isListening().catch(e => {
        logger.error(e);
        return;
    });

    if(isListening){
        logger.info(`[GOV_KLAYTN] klaytn caver connected to ${klaytn.rpc}`);
    }

    abiDecoder.addABI(Britto.getJSONInterface('Governance.abi'));

    orbit.onconnect = () => {
        initialized = true;

        chainNode["orbit"] = orbit;
        chainNode["eth"] = eth;
        chainNode["klaytn"] = klaytn;

        icon.method = require('./lib/icon');
        chainNode["icon"] = icon;
    };

    new Britto(orbit, 'GOV_ORBIT').connectWeb3();
    new Britto(eth, 'GOV_ETH').connectWeb3();

    Britto.setAdd0x();
    Britto.setRemove0x();
}

async function getAddress(chain) {
    if (!initialized) {
        return errmBeforeInitialize;
    }

    return monitor.address[chain.toUpperCase()];
}

async function getTransaction(chain, multisig, transactionId) {
    if (!initialized) {
        return errmBeforeInitialize;
    }

    let _node = chainNode[chain.toLowerCase()];
    if(!_node || !_node.method){
        return errmInvalidChain;
    }

    return await _node.method._getTransaction(_node, { multisig, transactionId}, abiDecoder);
}

async function confirmTransaction(chain, multisig, transactionId) {
    if (!initialized) {
        return errmBeforeInitialize;
    }

    let _node = chainNode[chain.toLowerCase()];
    if(!_node || !_node.method){
        return errmInvalidChain;
    }

    return await _node.method._confirmTransaction(_node, {
        multisig,
        transactionId,
        validator: {address: account.address, pk: account.pk},
    });
}

async function confirmTransactionByRange(chain, multisig, start, end) {
    if (!initialized) {
        return errmBeforeInitialize;
    }

    let _node = chainNode[chain.toLowerCase()];
    if(!_node || !_node.method || chain.toLowerCase() === "icon"){
        return errmInvalidChain;
    }

    let res = [];
    for(let i = parseInt(start); i <= parseInt(end); i++){
        let txHash = await _node.method._confirmTransaction(_node, {
            multisig: multisig,
            transactionId: i,
            validator: {address: account.address, pk: account.pk},
        })

        res.push({
            transactionId: i,
            res: txHash
        })
    }

    return res;
}

async function validateSigHash(multisig, sigHash) {
    if (!initialized) {
        return errmBeforeInitialize;
    }

    let _node = chainNode["orbit"];
    if(!_node || !_node.method){
        return errmInvalidChain;
    }

    return await _node.method._validateSigHash(_node, {
        multisig,
        sigHash,
        validator: {address: account.address, pk: account.pk},
    })
}

module.exports = {
    initialize,
    getAddress,
    getTransaction,
    confirmTransaction,
    confirmTransactionByRange,
    validateSigHash
}
