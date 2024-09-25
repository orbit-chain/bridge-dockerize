global.logger.ton = require('./logger');

const config = require(ROOT + '/config');

const Britto = require(ROOT + '/lib/britto');
const txSender = require(ROOT + '/lib/txsender');
const api = require(ROOT + '/lib/api');

const BridgeUtils = require(ROOT + '/lib/bridgeutils');
const bridgeUtils = new BridgeUtils();

const packer = require("./utils/packer");
const Ton = require("./utils/ton.api");

const FIX_GAS = 99999999;

const UINT64_MAX = "18446744073709551616";

const { Cell, Slice } = require("ton");

class TONValidator {
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
        this.chainIds = config.chainIds;

        if(chain.toLowerCase() !== "ton")
            throw 'Invalid chain symbol';

        if (!_account || !_account.address || !_account.pk)
            throw 'Invalid Ethereum Wallet Account';
        this.account = _account;

        const chainName = this.chainName = chain.toUpperCase();
        this.chainLower = chain.toLowerCase();

        const govInfo = this.govInfo = config.governance;
        if(!govInfo || !govInfo.chain || !govInfo.address || !govInfo.bytes || !govInfo.id)
            throw 'Empty Governance Info';

        this.intervals = {
            getLockRelay: {
                handler: this.getLockRelay.bind(this),
                timeout: 1000 * 10,
                interval: null,
            },
        };

        this.orbitHub = config.orbitHub.address
        const info = config.info[this.chainLower];
        this.tonMinter = info.CONTRACT_ADDRESS.minter;

        const ton = this.ton = new Ton(info.ENDPOINT);
        if(!ton) throw 'Invalid Ton Endpoint';

        ton.getTonAccount(this.account.pk).then(account => {
            if(monitor.address[chainName]) return;
            monitor.address[chainName] = account;
        });

        this.migAddress = info.CONTRACT_ADDRESS.multisig
        this.multisigABI = Britto.getJSONInterface({filename: 'multisig/Ed25519'});
        this.requestSwapABI = {"event":"RequestSwap","data":[[{"name":"opCode","type":"uint32","value":"hex"}],[{"name":"token","type":"uint160","value":"hex"},{"name":"toChain","type":"uint256","value":"hex"},{"name":"toAddr","type":"uint160","value":"hex"},{"name":"amount","type":"uint256","value":"uint32"}],[{"name":"fromAddr","type":"address","value":"address"},{"name":"tokenAddress","type":"address","value":"addressx"},{"name":"depositId","type":"uint256","value":"uint32"},{"name":"decimal","type":"uint8","value":"uint32"}]]};

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
            const response = await api.bible.get("/v1/api/ton/lock-relay");
            if (response.success !== "success") {
                logger.ton.error(`lock-relay api error: ${response}`);
                return;
            }
            let info = response.info;
            if (!Array.isArray(info)) {
                logger.ton.error('Received data is not array.');
                return;
            }
            info = info.filter(i => parseInt(i.type) !== 0);

            logger.ton.info(`LockRelay list ${info.length === 0 ? 'is empty.' : 'length: ' + info.length.toString()}`);

            for (let result of info) {
                let data = {
                    fromChain: this.chainName.toUpperCase(),
                    toChain: result.toChain,
                    fromAddr: result.fromAddr,
                    toAddr: result.toAddr,
                    token: result.token,
                    bytes32s: [this.govInfo.id, result.fromThash],
                    uints: [result.amount, result.decimals, result.depositId, result.lt], // result.lt?
                    data: result.data || '0x'
                };
                
                const tonMinter = this.tonMinter;
                const ton = this.ton;

                let txHash = data.bytes32s[1];
                txHash = Buffer.from(txHash.replace("0x",""), 'hex').toString('base64');
                let lt = data.uints[3];
                if(!lt) continue;

                let tx = await ton.getTransaction(tonMinter, txHash, lt);
                if(!tx){
                    logger.ton.error(`Skip relay ${data.bytes32s[1]}:${data.uints[3]}`);
                    continue;
                }

                if(!bridgeUtils.isValidAddress(data.toChain, data.toAddr)){
                    logger.ton.error(`Invalid toAddress ( ${data.toChain}, ${data.toAddr} )`);
                    continue;
                }

                if(data.data && !bridgeUtils.isValidData(data.toChain, data.data)){
                    logger.ton.error(`Invalid data ( ${data.toChain}, ${data.data} )`);
                    continue;
                }

                await this.validateRelayedData(data);
            }
        } catch (e) {
            logger.ton.error(`lock-relay api error: ${e.message}`);
        } finally {
            this.intervalSet(this.intervals.getLockRelay);
        }
    }

    async validateRelayedData(data) {
        const chainIds = this.chainIds;
        const ton = this.ton;
        const tonMinter = this.tonMinter;
        const chainName = this.chainName;
        const govInfo = this.govInfo;
        const REQUEST_SWAP = this.requestSwapABI;

        let txHash = data.bytes32s[1];
        txHash = Buffer.from(txHash.replace("0x",""), 'hex').toString('base64');

        let depositId = data.uints[2];
        let lt = data.uints[3];
        if(lt.dcomp(UINT64_MAX) !== -1){
            logger.ton.error(`Invalid logical time: ${lt}`);
            return;
        }

        let tx = await ton.getTransaction(tonMinter, txHash, lt);
        if(!tx || !tx.data || !tx.transaction_id){
            logger.ton.error(`getTransaction error: ${txHash}, ${lt}`);
            return;
        }

        lt = tx.transaction_id.lt;
        if(!lt || lt.dcomp(UINT64_MAX) !== -1) {
            logger.ton.error(`Invalid logical time from return value: ${lt}`);
            return;
        }

        let description = await ton.parseTransaction(tx.data);
        if(!description || !description.computePhase || !description.actionPhase){
            logger.ton.error(`Invalid description: ${txHash}, ${lt}`);
            return;
        }

        let computePhase = description.computePhase;
        if(!computePhase.success || parseInt(computePhase.exitCode) !== 0){
            logger.ton.error(`ComputePhase fail: ${txHash}, ${lt}`);
            return;
        }

        let actionPhase = description.actionPhase;
        if(!actionPhase.success){
            logger.ton.error(`ActionPhase fail: ${txHash}, ${lt}`);
            return;
        }

        let out_msgs = tx.out_msgs;
        if(!out_msgs || out_msgs.length === 0){
            logger.ton.error(`parseEvent error: ${txHash}, ${lt}`);
            return;
        }

        let res;
        for(let event of out_msgs){
            if(event.destination !== '') continue;
            if(!event.source || event.source !== tonMinter) continue;
            if(!event.value || event.value !== '0') continue;
            if(!event.msg_data || !event.msg_data.body || event.msg_data['@type'] !== 'msg.dataRaw') continue;

            const slice = Slice.fromCell(Cell.fromBoc(Buffer.from(event.msg_data.body, 'base64'))[0]);
            let opCode = null
            try {
                opCode = "0x"+slice.readUint(32).toString('hex'); // BN return
            } catch (e) {}
            if(!opCode || opCode !== "0x3afd461c") continue;

            let obj = {};
            for (let i=1; i< REQUEST_SWAP.data.length;i++) {
                let list = REQUEST_SWAP.data[i];
                let child = slice.readRef();
                for (let o of list) {
                    let value;
                    if (o.type === "address") {
                        value = child.readAddress()?.toFriendly();
                    } else {
                        value = child.readUint(Number(o.type.split('uint')[1]));
                    }

                    switch (o.value) {
                        case 'string':
                            value = Buffer.from(value.toString(16), 'hex').toString()
                            break;
                        case 'hex':
                            let length = parseInt(parseInt(o.type.replace("uint","")) / 4);
                            value = "0x"+value.toString(16).padStart(length, 0);
                            break;
                        case 'uint32':
                            value = value.toString()
                            break;
                        case 'number':
                            value = Number(value.toNumber())
                            break;
                    }

                    if (o.name.endsWith('[]')) {
                        let n = o.name.split('[]')[0]
                        if (!obj[n])
                            obj[n] = []
                        obj[n].push(value)
                    } else if (o.name.endsWith('{}')) {
                        let n = o.name.split('{}}')[0]
                        obj[n] = value
                    } else {
                        obj[o.name] = value;
                    }
                }
            }

            if(parseInt(obj.depositId) !== parseInt(depositId)) continue;
            res = obj;
        }
        if(!res) {
            logger.ton.error(`Invalid Transaction : ${txHash}, ${lt}`);
            return;
        }

        let toChain;
        for(let chain in chainIds){
            if(chainIds[chain] !== res.toChain) continue;
            toChain = chain;
            break;
        }
        if(!toChain){
            logger.ton.error(`Invalid toChainId in event: ${txHash}, ${lt}, ${res.toChain}`);
            return;
        }

        let fromAddr = await ton.getHashPart(res.fromAddr);
        if(!fromAddr || fromAddr.length !== 66){
            logger.ton.error(`Invalid fromAddr in event: ${txHash}, ${lt}, ${res.fromAddr}`);
            return;
        }

        let currentBlock = await ton.getCurrentBlock().catch(e => {});
        if (!currentBlock){
            logger.ton.error('getBlockNumber() execute error');
            return;
        }

        let txBlock = await ton.getTransactionBlock(tonMinter, lt).catch(e => {});
        if (!txBlock){
            logger.ton.error('getTransactionBlock() execute error');
            return;
        }

        let isConfirmed = parseInt(currentBlock) - parseInt(txBlock) >= config.system.tonConfirmCount;
        if(!isConfirmed){
            logger.ton.error(`depositId(${data.uints[2]}) is invalid. isConfirmed: ${isConfirmed}`);
            return;
        }

        let params = {
            hubContract: this.orbitHub,
            fromChain: this.chainName,
            toChain: toChain.toUpperCase(),
            fromAddr: fromAddr,
            toAddr: res.toAddr,
            token: res.token,
            bytes32s: [govInfo.id, data.bytes32s[1]],
            uints: [res.amount, res.decimal, res.depositId, lt],
            data: "0x"
        }

        const toInstance = instances[params.toChain.toLowerCase()];
        if(!toInstance) {
            logger.ton.error(`${params.toChain} instance is not exist`);
            return;
        }
        await toInstance.validateSwap(data, params);
    }

    async validateSwap(_, params){
        const validator = {address: this.account.address, pk: this.account.pk};

        const chainIds = this.chainIds;
        const chainName = this.chainName;
        const govInfo = this.govInfo;
        const hashMap = this.hashMap;
        const multisigABI = this.multisigABI;

        if(chainName !== params.toChain){
            logger.ton.error(`Invalid toChain. ${chainName} : ${params.toChain}`);
            return;
        }

        if(!this.isValidAddress(params.toAddr)){
            logger.ton.error(`Invalid toAddr. ${params.toAddr}`);
            return;
        }

        await valid(params, chainIds, this.orbitHub);

        async function valid(data, chainIds, orbitHubAddress) {
            let fromChainId = chainIds[data.fromChain.toUpperCase()];
            let toChainId = chainIds[data.toChain.toUpperCase()];
            if(!fromChainId || !toChainId){
                logger.ton.error(`Cannot get chainId. ${data.fromChain}, ${data.toChain}`);
                return;
            }

            let swapData = {
                hubContract: orbitHubAddress,
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

            let hash = Britto.sha256sol(packer.packSigHash({hashA, hashB, hashC}));
            if(hashMap.has(hash.toString('hex').add0x())){
                logger.ton.error(`Already signed. validated swapHash: ${hash.toString('hex').add0x()}`);
                return;
            }

            let res = await api.orbit.get(`/info/hash-info`, {whash: hash.toString('hex').add0x()})
            if(res.status === "success") {
                if(res.data.validators) {
                    for(var i = 0; i < res.data.validators.length; i++){
                        if(res.data.validators[i].toLowerCase() === validator.address.toLowerCase()){
                            logger.ton.error(`Already signed. validated swapHash: ${hash.toString('hex').add0x()}`);
                            return;
                        }
                    }
                }
                
                let ecSig = Britto.signMessage(hash, validator.pk);
                let edSig = Britto.signEd25519(hash, validator.pk);
                let sigs = TONValidator.makeSigsWithED(validator.address, ecSig, edSig);
                sigs[1] = parseInt(sigs[1],16)
    
                await api.validator.post(`/governance/validate`, {
                    from_chain: data.fromChain,
                    to_chain: data.toChain,
                    from_chain_id: fromChainId,
                    to_chain_id: toChainId,
                    from_addr: data.fromAddr,
                    to_addr: data.toAddr,
                    token: data.token,
                    bytes32s: data.bytes32s,
                    uints: data.uints,
                    data: data.data,
                    hash,
                    v: sigs[1],
                    r: sigs[2],
                    s: sigs[3],
                    ed_r: sigs[4],
                    ed_s: sigs[5]
                });
                
                hashMap.set(hash.toString('hex').add0x(), {
                    txHash: hash,
                    timestamp: parseInt(Date.now() / 1000),
                })
            }
        }
    }

    isValidAddress(toAddr) {
        return toAddr.slice(0,2) === "0x" && toAddr.length == 66;
    }

    ///////////////////////////////////////////////////////////////
    ///////// Governance Function
    async getTransaction(transactionId, decoder) {
        const ton = this.ton;
        const govInfo = this.govInfo;
        const info = config.info[this.chainLower];
        const chainName = this.chainName;
        const account = this.account;

        let transactionAddress = await ton.getTransactionAddress(this.migAddress, transactionId);
        if(!transactionAddress) return "GetTransactionContract Error";

        let transaction = await ton.getTransactionData(transactionAddress);
        if(!transaction) return "GetTransactionData Error";

        let knownContract = info.CONTRACT_ADDRESS;

        let destinationContract = "Unknown Contract";
        for (var key in knownContract){
            let addr = knownContract[key];
            if(!addr) continue;

            if(addr === transaction.destination){
                destinationContract = key;
                break;
            }
        }
        if(chainName === govInfo.chain && transaction.destination.toLowerCase() === govInfo.address.toLowerCase()){
            destinationContract = `${govInfo.chain} Vault`;
        }
        transaction.destinationContract = destinationContract;

        return transaction;
    }

    async confirmTransaction(transactionId, gasPrice, chainId) {
        const ton = this.ton;
        const chainName = this.chainName;
        const account = this.account;
        const address = monitor.address[chainName].address;

        let transactionAddress = await ton.getTransactionAddress(this.migAddress, transactionId);
        if(!transactionAddress) return "GetTransactionContract Error";

        let transactionConfig = await ton.getTransactionConfig(transactionAddress);
        if(!transactionConfig) return "GetTransactionConfig Error";

        let { required, confirmation, confirmedValidators } = transactionConfig;

        let myConfirmation = !!(confirmedValidators.find(va => va.toLowerCase() === address.toLowerCase()));
        if(myConfirmation || parseInt(required) === parseInt(confirmedValidators.length)) return "Already Confirmed"

        let seq;
        try {
            seq = await ton.confirmTransaction(account.pk, this.migAddress, parseInt(transactionId));
        } catch(e) {
            return "SendTransaction Error";
        }
        if(isNaN(parseInt(seq))) return "SendTransaction Error";

        return `Confirm transactionId ${transactionId} seq : ${seq}`;
    }
    ///////////////////////////////////////////////////////////////
}

module.exports = TONValidator;
