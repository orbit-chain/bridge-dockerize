global.logger.icon = require('./logger');

const config = require(ROOT + '/config');

const Britto = require(ROOT + '/lib/britto');
const txSender = require(ROOT + '/lib/txsender');
const api = require(ROOT + '/lib/api');
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
        this.orbitHub = config.orbitHub.address

        const govInfo = this.govInfo = config.governance;
        if(!govInfo || !govInfo.chain || !govInfo.address || !govInfo.bytes || !govInfo.id)
            throw 'Empty Governance Info';

        this.intervals = {
            getLockRelay: {
                handler: this.getLockRelay.bind(this),
                timeout: 1000 * 10,
                interval: null,
            }
        };

        const info = config.info[this.chainLower];
        global.monitor.setNodeConnectStatus(chainName, info.ENDPOINT.api, 'connecting');
        icon.getAddressByPK(this.account.pk).then(addr => {
            monitor.address[chainName] = addr;
            global.monitor.setNodeConnectStatus(chainName, info.ENDPOINT.api, 'connected');
        });

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
            let response = await api.bible.get("/v1/api/icon/lock-relay").catch(e => logger.icon.error('lock-relay api error: ' + e.message));
            if (response.success !== "success") {
                logger.icon.error(`lock-relay api error: ${response}`);
                return;
            }

            let info = response.info;
            if (!Array.isArray(info)) {
                logger.icon.error('Received data is not array.');
                return;
            }
    
            logger.icon.info(`LockRelay list ${info.length === 0 ? 'is empty.' : 'length: ' + info.length.toString()}`);
    
            for (let result of info) {
                if (this.govInfo.chain.replace("_LAYER_1", "") === result.toChain) result.toChain = this.govInfo.chain;
    
                let data = {
                    fromChain: result.fromChain,
                    toChain: result.toChain,
                    fromAddr: bridgeUtils.str2hex(result.fromAddr),
                    toAddr: bridgeUtils.str2hex(result.toAddr),
                    token: bridgeUtils.str2hex(result.token) || "0x0000000000000000000000000000000000000000",
                    relayThash: result.relayThash,
                    bytes32s: [this.govInfo.id, result.fromThash],
                    uints: [result.amount, result.decimals, result.depositId],
                    data: result.data
                };

                if (!bridgeUtils.isValidAddress(data.toChain, data.toAddr)) {
                    logger.icon.error(`Invalid toAddress ( ${data.toChain}, ${data.toAddr} )`);
                    continue;
                }
            
                if (data.data && !bridgeUtils.isValidData(data.toChain, data.data)) {
                    logger.icon.error(`Invalid data ( ${data.toChain}, ${data.data} )`);
                    continue;
                }
    
                await this.validateRelayedData(data);
            }
        } catch (e) {
            logger.icon.error('lock-relay api error: ' + e.message);
    
        } finally {
            this.intervalSet(this.intervals.getLockRelay);
        }
    }

    async validateRelayedData(data) {
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

            let hash = Britto.sha256sol(packer.packSwapData({
                hubContract: this.orbitHub,
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

            let res = await api.orbit.get(`/info/hash-info`, {whash: hash.toString('hex').add0x()})
            if(res.status === "success") {
                if(res.data.validators) {
                    for(var i = 0; i < res.data.validators.length; i++){
                        if(res.data.validators[i].toLowerCase() === validator.address.toLowerCase()){
                            logger.icon.error(`Already signed. validated swapHash: ${hash}`);
                            return;
                        }
                    }
                }

                let signature = Britto.signMessage(hash, validator.pk);
                let sigs = ICONValidator.makeSigs(validator.address, signature);
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

    isValidAddress(toAddr){
        const govInfo = this.govInfo;

        if(govInfo.chain === "ICON" && toAddr.toLowerCase() === govInfo.bytes.toLowerCase()){
            return false;
        }

        return (toAddr.slice(0,4) === '0x00' || toAddr.slice(0,4) === '0x01') && toAddr.length == 44;
    }

    async getTransaction(transactionId, _){
        const govInfo = this.govInfo;
        const info = config.info[this.chainLower];

        let mig = await icon.getCallBuilder(this.migAddress);

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

    async confirmTransaction(transactionId, a, b) {
        const pk = this.account.pk;
        const validator = await icon.getWalletByPK(pk);
        const vaAddress = await validator.getAddress();

        let mig = await icon.getCallBuilder(this.migAddress);

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
        let to = this.migAddress;
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
