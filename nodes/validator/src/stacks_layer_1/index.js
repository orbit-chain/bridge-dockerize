global.logger.stacks_layer_1 = require('./logger');

const config = require(ROOT + '/config');
const settings = config.requireEnv("./settings");
const Britto = require(ROOT + '/lib/britto');
const txSender = require(ROOT + '/lib/txsender');
const packer = require('./utils/packer');
const BridgeUtils = require('./utils/stacks.bridgeutils');
const stacks = new BridgeUtils();
const { addressFromVersionHash, addressToString, createAddress, getAddressFromPrivateKey, makeUnsignedSTXTokenTransfer, StacksMessageType } = require("@stacks/transactions");

const FIX_GAS = 99999999;

let lastBlockNum = {
    orbitHub: null,
    stacksBridge: null
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
         name: 'StacksTransactionSuggested',
         callback: receiveTransactionSuggested
    },
    {
         name: 'StacksTransactionSelected',
         callback: receiveTransactionSelected
    }
];

let addressBookEventList = [
    {
        name: 'Relay',
        callback: receiveAddressBookRelay,
    }
]

const chainName = 'STACKS_LAYER_1';
const orbitHub = Britto.getNodeConfigBase('orbitHub');
const stacksBridge = Britto.getNodeConfigBase('stacksBridge');
const addressBook = Britto.getNodeConfigBase('stacksAddressBook');

const gateKeeperABI = [{"constant":false,"inputs":[{"name":"","type":"string"},{"name":"","type":"string"},{"name":"","type":"bytes"},{"name":"","type":"bytes"},{"name":"","type":"bytes"},{"name":"","type":"bytes32[]"},{"name":"","type":"uint256[]"},{"name":"","type":"bytes32[]"}],"name":"applyLimitation","outputs":[],"payable":false,"stateMutability":"nonpayable","type":"function"},{"constant":true,"inputs":[{"name":"","type":"string"},{"name":"","type":"string"},{"name":"","type":"bytes"},{"name":"","type":"bytes32[]"},{"name":"","type":"uint256[]"}],"name":"isApplied","outputs":[{"name":"","type":"bool"}],"payable":false,"stateMutability":"view","type":"function"}];

let govInfo;

function initialize(_account) {
    if (!_account || !_account.address || !_account.pk) {
        throw 'Invalid Ethereum Wallet Account';
    }

    account = _account;

    govInfo = config.governance;
    if(!govInfo || !govInfo.chain || !govInfo.address || !govInfo.bytes || !govInfo.id) {
        throw 'Empty Governance Info';
    }

    if(monitor.address[chainName]) return;
    monitor.address[chainName] = getAddressFromPrivateKey(account.pk, stacks.TransactionVersion);

    orbitHub.ws = config.rpc.OCHAIN_WS;
    orbitHub.address = config.contract.ORBIT_HUB_CONTRACT;
    orbitHub.abi = Britto.getJSONInterface({filename: 'OrbitHub.abi', version: 'v2'});

    stacksBridge.ws = config.rpc.OCHAIN_WS;
    stacksBridge.address = settings.BridgeAddress.StacksBridgeContract;
    stacksBridge.abi = Britto.getJSONInterface({filename: 'StacksBridgeLayer1.abi', version: 'v2'});

    addressBook.ws = config.rpc.OCHAIN_WS;
    addressBook.address = settings.BridgeAddress.StacksAddressBook;
    addressBook.abi = Britto.getJSONInterface({filename: 'StacksAddressBookLayer1.abi', version: 'v2'});

    orbitHub.onconnect = () => {
        startSubscription(orbitHub, hubEventList)
    };

    stacksBridge.onconnect = () => {
        startSubscription(stacksBridge, bridgeEventList);
    };

    addressBook.onconnect = () => {
        startSubscription(addressBook, addressBookEventList);
    }

    global.monitor.setNodeConnectStatus(chainName, orbitHub.ws, "connecting");
    new Britto(orbitHub, chainName).connectWeb3();
    new Britto(stacksBridge, chainName).connectWeb3();
    new Britto(addressBook, chainName).connectWeb3();

    orbitHub.multisig.wallet = config.contract.ORBIT_HUB_MULTISIG;
    orbitHub.multisig.abi = Britto.getJSONInterface({filename: 'StacksMessageMultiSigWallet.abi', version: 'v2'});
    orbitHub.multisig.contract = new orbitHub.web3.eth.Contract(orbitHub.multisig.abi, orbitHub.multisig.wallet);

    stacksBridge.multisig.wallet = settings.BridgeAddress.MessageMultiSigWallet.Stacks;
    stacksBridge.multisig.abi = Britto.getJSONInterface({filename: 'StacksMessageMultiSigWallet.abi', version: 'v2'});
    stacksBridge.multisig.contract = new stacksBridge.web3.eth.Contract(stacksBridge.multisig.abi, stacksBridge.multisig.wallet);

    addressBook.multisig.wallet = settings.BridgeAddress.MessageMultiSigWallet.Stacks;
    addressBook.multisig.abi = Britto.getJSONInterface({filename: 'StacksMessageMultiSigWallet.abi', version: 'v2'});
    addressBook.multisig.contract = new addressBook.web3.eth.Contract(addressBook.multisig.abi, addressBook.multisig.wallet);

    // TODO: stacks conn
}

function startSubscription(node, eventList) {
    subscribeNewBlock(node.web3, node.name, blockNumber => {
        getEvent(blockNumber, node, eventList);
    });
}

function subscribeNewBlock(web3, name, callback) {
    web3.eth.subscribe('newBlockHeaders', (err, res) => {
        if (err) {
            logger.stacks_layer_1.error(`[ERROR] ${name} newBlockHeaders`);
            logger.stacks_layer_1.error(err);
            return;
        }
        if (!res.number) {
            return;
        }

        global.monitor.setBlockTime();

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
                    logger.stacks_layer_1.info(`[${nodeConfig.name.toUpperCase()}] Get '${event.name}' event from block ${blockNumber}. length: ${events.length}`);
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

    // Get stacks transaction by transaction id
    const txid = data.bytes32s[1];
    let transaction = await stacks.getTransaction(txid).catch();
    if (!transaction || transaction.tx_status !== 'success') {
        logger.stacks_layer_1.error(`validateSwap error: STACKS transaction ${txid} is not applied to ledger or transaction execution failed.`);
        logger.stacks_layer_1.error(`result: ${JSON.stringify(transaction || {})}`);
        return;
    }

    if(!transaction.token_transfer || !transaction.token_transfer.memo) {
        logger.stacks_layer_1.error(`validateSwap error: STACKS transaction ${txid}, invalid destination tag`);
        return;
    }

    // Get receive wallet address
    let stacksWallet = govInfo.address;
    if (!stacksWallet) {
        logger.stacks_layer_1.error('validateSwap error: Cannot get stacks wallet address.');
        return;
    }

    // STEP 1: Check Payment Transaction
    if (transaction.tx_type.toLowerCase() !== 'token_transfer') {
        logger.stacks_layer_1.error(`validateSwap error: Transaction ${txid} is not payment transaction.`);
        return;
    }

    // STEP 2: Check Wallet Balance Changes
    const tokenTransfer = transaction.token_transfer;
    if (stacksWallet.toUpperCase() !== tokenTransfer.recipient_address.toUpperCase()) {
        logger.stacks_layer_1.error('validateSwap error: recipent address not matched.');
        return;
    }
    const amount = tokenTransfer.amount;
    if (amount !== data.uints[0].toString()) {
        logger.stacks_layer_1.error(`validateSwap error: Payment deliveredAmount is different with data.amount. Expected ${amount}, but got ${data.amount}`);
        return;
    }

    if (parseInt(data.uints[1]) !== 6){
        logger.stacks_layer_1.error(`validateSwap error: invalid decimal ${data.uints[1]}`);
        return;
    }

    // STEP 3: Check data
    let fromAddr = transaction.sender_address;
    fromAddr = `0x${createAddress(fromAddr).hash160}`;
    if(!fromAddr || fromAddr.length === 0){
        logger.stacks_layer_1.error(`validateSwap error: invalid fromAddr ${fromAddr}`);
        return;
    }

    let memo = tokenTransfer.memo;
    if (memo.type !== StacksMessageType.MemoString) {
        logger.stacks_layer_1.error(`validateSwap error: invalid memo ${memo}`);
        return;
    }
    memo = memo.content;
    let addrData = await addressBook.contract.methods.get(memo).call().catch(e => {return;});
    if (!addrData) {
        logger.stacks_layer_1.error(`validateSwap error: toAddr or toChain is not defined.`);
        return;
    }

    let toChain = addrData.toChain;
    let toAddr = addrData.toAddr;
    let transfortData = addrData.data || '0x';
    if (!toAddr || toAddr.length === 0 || !toChain || toChain.length === 0) {
        logger.stacks_layer_1.error(`validateSwap error: toAddr or toChain is not defined.`);
        return;
    }

    if(!stacks.isValidAddress(toChain, toAddr)){
        logger.stacks_layer_1.error(`Invalid toAddress ( ${toChain}, ${toAddr} )`);
        return;
    }

    // STEP 4: Tag validating
    let quorumCnt = await addressBook.multisig.contract.methods.required().call().catch();
    if (!quorumCnt) {
        logger.stacks_layer_1.error(`validateSwap error: mig required count invalid(${quorumCnt})`);
        return;
    }
    quorumCnt = parseInt(quorumCnt);
    const tagHash = Britto.sha256sol(packer.packStacksTagHash({
        toChain,
        toAddress: toAddr,
        transfortData,
    }));
    const validateCount = parseInt(await addressBook.multisig.contract.methods.validateCount(tagHash).call().catch(e => logger.stacks_layer_1.info(`validateSwap call mig fail. ${e}`)));
    if (validateCount < quorumCnt) {
        logger.stacks_layer_1.error(`validateSwap error: tag validatedCount less than vault wanted.`);
        return;
    }

    const owners = await addressBook.multisig.contract.methods.getOwnersWithPublicKey().call().catch();
    const publicKeys = owners["1"].map(key => { return key.replace("0x", ""); });
    // TODO: find out simpler way of get MultiSig StacksAddress from numSig,Pubkeys
    const unsigned = await makeUnsignedSTXTokenTransfer({
        recipient: stacksWallet, // dummy data
        amount: 1n, // dummy data
        numSignatures: quorumCnt,
        publicKeys,
        network: stacks.Network,
    });
    const signer = unsigned.auth.spendingCondition.signer;
    if (stacksWallet !== addressToString(addressFromVersionHash(stacks.AddressVersion, signer))) {
        logger.stacks_layer_1.error(`validateSwap error: mig is not stacksWallet ${stacksWallet}, ${signer}`);
        return;
    }

    let params = {
        hubContract: orbitHub.address,
        fromChain: chainName,
        toChain: toChain,
        fromAddr: fromAddr,
        toAddr: toAddr,
        token: '0x0000000000000000000000000000000000000000',
        bytes32s: [govInfo.id, data.bytes32s[1]],
        uints: [amount, 6],
        data: transfortData,
    }

    let currentBlock = await stacks.getCurrentBlock();
    if(!currentBlock)
        return console.error('No current block data.');

    let isConfirmed = parseInt(currentBlock) - parseInt(transaction.block_height) >= config.system.stacksConfirmCount;
    if(!isConfirmed){
        console.log(`tx(${data.bytes32s[1]}) is invalid. isConfirmed: ${isConfirmed}`);
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

    async function valid(swapData) {
        let sender = Britto.getRandomPkAddress();
        if(!sender || !sender.pk || !sender.address){
            logger.stacks_layer_1.error("Cannot Generate account");
            return;
        }

        let swapHash = Britto.sha256sol(packer.packSwapData(swapData));

        let toChainMig = await orbitHub.contract.methods.getBridgeMig(swapData.toChain, govInfo.id).call();
        let contract = new orbitHub.web3.eth.Contract(orbitHub.multisig.abi, toChainMig);

        let validators = await contract.methods.getHashValidators(swapHash.toString('hex').add0x()).call();
        for(var i = 0; i < validators.length; i++){
            if(validators[i].toLowerCase() === validator.address.toLowerCase()){
                logger.stacks_layer_1.error(`Already signed. validated swapHash: ${swapHash}`);
                return;
            }
        }
        let signature = Britto.signMessage(swapHash, validator.pk);

        let sigs = makeSigs(validator.address, signature);

        let params = [
            swapData.fromChain,
            swapData.toChain,
            swapData.fromAddr,
            swapData.toAddr,
            swapData.token,
            swapData.bytes32s,
            swapData.uints,
            swapData.data,
            sigs
        ];

        let txOptions = {
            gasPrice: orbitHub.web3.utils.toHex('0'),
            from: sender.address,
            to: orbitHub.address
        };

        let gasLimit = await orbitHub.contract.methods.validateSwap(...params).estimateGas(txOptions).catch(e => {
            logger.stacks_layer_1.error('validateSwap estimateGas error: ' + e.message)
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

    async function applyLimitation(gateKeeper, data) {
        let sender = Britto.getRandomPkAddress();
        if(!sender || !sender.pk || !sender.address){
            logger.stacks_layer_1.error("Cannot Generate account");
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
                logger.stacks_layer_1.error(`Already signed. applyLimitation: ${hash}`);
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
                logger.stacks_layer_1.error(`applyLimitation error: ${err.message}`);
                return;
            }

            logger.stacks_layer_1.info(`applyLimitation: ${thash}`);
            global.monitor && global.monitor.setProgress(chainName, 'applyLimitation', data.block);
        });
    }
}

function receiveTransactionSuggested(events) {
    for (let event of events) {

        if(event.returnValues.govId !== govInfo.id)
            continue;

        let returnValues = {
            govId: event.returnValues.govId,
            swapIndex: event.returnValues.swapIndex,
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

    let stacksWallet = await orbitHub.contract.methods.govWallets(govInfo.id).call().catch(console.error);
    if(!stacksWallet || stacksWallet.toLowerCase() !== govInfo.bytes.toLowerCase()) {
        logger.stacks_layer_1.error('validateTransactionSuggested error: Cannot get Stacks wallet address from Smart contract.');
        return;
    }

    let swapData = await stacksBridge.contract.methods.swapData(govInfo.id, data.swapIndex).call().catch(e => {return;});
    if (!swapData || swapData.toAddr.length === 0) {
        logger.stacks_layer_1.error('validateTransactionSuggested error: swapData is invalid.');
        return;
    }

    let swapDataArray = await stacksBridge.contract.methods.getSwapDataArray(govInfo.id, data.swapIndex).call().catch(e => {return;});
    if (!swapDataArray || swapDataArray.bytes32s.length === 0){
        logger.stacks_layer_1.error('validateTransactionSuggested error: swapData is invalid.');
        return;
    }

    let suggestion = await stacksBridge.contract.methods.getSuggestion(0, govInfo.id, data.suggestIndex).call().catch(e => {return;});
    if (!suggestion || parseInt(suggestion.fee) === 0 || parseInt(suggestion.swapIndex) !== parseInt(data.swapIndex)){
        logger.stacks_layer_1.error('validateTransactionSuggested error: invalid suggestion');
        return;
    }

    let validators = await stacksBridge.multisig.contract.methods.getOwnersWithPublicKey().call();
    let required = await stacksBridge.multisig.contract.methods.required().call() || 0;
    if (!validators || validators[0].length < required) {
        logger.stacks_layer_1.error('validateTransactionSuggested validation fail: Validators not enough.');
        return;
    }

    /////////////////////////////////
    // Validating fee and sequence //
    /////////////////////////////////

    stacksWallet = stacks.getMultiAddressFromHex(stacksWallet);
    let toAddr = stacks.getSingleAddressFromHex(swapData.toAddr);
    let nonce = await stacks.getNonce(stacksWallet);
    let memo = stacks.getMemo(swapData.executionData);

    // Step 1: Sequence Check
    let suggestionSeq = Number(suggestion.seq);
    if (nonce !== suggestionSeq || Number.isNaN(suggestionSeq)) {
        logger.stacks_layer_1.error(`validateTransactionSuggested validation fail: Account sequence is different. Require ${nonce}, but ${suggestionSeq}`);
        return;
    }

    // Step 2: Fee Check
    let fee;
    try {
        let unsignedTx = await stacks.makeUnsignedSTXTokenTransfer(nonce, validators[1], required, toAddr, memo, swapDataArray.uints[0]);
        fee = (await stacks.estimateFee(unsignedTx.serialize()));
    } catch (e) {
        logger.stacks_layer_1.error(`Disconnect. err: ${e.message}`);
        process.exit(2);
    }
    let maxFee = parseInt(fee) * 2;

    let suggestionFee = Number(suggestion.fee);
    if (fee > suggestionFee) {
        logger.stacks_layer_1.error(`validateTransactionSuggested validation fail: Small fee. Expected ${fee}, but ${suggestionFee}`);
        return;
    } else if (maxFee < suggestionFee) {
        logger.stacks_layer_1.error(`validateTransactionSuggested validation fail: Too many fee. Maximum is ${maxFee}, but ${suggestionFee}`);
        return;
    } else if (Number.isNaN(suggestionFee)) {
        logger.stacks_layer_1.error(`validateTransactionSuggested validation fail: Invalid SuggestionFee ${suggestion.fee}`);
        return;
    }

    const suggestHash = Britto.sha256sol(packer.packSuggestHash({
        contract: stacksBridge.address,
        govId: govInfo.id,
        suggestIndex: data.suggestIndex,
        swapIndex: suggestion.swapIndex,
        fee: suggestion.fee,
        seq: suggestion.seq
    }));

    let hashValidators = await stacksBridge.multisig.contract.methods.getHashValidators(suggestHash.toString('hex').add0x()).call();
    for(var i = 0; i < hashValidators.length; i++){
        if(hashValidators[i].toLowerCase() === validator.address.toLowerCase()){
            logger.stacks_layer_1.error(`Already signed. validated suggestIndex: ${data.suggestIndex}`);
            return;
        }
    }

    const signature = Britto.signMessage(suggestHash, validator.pk);

    valid();

    async function valid() {
        let sender = Britto.getRandomPkAddress();
        if(!sender || !sender.pk || !sender.address){
            logger.stacks_layer_1.error("Cannot Generate account");
            return;
        }

        let params = [
            govInfo.id,
            data.suggestIndex,
            validator.address,
            signature.v,
            signature.r,
            signature.s
        ];

        let txOptions = {
            gasPrice: stacksBridge.web3.utils.toHex('0'),
            from: sender.address,
            to: stacksBridge.address
        };

        let gasLimit = await stacksBridge.contract.methods.validateTransactionSuggested(...params).estimateGas(txOptions).catch(e => {
            logger.stacks_layer_1.error('validateTransactionSuggested estimateGas error: ' + e.message)
        });

        if (!gasLimit) {
            return;
        }

        txOptions.gasLimit = stacksBridge.web3.utils.toHex(FIX_GAS);

        let txData = {
            method: 'validateTransactionSuggested',
            args: params,
            options: txOptions
        };

        await txSender.sendTransaction(stacksBridge, txData, {address: sender.address, pk: sender.pk, timeout: 1});
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

    let stacksWallet = await orbitHub.contract.methods.govWallets(govInfo.id).call().catch(console.error);
    if(!stacksWallet || stacksWallet.toLowerCase() !== govInfo.bytes.toLowerCase()) {
        logger.stacks_layer_1.error('validateTransactionSelected error: Cannot get Stacks wallet address from Smart contract.');
        return;
    }

    let selection = await stacksBridge.contract.methods.getSuggestion(1, govInfo.id, data.selectionIndex).call().catch(e => {return;});
    if (!selection || parseInt(selection.fee) === 0){
        logger.stacks_layer_1.error('validateTransactionSelected error: invalid selection');
        return;
    }

    let swapData = await stacksBridge.contract.methods.swapData(govInfo.id, selection.swapIndex).call().catch(e => {return;});
    if (!swapData || swapData.toAddr.length === 0) {
        logger.stacks_layer_1.error('validateTransactionSelected error: swapData is invalid.');
        return;
    }

    let swapDataArray = await stacksBridge.contract.methods.getSwapDataArray(govInfo.id, selection.swapIndex).call().catch(e => {return;});
    if (!swapDataArray || swapDataArray.bytes32s.length === 0){
        logger.stacks_layer_1.error('validateTransactionSelected error: swapData is invalid.');
        return;
    }

    let validators = await stacksBridge.multisig.contract.methods.getOwnersWithPublicKey().call();
    let required = await stacksBridge.multisig.contract.methods.required().call() || 0;
    if (!validators || validators[0].length < required) {
        logger.stacks_layer_1.error('validateTransactionSuggested validation fail: Validators not enough.');
        return;
    }

    let order = 0;
    for(let sigHash of selection.sigHashs){
        if(sigHash === "0x0000000000000000000000000000000000000000000000000000000000000000"){
            break;
        }
        order++;
    }

    let index = selection.vaList.findIndex(x => x.toLowerCase() === validator.address.toLowerCase());
    if (index === -1 || order !== index){
        logger.stacks_layer_1.error(`skip ${data.selectionIndex} validateTransactionSelected. sigingOrder: ${order}, myIndex: ${index}`);
        return;
    }

    let toAddr = stacks.getSingleAddressFromHex(swapData.toAddr);
    let memo = stacks.getMemo(swapData.executionData);
    let unsignedTx = await stacks.makeUnsignedSTXTokenTransfer(selection.seq, validators[1], required, toAddr, memo, swapDataArray.uints[0]);
    if(!unsignedTx){
        logger.stacks_layer_1.error('validateTransactionSelected : makeUnsignedTransaction error');
        return;
    }
    unsignedTx.setFee(selection.fee);

    let signatureHash = await stacks.getInitialSigHash(unsignedTx);
    for(let i = 0; i < order; i++){
        let lastSigHash = selection.sigHashs[i];
        let lastSignature = await collectSignature(lastSigHash);
        if(!lastSignature){
            logger.stacks_layer_1.error('validateTransactionSelected : collectSignature error');
            return;
        }

        signatureHash = stacks.getCurrentSigHash(signatureHash, lastSignature, selection.fee, selection.seq);
    }

    let mySignatureHash = await stacks.getSigHashPreSign(signatureHash, unsignedTx.auth.authType, selection.fee, selection.seq);
    if (!mySignatureHash || Number(mySignatureHash) === 0) {
        logger.stacks_layer_1.error('validateTransactionSelected error: Invalid my signature hash.');
        return;
    }

    const signingHash = Britto.sha256sol(packer.packSigningHash({
        contract: stacksBridge.address,
        govId: govInfo.id,
        selectionIndex: data.selectionIndex,
        vaList: selection.vaList
    }));

    let hashValidators = await stacksBridge.multisig.contract.methods.getHashValidators(signingHash.toString('hex').add0x()).call();
    for(var i = 0; i < hashValidators.length; i++){
        if(hashValidators[i].toLowerCase() === validator.address.toLowerCase()){
            logger.stacks_layer_1.error(`Already signed. validated selectionIndex: ${data.selectionIndex}`);
            return;
        }
    }

    const signatures = {v: [], r: [], s: []}; // [0]: MySignatureHash signature, [1]: WithdrawHash signature
    let signature;

    signature = Britto.signMessage(mySignatureHash, validator.pk);
    signatures.v.push(signature.v);
    signatures.r.push(signature.r);
    signatures.s.push(signature.s);

    signature = Britto.signMessage(signingHash, validator.pk);
    signatures.v.push(signature.v);
    signatures.r.push(signature.r);
    signatures.s.push(signature.s);

    valid();

    async function valid() {
        let sender = Britto.getRandomPkAddress();
        if(!sender || !sender.pk || !sender.address){
            logger.stacks_layer_1.error("Cannot Generate account");
            return;
        }

        let params = [
            govInfo.id,
            data.selectionIndex,
            "0x"+mySignatureHash,
            validator.address,
            signatures.v,
            signatures.r,
            signatures.s
        ];

        let txOptions = {
            gasPrice: stacksBridge.web3.utils.toHex('0'),
            from: sender.address,
            to: stacksBridge.address
        };

        let gasLimit = await stacksBridge.contract.methods.validateTransactionSelected(...params).estimateGas(txOptions).catch(e => {
            logger.stacks_layer_1.error('validateTransactionSelected estimateGas error: ' + e.message)
        });

        if (!gasLimit) {
            return;
        }

        txOptions.gasLimit = stacksBridge.web3.utils.toHex(FIX_GAS);

        let txData = {
            method: 'validateTransactionSelected',
            args: params,
            options: txOptions
        };

        await txSender.sendTransaction(stacksBridge, txData, {address: sender.address, pk: sender.pk, timeout: 1});
        global.monitor && global.monitor.setProgress(chainName, 'validateTransactionSelected', data.block);
    }
}

function receiveAddressBookRelay(events) {
    for (let event of events) {
        let returnValues = {
            toChain: event.returnValues.toChain,
            toAddress: event.returnValues.toAddr,
            data: event.returnValues.data,
        };

        validateTagRequest({
            block: event.blockNumber,
            validator: {address: account.address, pk: account.pk},
            ...returnValues
        });
    }
}

async function validateTagRequest(data) {
    let validator = {...data.validator} || {};
    delete data.validator;

    let toChain = data.toChain;
    let toAddress = data.toAddress;
    let transfortData = data.data || '0x';
    if (!toAddress || toAddress.length === 0 || !toChain || toChain.length === 0) {
        logger.stacks_layer_1.error(`validateTagRequest error: toAddr or toChain is not defined.`);
        return;
    }

    if(!stacks.isValidAddress(toChain, toAddress)){
        logger.stacks_layer_1.error(`Invalid toAddress ( ${toChain}, ${toAddress} )`);
        return;
    }

    let packerData = {
        toChain,
        toAddress,
        transfortData,
    }

    let tagHash = Britto.sha256sol(packer.packStacksTagHash(packerData));

    let validators = await addressBook.multisig.contract.methods.getHashValidators(tagHash.toString('hex').add0x()).call();
    for(var i = 0; i < validators.length; i++){
        if(validators[i].toLowerCase() === validator.address.toLowerCase()){
            logger.stacks_layer_1.error(`Already signed. validated swapHash: ${tagHash}`);
            return;
        }
    }

    let signature = Britto.signMessage(tagHash, validator.pk);

    valid();

    async function valid() {
        let sender = Britto.getRandomPkAddress();
        if(!sender || !sender.pk || !sender.address){
            logger.stacks_layer_1.error("Cannot Generate account");
            return;
        }

        let params = [
            packerData.toChain,
            packerData.toAddress,
            packerData.transfortData,
            validator.address,
            signature.v,
            signature.r,
            signature.s
        ];

        let txOptions = {
            gasPrice: addressBook.web3.utils.toHex('0'),
            from: sender.address,
            to: addressBook.address
        };

        let gasLimit = await addressBook.contract.methods.set(...params).estimateGas(txOptions).catch(e => {
            logger.stacks_layer_1.error('validateTagRequest estimateGas error: ' + e.message)
        });
        if (!gasLimit) {
            return;
        }

        txOptions.gasLimit = addressBook.web3.utils.toHex(FIX_GAS);

        let txData = {
            method: 'set',
            args: params,
            options: txOptions
        };

        await txSender.sendTransaction(addressBook, txData, {address: sender.address, pk: sender.pk, timeout: 1});
        global.monitor && global.monitor.setProgress(chainName, 'validateTagRequest', data.block);
    }
}

function makeSigs(validator, signature){
    let va = stacks.padLeft(validator, 64);
    let v = stacks.padLeft(parseInt(signature.v).toString(16), 64);

    let sigs = [
        va,
        v,
        signature.r,
        signature.s
    ]

    return sigs;
}

async function collectSignature(signatureHash) {
    let v = await stacksBridge.multisig.contract.methods.vSigs(signatureHash, 0).call().catch(console.error);
    let r = await stacksBridge.multisig.contract.methods.rSigs(signatureHash, 0).call().catch(console.error);
    let s = await stacksBridge.multisig.contract.methods.sSigs(signatureHash, 0).call().catch(console.error);

    if (!v || !r || !s || Number(v) === 0 || Number(r) === 0 || Number(s) === 0)
        return;

    v = parseInt(v) == 27 ? "00" : "01";
    r = r.replace("0x","");
    s = s.replace("0x","");

    return v + r + s;
}

async function getBalance(tokenAddr) {
    let amount = 0;

    if(tokenAddr === "0x0000000000000000000000000000000000000000"){
        amount = await stacks.getBalance(govInfo.address);
    }

    return amount;
}

module.exports = {
    getBalance,
    initialize
}
