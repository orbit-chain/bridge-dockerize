global.logger.gov = require('./logger');

const config = require(ROOT + '/config');
const settings = config.requireEnv("./settings");
const Britto = require(ROOT + '/lib/britto');
const abiDecoder = require('abi-decoder');

let account = {};
let initialized;

let chainNode = {};

const orbit = Britto.getNodeConfigBase('orbit');

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
    orbit.abi = Britto.getJSONInterface({filename: 'MessageMultiSigWallet.abi'});
    orbit.method = require('./lib/orbit');

    for(let chain of settings.chainList){
        let name = chain.replace('-v2', '').toLowerCase();

        if(chainNode[name] || name === 'orbit' || name === 'xrp'){
            continue;
        }

        let method = require(`./lib/${name}`);

        let node = await method.init();
        node.method = method

        chainNode[name] = node;
    }

    abiDecoder.addABI(Britto.getJSONInterface({filename: 'Governance.abi'}));

    orbit.onconnect = () => {
        initialized = true;

        chainNode["orbit"] = orbit;
    };

    new Britto(orbit, 'GOV_ORBIT').connectWeb3();

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
