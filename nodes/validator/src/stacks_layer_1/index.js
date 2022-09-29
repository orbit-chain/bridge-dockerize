global.logger.stacks_layer_1 = require('./logger');

const config = require(ROOT + '/config');

const Britto = require(ROOT + '/lib/britto');
const txSender = require(ROOT + '/lib/txsender');
const packer = require('./utils/packer');
const BridgeUtils = require('./utils/stacks.bridgeutils');
const stacks = new BridgeUtils();
const { AddressVersion, addressFromVersionHash, addressToString, createAddress, getAddressFromPrivateKey, makeUnsignedSTXTokenTransfer, StacksMessageType } = require("@stacks/transactions");

const FIX_GAS = 99999999;

class STACKSLayer1Validator {
    static makeSigs(validator, signature) {
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

    constructor(chain, _account) {
        if(chain.toLowerCase() !== "stacks_layer_1")
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

        if(monitor.address[chainName]) return;
        monitor.address[chainName] = getAddressFromPrivateKey(this.account.pk, stacks.TransactionVersion);

        const stacksBridge = this.stacksBridge = Britto.getNodeConfigBase('stacksBridge');
        stacksBridge.rpc = config.info.orbit.ENDPOINT.rpc;
        stacksBridge.address = info.CONTRACT_ADDRESS.BridgeContract;
        stacksBridge.abi = Britto.getJSONInterface({filename: 'bridge/Stacks'});

        this.bridgeEventList = [
            {
                name: 'StacksTransactionSuggested',
                callback: this.receiveTransactionSuggested.bind(this)
            },
            {
                name: 'StacksTransactionSelected',
                callback: this.receiveTransactionSelected.bind(this)
            }
        ];

        stacksBridge.onconnect = () => {
            instances.hub.registerSubscriber(stacksBridge, this.bridgeEventList);
        };

        const addressBook = this.addressBook = Britto.getNodeConfigBase('stacksAddressBook');
        addressBook.rpc = config.info.orbit.ENDPOINT.rpc;
        addressBook.address = info.CONTRACT_ADDRESS.AddressBook;
        addressBook.abi = Britto.getJSONInterface({filename: 'addressbook/Stacks'});

        this.addressBookEventList = [
            {
                name: 'Relay',
                callback: this.receiveAddressBookRelay.bind(this)
            }
        ];

        addressBook.onconnect = () => {
            instances.hub.registerSubscriber(addressBook, this.addressBookEventList);
        };

        new Britto(stacksBridge, chainName).connectWeb3();
        new Britto(addressBook, chainName).connectWeb3();

        stacksBridge.multisig.wallet = info.CONTRACT_ADDRESS.BridgeMultiSigWallet;
        stacksBridge.multisig.abi = Britto.getJSONInterface({filename: 'multisig/Stacks'});
        stacksBridge.multisig.contract = new stacksBridge.web3.eth.Contract(stacksBridge.multisig.abi, stacksBridge.multisig.wallet);

        addressBook.multisig.wallet = info.CONTRACT_ADDRESS.BridgeMultiSigWallet;
        addressBook.multisig.abi = Britto.getJSONInterface({filename: 'multisig/Stacks'});
        addressBook.multisig.contract = new addressBook.web3.eth.Contract(addressBook.multisig.abi, addressBook.multisig.wallet);

        this.multisigABI = Britto.getJSONInterface({filename: 'multisig/Stacks'});

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

    async validateRelayedData(data) {
        const orbitHub = instances.hub.getOrbitHub();
        const addressBook = this.addressBook;
        const chainName = this.chainName;
        const govInfo = this.govInfo;

        // Get stacks transaction by transaction id
        const txid = data.bytes32s[1];
        let transaction = await stacks.getTransaction(txid).catch();
        if (!transaction || transaction.tx_status !== 'success') {
            logger.stacks_layer_1.error(`validateSwap error: STACKS transaction ${txid} is not applied to ledger or transaction execution failed.`);
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
            logger.stacks_layer_1.error(`validateSwap error: Payment deliveredAmount is different with data.amount. Expected ${amount}, but got ${data.uints[0]}`);
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
            fromChain: this.chainName,
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

        const toInstance = instances[params.toChain.toLowerCase()];
        if(!toInstance) {
            logger.stacks_layer_1.error(`${params.toChain} instance is not exist`);
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
            logger.stacks_layer_1.error(`Invalid toChain. ${chainName} : ${params.toChain}`);
            return;
        }

        if(!this.isValidAddress(params.toAddr)){
            logger.stacks_layer_1.info(`Invalid toAddr. ${params.toAddr}`);
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
                logger.stacks_layer_1.error("Cannot Generate account");
                return;
            }

            swapData.hubContract = orbitHub.address;
            let swapHash = Britto.sha256sol(packer.packSwapData(swapData));
            if(hashMap.has(swapHash.toString('hex').add0x())){
                logger.stacks_layer_1.error(`Already signed. validated swapHash: ${swapHash.toString('hex').add0x()}`);
                return;
            }

            let toChainMig = await orbitHub.contract.methods.getBridgeMig(swapData.toChain, govInfo.id).call();
            let contract = new orbitHub.web3.eth.Contract(multisigABI, toChainMig);

            let validators = await contract.methods.getHashValidators(swapHash.toString('hex').add0x()).call();
            for(var i = 0; i < validators.length; i++){
                if(validators[i].toLowerCase() === validator.address.toLowerCase()){
                    logger.stacks_layer_1.error(`Already signed. validated swapHash: ${swapHash.toString('hex').add0x()}`);
                    return;
                }
            }
            let signature = Britto.signMessage(swapHash, validator.pk);

            let sigs = STACKSLayer1Validator.makeSigs(validator.address, signature);

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
            if(hashMap.has(hash.toString('hex').add0x())){
                logger.stacks_layer_1.error(`Already signed. limitation hash: ${hash.toString('hex').add0x()}`);
                return;
            }

            let hubMig = await orbitHub.contract.methods.getBridgeMig("HUB", govInfo.id).call();
            let migCon = new orbitHub.web3.eth.Contract(multisigABI, hubMig);

            let validators = await migCon.methods.getHashValidators(hash.toString('hex').add0x()).call();
            for(var i = 0; i < validators.length; i++){
                if(validators[i].toLowerCase() === validator.address.toLowerCase()){
                    logger.stacks_layer_1.error(`Already signed. applyLimitation: ${hash.toString('hex').add0x()}`);
                    return;
                }
            }

            let signature = Britto.signMessage(hash, validator.pk);
            let sigs = STACKSLayer1Validator.makeSigs(validator.address, signature);

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

                hashMap.set(hash.toString('hex').add0x(), {
                    txHash: thash,
                    timestamp: parseInt(Date.now() / 1000),
                })

                logger.stacks_layer_1.info(`applyLimitation: ${thash}`);
            });
        }
    }

    isValidAddress(toAddr) {
        const info = config.info[this.chainLower];
        if(toAddr.slice(0,2) !== "0x" || toAddr.length != 42) {
            return false;
        }

        let addr;
        try {
            if(info.ENDPOINT.network === "testnet"){
                addr = addressToString(addressFromVersionHash(AddressVersion.TestnetSingleSig, toAddr.replace("0x", "")));
                return addr.slice(0,2) === "ST";
            }
            else{
                addr = addressToString(addressFromVersionHash(AddressVersion.MainnetSingleSig, toAddr.replace("0x", "")));
                return addr.slice(0,2) === "SP";
            }
        } catch(e) {
            return false;
        }
    }

    receiveTransactionSuggested(event) {
        if(event.returnValues.govId.toLowerCase() !== this.govInfo.id.toLowerCase()) return;
        if(event.address.toLowerCase() !== this.stacksBridge.address.toLowerCase()) return;

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
        const stacksBridge = this.stacksBridge;
        const chainName = this.chainName;
        const govInfo = this.govInfo;
        const hashMap = this.hashMap;

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
        if(hashMap.has(suggestHash.toString('hex').add0x())){
            logger.stacks_layer_1.error(`Already signed. validated suggestHash: ${suggestHash.toString('hex').add0x()}`);
            return;
        }

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

            await txSender.sendTransaction(stacksBridge, txData, {address: sender.address, pk: sender.pk, timeout: 1}).then(thash => {
                hashMap.set(suggestHash.toString('hex').add0x(), {
                    txHash: thash,
                    timestamp: parseInt(Date.now() / 1000),
                })
            });
        }
    }

    receiveTransactionSelected(event) {
        if(event.returnValues.govId.toLowerCase() !== this.govInfo.id.toLowerCase()) return;
        if(event.address.toLowerCase() !== this.stacksBridge.address.toLowerCase()) return;

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
        const stacksBridge = this.stacksBridge;
        const chainName = this.chainName;
        const govInfo = this.govInfo;
        const hashMap = this.hashMap;

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
            let lastSignature = await this.collectSignature(lastSigHash);
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
        if(hashMap.has(signingHash.toString('hex').add0x())){
            logger.stacks_layer_1.error(`Already signed. validated signingHash: ${signingHash.toString('hex').add0x()}`);
            return;
        }

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

            await txSender.sendTransaction(stacksBridge, txData, {address: sender.address, pk: sender.pk, timeout: 1}).then(thash => {
                hashMap.set(signingHash.toString('hex').add0x(), {
                    txHash: thash,
                    timestamp: parseInt(Date.now() / 1000),
                })
            });
        }
    }

    async collectSignature(signatureHash) {
        const stacksBridge = this.stacksBridge;

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
        let toAddress = data.toAddress;
        let transfortData = data.data || '0x';
        if (!toAddress || toAddress.length === 0 || !toChain || toChain.length === 0) {
            logger.stacks_layer_1.error(`validateTagRequest error: toAddr or toChain is not defined.`);
            return;
        }

        if(!instances[toChain.toLowerCase()] || !instances[toChain.toLowerCase()].isValidAddress(toAddress)){
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
                logger.stacks_layer_1.error(`Already signed. validated tagHash: ${tagHash}`);
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
        }
    }
}

module.exports  = STACKSLayer1Validator;
