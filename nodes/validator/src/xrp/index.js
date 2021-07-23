global.logger.xrp = require('./logger');

const ethUtil = require('ethereumjs-util');
const config = require(ROOT + '/config');
const Britto = require(ROOT + '/lib/britto');
const txSender = require(ROOT + '/lib/txsender');
const packer = require('./utils/packer');
const BridgeUtils = require('./utils/xrp.bridgeutils');
const ripple = require('./utils/ripple.api');

const bridgeUtils = new BridgeUtils();

const FIX_GAS = 99999999;

let lastBlockNum = {
    orbitHub: null,
    xrpBridge: null
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
        name: 'XrpTransactionSuggested',
        callback: receiveTransactionSuggested
    },
    {
        name: 'XrpTransactionSelected',
        callback: receiveTransactionSelected
    }
];

let addressBookEventList = [
    {
        name: 'Relay',
        callback: receiveAddressBookRelay,
    }
]

const chainName = 'XRP';
const orbitHub = Britto.getNodeConfigBase('orbitHub');
const xrpBridge = Britto.getNodeConfigBase('xrpBridge');
const addressBook = Britto.getNodeConfigBase('xrpAddressBook');

let govInfo;

let reconnectHandle;
let tryReconnect = () =>{
    if (ripple.isConnected()) {
        logger.info("Web4 recovered : " + config.ripple.ws);
        if (reconnectHandle)
            clearInterval(reconnectHandle);
        reconnectHandle = null;
        return;
    }
    if (ripple.__tryreconnect >= 100) {
        logger.error("program exit cause ripple connection lost to " + config.ripple.ws);
        process.exit(2);
    } else {
        ripple.__tryreconnect++;
        logger.warn("try reconnect to " + config.ripple.ws + "(" + ripple.__tryreconnect + ")");
        ripple.connect();
    }
}

function initialize(_account) {
    if (!_account || !_account.address || !_account.pk)
        throw 'Invalid Ethereum Wallet Account';

    account = _account;

    govInfo = config.governance;
    if(!govInfo || !govInfo.chain || !govInfo.address || !govInfo.bytes || !govInfo.id)
        throw 'Empty Governance Info';

    ripple.__tryreconnect = 0;

    ripple.on('disconnected', (code) => {
        global.monitor.setNodeConnectStatus(chainName, config.ripple.ws, "disconnected");
        if (code !== 1000) {
            if (reconnectHandle)
                clearInterval(reconnectHandle);
            reconnectHandle = setInterval(() => {
                tryReconnect();
            }, 5000);
            tryReconnect();
        }
    });

    ripple.on("connected", () => {
        ripple.__tryreconnect = 0;
        global.monitor.setNodeConnectStatus(chainName, config.ripple.ws, "connected");
        logger.info(`[${chainName}] web4 connected to ${config.ripple.ws}`);

        if(monitor.address[chainName]) return;
        monitor.address[chainName] = bridgeUtils.getKeyPair(account.pk).address;

        orbitHub.ws = config.rpc.OCHAIN_WS;
        orbitHub.rpc = config.rpc.OCHAIN_RPC;
        orbitHub.address = config.contract.ORBIT_HUB_CONTRACT;
        orbitHub.abi = Britto.getJSONInterface({filename: 'OrbitHub.abi', version: 'v2'});

        xrpBridge.ws = config.rpc.OCHAIN_WS;
        xrpBridge.rpc = config.rpc.OCHAIN_RPC;
        xrpBridge.address = config.contract.XRP_BRIDGE_CONTRACT;
        xrpBridge.abi = Britto.getJSONInterface({filename: 'XrpBridge.abi', version: 'v2'});

        addressBook.ws = config.rpc.OCHAIN_WS;
        addressBook.rpc = config.rpc.OCHAIN_RPC;
        addressBook.address = config.contract.XRP_ADDRESS_BOOK;
        addressBook.abi = Britto.getJSONInterface({filename: 'XrpAddressBook.abi', version: 'v2'});

        orbitHub.onconnect = () => {
            startSubscription(orbitHub, hubEventList)
        };

        xrpBridge.onconnect = () => {
            startSubscription(xrpBridge, bridgeEventList);
        };

        addressBook.onconnect = () => {
            startSubscription(addressBook, addressBookEventList);
        }

        global.monitor.setNodeConnectStatus(chainName, orbitHub.ws, "connecting");
        new Britto(orbitHub, chainName).connectWeb3();
        new Britto(xrpBridge, chainName).connectWeb3();
        new Britto(addressBook, chainName).connectWeb3();

        orbitHub.multisig.wallet = config.contract.ORBIT_HUB_MULTISIG;
        orbitHub.multisig.abi = Britto.getJSONInterface({filename: 'MessageMultiSigWallet.abi', version: 'v2'});
        orbitHub.multisig.contract = new orbitHub.web3.eth.Contract(orbitHub.multisig.abi, orbitHub.multisig.wallet);

        xrpBridge.multisig.wallet = config.contract.XRP_BRIDGE_MULTISIG;
        xrpBridge.multisig.abi = Britto.getJSONInterface({filename: 'XrpMessageMultiSigWallet.abi', version: 'v2'});
        xrpBridge.multisig.contract = new xrpBridge.web3.eth.Contract(xrpBridge.multisig.abi, xrpBridge.multisig.wallet);

        addressBook.multisig.wallet = config.contract.XRP_BRIDGE_MULTISIG;
        addressBook.multisig.abi = Britto.getJSONInterface({filename: 'XrpMessageMultiSigWallet.abi', version: 'v2'});
        addressBook.multisig.contract = new addressBook.web3.eth.Contract(addressBook.multisig.abi, addressBook.multisig.wallet);
    });

    logger.info(`[${chainName}] web4 connecting to ${config.ripple.ws}`);
    global.monitor.setNodeConnectStatus(chainName, config.ripple.ws, "connecting");

    ripple.connect().catch(e => {
        logger.error('Ripple API connection error: ' + e.message);
        global.monitor.setNodeConnectStatus(chainName, config.ripple.ws, "disconnected");

        if (reconnectHandle)
            clearInterval(reconnectHandle);
        reconnectHandle = setInterval(() => {
            tryReconnect();
        }, 5000);
        tryReconnect();
    });
}

function startSubscription(node, eventList) {
    subscribeNewBlock(node.web3, node.name, blockNumber => {
        getEvent(blockNumber, node, eventList);
    });
}

function subscribeNewBlock(web3, name, callback) {
    web3.eth.subscribe('newBlockHeaders', (err, res) => {
        if (err) {
            logger.xrp.error(`[ERROR] ${name} newBlockHeaders`);
            logger.xrp.error(err);
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
                    logger.xrp.info(`[${nodeConfig.name.toUpperCase()}] Get '${event.name}' event from block ${blockNumber}. length: ${events.length}`);
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

    // Get ripple transaction by transaction id
    const txid = data.bytes32s[1].replace('0x', '').toUpperCase();
    let transaction = await ripple.getTransaction(txid).catch();
    if (!transaction || !transaction.outcome || transaction.outcome.result !== 'tesSUCCESS') {
        logger.xrp.error(`validateSwap error: Ripple transaction ${txid} is not applied to ledger or transaction execution failed.`);
        logger.xrp.error(`result: ${JSON.stringify(transaction || {})}`);
        return;
    }

    if(!transaction.specification || !transaction.specification.destination || !transaction.specification.destination.tag) {
        logger.xrp.error(`validateSwap error: Ripple transaction ${txid}, invalid destination tag`);
        return;
    }

    // Get receive wallet address
    let xrpWallet = govInfo.address;
    if (!xrpWallet) {
        logger.xrp.error('validateSwap error: Cannot get xrp wallet address.');
        return;
    }

    // STEP 1: Check Payment Transaction
    if (transaction.type.toLowerCase() !== 'payment') {
        logger.xrp.error(`validateSwap error: Transaction ${txid} is not payment transaction.`);
        return;
    }

    // STEP 2: Check Wallet Balance Changes
    let balanceChanges = transaction.outcome.balanceChanges[xrpWallet];
    let amount = '0';
    for (let balanceChange of balanceChanges) {
        if (balanceChange.currency.toUpperCase() !== 'XRP')
            continue;

        amount = amount.dadd(balanceChange.value).dmove(6);
    }

    if (amount !== data.uints[0].toString()) {
        logger.xrp.error(`validateSwap error: Payment deliveredAmount is different with data.amount. Expected ${amount}, but got ${data.amount}`);
        return;
    }

    if (parseInt(data.uints[1]) !== 6){
        logger.xrp.error(`validateSwap error: invalid decimal ${data.uints[1]}`);
        return;
    }

    // STEP 3: Check data
    let fromAddr = transaction.specification.source.address;
    fromAddr = bridgeUtils.getAddressToHex(fromAddr);
    if(!fromAddr || fromAddr.length === 0){
        logger.xrp.error(`validateSwap error: invalid fromAddr ${data.fromAddr}`);
        return;
    }

    let destinationTag = transaction.specification.destination.tag;

    let addrData = await addressBook.contract.methods.get(destinationTag).call().catch(e => {return;});
    if (!addrData) {
        logger.xrp.error(`validateSwap error: toAddr or toChain is not defined.`);
        return;
    }

    let toChain = addrData.toChain;
    let toAddr = addrData.toAddr;
    let transfortData = addrData.data || '0x';
    if (!toAddr || toAddr.length === 0 || !toChain || toChain.length === 0) {
        logger.xrp.error(`validateSwap error: toAddr or toChain is not defined.`);
        return;
    }

    if(!bridgeUtils.isValidAddress(toChain, toAddr)){
        logger.xrp.error(`Invalid toAddress ( ${params.toChain}, ${params.toAddr} )`);
        return;
    }

    // STEP 4: Tag validating
    const vaultInfo = await ripple.getVaultInfos(xrpWallet);
    if (!vaultInfo || !vaultInfo.SignerEntries) {
        logger.xrp.error(`validateSwap error: vault info not found.`);
        return;
    }
    const quorumCnt = parseInt(vaultInfo.SignerQuorum);
    const tagHash = Britto.sha256sol(packer.packXrpTagHash({
        toChain,
        toAddress: toAddr,
        transfortData,
    }));
    const validateCount = parseInt(await addressBook.multisig.contract.methods.validateCount(tagHash).call().catch(e => logger.xrp.info(`validateSwap call mig fail. ${e}`)));
    if (validateCount < quorumCnt) {
        logger.xrp.error(`validateSwap error: tag validatedCount less than vault wanted.`);
        return;
    }

    let addressObj = [];
    vaultInfo.SignerEntries.forEach(entry => {
        addressObj[entry.SignerEntry.Account] = true;
    })
    let cnt = 0;
    for (let i=0; i < validateCount; i++) {
        const v = await addressBook.multisig.contract.methods.vSigs(tagHash, i).call().catch(e => logger.xrp.info(`validateSwap call mig fail. ${e}`));
        const r = await addressBook.multisig.contract.methods.rSigs(tagHash, i).call().catch(e => logger.xrp.info(`validateSwap call mig fail. ${e}`));
        const s = await addressBook.multisig.contract.methods.sSigs(tagHash, i).call().catch(e => logger.xrp.info(`validateSwap call mig fail. ${e}`));
        const xrpAddr = bridgeUtils.getAddress(bridgeUtils.recoverPubKey(tagHash, v, r, s));
        if (addressObj[xrpAddr]) {
            cnt++;
        }
        delete addressObj[xrpAddr];
    }
    if (cnt < quorumCnt) {
        logger.xrp.error(`validateSwap error: validated address not matched in vault signer addresses`);
        return;
    }

    let swapData = {
        hubContract: orbitHub.address,
        fromChain: 'XRP',
        toChain: toChain,
        fromAddr: fromAddr,
        toAddr: toAddr,
        token: '0x0000000000000000000000000000000000000000',
        bytes32s: [govInfo.id, data.bytes32s[1]],
        uints: [amount, 6],
        data: transfortData,
    }

    let swapHash = Britto.sha256sol(packer.packSwapData(swapData));

    let toChainMig = await orbitHub.contract.methods.getBridgeMig(toChain, govInfo.id).call();
    let contract = new orbitHub.web3.eth.Contract(orbitHub.multisig.abi, toChainMig);

    let validators = await contract.methods.getHashValidators(swapHash.toString('hex').add0x()).call();
    for(var i = 0; i < validators.length; i++){
        if(validators[i].toLowerCase() === validator.address.toLowerCase()){
            logger.xrp.error(`Already signed. validated swapHash: ${swapHash}`);
            return;
        }
    }
    let signature = Britto.signMessage(swapHash, validator.pk);

    let curBalance = await monitor.getBalance("0x0000000000000000000000000000000000000000");
    if(!curBalance || curBalance === 0 || Number.isNaN(curBalance)){
        logger.xrp.error("getBalance error (0x0000000000000000000000000000000000000000)");
        return;
    }

    let isValidAmount = curBalance >= parseInt(amount);
    if(isValidAmount){
        valid();
    }
    else{
        console.log(`tx(${data.bytes32s[1]}) is invalid. isValidAmount: ${isValidAmount}`);
        return;
    }

    async function valid() {
        let sender = Britto.getRandomPkAddress();
        if(!sender || !sender.pk || !sender.address){
            logger.xrp.error("Cannot Generate account");
            return;
        }

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
            logger.xrp.error('validateSwap estimateGas error: ' + e.message)
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

    let xrpWallet = await orbitHub.contract.methods.govWallets(govInfo.id).call().catch(console.error);
    if(!xrpWallet || xrpWallet.toLowerCase() !== govInfo.bytes.toLowerCase()) {
        logger.xrp.error('validateTransactionSuggested error: Cannot get Xrp wallet address from Smart contract.');
        return;
    }

    let swapData = await xrpBridge.contract.methods.swapData(govInfo.id, data.swapIndex).call().catch(e => {return;});
    if (!swapData || swapData.toAddr.length === 0) {
        logger.xrp.error('validateTransactionSuggested error: swapData is invalid.');
        return;
    }

    let swapDataArray = await xrpBridge.contract.methods.getSwapDataArray(govInfo.id, data.swapIndex).call().catch(e => {return;});
    if (!swapDataArray || swapDataArray.bytes32s.length === 0){
        logger.xrp.error('validateTransactionSuggested error: swapData is invalid.');
        return;
    }

    xrpWallet = bridgeUtils.getAddressFromHex(xrpWallet);
    let toAddr = bridgeUtils.getAddressFromHex(swapData.toAddr);

    let suggestion = await xrpBridge.contract.methods.getSuggestion(0, govInfo.id, data.suggestIndex).call().catch(e => {return;});
    if (!suggestion || parseInt(suggestion.fee) === 0 || parseInt(suggestion.swapIndex) !== parseInt(data.swapIndex)){
        logger.xrp.error('validateTransactionSuggested error: invalid suggestion');
        return;
    }

    let validators = await xrpBridge.multisig.contract.methods.getOwners().call();
    if(suggestion.validators.length !== validators.length){
        logger.xrp.error('validateTransactionSuggested error: invalid validator list');
        return;
    }

    /////////////////////////////////
    // Validating fee and sequence //
    /////////////////////////////////

    let accountInfo = await ripple.getAccountInfo(xrpWallet);
    if (!accountInfo) {
        logger.xrp.error('validateTransactionSuggested error: Invalid account info');
        return;
    }

    let accountObj = await ripple.getAccountObjects(xrpWallet);
    if (!accountObj) {
        logger.xrp.error('validateTransactionSuggested error: Invalid account objects');
        return;
    }

    let currentSeq = accountInfo.sequence || 0;
    let quorumCount = accountObj['account_objects'][0].SignerQuorum || 0;
    let required = await xrpBridge.multisig.contract.methods.required().call() || 0;

    if (!validators || validators.length < quorumCount) {
        logger.xrp.error('validateTransactionSuggested validation fail: Validators not enough.');
        return;
    }

    // Step 1: Sequence Check
    if (currentSeq !== Number(suggestion.seq)) {
        logger.xrp.error(`validateTransactionSuggested validation fail: Account sequence is different. Require ${currentSeq}, but ${suggestion.seq}`);
        return;
    }

    // Step 2: Fee Check
    let networkFee = await ripple.getFee() || 0.000012;
    networkFee = networkFee < 1 ? (networkFee * 10 ** 6) : networkFee; // fee unit is drops. NOT XRP.

    let expectFee = networkFee * (1 + Math.max(quorumCount, Number(required)));
    if (expectFee > Number(suggestion.fee)) {
        logger.xrp.error(`validateTransactionSuggested validation fail: Small fee. Expected ${expectFee}, but ${suggestion.fee}`);
        return;
    } else if (expectFee * 1.25 < Number(suggestion.fee)) {
        logger.xrp.error(`validateTransactionSuggested validation fail: Too many fee. Maximum is ${expectFee * 1.25}, but ${suggestion.fee}`);
        return;
    }

    let memos = bridgeUtils.getReleaseMemo(govInfo.id, data.swapIndex);

    const paymentTx = {
        TransactionType: 'Payment',
        Account: xrpWallet,
        Destination: toAddr,
        Amount: swapDataArray.uints[0].toString(),
        Flags: 2147483648,
        Fee: suggestion.fee,
        Sequence: suggestion.seq,
        SigningPubKey: '',
        Memos: memos
    };

    if (swapData.executionData)
        paymentTx.DestinationTag = parseInt(swapData.executionData);

    ////////////////////////////////
    // Validating signature hashs //
    ////////////////////////////////

    for (let va of validators) {
        let id = await xrpBridge.multisig.contract.methods.xrpAddresses(va).call();
        if (!id) {
            logger.xrp.error('validateTransactionSuggested validation fail: No matched xrp address of ' + va);
            return;
        }

        let xrpAddress = bridgeUtils.getAddressFromHex(id);
        let signatureHash = '0x' + bridgeUtils.getSignatureHash(paymentTx, xrpAddress);
        let index = suggestion.signatureHashs.findIndex(x => x.toLowerCase() === signatureHash.toLowerCase());

        if (index === -1 || suggestion.validators[index].toLowerCase() !== va.toLowerCase()) {
            logger.xrp.error('validateTransactionSuggested validation fail: No matched signature hash. ' + `Expected hash: ${signatureHash}, validator: ${va}`);
            return;
        }
    }

    const suggestHash = Britto.sha256sol(packer.packSuggestHash({
        contract: xrpBridge.address,
        govId: govInfo.id,
        suggestIndex: data.suggestIndex,
        swapIndex: suggestion.swapIndex,
        validators: suggestion.validators,
        signatureHashs: suggestion.signatureHashs,
        fee: suggestion.fee,
        seq: suggestion.seq
    }));

    let hashValidators = await xrpBridge.multisig.contract.methods.getHashValidators(suggestHash.toString('hex').add0x()).call();
    for(var i = 0; i < hashValidators.length; i++){
        if(hashValidators[i].toLowerCase() === validator.address.toLowerCase()){
            logger.xrp.error(`Already signed. validated suggestIndex: ${data.suggestIndex}`);
            return;
        }
    }

    const signature = Britto.signMessage(suggestHash, validator.pk);

    valid();

    async function valid() {
        let sender = Britto.getRandomPkAddress();
        if(!sender || !sender.pk || !sender.address){
            logger.xrp.error("Cannot Generate account");
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
            gasPrice: xrpBridge.web3.utils.toHex('0'),
            from: sender.address,
            to: xrpBridge.address
        };

        let gasLimit = await xrpBridge.contract.methods.validateTransactionSuggested(...params).estimateGas(txOptions).catch(e => {
            logger.xrp.error('validateTransactionSuggested estimateGas error: ' + e.message)
        });

        if (!gasLimit) {
            return;
        }

        txOptions.gasLimit = xrpBridge.web3.utils.toHex(FIX_GAS);

        let txData = {
            method: 'validateTransactionSuggested',
            args: params,
            options: txOptions
        };

        await txSender.sendTransaction(xrpBridge, txData, {address: sender.address, pk: sender.pk, timeout: 1});
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

    let xrpWallet = await orbitHub.contract.methods.govWallets(govInfo.id).call().catch(console.error);
    if(!xrpWallet || xrpWallet.toLowerCase() !== govInfo.bytes.toLowerCase()) {
        logger.xrp.error('validateTransactionSelected error: Cannot get Xrp wallet address from Smart contract.');
        return;
    }

    xrpWallet = bridgeUtils.getAddressFromHex(xrpWallet);

    // Get ripple account objects
    let accountObj = await ripple.getAccountObjects(xrpWallet);
    if (!accountObj) {
        logger.xrp.error('validateTransactionSelected error: Invalid account objects');
        return;
    }

    let quorumCount = accountObj['account_objects'][0].SignerQuorum || 0;

    // Get all validator addresses
    let validators = await xrpBridge.multisig.contract.methods.getOwners().call();
    if (!validators || validators.length < quorumCount) {
        logger.xrp.error('validateTransactionSelected error: Validators not enough.');
        return;
    }

    let selection = await xrpBridge.contract.methods.getSuggestion(1, govInfo.id, data.selectionIndex).call().catch(e => {return;});
    if (!selection || parseInt(selection.fee) === 0){
        logger.xrp.error('validateTransactionSelected error: invalid selection');
        return;
    }

    let index = selection.validators.findIndex(x => x.toLowerCase() === validator.address.toLowerCase());
    if (index === -1){
        logger.xrp.error('validateTransactionSelected error: invalid selection');
        return;
    }

    let mySignatureHash = selection.signatureHashs[index];
    if (!mySignatureHash || Number(mySignatureHash) === 0) {
        logger.xrp.error('validateTransactionSelected error: Invalid my signature hash. ' + `Validator: ${validator.address} - MySignatureHash: ${mySignatureHash}`);
        return;
    }

    const signingHash = Britto.sha256sol(packer.packSigningHash({
        contract: xrpBridge.address,
        govId: govInfo.id,
        selectionIndex: data.selectionIndex,
        signatureHashs: selection.signatureHashs
    }));

    let hashValidators = await xrpBridge.multisig.contract.methods.getHashValidators(signingHash.toString('hex').add0x()).call();
    for(var i = 0; i < hashValidators.length; i++){
        if(hashValidators[i].toLowerCase() === validator.address.toLowerCase()){
            logger.xrp.error(`Already signed. validated selectionIndex: ${data.selectionIndex}`);
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
            logger.xrp.error("Cannot Generate account");
            return;
        }

        let params = [
            govInfo.id,
            data.selectionIndex,
            validator.address,
            signatures.v,
            signatures.r,
            signatures.s
        ];

        let txOptions = {
            gasPrice: xrpBridge.web3.utils.toHex('0'),
            from: sender.address,
            to: xrpBridge.address
        };

        let gasLimit = await xrpBridge.contract.methods.validateTransactionSelected(...params).estimateGas(txOptions).catch(e => {
            logger.xrp.error('validateTransactionSelected estimateGas error: ' + e.message)
        });

        if (!gasLimit) {
            return;
        }

        txOptions.gasLimit = xrpBridge.web3.utils.toHex(FIX_GAS);

        let txData = {
            method: 'validateTransactionSelected',
            args: params,
            options: txOptions
        };

        await txSender.sendTransaction(xrpBridge, txData, {address: sender.address, pk: sender.pk, timeout: 1});
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
        logger.xrp.error(`validateTagRequest error: toAddr or toChain is not defined.`);
        return;
    }

    if(!bridgeUtils.isValidAddress(toChain, toAddress)){
        logger.xrp.error(`Invalid toAddress ( ${toChain}, ${toAddress} )`);
        return;
    }

    let packerData = {
        toChain,
        toAddress,
        transfortData,
    }

    let tagHash = Britto.sha256sol(packer.packXrpTagHash(packerData));

    let validators = await addressBook.multisig.contract.methods.getHashValidators(tagHash.toString('hex').add0x()).call();
    for(var i = 0; i < validators.length; i++){
        if(validators[i].toLowerCase() === validator.address.toLowerCase()){
            logger.xrp.error(`Already signed. validated swapHash: ${tagHash}`);
            return;
        }
    }

    let signature = Britto.signMessage(tagHash, validator.pk);

    valid();

    async function valid() {
        let sender = Britto.getRandomPkAddress();
        if(!sender || !sender.pk || !sender.address){
            logger.xrp.error("Cannot Generate account");
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
            logger.xrp.error('validateTagRequest estimateGas error: ' + e.message)
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
        amount = await ripple.getBalance(govInfo.address);
    }

    return amount;
}

module.exports = {
    getBalance,
    initialize
}
