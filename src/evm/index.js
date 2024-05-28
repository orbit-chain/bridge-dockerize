global.logger.evm = require('./logger');

const config = require(ROOT + '/config');

const Britto = require(ROOT + '/lib/britto');
const RPCAggregator = require(ROOT + '/lib/rpcAggregator');
const txSender = require(ROOT + '/lib/txsender');
const api = require(ROOT + '/lib/api');
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
        this.orbitHub = config.orbitHub.address

        monitor.address[chainName] = this.account.address;

        const govInfo = this.govInfo = config.governance;
        if(!govInfo || !govInfo.chain || !govInfo.address || !govInfo.bytes || !govInfo.id) {
            throw Error('Empty Governance Info');
        }

        this.intervals = {
            getLockRelay: {
                handler: this.getLockRelay.bind(this),
                timeout: 1000 * 10,
                interval: null,
            }
        };

        const info = config.info[this.chainLower];

        let brittoConfig = {};
        if (govInfo.chain === chainName) {
            brittoConfig.address = govInfo.address;
            brittoConfig.abi = Britto.getJSONInterface({filename: "Vault"});
        } else {
            brittoConfig.address = info.CONTRACT_ADDRESS[`minter`];
            brittoConfig.abi = Britto.getJSONInterface({filename: "Minter"});
        }

        const rpcAggregator = this.rpcAggregator = new RPCAggregator(chainName, info.CHAIN_ID);
        let rpc = info.ENDPOINT.rpc;

        if(!Array.isArray(rpc) && typeof rpc !== "string") {
            throw `Unsupported ${this.chainLower} Endpoints: ${rpc}, Endpoints must be array or string.`;
        }

        rpc = Array.isArray(rpc) ? rpc : [ rpc ]

        let expandedNode = process.env[chainName] ? JSON.parse(process.env[chainName]) : undefined
        if(expandedNode && expandedNode.length > 0) {
            rpc = rpc.concat(expandedNode)
        }

        for (const url of rpc) {
            rpcAggregator.addRpc(url, brittoConfig);
        }

        if(chainName === "KLAYTN" && info.ENDPOINT.is_kas){
            const kas = info.ENDPOINT.kas;

            kas.accessKeyId = process.env.KAS_ACCESS_KEY_ID;
            kas.secretAccessKey = process.env.KAS_SECRET_ACCESS_KEY;

            if(kas.accessKeyId && kas.accessKeyId.length !== 0 && kas.secretAccessKey && kas.secretAccessKey.length !== 0){
                const option = {
                    headers: [
                        {name: 'Authorization', value: 'Basic ' + Buffer.from(kas.accessKeyId + ':' + kas.secretAccessKey).toString('base64')},
                        {name: 'x-chain-id', value: kas.chain_id},
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
        }

        if(rpcAggregator.length() === 0) {
            throw `Unsupported ${this.chainLower} Endpoints.`;
        }

        Britto.setAdd0x();
        Britto.setRemove0x();

        this.migAddress = info.CONTRACT_ADDRESS.multisig
        this.multisigABI = Britto.getJSONInterface({filename: 'multisig/Common'});

        this.hashMap = new Map();
        this.flushHashMap();

        this.workerStarted = false;
        this.startIntervalWorker();
    }

    startIntervalWorker() {
        if (this.workerStarted) {
            return;
        }
        this.workerStarted = true;

        this.getLockRelay();
    }

    intervalSet(obj) {
        if (obj.interval) return;
        obj.interval = setInterval(obj.handler.bind(this), obj.timeout);
    }

    intervalClear(obj) {
        clearInterval(obj.interval);
        obj.interval = null;
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

    async getLockRelay() {
        this.intervalClear(this.intervals.getLockRelay);

        try {
            let response = await api.bible.get(`/v1/api/${this.chainLower}/lock-relay`)
            if (response.success !== "success") {
                logger.evm.error(`lock-relay api error: ${response}`);
                return;
            }

            let info = response.info;
            if (!Array.isArray(info)) {
                logger.evm.error('Received data is not array.');
                return;
            }

            logger.evm.info(`LockRelay list ${info.length === 0 ? 'is empty.' : 'length: ' + info.length.toString()}`, this.loggerOpt);

            for (let result of info) {
                if (result.toChain === "ORBIT") continue;
                if (this.govInfo.chain.replace("_LAYER_1", "") === result.toChain) result.toChain = this.govInfo.chain;

                let data = {
                    fromChain: result.fromChain,
                    toChain: result.toChain,
                    fromAddr: bridgeUtils.str2hex(result.fromAddr),
                    toAddr: bridgeUtils.str2hex(result.toAddr),
                    token: bridgeUtils.str2hex(result.token) || "0x0000000000000000000000000000000000000000",
                    // relayThash: result.relayThash,  // stacks용...사용X
                    bytes32s: [this.govInfo.id, result.fromThash],
                    uints: [result.amount, result.decimals, result.depositId],
                    data: result.data
                };

                if (!bridgeUtils.isValidAddress(data.toChain, data.toAddr)) {
                    logger.evm.error(`Invalid toAddress ( ${data.toChain}, ${data.toAddr} )`, this.loggerOpt);
                    continue;
                }

                if (data.data && !bridgeUtils.isValidData(data.toChain, data.data)) {
                    logger.evm.error(`Invalid data ( ${data.toChain}, ${data.data} )`, this.loggerOpt);
                    continue;
                }
        
                // TODO: bypass 처리 OK
                // operator's relaySwap
                
                const nodes = await this.rpcAggregator.getNodes();
                if (!(await bridgeUtils.checkTransaction(nodes[0], data.bytes32s[1]))) continue;

                // stacks만 사용
                if (data.relayThash) {
                    const resp = await api.bible.get(`/v1/api/txevent/${data.toChain}/${data.relayThash}`);
                    const eventData = JSON.parse(resp.info.data);
                    const addSwapId = eventData.data.dataId;
                    data.bytes32s.push(data.relayThash);
                    data.uints.push(addSwapId);
                }

                if (data.toChain === "STACKS" && this.govInfo.chain === "STACKS") {
                    data.toChain = "STACKS_LAYER_1";
                }

                if (this.chainName === 'KLAYTN' && data.fromAddr.toLowerCase() === "0xdfcb0861d3cb75bb09975dce98c4e152823c1a0b") {
                    this.logger.info("[GUARD] BLOCK bridge");
                    continue;
                }

                await this.validateRelayedData(data);
            }
        } catch (e) {
            logger.evm.error('lock-relay api call error: ' + e.message, this.loggerOpt);
        } finally {
            this.intervalSet(this.intervals.getLockRelay);
        }
    }

    async parseLogs(contract, logs, name) {
        let receipts = [];
        for(let log of logs){
            if(log.address.toLowerCase() !== contract._address.toLowerCase()) continue;

            let receipt = contract._decodeEventABI.bind({
                name: "ALLEVENTS",
                jsonInterface: contract._jsonInterface
            })(log);
            receipts.push(receipt);
        }

        let eventResults = [];
        for(let receipt of receipts){
            if(receipt.event !== name) continue;

            eventResults.push(receipt);
        }

        return eventResults;
    }

    async getParams(mainnet, functionSig, tx, depositId) {
        const govInfo = this.govInfo;
        const loggerOpt = this.loggerOpt;

        let receipt = await mainnet.web3.eth.getTransactionReceipt(tx).catch(e => {});
        if (!receipt || !receipt.logs || receipt.logs.length === 0){
            logger.evm.error('No Transaction Receipt.', loggerOpt);
            return;
        }
        global.monitor.setBlockNumber(this.chainName + '_MAINNET', receipt.blockNumber);

        let events = await this.parseLogs(mainnet.contract, [...receipt.logs], functionSig).catch(e => {});
        if (!events || events.length == 0){
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

        const chainName = this.chainName;
        const loggerOpt = this.loggerOpt;
        const hashMap = this.hashMap;

        if(chainName !== params.toChain){
            logger.evm.error(`Invalid toChain. ${chainName} : ${params.toChain}`, loggerOpt);
            return;
        }

        if(!this.isValidAddress(params.toAddr)){
            logger.evm.error(`Invalid toAddr. ${params.toAddr}`, loggerOpt);
            return;
        }

        await valid(params, this.orbitHub);

        async function valid(data, orbitHubAddress) {
            let hash = Britto.sha256sol(packer.packSwapData({
                hubContract: orbitHubAddress,
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

            let res = await api.orbit.get(`/info/hash-info`, {whash: hash.toString('hex').add0x()})
            if(res.status === "success") {
                if(res.data.validators) {
                    for(var i = 0; i < res.data.validators.length; i++){
                        if(res.data.validators[i].toLowerCase() === validator.address.toLowerCase()){
                            logger.evm.error(`Already signed. validated swapHash: ${hash}`, {chain: chainName});
                            return;
                        }   
                    }
                }

                let signature = Britto.signMessage(hash, validator.pk);
                let sigs = EVMValidator.makeSigs(validator.address, signature);
                sigs[1] = parseInt(sigs[1],16)
    
                await api.validator.post(`/governance/validate`, {
                    from_chain: data.fromChain,
                    to_chain: data.toChain,
                    from_addr: data.fromAddr,
                    to_addr: data.toAddr,
                    token: data.token,
                    bytes32s: data.bytes32s,
                    uints: data.uints,
                    data: data.data,
                    hash,
                    v: sigs[1],
                    r: sigs[2],
                    s: sigs[3]
                });
    
                hashMap.set(hash.toString('hex').add0x(), {
                    txHash: hash,
                    timestamp: parseInt(Date.now() / 1000),
                })
            }
        }
    }

    isValidAddress(toAddr) {
        return toAddr.slice(0,2) === "0x" && toAddr.length === 42;
    }

    ///////////////////////////////////////////////////////////////
    ///////// Governance Function

    async getTransaction(transactionId, decoder) {
        const govInfo = this.govInfo;
        const info = config.info[this.chainLower];
        const mainnet = await this.rpcAggregator.select();
        const chainName = this.chainName;

        const mig = new mainnet.web3.eth.Contract(this.multisigABI, this.migAddress);

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

    async confirmTransaction(transactionId, gasPrice, chainId) {
        const info = config.info[this.chainLower];
        const mainnet = await this.rpcAggregator.select();
        const validator = {address: this.account.address, pk: this.account.pk};


        const mig = new mainnet.web3.eth.Contract(this.multisigABI, this.migAddress);

        let transaction = await mig.methods.transactions(transactionId).call().catch(e => {return;});
        if(!transaction || transaction.destination === "0x0000000000000000000000000000000000000000") return "GetTransaction Error";
        if(transaction.executed) return "Already Confirmed Proposal"

        let confirmedList = await mig.methods.getConfirmations(transactionId).call().catch(e => {return;});
        if(!confirmedList) return "GetConfirmations Error";

        let myConfirmation = !!(confirmedList.find(va => va.toLowerCase() === validator.address.toLowerCase()));

        let required = await mig.methods.required().call().catch(e => {return;});
        if(!required) return "GetRequired Error";

        if(myConfirmation || parseInt(required) === parseInt(confirmedList.length))
            return "Already Confirmed"

        let txData = {
            from: validator.address,
            to: this.migAddress,
            value: mainnet.web3.utils.toHex(0)
        }

        let gasLimit = await mig.methods.confirmTransaction(transactionId).estimateGas(txData).catch(e => {
            console.log(e)
            return e.message;;
        });
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
        let tx = await mainnet.web3.eth.sendSignedTransaction(signedTx.rawTransaction).catch(e => {
            console.log(e)
            return e.message;
        });
        if(!tx) return "SendTransaction Error";

        return tx.transactionHash;
    }

    // deprecated
    /*
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

    async validateEd25519SigHash(multisig, sigHash) {
        if(this.chainName !== "ORBIT") return "Invalid Chain";
        if(multisig.length !== 42 || sigHash.length !== 66) return "Invalid Input";

        const orbitHub = instances.hub.getOrbitHub();
        const validator = {address: this.account.address, pk: this.account.pk};

        const ABI = Britto.getJSONInterface({filename: 'multisig/Ed25519'});
        let mig = new orbitHub.web3.eth.Contract(ABI, multisig);

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

        let ecSig = Britto.signMessage(sigHash, validator.pk);
        let edSig = Britto.signEd25519(sigHash, validator.pk);

        let signature = Britto.signMessage(sigHash, validator.pk);
        let params = [
            validator.address,
            sigHash,
            ecSig.v,
            [ecSig.r, edSig.r],
            [ecSig.s, edSig.s]
        ]

        let txData = {
            from: sender.address,
            to: multisig,
            value: orbitHub.web3.utils.toHex(0)
        }

        let gasLimit = await mig.methods.validateWithEd25519(...params).estimateGas(txData).catch(e => {return;});
        if(!gasLimit) return "EstimateGas Error";

        let data = mig.methods.validateWithEd25519(...params).encodeABI();
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
    */
    ///////////////////////////////////////////////////////////////
}

module.exports = EVMValidator;
