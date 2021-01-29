global.logger.icon_v1 = require('./logger');

const config = require(ROOT + '/config');
const Britto = require(ROOT + '/lib/britto');
const txSender = require(ROOT + '/lib/txsender');
const packer = require('./utils/packer');

const icon = require('./utils/icon.api');
const BridgeUtils = require('./utils/icon.bridgeutils');
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

const chainName = 'ICON';
const orbitHub = Britto.getNodeConfigBase('orbitHub');

function initialize(_account) {
    if (!_account || !_account.address || !_account.pk)
        throw 'Invalid Ethereum Wallet Account';

    account = _account;

    govInfo = config.governance;
    if(!govInfo || !govInfo.chain || !govInfo.address || !govInfo.bytes || !govInfo.id)
        throw 'Empty Governance Info';

    orbitHub.ws = config.rpc.OCHAIN_WS;
    orbitHub.rpc = config.rpc.OCHAIN_RPC;
    orbitHub.address = config.contract.ORBIT_HUB_CONTRACT;
    orbitHub.abi = Britto.getJSONInterface({filename: 'OrbitHub.abi', version: 'v1'});

    orbitHub.onconnect = async () => {
        startSubscription(orbitHub);
        monitor.address[chainName] = await icon.getAddressByPK(account.pk);
    };

    global.monitor.setNodeConnectStatus(chainName + '_v1', orbitHub.ws, "connecting");
    new Britto(orbitHub, chainName + '_v1').connectWeb3();

    Britto.setAdd0x();
    Britto.setRemove0x();

    orbitHub.multisig.wallet = config.contract.ICON_BRIDGE_MULTISIG;
    orbitHub.multisig.abi = Britto.getJSONInterface({filename: 'MessageMultiSigWallet.abi', version: 'v1'});
    orbitHub.multisig.contract = new orbitHub.web3.eth.Contract(orbitHub.multisig.abi, orbitHub.multisig.wallet);
}

function startSubscription(node) {
    subscribeNewBlock(node.web3, blockNumber => {
        global.monitor.setBlockNumber(chainName + '_v1', blockNumber);
        getEvent(blockNumber, node);
    });
}

function subscribeNewBlock(web3, callback) {
    web3.eth.subscribe('newBlockHeaders', (err, res) => {
        if (err)
            return logger.icon_v1.error('subscribeNewBlock subscribe error: ' + err.message);

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
                    logger.icon_v1.info(`[${nodeConfig.name.toUpperCase()}] Get '${event.name}' event from block ${blockNumber}. length: ${events.length}`);
                }

                if (event.callback)
                    event.callback(events);

                eventResults.push(events);
            }).catch(reject);
        }

        resolve(eventResults);
    });
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

    icon.getTransactionResult(data.bytes32s[1]).then(async receipt => {
        if (!receipt){
            logger.icon_v1.error('No transaction receipt.');
            return;
        }

        if (receipt.eventLogs.length === 0){
            logger.icon_v1.error('No transaction event log.');
            return;
        }

        if(!bridgeUtils.isValidAddress(data.toChain, data.toAddr)){
            logger.icon_v1.error(`Invalid toAddress ( ${data.toChain}, ${data.toAddr} )`);
            return;
        }

        let currentBlock = await icon.getLastBlock().catch(e => {
            logger.icon_v1.error('getLastBlock() execute error: ' + e.message);
        });
        if (!currentBlock)
            return console.error('No current block data.');

        global.monitor.setBlockNumber(chainName + '_MAINNET', currentBlock.height);

        // Check deposit block confirmed
        let isConfirmed = currentBlock.height - Number(receipt.blockHeight) >= config.system.iconConfirmCount;

        let fromChain;
        let toChain;
        let fromAddr;
        let toAddr;
        let token;
        let decimal;
        let amount;

        let log;
        for(log of receipt.eventLogs){
            if(log.scoreAddress.toLowerCase() !== icon.contract.address.toLowerCase())
                continue;

            if(log.indexed[0] !== "SwapRequest(str,str,bytes,bytes,bytes,bytes,int,int,int)")
                continue;

            // depositId check
            if(icon.toHex(log.data[8]) !== icon.toHex(data.uints[2]))
                continue;

            fromChain = log.data[0];
            toChain = log.data[1];
            fromAddr = log.data[2];
            toAddr = log.data[3];
            token = log.data[4];
            decimal = log.data[6];
            amount = log.data[7]
        }

        if(!fromChain || !toChain || !fromAddr || !toAddr || !token || !decimal || !amount){
            logger.icon_v1.error("Can't find event data");
            return;
        }

        let isSame = data.fromChain === fromChain
            && data.toChain === toChain
            && data.fromAddr.toLowerCase() === fromAddr.toLowerCase()
            && data.toAddr.toLowerCase() === toAddr.toLowerCase()
            && data.token.toLowerCase() === token.toLowerCase()
            && icon.toHex(data.uints[0]) === icon.toHex(amount)
            && icon.toHex(data.uints[1]) === icon.toHex(decimal)

        // 두 조건을 만족하면 valid
        if (isConfirmed && isSame)
            await valid(data);
        else
            console.log('Icon Swap Validated fromThash(' + data.bytes32s[1] + ') is invalid.', 'isConfirmed: ' + isConfirmed, 'isSame: ' + isSame);
    }).catch(e => {
        logger.icon_v1.error('validateSwap getReceipt call error: ' + e.message);
    });

    async function valid(data) {
        let sender = Britto.getRandomPkAddress();
        if(!sender || !sender.pk || !sender.address){
            logger.icon_v1.error("Cannot Generate account");
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

        let toChainMig = await orbitHub.contract.methods.getBridgeMig(data.toChain, govInfo.id).call();
        let contract = new orbitHub.web3.eth.Contract(orbitHub.multisig.abi, toChainMig);

        let validators = await contract.methods.getHashValidators(hash.toString('hex').add0x()).call();
        for(var i = 0; i < validators.length; i++){
            if(validators[i].toLowerCase() === validator.address.toLowerCase()){
                logger.icon_v1.error(`Already signed. validated swapHash: ${hash}`);
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
            logger.icon_v1.error('validateSwap estimateGas error: ' + e.message)
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
        global.monitor && global.monitor.setProgress(chainName + '_v1', 'validateSwap', data.block);
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
