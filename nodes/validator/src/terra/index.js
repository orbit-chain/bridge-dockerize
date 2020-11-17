global.logger.terra = require('./logger');

const terrajs = require('@terra-money/core');
const BN = require('bn.js');
const _ = require('lodash');

const config = require(ROOT + '/config');
const Britto = require(ROOT + '/lib/britto');
const txSender = require(ROOT + '/lib/txsender');
const packer = require('./utils/packer');
const terra = require('./utils/terra.api');
const BridgeUtils = require('./utils/terra.bridgeutils');
const bridgeUtils = new BridgeUtils();

const FIX_GAS = 99999999;

let lastBlockNum = {
    orbitHub: null,
    terraBridge: null
};

let account = {};
let hubEventList = [
    {
        name: 'SwapRelay',
        callback: receiveSwapRelay
    }
];

let bridgeEventList = [
    {
        name: 'TransactionSuggested',
        callback: receiveTransactionSuggested
    },
    {
        name: 'TransactionSelected',
        callback: receiveTransactionSelected
    }
];

let govInfo;

const chainName = 'TERRA';
const orbitHub = Britto.getNodeConfigBase('orbitHub');
const terraBridge = Britto.getNodeConfigBase('terraBridge');

const suggestionType = { SUGGEST: 0, SELECT: 1 }

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
    orbitHub.abi = Britto.getJSONInterface('OrbitHub.abi');

    terraBridge.ws = config.rpc.OCHAIN_WS;
    terraBridge.rpc = config.rpc.OCHAIN_RPC;
    terraBridge.address = config.contract.TERRA_BRIDGE_CONTRACT;
    terraBridge.abi = Britto.getJSONInterface('TerraBridge.abi');

    orbitHub.onconnect = () => {
        startSubscription(orbitHub, hubEventList)
    };

    terraBridge.onconnect = () => {
        startSubscription(terraBridge, bridgeEventList);
    };

    global.monitor.setNodeConnectStatus(chainName, orbitHub.ws, "connecting");
    new Britto(orbitHub, chainName).connectWeb3();
    new Britto(terraBridge, chainName).connectWeb3();

    orbitHub.multisig.wallet = config.contract.ORBIT_HUB_MULTISIG;
    orbitHub.multisig.abi = Britto.getJSONInterface('MessageMultiSigWallet.abi');
    orbitHub.multisig.contract = new orbitHub.web3.eth.Contract(orbitHub.multisig.abi, orbitHub.multisig.wallet);

    terraBridge.multisig.wallet = config.contract.TERRA_BRIDGE_MULTISIG;
    terraBridge.multisig.abi = Britto.getJSONInterface('MessageMultiSigWallet.abi');
    terraBridge.multisig.contract = new terraBridge.web3.eth.Contract(terraBridge.multisig.abi, terraBridge.multisig.wallet);
}

function startSubscription(node, eventList) {
    subscribeNewBlock(node.web3, node.name, blockNumber => {
        getEvent(blockNumber, node, eventList);
    });
}

function subscribeNewBlock(web3, name, callback) {
    web3.eth.subscribe('newBlockHeaders', (err, res) => {
        if (err) {
            logger.terra.error(`[ERROR] ${name} newBlockHeaders`);
            logger.terra.error(err);
            return;
        }
        if (!res.number) {
            return;
        }

        if (!lastBlockNum[name])
            lastBlockNum[name] = res.number - 1;

        let start = lastBlockNum[name] + 1;
        let end = res.number;
        lastBlockNum[name] = end;

        for (let i = start; i <= end; i++) {
            if (callback)
                callback(i);
        }
    })
}

function getEvent(blockNumber, nodeConfig, nameOrArray, callback) {
    let options = {
        filter: {},
        fromBlock: blockNumber,
        toBlock: blockNumber
    };

    return new Promise((resolve, reject) => {
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
                if(event.name === "SwapRelay"){
                    events = events.filter(e => e.returnValues.fromChain === chainName && e.returnValues.bytes32s[0] === govInfo.id);
                }

                if (events.length > 0) {
                    logger.terra.info(`[${nodeConfig.name.toUpperCase()}] Get '${event.name}' event from block ${blockNumber}. length: ${events.length}`);
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
        });
    }
}

async function validateSwap(data) {
    let validator = {...data.validator} || {};
    delete data.validator;

    const denom = bridgeUtils.hex2str(data.token);

    if (parseInt(data.uints[1]) != 6){
        logger.terra.error(`validateSwap error: Invalid decimal.( ${denom}, ${data.uints[1]} )`);
        return;
    }

    // Get terra transaction
    const txhash = data.bytes32s[1].replace('0x', '').toUpperCase();
    let txInfo = await terra.getTransaction(txhash).catch(e => {
    });
    if (!txInfo) {
        logger.terra.error('validateSwap error: Cannot get transaction by hash.');
        return;
    }

    // STEP 1: Check Transaction status
    if (txInfo.code) {
        logger.terra.error(`validateSwap error: Transaction ${txhash} is failed.`);
        return;
    }

    // STEP 2: Check amount
    let msgSendList = txInfo.tx.value.msg.filter(x => x.type === 'bank/MsgSend' && x.value.to_address.toLowerCase() === govInfo.address.toLowerCase() && x.value.from_address.toLowerCase() === bridgeUtils.hex2str(data.fromAddr).toLowerCase());
    if (msgSendList.length === 0) {
        logger.terra.error(`validateSwap error: Cannot find the target wallet(${govInfo.address}) in to_address or fromAddr(${bridgeUtils.hex2str(data.fromAddr).toLowerCase()}).`);
        return;
    }

    let tokenAmount = 0;
    for (let msgSend of msgSendList) {
        for (let amountObj of msgSend.value.amount) {
            if (amountObj.denom !== denom){
                continue;
            }

            tokenAmount = new BN(tokenAmount.toString()).add(new BN(amountObj.amount.toString())).toString();
        }
    }

    if (data.uints[0].toString() !== tokenAmount.toString()) {
        logger.terra.error(`validateSwap error: ${data.bytes32s[1]} ${denom} amount not matched. Expect ${tokenAmount.toString()}, but got ${data.uints[0]}!`);
        return;
    }

    // STEP 3: Check Memos
    let toAddr, toChain;
    let memo = txInfo.tx.value.memo;
    try {
        memo = JSON.parse(memo);
    } catch (e) {
        logger.terra.error('validateSwap error: memo is not JSON type.');
        return;
    }

    toAddr = memo.toAddr;
    toChain = memo.toChain;

    if (!toAddr || toAddr.length === 0) {
        logger.terra.error(`validateSwap error: toAddr is not defined.`);
        return;
    }

    if (toAddr.toLowerCase() !== data.toAddr.toLowerCase()) {
        logger.terra.error(`validateSwap error: toAddr is different with memo.toAddr`);
        return;
    }

    if (!toChain || toChain.length === 0) {
        logger.terra.error(`validateSwap error: toChain is not defined.`);
        return;
    }

    if (toChain !== data.toChain) {
        logger.terra.error(`validateSwap error: toChain`);
        return;
    }

    valid();

    async function valid() {
        let sender = Britto.getRandomPkAddress();
        if(!sender || !sender.pk || !sender.address){
            logger.terra.error("Cannot Generate account");
            return;
        }

        let bytes32s = [ data.bytes32s[0], data.bytes32s[1] ];
        let uints = [ data.uints[0], data.uints[1] ];

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
        let validators = await terraBridge.multisig.contract.methods.getHashValidators(hash.toString('hex').add0x()).call();
        for(var i = 0; i < validators.length; i++){
            if(validators[i].toLowerCase() === validator.address.toLowerCase()){
                logger.terra.error(`Already signed. validated swapHash: ${hash}`);
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
            logger.terra.error('validateSwap estimateGas error: ' + e.message)
        });

        if (!gasLimit) {
            return;
        }

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

function receiveTransactionSuggested(events) {
    for (let event of events) {

        if(event.returnValues.govId !== govInfo.id)
            continue;

        let returnValues = {
            govId: event.returnValues.govId,
            suggestIndex: event.returnValues.suggestIndex,
        };

        validateTransactionSuggested({
            block: event.blockNumber,
            validator: {address: account.address, pk: account.pk},
            ...returnValues
        });
    }
}

async function validateTransactionSuggested(data) {
    let validator = {...data.validator} || {};
    delete data.validator;

    let suggestion = await terraBridge.contract.methods.getSuggestion(suggestionType.SUGGEST, govInfo.id, data.suggestIndex).call();
    if(!suggestion || suggestion.uints.length < 4){
        logger.terra.error('validateTransactionSuggested error: suggestion is invalid.');
        return;
    }

    const dataIndex = parseInt(suggestion.uints[0]);

    let swapData = await terraBridge.contract.methods.swapData(govInfo.id, dataIndex).call();
    if (!swapData) {
        logger.terra.error('validateTransactionSuggested error: swapData is invalid.');
        return;
    }

    let swapDataArray = await terraBridge.contract.methods.getSwapDataArray(govInfo.id, dataIndex).call();
    if (!swapDataArray || swapDataArray.uints.length < 2){
        logger.terra.error('validateTransactionSuggested error: swapDataArray is invalid.');
        return;
    }

    let memo = {
        contract: terraBridge.address.toLowerCase(),
        dataIndex: dataIndex.toString()
    };

    let rawTx = {
        fee: suggestion.uints[2].toString(),
        seq: suggestion.seq.toString(),
        from: govInfo.address,
        dest: bridgeUtils.hex2str(swapData.toAddr),
        memo: JSON.stringify(memo),
        amount: swapDataArray.uints[0],
        token: bridgeUtils.hex2str(swapData.token),
    }

    const balances = (await terra.getBalance(rawTx.from)).filter(x => x.denom === rawTx.token);
    if (balances.length <= 0 || parseInt(balances[0].amount) < parseInt(new BN(rawTx.amount).add(new BN(dataIndex.toString())).toString())) {
        logger.terra.error(`validateTransactionSuggested error: insufficient funds. req(${balances[0].amount}), real(${new BN(rawTx.amount).add(new BN(dataIndex.toString())).toString()}))`);
        return;
    }

    // Check tax
    if(rawTx.dest !== rawTx.from) {
        let calcTax = bridgeUtils.calculateTax(rawTx.token, new BN(rawTx.amount).add(new BN(dataIndex.toString())).toString());

        if(calcTax == null)
            return;

        if (calcTax.toString() === suggestion.uints[3].toString()) {
            logger.terra.error('validateTransactionSuggested error: Tax is different. Require ' + calcTax + ' but got ' + suggestion.uints[3].toString());
            return;
        }
    }

    rawTx.amount = new BN(rawTx.amount).sub(new BN(suggestion.uints[3].toString())).toString();

    let msgs = [];
    msgs.push(terrajs.buildSend([{amount: rawTx.amount, denom: rawTx.token}], rawTx.from, rawTx.dest));
    msgs.push(terrajs.buildSend([{amount: suggestion.uints[0].toString(), denom: rawTx.token}], rawTx.from, rawTx.from));
    if(msgs.filter(x => x.type !== 'bank/MsgSend').length > 0){
        logger.terra.error('validateTransactionSuggested error: Message type is invalid.');
        return;
    }

    /////////////////////////////////
    // Validating fee and sequence //
    /////////////////////////////////

    let accountInfo = await terra.getAccountInfo(govInfo.address);
    if (!accountInfo) {
        logger.terra.error('validateTransactionSuggested error: Invalid account info');
        return;
    }

    const accountVal = accountInfo.result.value;
    const accountNumber = accountVal.account_number;
    const sequence = accountVal.sequence;
    const required = await terraBridge.multisig.contract.methods.required().call();

    let ownerCount, pubkeyThreshold;
    if (accountVal.public_key) {
        ownerCount = accountVal.public_key.value.pubkeys.length;
        pubkeyThreshold = accountVal.public_key.value.threshold;
    } else {
        ownerCount = config.terra.pubkeys.length;
        pubkeyThreshold = config.terra.threshold;
    }

    if(!ownerCount){
        logger.terra.error(`validateTransactionSuggested validation fail: No pubkeys.`);
        return;
    }

    if (pubkeyThreshold.toString() !== required.toString()) {
        logger.terra.error(`validateTransactionSuggested validation fail: Account public key threshold is different. Require ${pubkeyThreshold}, but ${required}`);
        return;
    }

    // Step 1: Sequence Check
    if (sequence.toString() !== suggestion.seq.toString()) {
        logger.terra.error(`validateTransactionSuggested validation fail: Account sequence is different. Require ${sequence}, but ${suggestion.seq}`);
        return;
    }

    // Step 2: Fee Check
    const gasByMsg = 100000;
    const gasByPubkey = 1000;
    const gasPrice = config.terra.gasPrices.ukrw;
    const maxMultiply = 2.5;

    const expectGas = gasByMsg + gasByPubkey * ownerCount;
    const expectFee = Math.ceil(expectGas * gasPrice);

    if (expectGas > Number(suggestion.uints[1])) {
        logger.terra.error(`validateTransactionSuggested validation fail: Small gas. Expect ${expectGas}, but got ${suggestion.uints[1]}.`);
        return;
    }

    if (expectFee > Number(suggestion.uints[2])) {
        logger.terra.error(`validateTransactionSuggested validation fail: Small fee. Expected ${expectFee}, but got ${suggestion.uints[2]}.`);
        return;
    } else if (expectFee * maxMultiply < Number(suggestion.uints[2])) {
        logger.terra.error(`validateTransactionSuggested validation fail: Too many fee. Maximum is ${expectFee * maxMultiply}, but got ${suggestion.uints[2]}.`);
        return;
    }

    // Generate standard transaction.
    const stdTx = terrajs.buildStdTx(msgs, bridgeUtils.getFeeObject({gas: suggestion.uints[1], fee: suggestion.uints[2], tax: suggestion.uints[3], taxDenom: rawTx.token}), rawTx.memo);
    const signatureHash = bridgeUtils.getSignatureHash(stdTx, suggestion.seq.toString(), accountNumber);
    const suggestHash = Britto.sha256sol(packer.packSuggestHash({
        bridgeContract: terraBridge.address,
        govId: govInfo.id,
        suggestIndex: data.suggestIndex,
        uints: suggestion.uints,
        signatureHash: suggestion.signatureHash
    }));

    let validators = await terraBridge.multisig.contract.methods.getHashValidators(suggestHash.toString('hex').add0x()).call();
    for(var i = 0; i < validators.length; i++){
        if(validators[i].toLowerCase() === validator.address.toLowerCase()){
            logger.terra.error(`Already signed. validated suggestHash: ${suggestHash}`);
            return;
        }
    }

    const signature = Britto.signMessage(suggestHash, validator.pk);

    valid();

    async function valid() {
        let sender = Britto.getRandomPkAddress();
        if(!sender || !sender.pk || !sender.address){
            logger.terra.error("Cannot Generate account");
            return;
        }

        let sigs = [
            signature.r,
            signature.s
        ]

        let params = [
            govInfo.id,
            data.suggestIndex,
            validator.address,
            signature.v,
            sigs
        ];

        let txOptions = {
            gasPrice: terraBridge.web3.utils.toHex('0'),
            from: sender.address,
            to: terraBridge.address
        };

        let gasLimit = await terraBridge.contract.methods.validateTransactionSuggested(...params).estimateGas(txOptions).catch(e => {
            logger.terra.error('validateTransactionSuggested estimateGas error: ' + e.message)
        });

        if (!gasLimit) {
            return;
        }

        txOptions.gasLimit = terraBridge.web3.utils.toHex(FIX_GAS);

        let txData = {
            method: 'validateTransactionSuggested',
            args: params,
            options: txOptions
        };

        await txSender.sendTransaction(terraBridge, txData, {address: sender.address, pk: sender.pk, timeout: 1});
        global.monitor && global.monitor.setProgress(chainName, 'validateTransactionSuggested', data.block);
    }
}

function receiveTransactionSelected(events) {
    for (let event of events) {

        if(event.returnValues.govId !== govInfo.id)
            continue;

        let returnValues = {
            govId: event.returnValues.govId,
            selectionIndex: event.returnValues.selectionIndex,
        };

        validateTransactionSelected({
            block: event.blockNumber,
            validator: {address: account.address, pk: account.pk},
            ...returnValues
        });
    }
}

async function validateTransactionSelected(data) {
    let validator = {...data.validator} || {};
    delete data.validator;

    let selection = await terraBridge.contract.methods.getSuggestion(suggestionType.SELECT, govInfo.id, data.selectionIndex).call();
    if (!selection) {
        logger.terra.error('validateTransactionSelected error: Cannot get selection(' + data.selectionIndex + ')');
        return;
    }

    if (Number(selection.signatureHash.replace('0x', '')) === 0) {
        logger.terra.error('validateTransactionSelected error: Cannot get signatureHash of selection(' + data.selectionIndex + ')');
        return;
    }

    let validators = await terraBridge.multisig.contract.methods.getHashValidators(selection.signatureHash).call();
    for(var i = 0; i < validators.length; i++){
        if(validators[i].toLowerCase() === validator.address.toLowerCase()){
            logger.terra.error(`Already signed. validated signatureHash: ${selection.signatureHash}`);
            return;
        }
    }

    let signature = Britto.signMessage(selection.signatureHash, validator.pk);
    valid();

    async function valid() {
        let sender = Britto.getRandomPkAddress();
        if(!sender || !sender.pk || !sender.address){
            logger.terra.error("Cannot Generate account");
            return;
        }

        let sigs = [
            signature.r,
            signature.s
        ]

        let params = [
            govInfo.id,
            data.selectionIndex,
            validator.address,
            signature.v,
            sigs
        ];

        let txOptions = {
            gasPrice: terraBridge.web3.utils.toHex('0'),
            from: sender.address,
            to: terraBridge.address
        };

        let gasLimit = await terraBridge.contract.methods.validateTransactionSelected(...params).estimateGas(txOptions).catch(e => {
            logger.terra.error('validateTransactionSelected estimateGas error: ' + e.message)
        });

        if (!gasLimit) {
            return;
        }

        txOptions.gasLimit = terraBridge.web3.utils.toHex(FIX_GAS);

        let txData = {
            method: 'validateTransactionSelected',
            args: params,
            options: txOptions
        };

        await txSender.sendTransaction(terraBridge, txData, {address: sender.address, pk: sender.pk, timeout: 1});
        global.monitor && global.monitor.setProgress(chainName, 'validateTransactionSelected', data.block);
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
