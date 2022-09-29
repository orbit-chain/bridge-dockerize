global.logger.evm = require('./logger');

const config = require(ROOT + '/config');

const Britto = require(ROOT + '/lib/britto');
const RPCAggregator = require(ROOT + '/lib/rpcAggregator');
const txSender = require(ROOT + '/lib/txsender');
const packer = require('./utils/packer');

const BridgeUtils = require(ROOT + '/lib/bridgeutils');
const bridgeUtils = new BridgeUtils();

const Web3 = require('web3');

const FIX_GAS = 99999999;

class EVMValidator {
    static makeSigs(validator, signature) {
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

    constructor(chain, _account) {
        if(chain.includes("-v2")) chain = chain.split("-")[0];

        if (!_account || !_account.address || !_account.pk) {
            throw Error('Invalid Ethereum Wallet Account');
        }
        this.account = _account;

        const chainName = this.chainName = chain.toUpperCase();
        this.loggerOpt = {
            chain: chainName,
        }
        this.chainLower = chain.toLowerCase();
        this.chainCamel = `${this.chainName[0]}${this.chainName.slice(1).toLowerCase()}`;

        monitor.address[chainName] = this.account.address;

        const govInfo = this.govInfo = config.governance;
        if(!govInfo || !govInfo.chain || !govInfo.address || !govInfo.bytes || !govInfo.id) {
            throw Error('Empty Governance Info');
        }

        const info = config.info[this.chainLower];

        let brittoConfig = {};
        if (govInfo.chain === chainName) {
            brittoConfig.address = govInfo.address;
            brittoConfig.abi = Britto.getJSONInterface({filename: "Vault"});
        } else {
            brittoConfig.address = info.CONTRACT_ADDRESS[`${this.chainCamel}MinterContract`];
            brittoConfig.abi = Britto.getJSONInterface({filename: "Minter"});
        }

        const rpcAggregator = this.rpcAggregator = new RPCAggregator(chainName, info.CHAIN_ID);
        const rpc = info.ENDPOINT.rpc;
        if (Array.isArray(rpc)) {
            for (const url of rpc) {
                rpcAggregator.addRpc(url, brittoConfig);
            }
        } else if (typeof rpc === "string") {
            rpcAggregator.addRpc(rpc, brittoConfig);
        } else {
            throw `Unsupported ${this.chainLower} Endpoints: ${rpc}`;
        }

        if(chainName === "KLAYTN" && info.ENDPOINT.isKas){
            const kas = info.ENDPOINT.Kas;
            const option = {
                headers: [
                    {name: 'Authorization', value: 'Basic ' + Buffer.from(kas.accessKeyId + ':' + kas.secretAccessKey).toString('base64')},
                    {name: 'x-chain-id', value: kas.chainId},
                ]
            };

            const node = Britto.getNodeConfigBase("mainnet");
            node.rpc = kas.rpc;
            node.web3 = new Web3(new Web3.providers.HttpProvider(kas.rpc, option));

            node.address = brittoConfig.address;
            node.abi = brittoConfig.abi;
            node.contract = new node.web3.eth.Contract(node.abi, node.address);
            node.peggingType = `${this.chainName}_kas`;

            rpcAggregator.addRpcWithBritto(node).then((connected) => {
                logger.info(`[KLAYTN_KAS] mainnet ${connected ? "connected" : "disconnected"} to ${kas.rpc}.`);
                global.monitor.setNodeConnectStatus(chainName + "_kas", kas.rpc, connected ? "connected" : "disconnected");
            });
        }

        if(rpcAggregator.length() === 0) {
            throw `Unsupported ${this.chainLower} Endpoints.`;
        }

        Britto.setAdd0x();
        Britto.setRemove0x();

        this.multisigABI = Britto.getJSONInterface({filename: 'multisig/Common'});

        this.hashMap = new Map();
        this.flushHashMap();
    }

    flushHashMap() {
        setTimeout(this.flushHashMap.bind(this), 1000 * 60 * 5);

        const now = parseInt(Date.now() / 1000);
        for (let [hash, obj] of this.hashMap.entries()) {
            if (obj.timestamp + 60 * 10 < now) {
                this.hashMap.delete(hash);
            }
        }
    }

    async parseEvent(blockNumber, nodeConfig, name) {
        let options = {
            filter: {},
            fromBlock: blockNumber,
            toBlock: blockNumber
        };

        let eventResults = await nodeConfig.contract.getPastEvents(name, options);

        global.monitor.setBlockNumber(this.chainName + '_MAINNET', blockNumber);

        return eventResults;
    }

    async getParams(mainnet, functionSig, tx, depositId) {
        const govInfo = this.govInfo;
        const loggerOpt = this.loggerOpt;

        let receipt = await mainnet.web3.eth.getTransactionReceipt(tx).catch(e => {});
        if (!receipt){
            logger.evm.error('No Transaction Receipt.', loggerOpt);
            return;
        }

        let events = await this.parseEvent(receipt.blockNumber, mainnet, functionSig);
        if (events.length == 0){
            logger.evm.error('Invalid Transaction.', loggerOpt);
            return;
        }

        let params = {};
        for(let event of events){
            if(event.address.toLowerCase() !== mainnet.address.toLowerCase()) continue;
            if(event.transactionHash.toLowerCase() !== tx.toLowerCase()) continue;
            if(parseInt(event.returnValues.depositId) !== parseInt(depositId)) continue;

            params = event.returnValues;
        }
        if(!params || Object.keys(params).length === 0) return;

        params.receiptBlock = receipt.blockNumber;
        params.eqCnt = 1;

        let currentBlock = await mainnet.web3.eth.getBlock("latest").catch(e => {
            logger.evm.error('getBlock("latest") execute error: ' + e.message, loggerOpt);
        });
        if(!currentBlock || !currentBlock.number) return;
        params.currentBlock = currentBlock;

        return params;
    }

    async validateRelayedData(data) {
        const orbitHub = instances.hub.getOrbitHub();
        const govInfo = this.govInfo;
        const loggerOpt = this.loggerOpt;

        const chainName = this.chainName;
        if(data.fromChain !== chainName){
            logger.evm.error(`Invalid request. ${data.fromChain}`, loggerOpt);
            return;
        }

        const nodes = await this.rpcAggregator.getNodes();
        if(!nodes || nodes.length === 0){
            logger.evm.error(`rpcAggregator getNodes error`, loggerOpt);
            return;
        }

        let functionSig = (govInfo.chain === chainName) ? "Deposit" : "SwapRequest";

        let res = [];
        for(let node of nodes){
            let target = await this.getParams(node, functionSig, data.bytes32s[1], data.uints[2]);
            if(!target || !target.toChain || !target.fromAddr || !target.toAddr || !target.token || !target.amount || !target.decimal || !target.depositId || !target.receiptBlock || !target.currentBlock){
                logger.evm.error("Invalid Transaction (event params)", loggerOpt);
                continue;
            }
            if(!target.data) target.data = "0x";
            res.push(target);
        }
        if(res.length === 0){
            logger.evm.error("getParams error", loggerOpt);
            return;
        }

        let len = res.length;
        for(let i = 0; i < len; i++){
            for(let j = i+1; j < len; j++){
                if(res[i].toChain === res[j].toChain
                    && res[i].fromAddr === res[j].fromAddr
                    && res[i].toAddr === res[j].toAddr
                    && res[i].token === res[j].token
                    && res[i].amount === res[j].amount
                    && res[i].decimal === res[j].decimal
                    && res[i].depositId === res[j].depositId
                    && res[i].data === res[j].data
                    && res[i].receiptBlock === res[j].receiptBlock
                ) {
                    res[i].eqCnt = res[i].eqCnt + 1;
                    res[j].eqCnt = res[j].eqCnt + 1;
                }
            }
        }
        res.sort((a,b) => { return b.eqCnt - a.eqCnt });

        let maxCnt = res[0].eqCnt;
        let requireCnt = parseInt(nodes.length/2) + 1;
        if(maxCnt < requireCnt){
            logger.evm.error("malicious rpc returns.", loggerOpt);
            return;
        }

        let params = {...res[0]};

        // Check deposit block confirmed
        const confirmCount = config.system[`${this.chainLower}ConfirmCount`] || 24;
        let isConfirmed = parseInt(params.currentBlock.number) - parseInt(params.receiptBlock) >= confirmCount;

        if(chainName === "ETH"){
            let difficulty = params.currentBlock.difficulty;
            let currentTotalDifficulty = params.currentBlock.totalDifficulty;
            let terminalTotalDifficulty = config.info.eth.ETH_TERMINAL_TOTAL_DIFFICULTY;
            if(!currentTotalDifficulty || !terminalTotalDifficulty || difficulty === undefined
                || (currentTotalDifficulty).dcomp(terminalTotalDifficulty) === -1
                || parseInt(difficulty) !== 0
            ){
                logger.evm.error(`currentTotalDifficulty is invalid. ${currentTotalDifficulty}`, loggerOpt);
                return;
            }

            let beaconBlock = await bridgeUtils.getBeaconBlock().catch(e => {
                logger.evm.error('getBeaconBlock() execute error: ' + e.message, loggerOpt);
            });
            if (!beaconBlock || !beaconBlock.data || !beaconBlock.data.message || !beaconBlock.data.message.body || !beaconBlock.data.message.body.execution_payload) return;

            let finalizedBlockNumber = parseInt(beaconBlock.data.message.body.execution_payload.block_number);
            if (isNaN(finalizedBlockNumber) || finalizedBlockNumber === 0) {
                logger.eth.error('get finalized block number error.');
                return;
            }

            isConfirmed = parseInt(params.receiptBlock) <= finalizedBlockNumber;
        }

        if(!isConfirmed){
            logger.evm.error(`depositId(${data.uints[2]}) is invalid. isConfirmed: ${isConfirmed}`, loggerOpt);
            return;
        }

        params.fromChain = chainName;
        params.uints = [params.amount, params.decimal, params.depositId];
        params.bytes32s = [govInfo.id, data.bytes32s[1]];

        const toInstance = instances[params.toChain.toLowerCase()];
        if(!toInstance){
            logger.evm.error(`${params.toChain} instance is not exist`, loggerOpt);
            return;
        }
        await toInstance.validateSwap(data, params);
    }

    async validateSwap(_, params){
        const validator = {address: this.account.address, pk: this.account.pk};

        const orbitHub = instances.hub.getOrbitHub();
        const chainName = this.chainName;
        const govInfo = this.govInfo;
        const loggerOpt = this.loggerOpt;
        const hashMap = this.hashMap;
        const multisigABI = this.multisigABI;

        if(chainName !== params.toChain){
            logger.evm.error(`Invalid toChain. ${chainName} : ${params.toChain}`, loggerOpt);
            return;
        }

        if(!this.isValidAddress(params.toAddr)){
            logger.evm.error(`Invalid toAddr. ${params.toAddr}`, loggerOpt);
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

        let gateKeeper = new orbitHub.web3.eth.Contract(orbitHub.gateKeeperABI, gateKeeperAddr);
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
                logger.evm.error("Cannot Generate account", {chain: chainName});
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
                data: data.data,
            }));
            if(hashMap.has(hash.toString('hex').add0x())){
                logger.evm.error(`Already signed. validated swapHash: ${hash.toString('hex').add0x()}`, {chain: chainName});
                return;
            }

            let toChainMig = await orbitHub.contract.methods.getBridgeMig(data.toChain, govInfo.id).call();
            let contract = new orbitHub.web3.eth.Contract(multisigABI, toChainMig);

            let validators = await contract.methods.getHashValidators(hash.toString('hex').add0x()).call();
            for(var i = 0; i < validators.length; i++){
                if(validators[i].toLowerCase() === validator.address.toLowerCase()){
                    logger.evm.error(`Already signed. validated swapHash: ${hash}`, {chain: chainName});
                    return;
                }
            }

            let signature = Britto.signMessage(hash, validator.pk);
            let sigs = EVMValidator.makeSigs(validator.address, signature);

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
                logger.evm.error('validateSwap estimateGas error: ' + e.message, {chain: chainName})
            });

            if (!gasLimit)
                return;

            txOptions.gasLimit = orbitHub.web3.utils.toHex(FIX_GAS);

            let txData = {
                method: 'validateSwap',
                args: params,
                options: txOptions
            };

            await txSender.sendTransaction(orbitHub, txData, {address: sender.address, pk: sender.pk, timeout: 1}).then(thash => {
                hashMap.set(hash.toString('hex').add0x(), {
                    txHash: thash,
                    timestamp: parseInt(Date.now() / 1000),
                })
            });
        }

        async function applyLimitation(gateKeeper, data) {
            let sender = Britto.getRandomPkAddress();
            if(!sender || !sender.pk || !sender.address){
                logger.evm.error("Cannot Generate account", {chain: chainName});
                return;
            }

            let hash = Britto.sha256WithEncode(packer.packLimitationData({
                fromChain: data.fromChain,
                toChain: data.toChain,
                token: data.token,
                bytes32s: data.bytes32s,
                uints: data.uints
            }));
            if(hashMap.has(hash.toString('hex').add0x())){
                logger.evm.error(`Already signed. validated limitationHash: ${hash.toString('hex').add0x()}`, {chain: chainName});
                return;
            }

            let hubMig = await orbitHub.contract.methods.getBridgeMig("HUB", govInfo.id).call();
            let migCon = new orbitHub.web3.eth.Contract(multisigABI, hubMig);

            let validators = await migCon.methods.getHashValidators(hash.toString('hex').add0x()).call();
            for(var i = 0; i < validators.length; i++){
                if(validators[i].toLowerCase() === validator.address.toLowerCase()){
                    logger.evm.error(`Already signed. applyLimitation: ${hash}`, {chain: chainName});
                    return;
                }
            }

            let signature = Britto.signMessage(hash, validator.pk);
            let sigs = EVMValidator.makeSigs(validator.address, signature);

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
                    logger.evm.error(`applyLimitation error: ${err.message}`, {chain: chainName});
                    return;
                }

                hashMap.set(hash.toString('hex').add0x(), {
                    txHash: thash,
                    timestamp: parseInt(Date.now() / 1000),
                })

                logger.evm.info(`applyLimitation: ${thash}`, {chain: chainName});
            });
        }
    }

    async validateRelayedNFTData(data) {
        const orbitHub = instances.hub.getOrbitHub();
        const govInfo = this.govInfo;
        const loggerOpt = this.loggerOpt;

        const chainName = this.chainName;
        if(data.fromChain !== chainName){
            logger.evm.error(`Invalid request. ${data.fromChain}`, loggerOpt);
            return;
        }

        const nodes = await this.rpcAggregator.getNodes();
        if(!nodes || nodes.length === 0){
            logger.evm.error(`rpcAggregator getNodes error`, loggerOpt);
            return;
        }

        let functionSig = (govInfo.chain === chainName) ? "DepositNFT" : "SwapRequestNFT";

        let res = [];
        for(let node of nodes){
            let target = await this.getParams(node, functionSig, data.bytes32s[1], data.uints[2]);
            if(!target || !target.toChain || !target.fromAddr || !target.toAddr || !target.token || !target.amount || !target.depositId || !target.tokenId || !target.receiptBlock || !target.currentBlock){
                logger.evm.error("Invalid Transaction (event params)", loggerOpt);
                continue;
            }
            if(!target.data) target.data = "0x";
            res.push(target);
        }
        if(res.length === 0){
            logger.evm.error("getParams error", loggerOpt);
            return;
        }

        let len = res.length;
        for(let i = 0; i < len; i++){
            for(let j = i+1; j < len; j++){
                if(res[i].toChain === res[j].toChain
                    && res[i].fromAddr === res[j].fromAddr
                    && res[i].toAddr === res[j].toAddr
                    && res[i].token === res[j].token
                    && res[i].amount === res[j].amount
                    && res[i].depositId === res[j].depositId
                    && res[i].tokenId === res[j].tokenId
                    && res[i].data === res[j].data
                    && res[i].receiptBlock === res[j].receiptBlock
                ) {
                    res[i].eqCnt = res[i].eqCnt + 1;
                    res[j].eqCnt = res[j].eqCnt + 1;
                }
            }
        }
        res.sort((a,b) => { return b.eqCnt - a.eqCnt });

        let maxCnt = res[0].eqCnt;
        let requireCnt = parseInt(nodes.length/2) + 1;
        if(maxCnt < requireCnt){
            logger.evm.error("malicious rpc returns.", loggerOpt);
            return;
        }

        let params = {...res[0]};

        // Check deposit block confirmed
        const confirmCount = config.system[`${this.chainLower}ConfirmCount`] || 24;
        let isConfirmed = parseInt(params.currentBlock.number) - parseInt(params.receiptBlock) >= confirmCount;

        if(chainName === "ETH"){
            let difficulty = params.currentBlock.difficulty;
            let currentTotalDifficulty = params.currentBlock.totalDifficulty;
            let terminalTotalDifficulty = config.info.eth.ETH_TERMINAL_TOTAL_DIFFICULTY;
            if(!currentTotalDifficulty || !terminalTotalDifficulty || difficulty === undefined
                || (currentTotalDifficulty).dcomp(terminalTotalDifficulty) === -1
                || parseInt(difficulty) !== 0
            ){
                logger.evm.error(`currentTotalDifficulty is invalid. ${currentTotalDifficulty}`, loggerOpt);
                return;
            }

            let beaconBlock = await bridgeUtils.getBeaconBlock().catch(e => {
                logger.evm.error('getBeaconBlock() execute error: ' + e.message, loggerOpt);
            });
            if (!beaconBlock || !beaconBlock.data || !beaconBlock.data.message || !beaconBlock.data.message.body || !beaconBlock.data.message.body.execution_payload) return;

            let finalizedBlockNumber = parseInt(beaconBlock.data.message.body.execution_payload.block_number);
            if (isNaN(finalizedBlockNumber) || finalizedBlockNumber === 0) {
                logger.eth.error('get finalized block number error.');
                return;
            }

            isConfirmed = parseInt(params.receiptBlock) <= finalizedBlockNumber;
        }

        if(!isConfirmed){
            logger.evm.error(`depositId(${data.uints[2]}) is invalid. isConfirmed: ${isConfirmed}`, loggerOpt);
            return;
        }

        params.fromChain = chainName;
        params.uints = [params.amount, params.tokenId, params.depositId];
        params.bytes32s = [govInfo.id, data.bytes32s[1]];

        const toInstance = instances[params.toChain.toLowerCase()];
        if(!toInstance){
            logger.evm.error(`${params.toChain} instance is not exist`, loggerOpt);
            return;
        }
        await toInstance.validateSwapNFT(data, params);
    }

    async validateSwapNFT(_, params){
        const validator = {address: this.account.address, pk: this.account.pk};

        const orbitHub = instances.hub.getOrbitHub();
        const chainName = this.chainName;
        const govInfo = this.govInfo;
        const loggerOpt = this.loggerOpt;
        const hashMap = this.hashMap;
        const multisigABI = this.multisigABI;

        if(chainName !== params.toChain){
            logger.evm.error(`Invalid toChain. ${chainName} : ${params.toChain}`, loggerOpt);
            return;
        }

        if(!this.isValidAddress(params.toAddr)){
            logger.evm.error(`Invalid toAddr. ${params.toAddr}`, loggerOpt);
            return;
        }

        await valid(params);

        async function valid(data) {
            let sender = Britto.getRandomPkAddress();
            if(!sender || !sender.pk || !sender.address){
                logger.evm.error("Cannot Generate account", loggerOpt);
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
            if(hashMap.has(hash.toString('hex').add0x())){
                logger.evm.error(`Already signed. validated swapHash: ${hash}`, loggerOpt);
                return;
            }

            let toChainMig = await orbitHub.contract.methods.getBridgeMig(data.toChain, govInfo.id).call();
            let contract = new orbitHub.web3.eth.Contract(multisigABI, toChainMig);

            let validators = await contract.methods.getHashValidators(hash.toString('hex').add0x()).call();
            for(var i = 0; i < validators.length; i++){
                if(validators[i].toLowerCase() === validator.address.toLowerCase()){
                    logger.evm.error(`Already signed. validated swapHash: ${hash}`, loggerOpt);
                    return;
                }
            }

            let signature = Britto.signMessage(hash, validator.pk);
            let sigs = EVMValidator.makeSigs(validator.address, signature);

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
                logger.evm.error('validateSwapNFT estimateGas error: ' + e.message, loggerOpt)
            });

            if (!gasLimit)
                return;

            txOptions.gasLimit = orbitHub.web3.utils.toHex(FIX_GAS);

            let txData = {
                method: 'validateSwapNFT',
                args: params,
                options: txOptions
            };

            await txSender.sendTransaction(orbitHub, txData, {address: sender.address, pk: sender.pk, timeout: 1}).then(thash => {
                hashMap.set(hash.toString('hex').add0x(), {
                    txHash: thash,
                    timestamp: parseInt(Date.now() / 1000),
                })
            });
        }
    }

    isValidAddress(toAddr) {
        return toAddr.slice(0,2) === "0x" && toAddr.length === 42;
    }

    ///////////////////////////////////////////////////////////////
    ///////// Governance Function

    async getTransaction(multisig, transactionId, decoder) {
        const orbitHub = instances.hub.getOrbitHub();
        const govInfo = this.govInfo;
        const info = config.info[this.chainLower];
        const mainnet = await this.rpcAggregator.select();
        const chainName = this.chainName;

        if(multisig.length !== 42) return "Invalid input";

        const mig = new mainnet.web3.eth.Contract(this.multisigABI, multisig);

        let transaction = await mig.methods.transactions(transactionId).call().catch(e => {return;});
        if(!transaction || transaction.destination === "0x0000000000000000000000000000000000000000") return "GetTransaction Error";

        let confirmedList = await mig.methods.getConfirmations(transactionId).call().catch(e => {return;});
        if(!confirmedList) return "GetConfirmations Error";

        let myConfirmation = !!(confirmedList.find(va => va.toLowerCase() === this.account.address.toLowerCase()));

        let required = await mig.methods.required().call().catch(e => {return;});
        if(!required) return "GetRequired Error";

        transaction.myConfirmation = myConfirmation;
        transaction.required = required;
        transaction.confirmedList = confirmedList;

        let knownContract = info.CONTRACT_ADDRESS;

        let destinationContract = "Unknown Contract";
        for (var key in knownContract){
            let addr = knownContract[key];
            if(!addr) continue;

            if(addr.toLowerCase() === transaction.destination.toLowerCase()){
                destinationContract = key;
                break;
            }
        }
        if(chainName === govInfo.chain && transaction.destination.toLowerCase() === govInfo.address.toLowerCase()){
            destinationContract = `${govInfo.chain} Vault`;
        }
        transaction.destinationContract = destinationContract;

        let decodedData = decoder.decodeMethod(transaction.data);
        if(!decodedData){
            decodedData = "Unknown Transaction Call Data";
        }
        transaction.decodedData = decodedData;

        return transaction;
    }

    async confirmTransaction(multisig, transactionId, gasPrice, chainId) {
        const orbitHub = instances.hub.getOrbitHub();
        const info = config.info[this.chainLower];
        const mainnet = await this.rpcAggregator.select();
        const validator = {address: this.account.address, pk: this.account.pk};

        const mig = new mainnet.web3.eth.Contract(this.multisigABI, multisig);

        let transaction = await mig.methods.transactions(transactionId).call().catch(e => {return;});
        if(!transaction || transaction.destination === "0x0000000000000000000000000000000000000000") return "GetTransaction Error";

        let confirmedList = await mig.methods.getConfirmations(transactionId).call().catch(e => {return;});
        if(!confirmedList) return "GetConfirmations Error";

        let myConfirmation = !!(confirmedList.find(va => va.toLowerCase() === validator.address.toLowerCase()));

        let required = await mig.methods.required().call().catch(e => {return;});
        if(!required) return "GetRequired Error";

        if(myConfirmation || parseInt(required) === parseInt(confirmedList.length))
            return "Already Confirmed"

        let txData = {
            from: validator.address,
            to: multisig,
            value: mainnet.web3.utils.toHex(0)
        }

        let gasLimit = await mig.methods.confirmTransaction(transactionId).estimateGas(txData).catch(e => {return;});
        if(!gasLimit) return "EstimateGas Error";

        let data = mig.methods.confirmTransaction(transactionId).encodeABI();
        if(!data) return;

        txData.data = data;

        gasLimit = this.chainName === "ORBIT" ? FIX_GAS : (parseInt(gasLimit) * 2).toString();
        txData.gasLimit = mainnet.web3.utils.toHex(gasLimit);

        let web3GasPrice = await mainnet.web3.eth.getGasPrice().catch(e => {return;});
        if(web3GasPrice) gasPrice = parseInt(web3GasPrice) > parseInt(gasPrice) ? web3GasPrice : gasPrice;
        gasPrice = this.chainName === "ORBIT" ? 0 : parseInt(gasPrice * 1.2);
        txData.gasPrice = mainnet.web3.utils.toHex(gasPrice);

        let nonce = await mainnet.web3.eth.getTransactionCount(validator.address, 'pending').catch(e => {return;});
        if(nonce === undefined || isNaN(parseInt(nonce))) return "GetNonce Error"
        txData.nonce = mainnet.web3.utils.toHex(nonce);

        if(info.CHAIN_ID) txData.chainId = info.CHAIN_ID;
        if(parseInt(chainId) !== 0) txData.chainId = chainId;

        let signedTx = await mainnet.web3.eth.accounts.signTransaction(txData, "0x"+validator.pk.toString('hex'));
        let tx = await mainnet.web3.eth.sendSignedTransaction(signedTx.rawTransaction).catch(e => {console.log(e)});
        if(!tx) return "SendTransaction Error";

        return tx.transactionHash;
    }

    async validateSigHash(multisig, sigHash) {
        if(this.chainName !== "ORBIT") return "Invalid Chain";
        if(multisig.length !== 42 || sigHash.length !== 66) return "Invalid Input";

        const orbitHub = instances.hub.getOrbitHub();
        const validator = {address: this.account.address, pk: this.account.pk};

        let mig = new orbitHub.web3.eth.Contract(this.multisigABI, multisig);

        let confirmedList = await mig.methods.getHashValidators(sigHash).call().catch(e => {return;});
        if(!confirmedList) return "GetHashValidators Error";

        let myConfirmation = !!(confirmedList.find(va => va.toLowerCase() === validator.address.toLowerCase()));

        let required = await mig.methods.required().call().catch(e => {return;});
        if(!required) return "GetRequired Error";

        if(myConfirmation || parseInt(required) === parseInt(confirmedList.length))
            return "Already Confirmed"


        let sender = Britto.getRandomPkAddress();
        if(!sender || !sender.pk || !sender.address){
            return "Cannot Generate account";
        }

        let signature = Britto.signMessage(sigHash, validator.pk);
        let params = [
            validator.address,
            sigHash,
            signature.v,
            signature.r,
            signature.s,
        ]

        let txData = {
            from: sender.address,
            to: multisig,
            value: orbitHub.web3.utils.toHex(0)
        }

        let gasLimit = await mig.methods.validate(...params).estimateGas(txData).catch(e => {return;});
        if(!gasLimit) return "EstimateGas Error";

        let data = mig.methods.validate(...params).encodeABI();
        if(!data) return "EncodeABI Error";

        txData.data = data;
        txData.gasLimit = orbitHub.web3.utils.toHex(FIX_GAS);
        txData.gasPrice = orbitHub.web3.utils.toHex(0);
        txData.nonce = orbitHub.web3.utils.toHex(0);

        let signedTx = await orbitHub.web3.eth.accounts.signTransaction(txData, "0x"+sender.pk.toString('hex'));
        let tx = await orbitHub.web3.eth.sendSignedTransaction(signedTx.rawTransaction).catch(e => {console.log(e)});
        if(!tx) return "SendTransaction Error";

        return tx.transactionHash;
    }
    ///////////////////////////////////////////////////////////////
}

module.exports = EVMValidator;
