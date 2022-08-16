global.logger.eth_v2 = require('./logger');

const config = require(ROOT + '/config');
const settings = config.requireEnv("./settings");
const Britto = require(ROOT + '/lib/britto');
const RPCAggregator = require(ROOT + '/lib/rpcAggregator');
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

const chainName = 'ETH';
const rpcAggregator = new RPCAggregator(chainName, settings.ETH_CHAIN_ID);
const orbitHub = Britto.getNodeConfigBase('orbitHub');

const tokenABI = [ { "constant": true, "inputs": [ { "internalType": "address", "name": "", "type": "address" } ], "name": "balanceOf", "outputs": [ { "internalType": "uint256", "name": "", "type": "uint256" } ], "payable": false, "stateMutability": "view", "type": "function" } ];
const gateKeeperABI = [{"constant":false,"inputs":[{"name":"","type":"string"},{"name":"","type":"string"},{"name":"","type":"bytes"},{"name":"","type":"bytes"},{"name":"","type":"bytes"},{"name":"","type":"bytes32[]"},{"name":"","type":"uint256[]"},{"name":"","type":"bytes32[]"}],"name":"applyLimitation","outputs":[],"payable":false,"stateMutability":"nonpayable","type":"function"},{"constant":true,"inputs":[{"name":"","type":"string"},{"name":"","type":"string"},{"name":"","type":"bytes"},{"name":"","type":"bytes32[]"},{"name":"","type":"uint256[]"}],"name":"isApplied","outputs":[{"name":"","type":"bool"}],"payable":false,"stateMutability":"view","type":"function"}];

function initialize(_account) {
    if (!_account || !_account.address || !_account.pk)
        throw 'Invalid Ethereum Wallet Account';

    account = _account;

    monitor.address[chainName] = account.address;

    govInfo = config.governance;
    if(!govInfo || !govInfo.chain || !govInfo.address || !govInfo.bytes || !govInfo.id) {
        throw 'Empty Governance Info';
    }

    let brittoConfig = {};
    if (govInfo.chain === chainName) {
        brittoConfig.address = govInfo.address;
        brittoConfig.abi = Britto.getJSONInterface({filename: 'EthVault.abi', version: 'v2'});
    } else {
        brittoConfig.address = settings.BridgeAddress.Eth.EthMinterContract;
        brittoConfig.abi = Britto.getJSONInterface({filename: 'EthMinter.abi', version: 'v2'});
    }
    const rpc = settings.Endpoints.Eth.rpc;
    if (Array.isArray(rpc)) {
        for (const url of rpc) {
            rpcAggregator.addRpc(url, brittoConfig);
        }
    } else if (typeof rpc === "string") {
        rpcAggregator.addRpc(rpc, brittoConfig);
    } else {
        throw `Unsupported Endpoints: ${rpc}`;
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

    orbitHub.multisig.wallet = config.contract.ETH_BRIDGE_MULTISIG;
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
            return logger.eth_v2.error('subscribeNewBlock subscribe error: ' + err.message);

        if (!res.number) {
            return;
        }

        global.monitor.setBlockTime();

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
                    logger.eth_v2.info(`[${nodeConfig.name.toUpperCase()}] Get '${event.name}' event from block ${blockNumber}. length: ${events.length}`);
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

async function validateSwap(data) {
    let validator = {...data.validator} || {};
    delete data.validator;

    const mainnet = await rpcAggregator.select();
    mainnet.web3.eth.getTransactionReceipt(data.bytes32s[1]).then(async receipt => {
        if (!receipt){
            logger.eth_v2.error('No Transaction Receipt.');
            return;
        }

        let events = await parseEvent(receipt.blockNumber, mainnet, (govInfo.chain === chainName)? "Deposit" : "SwapRequest");
        if (events.length == 0){
            logger.eth_v2.error('Invalid Transaction.');
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
            logger.eth_v2.error("Invalid Transaction (event params)");
            return;
        }

        if(!bridgeUtils.isValidAddress(params.toChain, params.toAddr)){
            logger.eth_v2.error(`Invalid toAddress ( ${params.toChain}, ${params.toAddr} )`);
            return;
        }

        if(params.data && !bridgeUtils.isValidData(params.toChain, params.data)){
            logger.eth_v2.error(`Invalid data ( ${params.toChain}, ${params.data} )`);
            return;
        }

        params.fromChain = chainName;
        params.uints = [params.amount, params.decimal, params.depositId];
        params.bytes32s = [govInfo.id, data.bytes32s[1]];

        if (params.toChain === "STACKS") {
            const isValid = await stacksLayer2.validateSwapData({
                ...params,
                uints: [
                    ...params.uints,
                    data.uints[3],
                ],
                bytes32s: data.bytes32s,
            });
            if (!isValid) {
                return;
            }
            params.uints.push(data.uints[3]);
            params.bytes32s.push(data.bytes32s[2]);
        }

        let currentBlock = await mainnet.web3.eth.getBlockNumber().catch(e => {
            logger.eth_v2.error('getBlockNumber() execute error: ' + e.message);
        });

        if (!currentBlock)
            return console.error('No current block data.');

        // Check deposit block confirmed
        let isConfirmed = currentBlock - Number(receipt.blockNumber) >= config.system.ethConfirmCount;
        if (!isConfirmed) {
            console.log(`depositId(${data.uints[2]}) is invalid. isConfirmed: ${isConfirmed}`);
            return;
        }

        let gateKeeperAddr;
        try {
            gateKeeperAddr = await orbitHub.contract.methods.gateKeeper().call();
        } catch (e) {}

        if(!gateKeeperAddr || gateKeeperAddr === "0x0000000000000000000000000000000000000000"){
            await valid(params);
            return;
        }

        let gateKeeper = new orbitHub.web3.eth.Contract(gateKeeperABI, gateKeeperAddr);
        let isApplied = await gateKeeper.methods.isApplied(params.fromChain, params.toChain, params.token, params.bytes32s, params.uints).call();
        if(!isApplied){
            await applyLimitation(gateKeeper, params);
        }
        else{
            await valid(params);
        }
    }).catch(e => {
        logger.eth_v2.error('validateSwap error: ' + e.message);
    });

    async function valid(data) {
        let sender = Britto.getRandomPkAddress();
        if(!sender || !sender.pk || !sender.address){
            logger.eth_v2.error("Cannot Generate account");
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
                logger.eth_v2.error(`Already signed. validated swapHash: ${hash}`);
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
            logger.eth_v2.error('validateSwap estimateGas error: ' + e.message)
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

    async function applyLimitation(gateKeeper, data) {
        let sender = Britto.getRandomPkAddress();
        if(!sender || !sender.pk || !sender.address){
            logger.eth_v2.error("Cannot Generate account");
            return;
        }

        let hash = Britto.sha256WithEncode(packer.packLimitationData({
            fromChain: data.fromChain,
            toChain: data.toChain,
            token: data.token,
            bytes32s: data.bytes32s,
            uints: data.uints
        }));

        let hubMig = await orbitHub.contract.methods.getBridgeMig("HUB", govInfo.id).call();
        let migCon = new orbitHub.web3.eth.Contract(orbitHub.multisig.abi, hubMig);

        let validators = await migCon.methods.getHashValidators(hash.toString('hex').add0x()).call();
        for(var i = 0; i < validators.length; i++){
            if(validators[i].toLowerCase() === validator.address.toLowerCase()){
                logger.eth_v2.error(`Already signed. applyLimitation: ${hash}`);
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
            sigs
        ];

        let gasLimit = await gateKeeper.methods.applyLimitation(...params).estimateGas({
            from: sender.address,
            to: gateKeeper._address
        }).catch((e) => {});
        if(!gasLimit) return;

        let applyData = gateKeeper.methods.applyLimitation(...params).encodeABI();
        if(!applyData) return;

        let txData = {
            nonce: orbitHub.web3.utils.toHex(0),
            from: sender.address,
            to: gateKeeper._address,
            value: orbitHub.web3.utils.toHex(0),
            gasLimit: orbitHub.web3.utils.toHex(FIX_GAS),
            data: applyData
        };

        let signedTx = await orbitHub.web3.eth.accounts.signTransaction(txData, "0x"+sender.pk.toString('hex'));
        let tx = await orbitHub.web3.eth.sendSignedTransaction(signedTx.rawTransaction, async (err, thash) => {
            if(err) {
                logger.eth_v2.error(`applyLimitation error: ${err.message}`);
                return;
            }

            logger.eth_v2.info(`applyLimitation: ${thash}`);
            global.monitor && global.monitor.setProgress(chainName + '_v2', 'applyLimitation', data.block);
        });
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

async function validateSwapNFT(data) {
    let validator = {...data.validator} || {};
    delete data.validator;

    const mainnet = await rpcAggregator.select();
    mainnet.web3.eth.getTransactionReceipt(data.bytes32s[1]).then(async receipt => {
        if (!receipt){
            logger.eth_v2.error('No Transaction Receipt.');
            return;
        }

        let events = await parseEvent(receipt.blockNumber, mainnet, (govInfo.chain === chainName)? "DepositNFT" : "SwapRequestNFT");
        if (events.length == 0){
            logger.eth_v2.error('Invalid Transaction.');
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
            logger.eth_v2.error("Invalid Transaction (event params)");
            return;
        }

        if(!bridgeUtils.isValidAddress(params.toChain, params.toAddr)){
            logger.eth_v2.error(`Invalid toAddress ( ${params.toChain}, ${params.toAddr} )`);
            return;
        }

        params.fromChain = chainName;
        params.uints = [params.amount, params.tokenId, params.depositId];
        params.bytes32s = [govInfo.id, data.bytes32s[1]];

        let currentBlock = await mainnet.web3.eth.getBlockNumber().catch(e => {
            logger.eth_v2.error('getBlockNumber() execute error: ' + e.message);
        });

        if (!currentBlock)
            return console.error('No current block data.');

        // Check deposit block confirmed
        let isConfirmed = currentBlock - Number(receipt.blockNumber) >= config.system.ethConfirmCount;

        // 두 조건을 만족하면 valid
        if (isConfirmed)
            await valid(params);
        else
            console.log('depositId(' + data.uints[2] + ') is invalid.', 'isConfirmed: ' + isConfirmed);
    }).catch(e => {
        logger.eth_v2.error('validateSwapNFT error: ' + e.message);
    });

    async function valid(data) {
        let sender = Britto.getRandomPkAddress();
        if(!sender || !sender.pk || !sender.address){
            logger.eth_v2.error("Cannot Generate account");
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
                logger.eth_v2.error(`Already signed. validated swapHash: ${hash}`);
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
            logger.eth_v2.error('validateSwapNFT estimateGas error: ' + e.message)
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

async function getBalance(tokenAddr) {
    const mainnet = await rpcAggregator.select();
    let amount = 0;
    if(tokenAddr === "0x0000000000000000000000000000000000000000"){
        amount = await mainnet.web3.eth.getBalance(govInfo.address).catch(e => {
            logger.eth_v2.error(`${tokenAddr} getBalance error : ${e.message}`);
        });
    }
    else{
        let taddr = tokenAddr;
        if(tokenAddr.toLowerCase() === "0xC355fe6E4e99C0B93577F08c4e9a599714435912".toLowerCase()){
            taddr = "0x6B175474E89094C44Da98b954EedeAC495271d0F";
        }

        const token = new mainnet.web3.eth.Contract(tokenABI, taddr);
        amount = await token.methods.balanceOf(govInfo.address).call().catch(e => {
            logger.eth_v2.error(`${taddr} getBalance error : ${e.message}`);
        });
    }
    return parseInt(amount);
}

module.exports = {
    getBalance,
    initialize
}
