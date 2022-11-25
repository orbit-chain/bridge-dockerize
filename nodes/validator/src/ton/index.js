global.logger.ton = require('./logger');

const config = require(ROOT + '/config');

const Britto = require(ROOT + '/lib/britto');
const txSender = require(ROOT + '/lib/txsender');

const BridgeUtils = require(ROOT + '/lib/bridgeutils');
const bridgeUtils = new BridgeUtils();

const packer = require("./utils/packer");
const Ton = require("./utils/ton.api");

const FIX_GAS = 99999999;

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

        const info = config.info[this.chainLower];
        this.tonMinter = info.CONTRACT_ADDRESS.TonMinterContract;

        const ton = this.ton = new Ton(info.ENDPOINT);
        if(!ton) throw 'Invalid Ton Endpoint';

        ton.getTonAccount(this.account.pk).then(account => {
            if(monitor.address[chainName]) return;
            monitor.address[chainName] = account;
        });

        this.multisigABI = Britto.getJSONInterface({filename: 'multisig/Ed25519'});
        this.requestSwapABI = {"event":"RequestSwap","data":[[{"name":"opCode","type":"uint32","value":"hex"}],[{"name":"token","type":"uint160","value":"hex"},{"name":"toChain","type":"uint256","value":"hex"},{"name":"toAddr","type":"uint160","value":"hex"},{"name":"amount","type":"uint256","value":"uint32"}],[{"name":"fromAddr","type":"address","value":"address"},{"name":"tokenAddress","type":"address","value":"addressx"},{"name":"depositId","type":"uint256","value":"uint32"},{"name":"decimal","type":"uint8","value":"uint32"}]]};

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
        const chainIds = instances.hub.getChainIds();
        const ton = this.ton;
        const tonMinter = this.tonMinter;
        const chainName = this.chainName;
        const govInfo = this.govInfo;
        const REQUEST_SWAP = this.requestSwapABI;

        let txHash = data.bytes32s[1];
        txHash = Buffer.from(txHash.replace("0x",""), 'hex').toString('base64');

        let depositId = data.uints[2];
        let lt = data.uints[3];

        let tx = await ton.getTransaction(tonMinter, txHash, lt);
        if(!tx || !tx.data){
            logger.ton.error(`getTransaction error: ${txHash}, ${lt}`);
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
            } catch (e) {
                console.log(e);
            }
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
            hubContract: orbitHub.address,
            fromChain: this.chainName,
            toChain: toChain,
            fromAddr: fromAddr,
            toAddr: res.toAddr,
            token: res.token,
            bytes32s: [govInfo.id, data.bytes32s[1]],
            uints: [res.amount, res.decimal, data.uints[2], data.uints[3]],
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

        const orbitHub = instances.hub.getOrbitHub();
        const chainIds = instances.hub.getChainIds();
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
                logger.ton.error("Cannot Generate account");
                return;
            }

            let fromChainId = chainIds[data.fromChain];
            let toChainId = chainIds[data.toChain];
            if(!fromChainId || !toChainId){
                logger.ton.error(`Cannot get chainId. ${data.fromChain}, ${data.toChain}`);
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

            let hash = Britto.sha256sol(packer.packSigHash({hashA, hashB, hashC}));
            if(hashMap.has(hash.toString('hex').add0x())){
                logger.ton.error(`Already signed. validated swapHash: ${hash.toString('hex').add0x()}`);
                return;
            }

            let toChainMig = await orbitHub.contract.methods.getBridgeMig(data.toChain, govInfo.id).call();
            let contract = new orbitHub.web3.eth.Contract(multisigABI, toChainMig);

            let validators = await contract.methods.getHashValidators(hash.toString('hex').add0x()).call();
            for(var i = 0; i < validators.length; i++){
                if(validators[i].toLowerCase() === validator.address.toLowerCase()){
                    logger.ton.error(`Already signed. validated swapHash: ${hash.toString('hex').add0x()}`);
                    return;
                }
            }

            let ecSig = Britto.signMessage(hash, validator.pk);
            let edSig = Britto.signEd25519(hash, validator.pk);
            let sigs = TONValidator.makeSigsWithED(validator.address, ecSig, edSig);

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
                logger.ton.error('validateSwap estimateGas error: ' + e.message)
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
                logger.ton.error("Cannot Generate account");
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
                logger.ton.error(`Already signed. validated limitationHash: ${hash.toString('hex').add0x()}`);
                return;
            }

            let hubMig = await orbitHub.contract.methods.getBridgeMig("HUB", govInfo.id).call();
            let migCon = new orbitHub.web3.eth.Contract(multisigABI, hubMig);

            let validators = await migCon.methods.getHashValidators(hash.toString('hex').add0x()).call();
            for(var i = 0; i < validators.length; i++){
                if(validators[i].toLowerCase() === validator.address.toLowerCase()){
                    logger.ton.error(`Already signed. applyLimitation: ${hash}`);
                    return;
                }
            }

            let signature = Britto.signMessage(hash, validator.pk);
            let sigs = TONValidator.makeSigs(validator.address, signature);

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
                    logger.ton.error(`applyLimitation error: ${err.message}`);
                    return;
                }

                hashMap.set(hash.toString('hex').add0x(), {
                    txHash: thash,
                    timestamp: parseInt(Date.now() / 1000),
                })

                logger.ton.info(`applyLimitation: ${thash}`);
            });
        }
    }

    isValidAddress(toAddr) {
        return toAddr.slice(0,2) === "0x" && toAddr.length == 66;
    }
}

module.exports = TONValidator;
