global.logger.heco = require('./logger');

const config = require(ROOT + '/config');
const Britto = require(ROOT + '/lib/britto');
const txSender = require(ROOT + '/lib/txsender');
const packer = require('./utils/packer');

const BridgeUtils = require(ROOT + '/lib/bridgeutils');
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

const chainName = 'HECO';
const mainnet = Britto.getNodeConfigBase('mainnet');
const orbitHub = Britto.getNodeConfigBase('orbitHub');

const tokenABI = [ { "constant": true, "inputs": [ { "internalType": "address", "name": "", "type": "address" } ], "name": "balanceOf", "outputs": [ { "internalType": "uint256", "name": "", "type": "uint256" } ], "payable": false, "stateMutability": "view", "type": "function" } ];

function initialize(_account) {
    if (!_account || !_account.address || !_account.pk)
        throw 'Invalid Ethereum Wallet Account';

    account = _account;

    monitor.address[chainName] = account.address;

    govInfo = config.governance;
    if(!govInfo || !govInfo.chain || !govInfo.address || !govInfo.bytes || !govInfo.id)
        throw 'Empty Governance Info';

    mainnet.rpc = config.heco.HECO_RPC;
    if(govInfo.chain === chainName){
        //TODO: implement vault
        //mainnet.address = govInfo.address;
        //mainnet.abi = Britto.getJSONInterface({filename: 'HecoVault.abi', version: 'v2'});
    }
    else{
        mainnet.address = config.contract.HECO_MAINNET_MINTER;
        mainnet.abi = Britto.getJSONInterface({filename: 'HecoMinter.abi', version: 'v2'});
    }

    orbitHub.ws = config.rpc.OCHAIN_WS;
    orbitHub.rpc = config.rpc.OCHAIN_RPC;
    orbitHub.address = config.contract.ORBIT_HUB_CONTRACT;
    orbitHub.abi = Britto.getJSONInterface({filename: 'OrbitHub.abi', version: 'v2'});

    orbitHub.onconnect = () => { startSubscription(orbitHub) };

    global.monitor.setNodeConnectStatus(chainName, mainnet.rpc, "connecting");
    new Britto(mainnet, chainName).connectWeb3();
    global.monitor.setNodeConnectStatus(chainName, orbitHub.ws, "connecting");
    new Britto(orbitHub, chainName).connectWeb3();

    Britto.setAdd0x();
    Britto.setRemove0x();

    orbitHub.multisig.wallet = config.contract.HECO_BRIDGE_MULTISIG;
    orbitHub.multisig.abi = Britto.getJSONInterface({filename: 'MessageMultiSigWallet.abi', version: 'v2'});
    orbitHub.multisig.contract = new orbitHub.web3.eth.Contract(orbitHub.multisig.abi, orbitHub.multisig.wallet);
}

function startSubscription(node) {
    subscribeNewBlock(node.web3, blockNumber => {
        global.monitor.setBlockNumber(chainName, blockNumber);
        getEvent(blockNumber, node);
    });
}

function subscribeNewBlock(web3, callback) {
    web3.eth.subscribe('newBlockHeaders', (err, res) => {
        if (err)
            return logger.heco.error('subscribeNewBlock subscribe error: ' + err.message);

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
                    logger.heco.info(`[${nodeConfig.name.toUpperCase()}] Get '${event.name}' event from block ${blockNumber}. length: ${events.length}`);
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

    mainnet.web3.eth.getTransactionReceipt(data.bytes32s[1]).then(async receipt => {
        if (!receipt){
            logger.heco.error('No Transaction Receipt.');
            return;
        }


        let events = await parseEvent(receipt.blockNumber, mainnet, (govInfo.chain === chainName)? "Deposit" : "SwapRequest");
        if (events.length == 0){
            logger.heco.error('Invalid Transaction.');
            return;
        }

        let params;
        events.forEach(async _event => {
            if(_event.address.toLowerCase() !== mainnet.address.toLowerCase()){
                return;
            }

            if(_event.transactionHash.toLowerCase() !== data.bytes32s[1].toLowerCase()){
                return;
            }

            if(_event.returnValues.depositId !== data.uints[2]){
                return;
            }

            params = _event.returnValues;
        });

        if(!params || !params.toChain || !params.fromAddr || !params.toAddr || !params.token || !params.amount || !params.decimal){
            logger.heco.error("Invalid Transaction (event params)");
            return;
        }

        if(!bridgeUtils.isValidAddress(params.toChain, params.toAddr)){
            logger.heco.error(`Invalid toAddress ( ${params.toChain}, ${params.toAddr} )`);
            return;
        }

        if(params.data && !bridgeUtils.isValidData(params.toChain, params.data)){
            logger.heco.error(`Invalid data ( ${params.toChain}, ${params.data} )`);
            return;
        }

        params.fromChain = chainName;
        params.uints = [params.amount, params.decimal, params.depositId];
        params.bytes32s = [govInfo.id, data.bytes32s[1]];

        let currentBlock = await mainnet.web3.eth.getBlockNumber().catch(e => {
            logger.heco.error('getBlockNumber() execute error: ' + e.message);
        });

        if (!currentBlock)
            return console.error('No current block data.');

        // Check deposit block confirmed
        let isConfirmed = currentBlock - Number(receipt.blockNumber) >= config.system.hecoConfirmCount;

        let curBalance = await monitor.getBalance(params.token);
        if(!curBalance || curBalance === 0 || Number.isNaN(curBalance)){
            logger.heco.error(`getBalance error ( ${params.token})`);
            return;
        }

        let isValidAmount = curBalance >= parseInt(params.amount);

        // 두 조건을 만족하면 valid
        if (isConfirmed && isValidAmount)
            await valid(params);
        else
            console.log(`depositId(${data.uints[2]}) is invalid. isConfirmed: ${isConfirmed}, isValidAmount: ${isValidAmount}`);
    }).catch(e => {
        logger.heco.error('validateSwap error: ' + e.message);
    });

    async function valid(data) {
        let sender = Britto.getRandomPkAddress();
        if(!sender || !sender.pk || !sender.address){
            logger.heco.error("Cannot Generate account");
            return;
        }

        if (!data.data) {
            data.data = "0x";
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
            data: data.data,
        }));

        let toChainMig = await orbitHub.contract.methods.getBridgeMig(data.toChain, govInfo.id).call();
        let contract = new orbitHub.web3.eth.Contract(orbitHub.multisig.abi, toChainMig);

        let validators = await contract.methods.getHashValidators(hash.toString('hex').add0x()).call();
        for(var i = 0; i < validators.length; i++){
            if(validators[i].toLowerCase() === validator.address.toLowerCase()){
                logger.heco.error(`Already signed. validated swapHash: ${hash}`);
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
            logger.heco.error('validateSwap estimateGas error: ' + e.message)
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
        global.monitor && global.monitor.setProgress(chainName, 'validateSwap', data.block);
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

    mainnet.web3.eth.getTransactionReceipt(data.bytes32s[1]).then(async receipt => {
        if (!receipt){
            logger.heco.error('No Transaction Receipt.');
            return;
        }

        let events = await parseEvent(receipt.blockNumber, mainnet, (govInfo.chain === chainName)? "DepositNFT" : "SwapRequestNFT");
        if (events.length == 0){
            logger.heco.error('Invalid Transaction.');
            return;
        }

        let params;
        events.forEach(async _event => {
            if(_event.address.toLowerCase() !== mainnet.address.toLowerCase()){
                return;
            }

            if(_event.transactionHash.toLowerCase() !== data.bytes32s[1].toLowerCase()){
                return;
            }

            if(_event.returnValues.depositId !== data.uints[2]){
                return;
            }

            params = _event.returnValues;
        });

        if(!params || !params.toChain || !params.fromAddr || !params.toAddr || !params.token || !params.amount || !params.tokenId){
            logger.heco.error("Invalid Transaction (event params)");
            return;
        }

        if(!bridgeUtils.isValidAddress(params.toChain, params.toAddr)){
            logger.heco.error(`Invalid toAddress ( ${params.toChain}, ${params.toAddr} )`);
            return;
        }

        params.fromChain = chainName;
        params.uints = [params.amount, params.tokenId, params.depositId];
        params.bytes32s = [govInfo.id, data.bytes32s[1]];

        let currentBlock = await mainnet.web3.eth.getBlockNumber().catch(e => {
            logger.heco.error('getBlockNumber() execute error: ' + e.message);
        });

        if (!currentBlock)
            return console.error('No current block data.');

        // Check deposit block confirmed
        let isConfirmed = currentBlock - Number(receipt.blockNumber) >= config.system.hecoConfirmCount;

        // 두 조건을 만족하면 valid
        if (isConfirmed)
            await valid(params);
        else
            console.log('depositId(' + data.uints[2] + ') is invalid.', 'isConfirmed: ' + isConfirmed);
    }).catch(e => {
        logger.heco.error('validateSwapNFT error: ' + e.message);
    });

    async function valid(data) {
        let sender = Britto.getRandomPkAddress();
        if(!sender || !sender.pk || !sender.address){
            logger.heco.error("Cannot Generate account");
            return;
        }

        if (!data.data) {
            data.data = "0x";
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
                logger.heco.error(`Already signed. validated swapHash: ${hash}`);
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
            logger.heco.error('validateSwapNFT estimateGas error: ' + e.message)
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
        global.monitor && global.monitor.setProgress(chainName, 'validateSwapNFT', data.block);
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

async function getBalance(tokenAddr) {
    let amount = 0;
    if(tokenAddr === "0x0000000000000000000000000000000000000000"){
        amount = await mainnet.web3.eth.getBalance(govInfo.address).catch(e => {
            logger.heco.error(`${tokenAddr} getBalance error : ${e.message}`);
        });
    }
    else{
        const token = new mainnet.web3.eth.Contract(tokenABI, tokenAddr);
        amount = await token.methods.balanceOf(govInfo.address).call().catch(e => {
            logger.heco.error(`${tokenAddr} getBalance error : ${e.message}`);
        });
    }
    return parseInt(amount);
}

module.exports = {
    getBalance,
    initialize
}
