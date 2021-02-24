global.logger.klaytn_v2 = require('./logger');

const config = require(ROOT + '/config');
const Britto = require(ROOT + '/lib/britto');
const txSender = require(ROOT + '/lib/txsender');
const packer = require('./utils/packer');
const Caver = require('caver-js');

const BridgeUtils = require('./utils/klaytn.bridgeutils');
const bridgeUtils = new BridgeUtils();

const FIX_GAS = 99999999;

let lastBlockNum = null;
let account = {};
let eventList = [
    {
        name: 'SwapRelay',
        callback: receiveSwapRelay
    },
    {
        name: 'SwapNFTRelay',
        callback: receiveSwapNFTRelay
    }
];

let govInfo;

const chainName = 'KLAYTN';
const mainnet = Britto.getNodeConfigBase('mainnet');
const orbitHub = Britto.getNodeConfigBase('orbitHub');

async function initialize(_account) {
    if (!_account || !_account.address || !_account.pk)
        throw 'Invalid klaytnereum Wallet Account';

    account = _account;

    monitor.address[chainName] = account.address;

    govInfo = config.governance;
    if(!govInfo || !govInfo.chain || !govInfo.address || !govInfo.bytes || !govInfo.id)
        throw 'Empty Governance Info';

    if(config.klaytn.KLAYTN_ISKAS){
        const option = {
            headers: [
                {name: 'Authorization', value: 'Basic ' + Buffer.from(config.klaytn.KLAYTN_KAS.accessKeyId + ':' + config.klaytn.KLAYTN_KAS.secretAccessKey).toString('base64')},
                {name: 'x-chain-id', value: config.klaytn.KLAYTN_KAS.chainId},
            ]
        }

        mainnet.rpc = config.klaytn.KLAYTN_KAS.rpc;
        mainnet.caver = new Caver(new Caver.providers.HttpProvider(config.klaytn.KLAYTN_KAS.rpc, option));
    }
    else{
        mainnet.rpc = config.klaytn.KLAYTN_RPC;
        mainnet.caver = new Caver(config.klaytn.KLAYTN_RPC);
    }

    global.monitor.setNodeConnectStatus(chainName + "_v2", mainnet.rpc, "connecting");

    let isListening = await mainnet.caver.klay.net.isListening().catch(e => {
        logger.klaytn_v2.error(e);
        return;
    });

    if(!isListening){
        global.monitor.setNodeConnectStatus(chainName + "_v2", mainnet.rpc, "connectionFail");
        return;
    }
    else{
        logger.info(`[KLAYTN] klaytn caver connected to ${mainnet.rpc}`);
        global.monitor.setNodeConnectStatus(chainName + "_v2", mainnet.rpc, "connected");
    }

    if(govInfo.chain === chainName){
        mainnet.address = govInfo.address;
        mainnet.abi = Britto.getJSONInterface({filename: 'KlaytnVault.abi', version: 'v2'});
        mainnet.contract = new mainnet.caver.klay.Contract(mainnet.abi, mainnet.address);
    }
    else{
        mainnet.address = config.contract.KLAYTN_MAINNET_MINTER;
        mainnet.abi = Britto.getJSONInterface({filename: 'KlaytnMinter.abi', version: 'v2'});
        mainnet.contract = new mainnet.caver.klay.Contract(mainnet.abi, mainnet.address);
    }

    orbitHub.ws = config.rpc.OCHAIN_WS;
    orbitHub.rpc = config.rpc.OCHAIN_RPC;
    orbitHub.address = config.contract.ORBIT_HUB_CONTRACT;
    orbitHub.abi = Britto.getJSONInterface({filename: 'OrbitHub.abi', version: 'v2'});

    orbitHub.onconnect = () => { startSubscription(orbitHub) };

    global.monitor.setNodeConnectStatus(chainName + "_v2", orbitHub.ws, "connecting");
    new Britto(orbitHub, chainName + "_v2").connectWeb3();

    Britto.setAdd0x();
    Britto.setRemove0x();

    orbitHub.multisig.wallet = config.contract.KLAYTN_BRIDGE_MULTISIG;
    orbitHub.multisig.abi = Britto.getJSONInterface({filename: 'MessageMultiSigWallet.abi', version: 'v2'});
    orbitHub.multisig.contract = new orbitHub.web3.eth.Contract(orbitHub.multisig.abi, orbitHub.multisig.wallet);
}

function startSubscription(node) {
    subscribeNewBlock(node.web3, blockNumber => {
        global.monitor.setBlockNumber(chainName + "_v2", blockNumber);
        getEvent(blockNumber, node);
    });
}

function subscribeNewBlock(web3, callback) {
    web3.eth.subscribe('newBlockHeaders', (err, res) => {
        if (err)
            return logger.klaytn_v2.error('subscribeNewBlock subscribe error: ' + err.message);

        if (!res.number) {
            return;
        }

        if (!lastBlockNum)
            lastBlockNum = res.number - 1;

        let start = lastBlockNum + 1;
        let end = res.number;
        lastBlockNum = end;

        for (let i = start; i <= end; i++) {
            if (callback)
                callback(i);
        }
    })
}

/**
 * Get events in specific block.
 * @param blockNumber Target block number
 * @param nodeConfig Target chain, node, and contract.
 * @param nameOrArray Event name or list
 * @param callback
 * @returns {Promise<any>}
 */
function getEvent(blockNumber, nodeConfig, nameOrArray, callback) {
    let options = {
        filter: {},
        fromBlock: blockNumber,
        toBlock: blockNumber
    };

    return new Promise((resolve, reject) => {
        let _eventList = eventList;
        if (Array.isArray(nameOrArray)) {
            _eventList = nameOrArray;
        } else if (typeof nameOrArray === 'string' && callback) {
            _eventList = [{
                name: nameOrArray,
                callback: callback
            }]
        }

        let eventResults = [];
        for (let event of _eventList) {
            nodeConfig.contract.getPastEvents(event.name, options).then(events => {
                events = events.filter(e => e.returnValues.fromChain === chainName && e.returnValues.bytes32s[0] === govInfo.id);

                if (events.length > 0) {
                    logger.klaytn_v2.info(`[${nodeConfig.name.toUpperCase()}] Get '${event.name}' event from block ${blockNumber}. length: ${events.length}`);
                }

                if (event.callback)
                    event.callback(events);

                eventResults.push(events);
            }).catch(reject);
        }

        resolve(eventResults);
    });
}

async function parseEvent(blockNumber, nodeConfig, name) {
    let options = {
        filter: {},
        fromBlock: blockNumber,
        toBlock: blockNumber
    };

    let eventResults = await nodeConfig.contract.getPastEvents(name, options);

    global.monitor.setBlockNumber(chainName + '_MAINNET', blockNumber);

    return eventResults;
}

function receiveSwapRelay(events) {
    for (let event of events) {
        if(event.returnValues.bytes32s[0] !== govInfo.id){
            continue;
        }

        if(event.returnValues.fromChain !== chainName){
            continue;
        }

        let returnValues = {
            fromChain: event.returnValues.fromChain,
            bytes32s: event.returnValues.bytes32s,
            uints: event.returnValues.uints
        };

        validateSwap({
            block: event.blockNumber,
            validator: {address: account.address, pk: account.pk},
            ...returnValues
        })
    }
}

function validateSwap(data) {
    let validator = {...data.validator} || {};
    delete data.validator;

    mainnet.caver.klay.getTransactionReceipt(data.bytes32s[1]).then(async receipt => {
        if (!receipt){
            logger.klaytn_v2.error('No Transaction Receipt.');
            return;
        }

        let events = await parseEvent(receipt.blockNumber, mainnet, (govInfo.chain === chainName)? "Deposit" : "SwapRequest");
        if (events.length == 0){
            logger.klaytn_v2.error('Invalid Transaction.');
            return;
        }

        let params;
        events.forEach(async _event => {
            if(_event.address.toLowerCase() !== mainnet.address.toLowerCase()){
                return;
            }

            if(_event.returnValues.depositId !== data.uints[2]){
                return;
            }

            params = _event.returnValues;
        });

        if (!params.data) {
            params.data = "0x";
        }

        if(!params || !params.toChain || !params.fromAddr || !params.toAddr || !params.token || !params.amount || !params.decimal){
            logger.klaytn_v2.error("Invalid Transaction (event params)");
            return;
        }

        if(!bridgeUtils.isValidAddress(params.toChain, params.toAddr)){
            logger.klaytn_v2.error(`Invalid toAddress ( ${params.toChain}, ${params.toAddr} )`);
            return;
        }

        params.fromChain = chainName;
        params.uints = [params.amount, params.decimal, params.depositId];
        params.bytes32s = [govInfo.id, data.bytes32s[1]];

        let currentBlock = await mainnet.caver.klay.getBlockNumber().catch(e => {
            logger.klaytn_v2.error('getBlockNumber() execute error: ' + e.message);
        });

        if (!currentBlock)
            return console.error('No current block data.');

        // Check deposit block confirmed
        let isConfirmed = currentBlock - Number(receipt.blockNumber) >= config.system.klaytnConfirmCount;

        // 두 조건을 만족하면 valid
        if (isConfirmed)
            await valid(params);
        else
            console.log('depositId(' + data.uints[2] + ') is invalid.', 'isConfirmed: ' + isConfirmed);
    }).catch(e => {
        logger.klaytn_v2.error('validateSwap error: ' + e.message);
    });

    async function valid(data) {
        let sender = Britto.getRandomPkAddress();
        if(!sender || !sender.pk || !sender.address){
            logger.klaytn_v2.error("Cannot Generate account");
            return;
        }

        let hash = Britto.sha256sol(packer.packSwapData({
            hubContract: orbitHub.address,
            fromChain: data.fromChain,
            toChain: data.toChain,
            fromAddr: data.fromAddr,
            toAddr: data.toAddr,
            token: data.token,
            bytes32s: data.bytes32s,
            uints: data.uints,
            data: data.data
        }));

        let toChainMig = await orbitHub.contract.methods.getBridgeMig(data.toChain, govInfo.id).call();
        let contract = new orbitHub.web3.eth.Contract(orbitHub.multisig.abi, toChainMig);

        let validators = await contract.methods.getHashValidators(hash.toString('hex').add0x()).call();
        for(var i = 0; i < validators.length; i++){
            if(validators[i].toLowerCase() === validator.address.toLowerCase()){
                logger.klaytn_v2.error(`Already signed. validated swapHash: ${hash}`);
                return;
            }
        }

        let signature = Britto.signMessage(hash, validator.pk);

        let sigs = makeSigs(validator.address, signature);

        let params = [
            data.fromChain,
            data.toChain,
            data.fromAddr,
            data.toAddr,
            data.token,
            data.bytes32s,
            data.uints,
            data.data,
            sigs
        ];

        let txOptions = {
            gasPrice: orbitHub.web3.utils.toHex('0'),
            from: sender.address,
            to: orbitHub.address
        };

        let gasLimit = await orbitHub.contract.methods.validateSwap(...params).estimateGas(txOptions).catch(e => {
            logger.klaytn_v2.error('validateSwap estimateGas error: ' + e.message)
        });

        if (!gasLimit)
            return;

        txOptions.gasLimit = orbitHub.web3.utils.toHex(FIX_GAS);

        let txData = {
            method: 'validateSwap',
            args: params,
            options: txOptions
        };

        await txSender.sendTransaction(orbitHub, txData, {address: sender.address, pk: sender.pk, timeout: 1});
        global.monitor && global.monitor.setProgress(chainName + "_v2", 'validateSwap', data.block);
    }
}


function receiveSwapNFTRelay(events) {
    for (let event of events) {
        if(event.returnValues.bytes32s[0] !== govInfo.id){
            continue;
        }

        if(event.returnValues.fromChain !== chainName){
            continue;
        }

        let returnValues = {
            fromChain: event.returnValues.fromChain,
            bytes32s: event.returnValues.bytes32s,
            uints: event.returnValues.uints
        };

        validateSwapNFT({
            block: event.blockNumber,
            validator: {address: account.address, pk: account.pk},
            ...returnValues
        })
    }
}

function validateSwapNFT(data) {
    let validator = {...data.validator} || {};
    delete data.validator;

    mainnet.caver.klay.getTransactionReceipt(data.bytes32s[1]).then(async receipt => {
        if (!receipt){
            logger.klaytn_v2.error('No Transaction Receipt.');
            return;
        }

        let events = await parseEvent(receipt.blockNumber, mainnet, (govInfo.chain === chainName)? "DepositNFT" : "SwapRequestNFT");
        if (events.length == 0){
            logger.klaytn_v2.error('Invalid Transaction.');
            return;
        }

        let params;
        events.forEach(async _event => {
            if(_event.address.toLowerCase() !== mainnet.address.toLowerCase()){
                return;
            }

            if(_event.returnValues.depositId !== data.uints[2]){
                return;
            }

            params = _event.returnValues;
        });

        if (!params.data) {
            params.data = "0x";
        }

        if(!params || !params.toChain || !params.fromAddr || !params.toAddr || !params.token || !params.amount || !params.tokenId){
            logger.klaytn_v2.error("Invalid Transaction (event params)");
            return;
        }

        if(!bridgeUtils.isValidAddress(params.toChain, params.toAddr)){
            logger.klaytn_v2.error(`Invalid toAddress ( ${params.toChain}, ${params.toAddr} )`);
            return;
        }

        params.fromChain = chainName;
        params.uints = [params.amount, params.tokenId, params.depositId];
        params.bytes32s = [govInfo.id, data.bytes32s[1]];

        let currentBlock = await mainnet.caver.klay.getBlockNumber().catch(e => {
            logger.klaytn_v2.error('getBlockNumber() execute error: ' + e.message);
        });

        if (!currentBlock)
            return console.error('No current block data.');

        // Check deposit block confirmed
        let isConfirmed = currentBlock - Number(receipt.blockNumber) >= config.system.klaytnConfirmCount;

        // 두 조건을 만족하면 valid
        if (isConfirmed)
            await valid(params);
        else
            console.log('depositId(' + data.uints[2] + ') is invalid.', 'isConfirmed: ' + isConfirmed);
    }).catch(e => {
        logger.klaytn_v2.error('validateSwapNFT error: ' + e.message);
    });

    async function valid(data) {
        let sender = Britto.getRandomPkAddress();
        if(!sender || !sender.pk || !sender.address){
            logger.klaytn_v2.error("Cannot Generate account");
            return;
        }

        let hash = Britto.sha256sol(packer.packSwapNFTData({
            hubContract: orbitHub.address,
            fromChain: data.fromChain,
            toChain: data.toChain,
            fromAddr: data.fromAddr,
            toAddr: data.toAddr,
            token: data.token,
            bytes32s: data.bytes32s,
            uints: data.uints,
            data: data.data
        }));

        let toChainMig = await orbitHub.contract.methods.getBridgeMig(data.toChain, govInfo.id).call();
        let contract = new orbitHub.web3.eth.Contract(orbitHub.multisig.abi, toChainMig);

        let validators = await contract.methods.getHashValidators(hash.toString('hex').add0x()).call();
        for(var i = 0; i < validators.length; i++){
            if(validators[i].toLowerCase() === validator.address.toLowerCase()){
                logger.klaytn_v2.error(`Already signed. validated swapHash: ${hash}`);
                return;
            }
        }

        let signature = Britto.signMessage(hash, validator.pk);

        let sigs = makeSigs(validator.address, signature);

        let params = [
            data.fromChain,
            data.toChain,
            data.fromAddr,
            data.toAddr,
            data.token,
            data.bytes32s,
            data.uints,
            data.data,
            sigs
        ];

        let txOptions = {
            gasPrice: orbitHub.web3.utils.toHex('0'),
            from: sender.address,
            to: orbitHub.address
        };

        let gasLimit = await orbitHub.contract.methods.validateSwapNFT(...params).estimateGas(txOptions).catch(e => {
            logger.klaytn_v2.error('validateSwapNFT estimateGas error: ' + e.message)
        });

        if (!gasLimit)
            return;

        txOptions.gasLimit = orbitHub.web3.utils.toHex(FIX_GAS);

        let txData = {
            method: 'validateSwapNFT',
            args: params,
            options: txOptions
        };

        await txSender.sendTransaction(orbitHub, txData, {address: sender.address, pk: sender.pk, timeout: 1});
        global.monitor && global.monitor.setProgress(chainName + "_v2", 'validateSwapNFT', data.block);
    }
}

function makeSigs(validator, signature){
    let va = bridgeUtils.padLeft(validator, 64);
    let v = bridgeUtils.padLeft(parseInt(signature.v).toString(16), 64);

    let sigs = [
        va,
        v,
        signature.r,
        signature.s
    ]

    return sigs;
}

module.exports.initialize = initialize;
