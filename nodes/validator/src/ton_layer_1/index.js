global.logger.ton_layer_1 = require('./logger');

const config = require(ROOT + '/config');

const Britto = require(ROOT + '/lib/britto');
const txSender = require(ROOT + '/lib/txsender');

const BridgeUtils = require(ROOT + '/lib/bridgeutils');
const bridgeUtils = new BridgeUtils();

const packer = require("./utils/packer");
const Ton = require("./utils/ton.api");

const FIX_GAS = 99999999;

class TONLayer1Validator {
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

    static makeSigsWithED(validator, sigEC, sigED) {
        let va = bridgeUtils.padLeft(validator, 64);
        let ecV = bridgeUtils.padLeft(parseInt(sigEC.v).toString(16), 64);

        let sigs = [
            va,
            ecV,
            sigEC.r,
            sigEC.s,
            sigED.r,
            sigED.s,
        ]

        return sigs;
    }

    constructor(chain, _account) {
        if(chain.toLowerCase() !== "ton_layer_1")
            throw 'Invalid chain symbol';

        if (!_account || !_account.address || !_account.pk)
            throw 'Invalid Ethereum Wallet Account';
        this.account = _account;

        this.lastBlockNum = {
            tonAddressBook: null,
        };

        const chainName = this.chainName = chain.toUpperCase();
        this.chainLower = chain.toLowerCase();

        const govInfo = this.govInfo = config.governance;
        if(!govInfo || !govInfo.chain || !govInfo.address || !govInfo.bytes || !govInfo.id)
            throw 'Empty Governance Info';

        const info = config.info[this.chainLower];

        const ton = this.ton = new Ton(info.ENDPOINT);
        if(!ton) throw 'Invalid Ton Endpoint';

        const addressBook = this.addressBook = Britto.getNodeConfigBase('tonAddressBook');
        addressBook.rpc = config.info.orbit.ENDPOINT.rpc;
        addressBook.address = info.CONTRACT_ADDRESS.AddressBook;
        addressBook.abi = Britto.getJSONInterface({filename: 'addressbook/Ton'});

        this.addressBookEventList = [
            {
                name: 'RelayTag',
                callback: this.receiveAddressBookRelay.bind(this),
            }
        ];

        addressBook.onconnect = async () => {
            instances.hub.registerSubscriber(addressBook, this.addressBookEventList);

            if(monitor.address[chainName]) return;
            monitor.address[chainName] = await this.ton.getTonAccount(this.account.pk);
        };
        new Britto(addressBook, chainName).connectWeb3();

        this.multisigABI = Britto.getJSONInterface({filename: 'multisig/Ed25519'});

        addressBook.multisig.wallet = info.CONTRACT_ADDRESS.BridgeMultiSigWallet;
        addressBook.multisig.abi = this.multisigABI;
        addressBook.multisig.contract = new addressBook.web3.eth.Contract(addressBook.multisig.abi, addressBook.multisig.wallet);

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
        const ton = this.ton;
        const addressBook = this.addressBook;
        const chainName = this.chainName;
        const govInfo = this.govInfo;

        if(data.fromChain !== chainName){
            logger.ton_layer_1.error(`Invalid request. ${data.fromChain}`);
            return;
        }

        let vault = govInfo.address;
        let txHash = data.bytes32s[1];
        txHash = Buffer.from(txHash.replace("0x",""), 'hex').toString('base64');
        let lt = data.uints[2];

        let tx = await ton.getTransaction(vault, txHash, lt);
        if(!tx || !tx.data) {
            logger.ton_layer_1.error(`getTransaction error: ${txHash}, ${lt}`);
            return;
        }

        let description = await ton.parseTransaction(tx.data);
        if(!description || !description.computePhase || !description.actionPhase){
            logger.ton_layer_1.error(`Invalid description: ${txHash}, ${lt}`);
            return;
        }

        let computePhase = description.computePhase;
        if(!computePhase.success || parseInt(computePhase.exitCode) !== 0){
            logger.ton_layer_1.error(`ComputePhase fail: ${txHash}, ${lt}`);
            return;
        }

        let actionPhase = description.actionPhase;
        if(!actionPhase.success){
            logger.ton_layer_1.error(`ActionPhase fail: ${txHash}, ${lt}`);
            return;
        }

        let out_msgs = tx.out_msgs;
        if(out_msgs && out_msgs.length !== 0){
            logger.ton_layer_1.error(`Invalid transaction. OutMessage exist: ${txHash}, ${lt}`);
            return;
        }

        let in_msg = tx.in_msg;
        if(!in_msg || in_msg.source === vault || in_msg.destination !== vault || in_msg['@type'] !== 'raw.message'){
            logger.ton_layer_1.error(`Invalid in_msg data. ${txHash}, ${lt}`);
            return;
        }

        let msg_data = in_msg.msg_data;
        if(msg_data['@type'] !== 'msg.dataText'){
            logger.ton_layer_1.error(`Invalid msg_data type. ${txHash}, ${lt}`);
            return;
        }

        let fromAddr = await ton.getHashPart(in_msg.source);
        if(!fromAddr || fromAddr.length !== 66){
            logger.ton_layer_1.error(`Invalid from address. ${txHash}, ${lt}`);
            return;
        }

        let amount = in_msg.value;
        if(!amount || amount === '0' || isNaN(parseInt(amount))){
            logger.ton_layer_1.error(`Invalid amount. ${txHash}, ${lt}`);
            return;
        }

        let tag = in_msg.message;
        if(!tag || isNaN(parseInt(tag)) || parseInt(tag) <= 100000000){
            logger.ton_layer_1.error(`Invalid tag. ${txHash}, ${lt}, ${tag}`);
            return;
        }

        let addrData = await addressBook.contract.methods.getTag(tag).call().catch(e => {return;});
        if(!addrData){
            logger.ton_layer_1.error(`Invalid tag. ${txHash}, ${lt}`);
            return;
        }

        let toChain = addrData[0];
        let toAddr = addrData[1];
        let transfortData = addrData[2] || '0x';
        if (!toAddr || toAddr.length === 0 || !toChain || toChain.length === 0) {
            logger.ton_layer_1.error(`toAddr or toChain is not defined. ${txHash}, ${lt}`);
            return;
        }

        const vaultInfo = await ton.getMultisigData(vault);
        if(!vaultInfo || !vaultInfo.pubkeys || !vaultInfo.required){
            logger.ton_layer_1.error(`getVaultInfo error. ${txHash}, ${lt}`);
            return;
        }
        const publicKeys = vaultInfo.pubkeys;
        const required = vaultInfo.required;

        let version = await addressBook.contract.methods.versionCount().call().catch(e => {});
        if(!version){
            logger.ton_layer_1.error(`getAddressBookVersionCount error.`);
            return;
        }

        const tagHash = Britto.sha256sol(packer.packTagHash({
            version,
            toChain,
            toAddress: toAddr,
            transfortData
        })).toString('hex').add0x();

        const validators = await addressBook.multisig.contract.methods.getHashValidators(tagHash).call();
        let confirmed = 0;
        for(let i = 0; i < validators.length; i++){
            let va = validators[i]
            let vaPub = await addressBook.multisig.contract.methods.publicKeys(va).call();
            if(vaPub === "0x0000000000000000000000000000000000000000000000000000000000000000"
                || !publicKeys.find(pub => pub.toLowerCase() === vaPub.toLowerCase())) continue;

            let edR = await addressBook.multisig.contract.methods.edRSigs(tagHash, i).call().catch(e => {});
            let edS = await addressBook.multisig.contract.methods.edSSigs(tagHash, i).call().catch(e => {});
            if(!edR || !edS) continue;

            vaPub = vaPub.remove0x();
            edR = edR.remove0x();
            edS = edS.remove0x();

            if(!Britto.verifyEd25519(tagHash, `${edR}${edS}`, vaPub)) continue;

            confirmed = confirmed + 1;
        }
        if(confirmed < parseInt(required)) {
            logger.ton_layer_1.error(`validated address not matched in vault signer addresses. ${txHash}, ${lt}, ${tag}`);
            return;
        }

        let currentBlock = await ton.getCurrentBlock().catch(e => {});
        if (!currentBlock){
            logger.ton_layer_1.error('getBlockNumber() execute error');
            return;
        }

        let txBlock = await ton.getTransactionBlock(vault, lt).catch(e => {});
        if (!txBlock){
            logger.ton_layer_1.error('getTransactionBlock() execute error');
            return;
        }

        let isConfirmed = parseInt(currentBlock) - parseInt(txBlock) >= config.system.tonConfirmCount;
        if(!isConfirmed){
            logger.ton_layer_1.error(`depositId(${data.uints[2]}) is invalid. isConfirmed: ${isConfirmed}`);
            return;
        }

        let params = {
            fromChain: chainName,
            toChain: toChain,
            fromAddr: fromAddr,
            toAddr: toAddr,
            token: '0x0000000000000000000000000000000000000000',
            bytes32s: [govInfo.id, data.bytes32s[1]],
            uints: [amount, 9, data.uints[2]],
            data: transfortData
        };

        const toInstance = instances[params.toChain.toLowerCase()];
        if(!toInstance) {
            logger.ton_layer_1.error(`${params.toChain} instance is not exist`);
            return;
        }
        await toInstance.validateSwap(data, params);
    }

    async validateSwap(_, params){
        const validator = {address: this.account.address, pk: this.account.pk};

        const orbitHub = instances.hub.getOrbitHub();
        const chainIds = instances.hub.getChainIds();
        const chainName = this.chainName;
        const govInfo = this.govInfo;
        const hashMap = this.hashMap;
        const multisigABI = this.multisigABI;

        if(chainName !== params.toChain){
            logger.ton_layer_1.error(`Invalid toChain. ${chainName} : ${params.toChain}`);
            return;
        }

        if(!this.isValidAddress(params.toAddr)){
            logger.ton_layer_1.error(`Invalid toAddr. ${params.toAddr}`);
            return;
        }

        if(params.token !== "0x0000000000000000000000000000000000000000"){
            logger.ton_layer_1.error(`Invalid token. ${params.token}`);
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
                logger.ton_layer_1.error("Cannot Generate account");
                return;
            }

            let fromChainId = chainIds[data.fromChain];
            let toChainId = chainIds[data.toChain];
            if(!fromChainId || !toChainId){
                logger.ton_layer_1.error(`Cannot get chainId. ${data.fromChain}, ${data.toChain}`);
                return;
            }

            let swapData = {
                hubContract: orbitHub.address,
                fromChainId: fromChainId,
                toChainId: toChainId,
                fromAddr: data.fromAddr,
                toAddr: data.toAddr,
                token: data.token,
                bytes32s: data.bytes32s,
                uints: data.uints,
                data: data.data,
            }

            let hashA = Britto.sha256sol(packer.packSwapDataA(swapData)).toString('hex').add0x();
            let hashB = Britto.sha256sol(packer.packSwapDataB(swapData)).toString('hex').add0x();
            let hashC = Britto.sha256sol(packer.packSwapDataC(swapData)).toString('hex').add0x();
            let hashD = Britto.sha256sol(packer.packSwapDataD(swapData)).toString('hex').add0x();

            let hash1 = Britto.sha256sol(packer.packSigHash({hash1: hashA, hash2: hashB}));
            let hash2 = Britto.sha256sol(packer.packSigHash({hash1: hashC, hash2: hashD}));

            let hash = Britto.sha256sol(packer.packSigHash({hash1, hash2}));
            if(hashMap.has(hash.toString('hex').add0x())){
                logger.ton_layer_1.error(`Already signed. validated swapHash: ${hash.toString('hex').add0x()}`);
                return;
            }

            let toChainMig = await orbitHub.contract.methods.getBridgeMig(data.toChain, govInfo.id).call();
            let contract = new orbitHub.web3.eth.Contract(multisigABI, toChainMig);

            let validators = await contract.methods.getHashValidators(hash.toString('hex').add0x()).call();
            for(var i = 0; i < validators.length; i++){
                if(validators[i].toLowerCase() === validator.address.toLowerCase()){
                    logger.ton_layer_1.error(`Already signed. validated swapHash: ${hash}`);
                    return;
                }
            }

            let ecSig = Britto.signMessage(hash, validator.pk);
            let edSig = Britto.signEd25519(hash, validator.pk);
            let sigs = TONLayer1Validator.makeSigsWithED(validator.address, ecSig, edSig);

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
                logger.ton_layer_1.error('validateSwap estimateGas error: ' + e.message)
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
                logger.ton_layer_1.error("Cannot Generate account");
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
                logger.ton_layer_1.error(`Already signed. validated limitationHash: ${hash.toString('hex').add0x()}`);
                return;
            }

            let hubMig = await orbitHub.contract.methods.getBridgeMig("HUB", govInfo.id).call();
            let migCon = new orbitHub.web3.eth.Contract(multisigABI, hubMig);

            let validators = await migCon.methods.getHashValidators(hash.toString('hex').add0x()).call();
            for(var i = 0; i < validators.length; i++){
                if(validators[i].toLowerCase() === validator.address.toLowerCase()){
                    logger.ton_layer_1.error(`Already signed. applyLimitation: ${hash}`);
                    return;
                }
            }

            let signature = Britto.signMessage(hash, validator.pk);
            let sigs = TONLayer1Validator.makeSigs(validator.address, signature);

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
                    logger.ton_layer_1.error(`applyLimitation error: ${err.message}`);
                    return;
                }

                hashMap.set(hash.toString('hex').add0x(), {
                    txHash: thash,
                    timestamp: parseInt(Date.now() / 1000),
                })

                logger.ton_layer_1.info(`applyLimitation: ${thash}`);
            });
        }
    }

    isValidAddress(toAddr) {
        return toAddr.slice(0,2) === "0x" && toAddr.length == 66;
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
            logger.ton_layer_1.error(`validateTagRequest error: invalid toChain ${toChain}`);
            return;
        }

        let toAddress = data.toAddress;
        if (!toAddress || toAddress.length === 0) {
            logger.ton_layer_1.error(`validateTagRequest error: toAddr or toChain is not defined.`);
            return;
        }

        if(!instances[toChain.toLowerCase()] || !instances[toChain.toLowerCase()].isValidAddress(toAddress)){
            logger.ton_layer_1.error(`Invalid toAddress ( ${toChain}, ${toAddress} )`);
            return;
        }

        let transfortData = data.data || '0x';

        let version = await addressBook.contract.methods.versionCount().call().catch(e => {});
        if(!version){
            logger.ton_layer_1.error(`getAddressBookVersionCount error.`);
            return;
        }

        let packerData = {
            version,
            toChain,
            toAddress,
            transfortData
        };

        let tagHash = Britto.sha256sol(packer.packTagHash(packerData));

        let validators = await addressBook.multisig.contract.methods.getHashValidators(tagHash.toString('hex').add0x()).call();
        for(var i = 0; i < validators.length; i++){
            if(validators[i].toLowerCase() === validator.address.toLowerCase()){
                logger.ton_layer_1.error(`Already signed. validated tagHash: ${tagHash}`);
                return;
            }
        }

        let ecSig = Britto.signMessage(tagHash, validator.pk);
        let edSig = Britto.signEd25519(tagHash, validator.pk);

        valid();

        async function valid() {
            let sender = Britto.getRandomPkAddress();
            if(!sender || !sender.pk || !sender.address){
                logger.ton_layer_1.error("Cannot Generate account");
                return;
            }

            let params = [
                packerData.toChain,
                packerData.toAddress,
                packerData.transfortData,
                validator.address,
                ecSig.v,
                [ecSig.r, edSig.r],
                [ecSig.s, edSig.s]
            ];

            let txOptions = {
                gasPrice: addressBook.web3.utils.toHex('0'),
                from: sender.address,
                to: addressBook.address
            };

            let gasLimit = await addressBook.contract.methods.setTag(...params).estimateGas(txOptions).catch(e => {
                logger.ton_layer_1.error('validateTagRequest estimateGas error: ' + e.message)
            });
            if (!gasLimit) {
                return;
            }

            txOptions.gasLimit = addressBook.web3.utils.toHex(FIX_GAS);

            let txData = {
                method: 'setTag',
                args: params,
                options: txOptions
            };

            await txSender.sendTransaction(addressBook, txData, {address: sender.address, pk: sender.pk, timeout: 1});
        }
    }
}

module.exports = TONLayer1Validator;
