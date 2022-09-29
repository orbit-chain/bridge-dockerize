global.logger.icon = require('./logger');

const config = require(ROOT + '/config');

const Britto = require(ROOT + '/lib/britto');
const txSender = require(ROOT + '/lib/txsender');
const packer = require('./utils/packer');

const icon = require('./utils/icon.api');
const BridgeUtils = require(ROOT + '/lib/bridgeutils');
const bridgeUtils = new BridgeUtils();

const FIX_GAS = 99999999;

class ICONValidator {
    static makeSigs(validator, signature){
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
        if(chain.toLowerCase() !== "icon")
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
        global.monitor.setNodeConnectStatus(chainName, info.ENDPOINT.api, 'connecting');
        icon.getAddressByPK(this.account.pk).then(addr => {
            monitor.address[chainName] = addr;
            global.monitor.setNodeConnectStatus(chainName, info.ENDPOINT.api, 'connected');
        });

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

    async validateRelayedData(data) {
        const orbitHub = instances.hub.getOrbitHub();
        const chainName = this.chainName;
        const govInfo = this.govInfo;

        let receipt = await icon.getTransactionResult(data.bytes32s[1]);
        if (!receipt){
            logger.icon.error('No transaction receipt.');
            return;
        }

        if (receipt.eventLogs.length === 0){
            logger.icon.error('No transaction event log.');
            return;
        }

        let currentBlock = await icon.getLastBlock().catch(e => {
            logger.icon.error('getLastBlock() execute error: ' + e.message);
        });
        if (!currentBlock)
            return console.error('No current block data.');

        global.monitor.setBlockNumber(chainName + '_MAINNET', currentBlock.height);

        // Check deposit block confirmed
        let isConfirmed = parseInt(currentBlock.height) - parseInt(receipt.blockHeight) >= config.system.iconConfirmCount;
        if (!isConfirmed) {
            console.log(`depositId(${data.uints[2]}) is invalid. isConfirmed: ${isConfirmed}`);
            return;
        }

        let fromChain;
        let toChain;
        let fromAddr;
        let toAddr;
        let token;
        let decimal;
        let amount;
        let depositId;
        let executionData;

        let log;
        //SwapRequest(self, fromChain: str, toChain: str, fromAddr: bytes, toAddr: bytes, token: bytes, tokenAddress: bytes, decimal: int, amount: int, depositId: int, data: bytes):
        const MINTER_EVENT = "SwapRequest(str,str,bytes,bytes,bytes,bytes,int,int,int,bytes)";
        //Deposit(self, fromChain: str, toChain: str, fromAddr: bytes, toAddr: bytes, token: bytes, decimal: int, amount: int, depositId: int, data: bytes)
        const VAULT_EVENT = "Deposit(str,str,bytes,bytes,bytes,int,int,int,bytes)";
        for(log of receipt.eventLogs){
            if(log.scoreAddress.toLowerCase() !== icon.contract.address.toLowerCase())
                continue;

            if(log.indexed[0] !== MINTER_EVENT && log.indexed[0] !== VAULT_EVENT) continue;

            if(log.indexed[0] === MINTER_EVENT && icon.toHex(log.data[8]) === icon.toHex(data.uints[2])){
                fromChain = log.data[0];
                toChain = log.data[1];
                fromAddr = log.data[2];
                toAddr = log.data[3];
                token = log.data[4];
                decimal = log.data[6];
                amount = log.data[7];
                depositId = log.data[8];
                executionData = log.data[9];
            }

            if(log.indexed[0] === VAULT_EVENT && icon.toHex(log.data[7]) === icon.toHex(data.uints[2])){
                fromChain = log.data[0];
                toChain = log.data[1];
                fromAddr = log.data[2];
                toAddr = log.data[3];
                token = log.data[4];
                decimal = log.data[5];
                amount = log.data[6];
                depositId = log.data[7];
                executionData = log.data[8];
            }
        }
        if (!executionData) {
            executionData = '0x';
        }

        if(!fromChain || !toChain || !fromAddr || !toAddr || !token || !decimal || !amount || !depositId || !executionData){
            logger.icon.error("Can't find event data");
            return;
        }

        let params = {
            fromChain: fromChain,
            toChain: toChain,
            fromAddr: fromAddr,
            toAddr: toAddr,
            token: token,
            bytes32s: [ govInfo.id, data.bytes32s[1] ],
            uints: [ amount, decimal, depositId ],
            data: executionData
        }

        const toInstance = instances[params.toChain.toLowerCase()];
        if(!toInstance) {
            logger.icon.error(`${params.toChain} instance is not exist`);
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
            logger.icon.error(`Invalid toChain. ${chainName} : ${params.toChain}`);
            return;
        }

        if(!this.isValidAddress(params.toAddr)){
            logger.icon.error(`Invalid Address. ${params.toAddr}`);
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
                logger.icon.error("Cannot Generate account");
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
                data: data.data
            }));

            if(hashMap.has(hash.toString('hex').add0x())){
                logger.icon.error(`Already signed. validated swapHash: ${hash.toString('hex').add0x()}`);
                return;
            }

            let toChainMig = await orbitHub.contract.methods.getBridgeMig(data.toChain, govInfo.id).call();
            let contract = new orbitHub.web3.eth.Contract(multisigABI, toChainMig);

            let validators = await contract.methods.getHashValidators(hash.toString('hex').add0x()).call();
            for(var i = 0; i < validators.length; i++){
                if(validators[i].toLowerCase() === validator.address.toLowerCase()){
                    logger.icon.error(`Already signed. validated swapHash: ${hash}`);
                    return;
                }
            }

            let signature = Britto.signMessage(hash, validator.pk);
            let sigs = ICONValidator.makeSigs(validator.address, signature);

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
                logger.icon.error('validateSwap estimateGas error: ' + e.message)
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
                logger.icon.error("Cannot Generate account");
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
                logger.icon.error(`Already signed. validated swapHash: ${hash.toString('hex').add0x()}`);
                return;
            }

            let hubMig = await orbitHub.contract.methods.getBridgeMig("HUB", govInfo.id).call();
            let migCon = new orbitHub.web3.eth.Contract(multisigABI, hubMig);

            let validators = await migCon.methods.getHashValidators(hash.toString('hex').add0x()).call();
            for(var i = 0; i < validators.length; i++){
                if(validators[i].toLowerCase() === validator.address.toLowerCase()){
                    logger.icon.error(`Already signed. applyLimitation: ${hash}`);
                    return;
                }
            }

            let signature = Britto.signMessage(hash, validator.pk);
            let sigs = ICONValidator.makeSigs(validator.address, signature);

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
                    logger.icon.error(`applyLimitation error: ${err.message}`);
                    return;
                }

                hashMap.set(hash.toString('hex').add0x(), {
                    txHash: thash,
                    timestamp: parseInt(Date.now() / 1000),
                })

                logger.icon.info(`applyLimitation: ${thash}`);
            });
        }
    }

    async validateRelayedNFTData(data) {
        const orbitHub = instances.hub.getOrbitHub();
        const chainName = this.chainName;
        const govInfo = this.govInfo;

        let receipt = await icon.getTransactionResult(data.bytes32s[1]);
        if (!receipt){
            logger.icon.error('No transaction receipt.');
            return;
        }

        if (receipt.eventLogs.length === 0){
            logger.icon.error('No transaction event log.');
            return;
        }

        let currentBlock = await icon.getLastBlock().catch(e => {
            logger.icon.error('getLastBlock() execute error: ' + e.message);
        });
        if (!currentBlock)
            return console.error('No current block data.');

        global.monitor.setBlockNumber(chainName + '_MAINNET', currentBlock.height);

        // Check deposit block confirmed
        let isConfirmed = parseInt(currentBlock.height) - parseInt(receipt.blockHeight) >= config.system.iconConfirmCount;
        if (!isConfirmed) {
            console.log(`depositId(${data.uints[2]}) is invalid. isConfirmed: ${isConfirmed}`);
            return;
        }

        let fromChain;
        let toChain;
        let fromAddr;
        let toAddr;
        let token;
        let tokenId;
        let amount;
        let depositId;
        let executionData;

        let log;
        //SwapNFTRequest(self, fromChain: str, toChain: str, fromAddr: bytes, toAddr: bytes, token: bytes, tokenAddress: bytes, tokenId: int, amount: int, depositId: int, data: bytes)
        const MINTER_EVENT = "SwapNFTRequest(str,str,bytes,bytes,bytes,bytes,int,int,int,bytes)"
        //DepositNFT(self, fromChain: str, toChain: str, fromAddr: bytes, toAddr: bytes, token: bytes, tokenId: int, amount: int, depositId: int, data: bytes):
        const VAULT_EVENT = "DepositNFT(str,str,bytes,bytes,bytes,int,int,int,bytes)";
        for(log of receipt.eventLogs){
            if(log.scoreAddress.toLowerCase() !== icon.contract.address.toLowerCase())
                continue;

            if(log.indexed[0] !== MINTER_EVENT && log.indexed[0] !== VAULT_EVENT) continue;

            if(log.indexed[0] === MINTER_EVENT && icon.toHex(log.data[8]) === icon.toHex(data.uints[2])){
                fromChain = log.data[0];
                toChain = log.data[1];
                fromAddr = log.data[2];
                toAddr = log.data[3];
                token = log.data[4];
                tokenId = log.data[6];
                amount = log.data[7];
                depositId = log.data[8];
                executionData = log.data[9];
            }

            if(log.indexed[0] === VAULT_EVENT && icon.toHex(log.data[7]) === icon.toHex(data.uints[2])){
                fromChain = log.data[0];
                toChain = log.data[1];
                fromAddr = log.data[2];
                toAddr = log.data[3];
                token = log.data[4];
                tokenId = log.data[5];
                amount = log.data[6];
                depositId = log.data[7];
                executionData = log.data[8];
            }
        }
        if (!executionData) {
            executionData = '0x';
        }

        if(!fromChain || !toChain || !fromAddr || !toAddr || !token || !amount || !depositId || !executionData || !tokenId){
            logger.icon.error("Can't find event data");
            return;
        }

        let params = {
            fromChain: fromChain,
            toChain: toChain,
            fromAddr: fromAddr,
            toAddr: toAddr,
            token: token,
            bytes32s: [ govInfo.id, data.bytes32s[1] ],
            uints: [ amount, tokenId, depositId ],
            data: executionData
        }

        const toInstance = instances[params.toChain.toLowerCase()];
        if(!toInstance) {
            logger.icon.error(`${params.toChain} instance is not exist`);
            return;
        }
        await toInstance.validateSwapNFT(data, params);
    }

    async validateSwapNFT(_, params) {
        const validator = {address: this.account.address, pk: this.account.pk};

        const orbitHub = instances.hub.getOrbitHub();
        const chainName = this.chainName;
        const govInfo = this.govInfo;
        const hashMap = this.hashMap;
        const multisigABI = this.multisigABI;

        if(chainName !== params.toChain){
            logger.icon.error(`Invalid toChain. ${chainName} : ${params.toChain}`);
            return;
        }

        if(!this.isValidAddress(params.toAddr)){
            logger.icon.error(`Invalid Address. ${params.toAddr}`);
            return;
        }

        await valid(params);

        async function valid(data) {
            let sender = Britto.getRandomPkAddress();
            if(!sender || !sender.pk || !sender.address){
                logger.icon.error("Cannot Generate account");
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
                logger.icon.error(`Already signed. validated swapHash: ${hash}`);
                return;
            }

            let toChainMig = await orbitHub.contract.methods.getBridgeMig(data.toChain, govInfo.id).call();
            let contract = new orbitHub.web3.eth.Contract(multisigABI, toChainMig);

            let validators = await contract.methods.getHashValidators(hash.toString('hex').add0x()).call();
            for(var i = 0; i < validators.length; i++){
                if(validators[i].toLowerCase() === validator.address.toLowerCase()){
                    logger.icon.error(`Already signed. validated swapHash: ${hash}`);
                    return;
                }
            }

            let signature = Britto.signMessage(hash, validator.pk);

            let sigs = ICONValidator.makeSigs(validator.address, signature);

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
                logger.icon.error('validateSwapNFT estimateGas error: ' + e.message)
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

    isValidAddress(toAddr){
        const govInfo = this.govInfo;

        if(govInfo.chain === "ICON" && toAddr.toLowerCase() === govInfo.bytes.toLowerCase()){
            return false;
        }

        return (toAddr.slice(0,4) === '0x00' || toAddr.slice(0,4) === '0x01') && toAddr.length == 44;
    }

    async getTransaction(multisig, transactionId, _){
        const govInfo = this.govInfo;
        const info = config.info[this.chainLower];

        let mig = await icon.getCallBuilder(multisig);

        let transaction = await icon.call(mig, "getTransactionInfo", {"_transactionId": transactionId}).catch(e=>{return;});
        if(!transaction || !transaction._destination) return "GetTransaction Error";

        let ownerCount = await icon.call(mig, "getWalletOwnerCount", {}).catch(e=>{return;});
        if(!ownerCount) return "GetWalletOwnerCount Error";

        let confirmedList = await icon.call(mig, "getConfirmations", {"_offset": "0", "_count": ownerCount, "_transactionId": transactionId}).catch(e=>{return;});
        if(!confirmedList) return "GetConfirmations Error";

        let myConfirmation = !!(confirmedList.find(va => va.toLowerCase() === this.account.address.toLowerCase()));

        let required = await icon.call(mig, "getRequirement", {}).catch(e=>{return;});
        if(!required) return "GetRequirement Error";

        transaction.myConfirmation = myConfirmation;
        transaction.required = required;
        transaction.confirmedList = confirmedList;

        let knownContract = info.CONTRACT_ADDRESS;

        let destinationContract = "Unknown Contract";
        for (var key in knownContract){
            let addr = knownContract[key];
            if(!addr) continue;

            if(addr.toLowerCase() === transaction._destination.toLowerCase()){
                destinationContract = key;
                break;
            }
        }
        if(transaction._destination.toLowerCase() === govInfo.address.toLowerCase()){
            destinationContract = `${govInfo.chain} Vault`;
        }
        transaction.destinationContract = destinationContract;

        transaction.method = transaction._method;
        transaction.params = JSON.parse(transaction._params);

        return transaction;
    }

    async confirmTransaction(multisig, transactionId, a, b) {
        const govInfo = this.govInfo;
        const info = config.info[this.chainLower];

        const pk = this.account.pk;
        const validator = await icon.getWalletByPK(pk);
        const vaAddress = await validator.getAddress();

        let mig = await icon.getCallBuilder(multisig);

        let transaction = await icon.call(mig, "getTransactionInfo", {"_transactionId": transactionId}).catch(e=>{return;});
        if(!transaction || !transaction._destination) return "GetTransaction Error";

        let ownerCount = await icon.call(mig, "getWalletOwnerCount", {}).catch(e=>{return;});
        if(!ownerCount) return "GetWalletOwnerCount Error";

        let confirmedList = await icon.call(mig, "getConfirmations", {"_offset": "0", "_count": ownerCount, "_transactionId": transactionId}).catch(e=>{return;});
        if(!confirmedList) return "GetConfirmations Error";

        let myConfirmation = !!(confirmedList.find(va => va.toLowerCase() === vaAddress.toLowerCase()));

        let required = await icon.call(mig, "getRequirement", {}).catch(e=>{return;});
        if(!required) return "GetRequirement Error";

        if(myConfirmation || parseInt(required) === parseInt(confirmedList.length))
            return "Already Confirmed"

        let from = vaAddress;
        let to = multisig;
        let method = "confirmTransaction";

        let params = {
            _transactionId: transactionId
        }

        let tx = await icon.makeContractTransaction(from, to, 0, method, params).catch(e=>{return;});
        if(!transaction) return "Transaction Builder Error";

        let stepLimit = await icon.estimateStepLimit(tx).catch(e=>{return;});
        if(!stepLimit) return "EstimateGas Error";

        let txHash = await icon.sendTransaction(validator, tx, stepLimit).catch(e=>{return e});
        if(!txHash) return "SendTransaction Error";

        return txHash;
    }
}

module.exports = ICONValidator;
