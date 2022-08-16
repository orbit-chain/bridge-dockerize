global.logger.stacks_layer_2 = require('./logger');

const config = require(ROOT + '/config');
const settings = config.requireEnv("./settings");
const Britto = require(ROOT + '/lib/britto');
const txSender = require(ROOT + '/lib/txsender');
const packer = require('./utils/packer');
const BridgeUtils = require('./utils/stacks.bridgeutils');
const stacks = new BridgeUtils();
const { addressFromVersionHash, addressToString, createAddress, cvToValue, getAddressFromPrivateKey, makeUnsignedSTXTokenTransfer, StacksMessageType, bufferCV } = require("@stacks/transactions");

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

const chainName = 'STACKS';
const orbitHub = Britto.getNodeConfigBase('orbitHub');
const stacksBridge = Britto.getNodeConfigBase('stacksBridge');

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

    if(monitor.address["STACKS_LAYER_2"]) return;

    let key = account.pk;
    if(Buffer.isBuffer(key)) key = key.toString('hex');
    key = key.replace("0x", "") + "01";
    monitor.address["STACKS_LAYER_2"] = getAddressFromPrivateKey(key, stacks.TransactionVersion);

    orbitHub.ws = config.rpc.OCHAIN_WS;
    orbitHub.address = config.contract.ORBIT_HUB_CONTRACT;
    orbitHub.abi = Britto.getJSONInterface({filename: 'OrbitHub.abi', version: 'v2'});

    stacksBridge.ws = config.rpc.OCHAIN_WS;
    stacksBridge.address = settings.BridgeAddress.StacksBridgeContract;
    stacksBridge.abi = Britto.getJSONInterface({filename: 'StacksBridgeLayer2.abi', version: 'v2'});

    orbitHub.onconnect = () => {
        startSubscription(orbitHub, hubEventList)
    };

    stacksBridge.onconnect = () => {
    };

    global.monitor.setNodeConnectStatus(chainName, orbitHub.ws, "connecting");
    new Britto(orbitHub, chainName).connectWeb3();
    new Britto(stacksBridge, chainName).connectWeb3();

    orbitHub.multisig.wallet = config.contract.ORBIT_HUB_MULTISIG;
    orbitHub.multisig.abi = Britto.getJSONInterface({filename: 'StacksMessageMultiSigWallet.abi', version: 'v2'});
    orbitHub.multisig.contract = new orbitHub.web3.eth.Contract(orbitHub.multisig.abi, orbitHub.multisig.wallet);

    stacksBridge.multisig.wallet = settings.BridgeAddress.MessageMultiSigWallet.Stacks;
    stacksBridge.multisig.abi = Britto.getJSONInterface({filename: 'StacksMessageMultiSigWallet.abi', version: 'v2'});
    stacksBridge.multisig.contract = new stacksBridge.web3.eth.Contract(stacksBridge.multisig.abi, stacksBridge.multisig.wallet);
}

function startSubscription(node, eventList) {
    subscribeNewBlock(node.web3, node.name, blockNumber => {
        getEvent(blockNumber, node, eventList);
    });
}

function subscribeNewBlock(web3, name, callback) {
    web3.eth.subscribe('newBlockHeaders', (err, res) => {
        if (err) {
            logger.stacks_layer_2.error(`[ERROR] ${name} newBlockHeaders`);
            logger.stacks_layer_2.error(err);
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
                    logger.stacks_layer_2.info(`[${nodeConfig.name.toUpperCase()}] Get '${event.name}' event from block ${blockNumber}. length: ${events.length}`);
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

    const txid = data.bytes32s[1];
    let transaction = await stacks.getTransaction(txid).catch();
    if (!transaction || transaction.tx_status !== 'success') {
        logger.stacks_layer_2.error(`validateSwap error: STACKS transaction ${txid} is not applied to ledger or transaction execution failed.`);
        logger.stacks_layer_2.error(`result: ${JSON.stringify(transaction || {})}`);
        return;
    }
    let params = {}
    let event;
    transaction.events.forEach(e => {
        if (e.event_type !== "smart_contract_log") {
            return;
        }
        const contractLog = e.contract_log;
        const cId = contractLog.contract_id;
        const [deployer , name] = cId.split(".");
        const stacksAddrs = settings.BridgeAddress.Stacks;
        if (stacksAddrs.DeployAddress.toLowerCase() !== deployer.toLowerCase()) {
            logger.stacks_layer_2.error(`Not support token: ${cId}`);
            return;
        }
        for (const [origin, tokenName] of Object.entries(stacksAddrs)) {
            if (name === tokenName) {
                params.token = origin;
                break;
            }
        }
        if (!params.token) {
            logger.stacks_layer_2.error(`Not support token: ${cId}`);
            return;
        }

        let decodeData = stacks.hexToCV(contractLog.value.hex).data;
        if(cvToValue(decodeData["deposit-id"]).toString() === data.uints[2]){
            event = decodeData;
        }
    });

    if(!event || !event["to-chain"] || !event["from-addr"] || !event["to-addr"] || !event["amount"] || !event["decimal"] || !event["deposit-id"]){
        logger.stacks_layer_2.error("Invalid Transaction (event params)");
        return;
    }

    const toChain = params.toChain = Buffer.from(cvToValue(event["to-chain"]).replace("0x", ""), "hex").toString();
    const toAddr = params.toAddr = cvToValue(event["to-addr"]);
    if(!stacks.isValidAddress(toChain, toAddr)){
        logger.stacks_layer_2.error(`Invalid toAddress ( ${toChain}, ${toAddr} )`);
        return;
    }

    const amount = cvToValue(event.amount).toString();
    params.fromAddr = createAddress(transaction.sender_address).hash160.add0x().toLowerCase();
    params.fromChain = chainName;
    params.uints = [amount, parseInt(cvToValue(event.decimal)), cvToValue(event["deposit-id"]).toString()];
    params.bytes32s = [govInfo.id, data.bytes32s[1]];

    const latestBlock = await stacks.getLatestBlock();
    if (!latestBlock) {
        logger.stacks_layer_2.error('No current block data.');
        return;
    }
    // Check deposit block confirmed
    const isConfirmed = Number(latestBlock.height) - Number(transaction.block_height) >= config.system.stacksConfirmCount;
    if(!isConfirmed){
        logger.stacks_layer_2.info(`depositId(${params.uints[2]}) is invalid. isConfirmed: ${isConfirmed}`);
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

    async function valid(data) {
        let sender = Britto.getRandomPkAddress();
        if(!sender || !sender.pk || !sender.address){
            logger.stacks_layer_2.error("Cannot Generate account");
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
                logger.stacks_layer_2.error(`Already signed. validated swapHash: ${hash}`);
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
            logger.stacks_layer_2.error('validateSwap estimateGas error: ' + e.message)
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

    async function applyLimitation(gateKeeper, data) {
        let sender = Britto.getRandomPkAddress();
        if(!sender || !sender.pk || !sender.address){
            logger.stacks_layer_2.error("Cannot Generate account");
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
                logger.stacks_layer_2.error(`Already signed. applyLimitation: ${hash}`);
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
                logger.stacks_layer_2.error(`applyLimitation error: ${err.message}`);
                return;
            }

            logger.stacks_layer_2.info(`applyLimitation: ${thash}`);
            global.monitor && global.monitor.setProgress(chainName, 'applyLimitation', data.block);
        });
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

async function validateSwapData(data) {
    const txid = data.bytes32s[2];
    let transaction = await stacks.getTransaction(txid).catch();
    if (!transaction || transaction.tx_status !== 'success') {
        logger.stacks_layer_2.error(`validateSwap error: STACKS transaction ${txid} is not applied to ledger or transaction execution failed.`);
        logger.stacks_layer_2.error(`result: ${JSON.stringify(transaction || {})}`);
        return;
    }
    let event;
    transaction.events.forEach(e => {
        if (e.event_type !== "smart_contract_log") {
            return;
        }
        const contractLog = e.contract_log;
        const cId = contractLog.contract_id;
        const stacksAddrs = settings.BridgeAddress.Stacks;
        const contractName = stacksAddrs[data.token.toLowerCase()];
        if (!contractName) {
            logger.stacks_layer_2.error(`Not support token: ${data.token}`);
            return;
        }
        if (cId !== `${settings.BridgeAddress.Stacks.DeployAddress}.${contractName}`) {
            return;
        }
        event = stacks.hexToCV(contractLog.value.hex).data;
    });
    // Check all of swap-data valid
    const amount = parseInt(cvToValue(event.amount));
    if (amount !== parseInt(data.uints[0])) {
        logger.stacks_layer_2.error(`Invalid amount: (${amount}, ${data.uints[0]})`);
        return;
    }
    const decimals = parseInt(cvToValue(event.decimals));
    if (decimals !== parseInt(data.uints[1])) {
        logger.stacks_layer_2.error(`Invalid decimals: (${decimals}, ${data.uints[1]})`);
        return;
    }
    const depositId = parseInt(cvToValue(event["deposit-id"]));
    if (depositId !== parseInt(data.uints[2])) {
        logger.stacks_layer_2.error(`Invalid depositId: (${depositId}, ${data.uints[2]})`);
        return;
    }
    const dataId = parseInt(cvToValue(event["data-id"]));
    if (dataId !== parseInt(data.uints[3])) {
        logger.stacks_layer_2.error(`Invalid data-id: (${dataId}, ${data.uints[3]})`);
        return;
    }
    const fromAddr = cvToValue(event["from-addr"]);
    if(fromAddr.toLowerCase() !== data.fromAddr.toLowerCase()){
        logger.stacks_layer_2.error(`Invalid fromAddr: (${fromAddr}, ${data.fromAddr})`);
        return;
    }
    const toAddr = `0x${createAddress(cvToValue(event["to-addr"])).hash160}`;
    if (toAddr !== data.toAddr) {
        logger.stacks_layer_2.error(`Invalid toAddr: (${toAddr}, ${data.toAddr})`);
        return;
    }
    const fromChain = Buffer.from(cvToValue(event["from-chain"]).replace("0x", ""), "hex").toString();
    if (fromChain !== data.fromChain) {
        logger.stacks_layer_2.error(`Invalid fromChain: (${fromChain}, ${data.fromChain})`);
        return;
    }
    const govId = cvToValue(event["gov-id"]);
    if (govId !== data.bytes32s[0]) {
        logger.stacks_layer_2.error(`Invalid govId: (${govId}, ${data.bytes32s[0]})`);
        return;
    }
    const originHash = cvToValue(event["tx-hash"]);
    if (originHash !== data.bytes32s[1]) {
        logger.stacks_layer_2.error(`Invalid originHash: (${originHash}, ${data.bytes32s[1]})`);
        return;
    }
    const originToken = cvToValue(event.token);
    if (originToken.toLowerCase() !== data.token.toLowerCase()) {
        logger.stacks_layer_2.error(`Invalid originToken: (${originToken}, ${data.token})`);
        return;
    }
    const hubContract = cvToValue(event["hub-contract"]);
    if (hubContract !== settings.BridgeAddress.OrbitHubContract) {
        logger.stacks_layer_2.error(`Invalid hubContract: (${hubContract})`);
        return;
    }

    const hash = Britto.sha256sol(packer.packDataHash({
        hubContract: orbitHub.address,
        fromChain: data.fromChain,
        toChain: "STACKS",
        fromAddr: data.fromAddr,
        toAddr: data.toAddr,
        token: data.token,
        bytes32s: [data.bytes32s[0], data.bytes32s[1]],
        uints: data.uints,
        data: data.data,
    }));

    let res = await stacks.readContract(
        settings.BridgeAddress.Stacks.DeployAddress,
        settings.BridgeAddress.Stacks[data.token.toLowerCase()],
        "is-confirmed",
        [bufferCV(Buffer.from(hash.replace("0x",""), "hex"))],
        settings.BridgeAddress.Stacks.DeployAddress
    );
    if(!res || !res.type || res.type === 3){
        return;
    }

    return true;
}

module.exports = {
    initialize,
    validateSwapData,
}
