global.logger.xrp = require('./logger');

const config = require(ROOT + '/config');

const Britto = require(ROOT + '/lib/britto');
const txSender = require(ROOT + '/lib/txsender');
const api = require(ROOT + '/lib/api');

const packer = require('./utils/packer');

const BridgeUtils = require('./utils/xrp.bridgeutils');
const bridgeUtils = new BridgeUtils();

const rippleAddr = require('ripple-address-codec');

const FIX_GAS = 99999999;

class XRPValidator {
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
        if(chain.toLowerCase() !== "xrp")
            throw 'Invalid chain symbol';

        if (!_account || !_account.address || !_account.pk)
            throw 'Invalid Ethereum Wallet Account';
        this.account = _account;

        const chainName = this.chainName = chain.toUpperCase();
        this.chainLower = chain.toLowerCase();
        this.orbitHub = config.orbitHub.address

        const govInfo = this.govInfo = config.governance;
        if(!govInfo || !govInfo.chain || !govInfo.address || !govInfo.bytes || !govInfo.id)
            throw 'Empty Governance Info';

        this.xrpWallet = this.govInfo.address
        const info = config.info[this.chainLower];

        this.reconnectHandle = null;
        const ripple = this.ripple = require('./utils/ripple.api');
        ripple.__tryreconnect = 0;

        ripple.on('disconnected', (code) => {
            global.monitor.setNodeConnectStatus(chainName, info.ENDPOINT.socket, "disconnected");
            if (code !== 1000) {
                if (this.reconnectHandle)
                    clearInterval(this.reconnectHandle);
                this.reconnectHandle = setInterval(() => {
                    this.tryReconnect();
                }, 5000);
                this.tryReconnect();
            }
            else{
                logger.xrp.error("program exit cause ripple connection lost to " + info.ENDPOINT.socket);
                process.exit(2);
            }
        });

        ripple.on("connected", () => {
            ripple.__tryreconnect = 0;
        });

        global.monitor.setNodeConnectStatus(chainName, info.ENDPOINT.socket, "connected");

        if(monitor.address[chainName]) return;
        monitor.address[chainName] = bridgeUtils.getKeyPair(this.account.pk).address;

        const addressBook = this.addressBook = Britto.getNodeConfigBase('xrpAddressBook');
        addressBook.rpc = config.endpoints.silicon.rpc[0];
        addressBook.address = config.settings.silicon.addressbook;
        addressBook.abi = Britto.getJSONInterface({filename: 'AddressBook'});
        new Britto(addressBook, chainName).connectWeb3();

        addressBook.multisig.wallet = config.settings.silicon.multisig;
        addressBook.multisig.abi = Britto.getJSONInterface({filename: 'multisig/Xrp'});
        addressBook.multisig.contract = new addressBook.web3.eth.Contract(addressBook.multisig.abi, addressBook.multisig.wallet);

        const xrpBridge = this.xrpBridge = Britto.getNodeConfigBase('xrpBridge');
        xrpBridge.rpc = config.endpoints.silicon.rpc[0];
        xrpBridge.address = config.settings.silicon.xrpBridge;
        xrpBridge.abi = Britto.getJSONInterface({filename: 'bridge/Xrp'});
        new Britto(xrpBridge, 'silicon').connectWeb3();

        xrpBridge.multisig.wallet = config.settings.silicon.multisig;
        xrpBridge.multisig.abi = Britto.getJSONInterface({filename: 'multisig/Xrp'});
        xrpBridge.multisig.contract = new xrpBridge.web3.eth.Contract(xrpBridge.multisig.abi, xrpBridge.multisig.wallet);


        ripple.connect().catch(e => {
            logger.xrp.error('Ripple API connection error: ' + e.message);
            global.monitor.setNodeConnectStatus(chainName, info.ENDPOINT.socket, "disconnected");

            if (this.reconnectHandle)
                clearInterval(this.reconnectHandle);
            this.reconnectHandle = setInterval(() => {
                this.tryReconnect();
            }, 5000);
            this.tryReconnect();

            this.ripple.connect();
        });

        this.workerStarted = false;
        this.intervals = {
            getLockRelay: {
                handler: this.getLockRelay.bind(this),
                timeout: 1000 * 10,
                interval: null,
            },
            getTagRelay: {
                handler: this.getTagRelay.bind(this),
                timeout: 1000 * 3,
                interval: null,
            },
            getSuggestRelay: {
                handler: this.getSuggestRelay.bind(this),
                timeout: 1000 * 10,
                interval: null
            },
            getSelectRelay: {
                handler: this.getSelectRelay.bind(this),
                timeout: 1000 * 10,
                interval: null
            },
        }
        this.startIntervalWorker();

        this.hashMap = new Map();
        this.flushHashMap();
    }

    startIntervalWorker() {
        if (this.workerStarted) {
            return;
        }
        this.workerStarted = true;
    
        this.getLockRelay();
        this.getTagRelay();
        this.getSuggestRelay();
        this.getSelectRelay();
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

    tryReconnect() {
        const info = config.info[this.chainLower];
        if (this.ripple.isConnected()) {
            logger.xrp.info("Web4 recovered : " + info.ENDPOINT.socket);
            if (this.reconnectHandle)
                clearInterval(this.reconnectHandle);
            this.reconnectHandle = null;
            return;
        }
        if (this.ripple.__tryreconnect >= 100) {
            logger.xrp.error("program exit cause ripple connection lost to " + info.ENDPOINT.socket);
            process.exit(2);
        } else {
            this.ripple.__tryreconnect++;
            logger.xrp.warn("try reconnect to " + info.ENDPOINT.socket + "(" + this.ripple.__tryreconnect + ")");
            this.ripple.connect();
        }
    }

    async getLockRelay() {
        this.intervalClear(this.intervals.getLockRelay);

        try {
            let response = await api.bible.get("/v1/api/xrp/lock-relay").catch(e => logger.xrp.error('lock-relay api error: ' + e.message));
            if (response.success !== "success") {
                logger.xrp.error(`lock-relay api error: ${response}`);
                return;
            }

            let info = response.info;
            if (!Array.isArray(info)) {
                logger.xrp.error('Received data is not array.');
                return;
            }
    
            logger.xrp.info(`LockRelay list ${info.length === 0 ? 'is empty.' : 'length: ' + info.length.toString()}`);
    
            for (let result of info) {
                let data = {
                    fromChain: result.fromChain,
                    toChain: result.toChain,
                    fromAddr: bridgeUtils.str2hex(result.fromAddr),
                    toAddr: bridgeUtils.str2hex(result.toAddr),
                    token: bridgeUtils.str2hex(result.token) || "0x0000000000000000000000000000000000000000",
                    // relayThash: result.relayThash,
                    bytes32s: [this.govInfo.id, result.fromThash],
                    uints: [result.amount, 6],
                    data: result.data,
                };
    
                if(!bridgeUtils.isValidAddress(data.toChain, data.toAddr)){
                    logger.xrp.error(`Invalid toAddress ( ${data.toChain}, ${data.toAddr} )`);
                    continue;
                }
            
                if(data.data && !bridgeUtils.isValidData(data.toChain, data.data)){
                    logger.xrp.error(`Invalid data ( ${data.toChain}, ${data.data} )`);
                    continue;
                }
                
                await this.validateRelayedData(data);
            }
        } catch(e) {
            logger.xrp.error('lock-relay api error: ' + e.message);
    
        } finally {
            this.intervalSet(this.intervals.getLockRelay);
        }
    }

    async validateRelayedData(data) {
        const ripple = this.ripple;
        const addressBook = this.addressBook;
        const chainName = this.chainName;
        const govInfo = this.govInfo;

        // Get ripple transaction by transaction id
        const txid = data.bytes32s[1].replace('0x', '').toUpperCase();
        let transaction = await ripple.getTransaction(txid).catch();
        if (!transaction || !transaction.outcome || transaction.outcome.result !== 'tesSUCCESS') {
            logger.xrp.error(`validateSwap error: Ripple transaction ${txid} is not applied to ledger or transaction execution failed.`);
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
        if(!balanceChanges){
            logger.xrp.error('validateSwap error: balanceChanges undefined.');
            return;
        }

        let amount = '0';
        for (let balanceChange of balanceChanges) {
            if (balanceChange.currency.toUpperCase() !== 'XRP' || parseInt(balanceChange.value.dmove(6)) <= 0 || Number.isNaN(parseInt(balanceChange.value.dmove(6))))
                continue;

            amount = amount.dadd(balanceChange.value.dmove(6));
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
            logger.xrp.error(`validateSwap error: invalid fromAddr ${fromAddr}`);
            return;
        }

        let destinationTag = transaction.specification.destination.tag;

        let addrData = await addressBook.contract.methods.getTag(destinationTag).call().catch(e => {return;});
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

        let version = await addressBook.contract.methods.versionCount().call().catch(e => {});
        if(!version){
            logger.xrp.error(`getAddressBookVersionCount error.`);
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
            version,
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
        });
        if (parseInt(destinationTag) < 1100081815) {
            addressObj["rLX7h5xM2cdC69XQVoJTNtpbTcL2QqABEL"] = true;
        }
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

        let params = {
            hubContract: this.orbitHub,
            fromChain: 'XRP',
            toChain: toChain,
            fromAddr: fromAddr,
            toAddr: toAddr,
            token: '0x0000000000000000000000000000000000000000',
            bytes32s: [govInfo.id, data.bytes32s[1]],
            uints: [amount, 6],
            data: transfortData,
        }

        const toInstance = instances[params.toChain.toLowerCase()];
        if(!toInstance) {
            logger.xrp.error(`${params.toChain} instance is not exist`);
            return;
        }
        await toInstance.validateSwap(data, params);
    }

    async validateSwap(_, params){
        const validator = {address: this.account.address, pk: this.account.pk};
        const chainName = this.chainName;
        const hashMap = this.hashMap;

        if(chainName !== params.toChain){
            logger.xrp.error(`Invalid toChain. ${chainName} : ${params.toChain}`);
            return;
        }

        if(!this.isValidAddress(params.toAddr)){
            logger.xrp.error(`Invalid Address. ${params.toAddr}`);
            return;
        }

        if(!this.isValidData(params.data)){
            logger.xrp.error(`Invalid Data. ${params.data}`);
            return;
        }

        if(params.token !== "0x0000000000000000000000000000000000000000"){
            logger.xrp.error(`Invalid token. ${params.token}`);
            return;
        }

        await valid(params, this.orbitHub)

        async function valid(swapData, orbitHubAddress) {
            let sender = Britto.getRandomPkAddress();
            if(!sender || !sender.pk || !sender.address){
                logger.xrp.error("Cannot Generate account");
                return;
            }

            swapData.hubContract = orbitHubAddress;
            let swapHash = Britto.sha256sol(packer.packSwapData(swapData));
            if(hashMap.has(swapHash.toString('hex').add0x())){
                logger.xrp.error(`Already signed. validated swapHash: ${swapHash.toString('hex').add0x()}`);
                return;
            }

            let res = await api.orbit.get(`/info/hash-info`, {whash: swapHash.toString('hex').add0x()})
            if(res.status === "success") {
                if(res.data.validators) {
                    for(var i = 0; i < res.data.validators.length; i++){
                        if(res.data.validators[i].toLowerCase() === validator.address.toLowerCase()){
                            logger.xrp.error(`Already signed. validated swapHash: ${swapHash}`);
                            return;
                        }
                    }
                }
                
                let signature = Britto.signMessage(swapHash, validator.pk);
                let sigs = XRPValidator.makeSigs(validator.address, signature);
                sigs[1] = parseInt(sigs[1],16)
    
                await api.validator.post(`/governance/validate`, {
                    from_chain: swapData.fromChain,
                    to_chain: swapData.toChain,
                    from_addr: swapData.fromAddr,
                    to_addr: swapData.toAddr,
                    token: swapData.token,
                    bytes32s: swapData.bytes32s,
                    uints: swapData.uints,
                    data: swapData.data,
                    hash: swapHash,
                    v: sigs[1],
                    r: sigs[2],
                    s: sigs[3],
                });
    
                hashMap.set(swapHash.toString('hex').add0x(), {
                    txHash: swapHash,
                    timestamp: parseInt(Date.now() / 1000),
                })
            }
        }
    }

    isValidAddress(toAddr) {
        const govInfo = this.govInfo;

        try{
            let buf = Buffer.from(toAddr.replace('0x', ''), 'hex');
            toAddr = rippleAddr.codec.codec.encode(buf);
        } catch(e) {
            return false;
        }

        return rippleAddr.isValidClassicAddress(toAddr) && govInfo.chain === "XRP" && toAddr.toLowerCase() !== govInfo.address.toLowerCase();
    }

    isValidData(data) {
        if(!data || data === "0x") return false;

        return parseInt(data) <= 4294967295;
    }

    async checkValidSuggestion(suggestIndex, dataIndex) {
        let suggestion = await xrpBridge.contract.methods.getSuggestion(0, suggestIndex).call().catch(e => {return;});
        if(suggestion && parseInt(suggestion.fee) !== 0 && parseInt(suggestion.swapIndex) === parseInt(dataIndex)) {
            return suggestion;
        }
        return;
    }

    async getSuggestRelay() {
        this.intervalClear(this.intervals.getSuggestRelay);
    
        this.xrpBridge.contract.methods.getStepStatus().call().then(async status => {
            if (!status) return;

            if(!status.needRelaySuggestion) return;

            logger.xrp.info('needSuggestRelay data index: ' + status.suggestIndex);
            await this.validateTransactionSuggested(status);
        }).catch(e => {
            logger.xrp.error('getSuggestRelay call error: ' + e.message);
        }).finally(() => {
            this.intervalSet(this.intervals.getSuggestRelay);
        });
    }

    async validateTransactionSuggested(data) {
        await this.xrpBridge.contract.methods.relayTransactionSuggested(data.suggestIndex).estimateGas().catch(() => {
            logger.xrp.error('relayTransactionSuggested estimateGas error');
        });

        let validator = {address: this.account.address, pk: this.account.pk} || {};

        const ripple = this.ripple;
        const xrpBridge = this.xrpBridge;
        const govInfo = this.govInfo;
        const hashMap = this.hashMap;

        let xrpWallet = this.xrpWallet

        let swapData = await xrpBridge.contract.methods.swapData(data.dataIndex).call().catch(e => {return;});
        if (!swapData || swapData.toAddr.length === 0) {
            logger.xrp.error('validateTransactionSuggested error: swapData is invalid.');
            return;
        }

        let swapDataArray = await xrpBridge.contract.methods.getSwapDataArray(data.dataIndex).call().catch(e => {return;});
        if (!swapDataArray || swapDataArray.bytes32s.length === 0){
            logger.xrp.error('validateTransactionSuggested error: swapData is invalid.');
            return;
        }

        let toAddr = bridgeUtils.getAddressFromHex(swapData.toAddr);

        let suggestion = await xrpBridge.contract.methods.getSuggestion(0, data.suggestIndex).call().catch(e => {return;});
        if (!suggestion || parseInt(suggestion.fee) === 0 || parseInt(suggestion.swapIndex) !== parseInt(data.dataIndex)){
            let validSuggestion
            for(let i = data.suggestIndex - 1; i >= 0; i--) {
                if (validSuggestion) break;
                validSuggestion = this.checkValidSuggestion(i, dataIndex);
            }
            if(validSuggestion) {
                suggestion = validSuggestion
            } else {
                logger.xrp.error('validateTransactionSuggested error: invalid suggestion');
                return;
            }
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
        let suggestionSeq = Number(suggestion.seq);
        if (currentSeq !== suggestionSeq || Number.isNaN(suggestionSeq)) {
            logger.xrp.error(`validateTransactionSuggested validation fail: Account sequence is different. Require ${currentSeq}, but ${suggestionSeq}`);
            return;
        }

        // Step 2: Fee Check
        let networkFee = await ripple.getFee() || 0.000012;
        networkFee = networkFee < 1 ? (networkFee * 10 ** 6) : networkFee; // fee unit is drops. NOT XRP.

        let minFee = networkFee * (1 + Math.max(quorumCount, Number(required))); // expectFee
        let maxFee = minFee * 1.25 < 100000 ? 100000 : minFee * 1.25; // expectFee * 1.25 or 0.1 XRP

        let suggestionFee = Number(suggestion.fee);
        if (minFee > suggestionFee) {
            logger.xrp.error(`validateTransactionSuggested validation fail: Small fee. Expected ${minFee}, but ${suggestionFee}`);
            return;
        } else if (maxFee < suggestionFee) {
            logger.xrp.error(`validateTransactionSuggested validation fail: Too many fee. Maximum is ${expectFee * 1.25}, but ${suggestionFee}`);
            return;
        } else if (Number.isNaN(suggestionFee)) {
            logger.xrp.error(`validateTransactionSuggested validation fail: Invalid SuggestionFee ${suggestion.fee}`);
            return;
        }

        let memos = bridgeUtils.getReleaseMemo(govInfo.id, data.dataIndex);

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
        if(hashMap.has(suggestHash.toString('hex').add0x())){
            logger.xrp.error(`Already signed. validated suggestHash: ${suggestHash.toString('hex').add0x()}`);
            return;
        }

        let res = await api.orbit.get(`/info/hash-info`, {whash: suggestHash.toString('hex').add0x()})
        if(res.status === "success") {
            if(res.data.validators) {
                for(var i = 0; i < res.data.validators.length; i++){
                    if(res.data.validators[i].toLowerCase() === validator.address.toLowerCase()){
                        logger.evm.error(`Already signed. validated suggestHash: ${suggestHash}`);
                        return;
                    }   
                }
            }
            let signature = Britto.signMessage(suggestHash, validator.pk);
            let sigs = XRPValidator.makeSigs(validator.address, signature);
            sigs[1] = parseInt(sigs[1],16)

            await api.validator.post(`/governance/validate-suggested`, {
                contract: xrpBridge.address,
                govId: govInfo.id,
                suggestIndex: data.suggestIndex,
                swapIndex: suggestion.swapIndex,
                validators: suggestion.validators,
                signatureHashs: suggestion.signatureHashs,
                fee: suggestion.fee,
                seq: suggestion.seq,
                hash: suggestHash,
                v: sigs[1],
                r: sigs[2],
                s: sigs[3]
            });

            hashMap.set(suggestHash.toString('hex').add0x(), {
                txHash: suggestHash,
                timestamp: parseInt(Date.now() / 1000),
            })
        }

        let hashValidators = await xrpBridge.multisig.contract.methods.getHashValidators(suggestHash.toString('hex').add0x()).call();
        for(var i = 0; i < hashValidators.length; i++){
            if(hashValidators[i].toLowerCase() === validator.address.toLowerCase()){
                logger.xrp.error(`Already signed. validated suggestIndex: ${data.suggestIndex}`);
                return;
            }
        }
    }

    async getSelectRelay() {
        this.intervalClear(this.intervals.getSelectRelay);
    
        this.xrpBridge.contract.methods.getStepStatus().call().then(async status => {
            if (!status)
                return;
    
            if(!status.needRelaySelection)
                return;
    
            logger.xrp.info('needSelectRelay data index: ' + status.selectionIndex);
            await this.validateTransactionSelected(status.selectionIndex);
        }).catch(e => {
            logger.xrp.error('getSelectRelay call error: ' + e.message);
        }).finally(() => {
            this.intervalSet(this.intervals.getSelectRelay);
        });
    }

    async validateTransactionSelected(selectionIndex) {
        await this.xrpBridge.contract.methods.relayTransactionSuggested(selectionIndex).estimateGas().catch(() => {
            logger.xrp.error('relayTransactionSuggested estimateGas error');
        });

        let validator = {address: this.account.address, pk: this.account.pk} || {};

        const ripple = this.ripple;
        const xrpBridge = this.xrpBridge;
        const govInfo = this.govInfo;
        const hashMap = this.hashMap;

        let xrpWallet = this.xrpWallet

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

        let selection = await xrpBridge.contract.methods.getSuggestion(1, selectionIndex).call().catch(e => {return;});
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

        // TODO: orbit api에서 검증
        let response = await api.orbit.get(`/info/hash-info`, {whash: mySignatureHash})
        if(response.status === "success") {
            if(response.data.validators.length !== 0) {
                if(response.data.validators[0].toLowerCase() === validator.address.toLowerCase()){
                    logger.evm.error(`Already signed. validated mySignatureHash: ${mySignatureHash}`);
                    return;
                }   
            }
            let signature = Britto.signMessage(mySignatureHash, validator.pk);
            let sigs = XRPValidator.makeSigs(validator.address, signature);
            sigs[1] = parseInt(sigs[1],16)

            await api.validator.post(`/governance/validate-xrp-signature`, {
                contract: xrpBridge.address,
                govId: govInfo.id,
                selectionIndex,
                signatureHashs: selection.signatureHashs,
                hash: mySignatureHash,
                v: sigs[1],
                r: sigs[2],
                s: sigs[3]
            });

            hashMap.set(mySignatureHash.toString('hex').add0x(), {
                txHash: mySignatureHash,
                timestamp: parseInt(Date.now() / 1000),
            })
        }

        const signingHash = Britto.sha256sol(packer.packSigningHash({
            contract: xrpBridge.address,
            govId: govInfo.id,
            selectionIndex: selectionIndex,
            signatureHashs: selection.signatureHashs
        }));
        if(hashMap.has(signingHash.toString('hex').add0x())){
            logger.xrp.error(`Already signed. validated signingHash: ${signingHash.toString('hex').add0x()}`);
            return;
        }

        let res = await api.orbit.get(`/info/hash-info`, {whash: signingHash.toString('hex').add0x()})
        if(res.status === "success") {
            if(res.data.validators) {
                for(var i = 0; i < res.data.validators.length; i++){
                    if(res.data.validators[i].toLowerCase() === validator.address.toLowerCase()){
                        logger.evm.error(`Already signed. validated signingHash: ${signingHash}`);
                        return;
                    }   
                }
            }
            let signature = Britto.signMessage(signingHash, validator.pk);
            let sigs = XRPValidator.makeSigs(validator.address, signature);
            sigs[1] = parseInt(sigs[1],16)

            await api.validator.post(`/governance/validate-selected`, {
                contract: xrpBridge.address,
                govId: govInfo.id,
                selectionIndex,
                signatureHashs: selection.signatureHashs,
                hash: signingHash,
                v: sigs[1],
                r: sigs[2],
                s: sigs[3]
            });

            hashMap.set(signingHash.toString('hex').add0x(), {
                txHash: signingHash,
                timestamp: parseInt(Date.now() / 1000),
            })
        }

        let hashValidators = await xrpBridge.multisig.contract.methods.getHashValidators(signingHash.toString('hex').add0x()).call();
        for(var i = 0; i < hashValidators.length; i++){
            if(hashValidators[i].toLowerCase() === validator.address.toLowerCase()){
                logger.xrp.error(`Already signed. validated selectionIndex: ${selectionIndex}`);
                return;
            }
        }
    }

    async getTagRelay() {
        this.intervalClear(this.intervals.getTagRelay);

        try {
            if(!this.addressBook) return
            const response = await api.bible.get("/v1/api/xrp/tag-relay");
            if (response.result !== "success") {
                logger.xrp.error(`tag-relay api error: ${response}`);
                return;
            }
            let info = response.info;
            if (!Array.isArray(info)) {
                logger.xrp.error('Received data is not array.');
                return;
            }

            logger.xrp.info(`TagRelay list ${info.length === 0 ? 'is empty.' : 'length: ' + info.length.toString()}`);

            for (let result of info) {
                let data = {
                    toChain: result.to_chain,
                    toAddr: result.to_address,
                    data: result.data
                };

                if(!bridgeUtils.isValidAddress(data.toChain, data.toAddr)){
                    logger.xrp.error(`Invalid toAddress ( ${data.toChain}, ${data.toAddr} )`);
                    continue;
                }

                if(data.data && !bridgeUtils.isValidData(data.toChain, data.data)){
                    logger.xrp.error(`Invalid data ( ${data.toChain}, ${data.data} )`);
                    continue;
                }

                await this.validateTagRequest(data);
            }
        } catch (e) {
            logger.xrp.error(`tag-relay api error: ${e.message}`);
        } finally {
            this.intervalSet(this.intervals.getTagRelay);
        }
    }

    async validateTagRequest(data) {
        const chainName = this.chainName;

        let toChain = data.toChain;
        if(!toChain || toChain.length === 0 || toChain.toLowerCase() === chainName.toLowerCase()) {
            logger.xrp.error(`validateTagRequest error: invalid toChain ${toChain}`);
            return;
        }

        let toAddress = data.toAddr;
        if (!toAddress || toAddress.length === 0) {
            logger.xrp.error(`validateTagRequest error: toAddr or toChain is not defined.`);
            return;
        }

        if(!instances[toChain.toLowerCase()] || !instances[toChain.toLowerCase()].isValidAddress(toAddress)){
            logger.xrp.error(`Invalid toAddress ( ${toChain}, ${toAddress} )`);
            return;
        }

        let transfortData = data.data || '0x';

        let version = await this.addressBook.contract.methods.versionCount().call().catch(e => {});
        if(!version){
            logger.xrp.error(`getAddressBookVersionCount error.`);
            return;
        }

        let packerData = {
            version,
            toChain,
            toAddress,
            transfortData,
        }

        let tagHash = Britto.sha256sol(packer.packXrpTagHash(packerData));

        const validator = {address: this.account.address, pk: this.account.pk};
        let validators = await api.orbit.get(`/info/tag-signatures`, {
            version,
            chain: "XRP",
            to_chain: toChain,
            to_address: toAddress
        });

        for(let v of validators.data) {
            if(v.validator.toLowerCase() === validator.address.toLowerCase()) {
                logger.xrp.error(`Already signed. validated tagHash: ${tagHash}`);
                return;
            }
        }

        let signature = Britto.signMessage(tagHash, validator.pk);

        signature.v = parseInt(signature.v, 16)

        await api.validator.post(`/governance/validate-tag`, {
            version,
            chain: "XRP",
            to_chain: packerData.toChain,
            to_addr: packerData.toAddress,
            data: packerData.transfortData,
            validator: validator.address,
            hash: tagHash,
            v: signature.v,
            r: signature.r,
            s: signature.s
        });
    }
}

module.exports = XRPValidator;
