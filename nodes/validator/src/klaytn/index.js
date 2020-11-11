global.logger.klaytn = require('./logger');

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
    }
];

let govInfo;

const chainName = 'KLAYTN';
const mainnet = Britto.getNodeConfigBase('mainnet');
const orbitHub = Britto.getNodeConfigBase('orbitHub');

function initialize(_account) {
    if (!_account || !_account.address || !_account.pk)
        throw 'Invalid Ethereum Wallet Account';

    account = _account;

    govInfo = config.governance;
    if(!govInfo || !govInfo.chain || !govInfo.address || !govInfo.bytes || !govInfo.id)
        throw 'Empty Governance Info';

    mainnet.rpc = config.klaytn.KLAYTN_RPC;

    if(govInfo.chain === chainName){
        mainnet.address = govInfo.address;
        mainnet.abi = Britto.getJSONInterface('KlaytnVault.abi');
    }
    else{
        mainnet.address = config.contract.KLAYTN_MAINNET_MINTER;
        mainnet.abi = Britto.getJSONInterface('KlaytnMinter.abi');
    }

    orbitHub.ws = config.rpc.OCHAIN_WS;
    orbitHub.rpc = config.rpc.OCHAIN_RPC;
    orbitHub.address = config.contract.ORBIT_HUB_CONTRACT;
    orbitHub.abi = Britto.getJSONInterface('OrbitHub.abi');

    orbitHub.onconnect = () => { startSubscription(orbitHub) };

    global.monitor.setNodeConnectStatus(chainName, mainnet.rpc, "connecting");
    new Britto(mainnet, chainName).connectWeb3();
    global.monitor.setNodeConnectStatus(chainName, orbitHub.ws, "connecting");
    new Britto(orbitHub, chainName).connectWeb3();

    mainnet.caver = new Caver(config.klaytn.KLAYTN_RPC);

    Britto.setAdd0x();
    Britto.setRemove0x();

    orbitHub.multisig.wallet = config.contract.KLAYTN_BRIDGE_MULTISIG;
    orbitHub.multisig.abi = Britto.getJSONInterface('MessageMultiSigWallet.abi');
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
            return logger.klaytn.error('subscribeNewBlock subscribe error: ' + err.message);

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
                if (events.length > 0) {
                    logger.klaytn.info(`[${nodeConfig.name.toUpperCase()}] Get '${event.name}' event from block ${blockNumber}. length: ${events.length}`);
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
            toChain: event.returnValues.toChain,
            fromAddr: event.returnValues.fromAddr,
            toAddr: event.returnValues.toAddr,
            token: event.returnValues.token,
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
            logger.klaytn.error('No Transaction Receipt.');
            return;
        }

        if(!bridgeUtils.isValidAddress(data.toChain, data.toAddr)){
            logger.klaytn.error(`Invalid toAddress ( ${data.toChain}, ${data.toAddr} )`);
            return;
        }

        let events = await parseEvent(receipt.blockNumber, mainnet,  (govInfo.chain === chainName)? "Deposit" : "SwapRequest");
        if (events.length == 0){
            logger.klaytn.error('Invalid Transaction.');
            return;
        }

        let isSame = false;
        events.forEach(async _event => {
            if(_event.address.toLowerCase() !== mainnet.address.toLowerCase()){
                return;
            }

            if(_event.returnValues.depositId !== data.uints[2]){
                return;
            }

            let params = _event.returnValues;

            // 이벤트에서 받은 데이터와 컨트랙트에 기록된 deposit data가 모두 일치하는지 확인
            isSame = data.fromChain === params.fromChain
                && data.toChain === params.toChain
                && data.fromAddr.toLowerCase() === params.fromAddr.toLowerCase()
                && data.toAddr.toLowerCase() === params.toAddr.toLowerCase()
                && data.token.toLowerCase() === params.token.toLowerCase()
                && data.uints[0] === params.amount
                && data.uints[1] === params.decimal
        });

        let currentBlock = await mainnet.caver.klay.getBlockNumber().catch(e => {
            logger.klaytn.error('getBlockNumber() execute error: ' + e.message);
        });

        if (!currentBlock)
            return console.error('No current block data.');

        // Check deposit block confirmed
        let isConfirmed = currentBlock - Number(receipt.blockNumber) >= config.system.ethConfirmCount;

        // 두 조건을 만족하면 valid
        if (isConfirmed && isSame)
            await valid(data);
        else
            console.log('depositId(' + data.uints[2] + ') is invalid.', 'isConfirmed: ' + isConfirmed, 'isSame: ' + isSame);
    }).catch(e => {
        logger.klaytn.error('validateSwap error: ' + e.message);
    });

    async function valid(data) {
        let sender = Britto.getRandomPkAddress();
        if(!sender || !sender.pk || !sender.address){
            logger.klaytn.error("Cannot Generate account");
            return;
        }

        let bytes32s = [ data.bytes32s[0], data.bytes32s[1] ];
        let uints = [ data.uints[0], data.uints[1], data.uints[2] ];

        let hash = Britto.sha256sol(packer.packSwapData({
            hubContract: orbitHub.address,
            fromChain: data.fromChain,
            toChain: data.toChain,
            fromAddr: data.fromAddr,
            toAddr: data.toAddr,
            token: data.token,
            bytes32s: bytes32s,
            uints: uints
        }));

        // Orbit Bridge System에 등록되어있는 ToChain의 MultiSigWallet과 FromChain의 MultiSigWallet이 달라지는 경우 발생시 업데이트 필요
        let validators = await orbitHub.multisig.contract.methods.getHashValidators(hash.toString('hex').add0x()).call();
        for(var i = 0; i < validators.length; i++){
            if(validators[i].toLowerCase() === validator.address.toLowerCase()){
                logger.klaytn.error(`Already signed. validated swapHash: ${hash}`);
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
            bytes32s,
            uints,
            sigs
        ];

        let txOptions = {
            gasPrice: orbitHub.web3.utils.toHex('0'),
            from: sender.address,
            to: orbitHub.address
        };

        let gasLimit = await orbitHub.contract.methods.validateSwap(...params).estimateGas(txOptions).catch(e => {
            logger.klaytn.error('validateSwap estimateGas error: ' + e.message)
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
