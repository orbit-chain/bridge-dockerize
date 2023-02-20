global.logger.xrp = require('./logger');

const config = require(ROOT + '/config');

const Britto = require(ROOT + '/lib/britto');
const txSender = require(ROOT + '/lib/txsender');

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

        const govInfo = this.govInfo = config.governance;
        if(!govInfo || !govInfo.chain || !govInfo.address || !govInfo.bytes || !govInfo.id)
            throw 'Empty Governance Info';

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
            global.monitor.setNodeConnectStatus(chainName, info.ENDPOINT.socket, "connected");
            logger.xrp.info(`[${chainName}] web4 connected to ${info.ENDPOINT.socket}`);

            if(monitor.address[chainName]) return;
            monitor.address[chainName] = bridgeUtils.getKeyPair(this.account.pk).address;

            const xrpBridge = this.xrpBridge = Britto.getNodeConfigBase('xrpBridge');
            xrpBridge.rpc = config.info.orbit.ENDPOINT.rpc;
            xrpBridge.address = info.CONTRACT_ADDRESS.BridgeContract;
            xrpBridge.abi = Britto.getJSONInterface({filename: 'bridge/Xrp'});

            this.bridgeEventList = [
                {
                    name: 'XrpTransactionSuggested',
                    callback: this.receiveTransactionSuggested.bind(this)
                },
                {
                    name: 'XrpTransactionSelected',
                    callback: this.receiveTransactionSelected.bind(this)
                }
            ];

            xrpBridge.onconnect = () => {
                instances.hub.registerSubscriber(xrpBridge, this.bridgeEventList);
            };

            this.addressBookEventList = [
                {
                    name: 'Relay',
                    callback: this.receiveAddressBookRelay.bind(this),
                }
            ];

            const addressBook = this.addressBook = Britto.getNodeConfigBase('xrpAddressBook');
            addressBook.rpc = config.info.orbit.ENDPOINT.rpc;
            addressBook.address = info.CONTRACT_ADDRESS.AddressBook;
            addressBook.abi = Britto.getJSONInterface({filename: 'addressbook/Xrp'});

            addressBook.onconnect = () => {
                instances.hub.registerSubscriber(addressBook, this.addressBookEventList);
            };

            new Britto(xrpBridge, chainName).connectWeb3();
            new Britto(addressBook, chainName).connectWeb3();

            xrpBridge.multisig.wallet = info.CONTRACT_ADDRESS.BridgeMultiSigWallet;
            xrpBridge.multisig.abi = Britto.getJSONInterface({filename: 'multisig/Xrp'});
            xrpBridge.multisig.contract = new xrpBridge.web3.eth.Contract(xrpBridge.multisig.abi, xrpBridge.multisig.wallet);

            addressBook.multisig.wallet = info.CONTRACT_ADDRESS.BridgeMultiSigWallet;
            addressBook.multisig.abi = Britto.getJSONInterface({filename: 'multisig/Xrp'});
            addressBook.multisig.contract = new addressBook.web3.eth.Contract(addressBook.multisig.abi, addressBook.multisig.wallet);

            this.multisigABI = Britto.getJSONInterface({filename: 'multisig/Xrp'});
        });

        logger.xrp.info(`[${chainName}] web4 connecting to ${info.ENDPOINT.socket}`);
        global.monitor.setNodeConnectStatus(chainName, info.ENDPOINT.socket, "connecting");

        ripple.connect().catch(e => {
            logger.xrp.error('Ripple API connection error: ' + e.message);
            global.monitor.setNodeConnectStatus(chainName, info.ENDPOINT.socket, "disconnected");

            if (this.reconnectHandle)
                clearInterval(this.reconnectHandle);
            this.reconnectHandle = setInterval(() => {
                this.tryReconnect();
            }, 5000);
            this.tryReconnect();
        });

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

    async validateRelayedData(data) {
        const orbitHub = instances.hub.getOrbitHub();
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

        let params = {
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

        const toInstance = instances[params.toChain.toLowerCase()];
        if(!toInstance) {
            logger.xrp.error(`${params.toChain} instance is not exist`);
            return;
        }
        await toInstance.validateSwap(data, params);
    }

    async validateSwap(_, params){
        const validator = {address: this.account.address, pk: this.account.pk};

        const orbitHub = instances.hub.getOrbitHub();
        const chainName = this.chainName;
        const govInfo = this.govInfo;
        const hashMap = this.hashMap;
        const multisigABI = this.multisigABI;

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

        async function valid(swapData) {
            let sender = Britto.getRandomPkAddress();
            if(!sender || !sender.pk || !sender.address){
                logger.xrp.error("Cannot Generate account");
                return;
            }

            swapData.hubContract = orbitHub.address;
            let swapHash = Britto.sha256sol(packer.packSwapData(swapData));
            if(hashMap.has(swapHash.toString('hex').add0x())){
                logger.xrp.error(`Already signed. validated swapHash: ${swapHash.toString('hex').add0x()}`);
                return;
            }

            let toChainMig = await orbitHub.contract.methods.getBridgeMig(swapData.toChain, govInfo.id).call();
            let contract = new orbitHub.web3.eth.Contract(multisigABI, toChainMig);

            let validators = await contract.methods.getHashValidators(swapHash.toString('hex').add0x()).call();
            for(var i = 0; i < validators.length; i++){
                if(validators[i].toLowerCase() === validator.address.toLowerCase()){
                    logger.xrp.error(`Already signed. validated swapHash: ${swapHash}`);
                    return;
                }
            }

            let signature = Britto.signMessage(swapHash, validator.pk);
            let sigs = XRPValidator.makeSigs(validator.address, signature);

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

            await txSender.sendTransaction(orbitHub, txData, {address: sender.address, pk: sender.pk, timeout: 1}).then(thash => {
                hashMap.set(swapHash.toString('hex').add0x(), {
                    txHash: thash,
                    timestamp: parseInt(Date.now() / 1000),
                })
            });
        }

        async function applyLimitation(gateKeeper, data) {
            let sender = Britto.getRandomPkAddress();
            if(!sender || !sender.pk || !sender.address){
                logger.xrp.error("Cannot Generate account");
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
                logger.xrp.error(`Already signed. limitation hash: ${hash.toString('hex').add0x()}`);
                return;
            }

            let hubMig = await orbitHub.contract.methods.getBridgeMig("HUB", govInfo.id).call();
            let migCon = new orbitHub.web3.eth.Contract(multisigABI, hubMig);

            let validators = await migCon.methods.getHashValidators(hash.toString('hex').add0x()).call();
            for(var i = 0; i < validators.length; i++){
                if(validators[i].toLowerCase() === validator.address.toLowerCase()){
                    logger.xrp.error(`Already signed. applyLimitation: ${hash.toString('hex').add0x()}`);
                    return;
                }
            }

            let signature = Britto.signMessage(hash, validator.pk);
            let sigs = XRPValidator.makeSigs(validator.address, signature);

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
                    logger.xrp.error(`applyLimitation error: ${err.message}`);
                    return;
                }

                hashMap.set(hash.toString('hex').add0x(), {
                    txHash: thash,
                    timestamp: parseInt(Date.now() / 1000),
                })

                logger.xrp.info(`applyLimitation: ${thash}`);
            });
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

    receiveTransactionSuggested(event) {
        if(event.returnValues.govId.toLowerCase() !== this.govInfo.id.toLowerCase()) return;
        if(event.address.toLowerCase() !== this.xrpBridge.address.toLowerCase()) return;

        let returnValues = {
            govId: event.returnValues.govId,
            swapIndex: event.returnValues.swapIndex,
            suggestIndex: event.returnValues.suggestIndex,
        };

        this.validateTransactionSuggested({
            block: event.blockNumber,
            validator: {address: this.account.address, pk: this.account.pk},
            ...returnValues
        });
    }

    async validateTransactionSuggested(data) {
        let validator = {...data.validator} || {};
        delete data.validator;

        const orbitHub = instances.hub.getOrbitHub();
        const ripple = this.ripple;
        const xrpBridge = this.xrpBridge;
        const chainName = this.chainName;
        const govInfo = this.govInfo;
        const hashMap = this.hashMap;

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
        if(hashMap.has(suggestHash.toString('hex').add0x())){
            logger.xrp.error(`Already signed. validated suggestHash: ${suggestHash.toString('hex').add0x()}`);
            return;
        }

        let hashValidators = await xrpBridge.multisig.contract.methods.getHashValidators(suggestHash.toString('hex').add0x()).call();
        for(var i = 0; i < hashValidators.length; i++){
            if(hashValidators[i].toLowerCase() === validator.address.toLowerCase()){
                logger.xrp.error(`Already signed. validated suggestIndex: ${data.suggestIndex}`);
                return;
            }
        }

        const signature = Britto.signMessage(suggestHash, validator.pk);

        await valid();

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

            await txSender.sendTransaction(xrpBridge, txData, {address: sender.address, pk: sender.pk, timeout: 1}).then(thash => {
                hashMap.set(suggestHash.toString('hex').add0x(), {
                    txHash: thash,
                    timestamp: parseInt(Date.now() / 1000),
                })
            });
        }
    }

    receiveTransactionSelected(event) {
        if(event.returnValues.govId.toLowerCase() !== this.govInfo.id.toLowerCase()) return;
        if(event.address.toLowerCase() !== this.xrpBridge.address.toLowerCase()) return;

        let returnValues = {
            govId: event.returnValues.govId,
            selectionIndex: event.returnValues.selectionIndex,
        };

        this.validateTransactionSelected({
            block: event.blockNumber,
            validator: {address: this.account.address, pk: this.account.pk},
            ...returnValues
        });
    }

    async validateTransactionSelected(data) {
        let validator = {...data.validator} || {};
        delete data.validator;

        const orbitHub = instances.hub.getOrbitHub();
        const ripple = this.ripple;
        const xrpBridge = this.xrpBridge;
        const chainName = this.chainName;
        const govInfo = this.govInfo;
        const hashMap = this.hashMap;

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
        if(hashMap.has(signingHash.toString('hex').add0x())){
            logger.xrp.error(`Already signed. validated signingHash: ${signingHash.toString('hex').add0x()}`);
            return;
        }

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

            await txSender.sendTransaction(xrpBridge, txData, {address: sender.address, pk: sender.pk, timeout: 1}).then(thash => {
                hashMap.set(signingHash.toString('hex').add0x(), {
                    txHash: thash,
                    timestamp: parseInt(Date.now() / 1000),
                })
            });
        }
    }

    receiveAddressBookRelay(event) {
        if(event.address.toLowerCase() !== this.addressBook.address.toLowerCase()) return;

        let returnValues = {
            toChain: event.returnValues.toChain,
            toAddress: event.returnValues.toAddr,
            data: event.returnValues.data,
        };

        this.validateTagRequest({
            block: event.blockNumber,
            validator: {address: this.account.address, pk: this.account.pk},
            ...returnValues
        });
    }

    async validateTagRequest(data) {
        let validator = {...data.validator} || {};
        delete data.validator;

        const addressBook = this.addressBook;
        const chainName = this.chainName;
        const govInfo = this.govInfo;

        let toChain = data.toChain;
        if(!toChain || toChain.length === 0 || toChain.toLowerCase() === chainName.toLowerCase()) {
            logger.xrp.error(`validateTagRequest error: invalid toChain ${toChain}`);
            return;
        }

        let toAddress = data.toAddress;
        if (!toAddress || toAddress.length === 0) {
            logger.xrp.error(`validateTagRequest error: toAddr or toChain is not defined.`);
            return;
        }

        if(!instances[toChain.toLowerCase()] || !instances[toChain.toLowerCase()].isValidAddress(toAddress)){
            logger.xrp.error(`Invalid toAddress ( ${toChain}, ${toAddress} )`);
            return;
        }

        let transfortData = data.data || '0x';

        let packerData = {
            toChain,
            toAddress,
            transfortData,
        }

        let tagHash = Britto.sha256sol(packer.packXrpTagHash(packerData));

        let validators = await addressBook.multisig.contract.methods.getHashValidators(tagHash.toString('hex').add0x()).call();
        for(var i = 0; i < validators.length; i++){
            if(validators[i].toLowerCase() === validator.address.toLowerCase()){
                logger.xrp.error(`Already signed. validated tagHash: ${tagHash}`);
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
        }
    }
}

module.exports = XRPValidator;
