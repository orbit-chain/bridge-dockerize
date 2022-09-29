global.logger.stacks = require('./logger');

const config = require(ROOT + '/config');

const Britto = require(ROOT + '/lib/britto');
const txSender = require(ROOT + '/lib/txsender');
const packer = require('./utils/packer');
const BridgeUtils = require('./utils/stacks.bridgeutils');
const stacks = new BridgeUtils();

const { AddressVersion, addressFromVersionHash, addressToString, createAddress, cvToValue, getAddressFromPrivateKey, makeUnsignedSTXTokenTransfer, StacksMessageType, bufferCV } = require("@stacks/transactions");

const FIX_GAS = 99999999;

class STACKSValidator {
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
        if(chain.toLowerCase() !== "stacks")
            throw 'Invalid chain symbol';

        if (!_account || !_account.address || !_account.pk) {
            throw Error('Invalid Ethereum Wallet Account');
        }
        this.account = _account;

        const govInfo = this.govInfo = config.governance;
        if(!govInfo || !govInfo.chain || !govInfo.address || !govInfo.bytes || !govInfo.id) {
            throw Error('Empty Governance Info');
        }

        const chainName = this.chainName = chain.toUpperCase();
        this.chainLower = chain.toLowerCase();

        let key = this.account.pk;
        if(Buffer.isBuffer(key)) key = key.toString('hex');
        key = key.replace("0x", "") + "01";
        monitor.address[chainName] = getAddressFromPrivateKey(key, stacks.TransactionVersion);

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

        const txid = data.bytes32s[1];
        let transaction = await stacks.getTransaction(txid).catch();
        if (!transaction || transaction.tx_status !== 'success') {
            logger.stacks.error(`validateSwap error: STACKS transaction ${txid} is not applied to ledger or transaction execution failed.`);
            return;
        }

        let params = {}
        let event;
        transaction.events.forEach(e => {
            if (e.event_type !== "smart_contract_log") {
                return;
            }
            const contractLog = e.contract_log;
            const cId = contractLog.contract_id;
            const [deployer , name] = cId.split(".");
            const stacksAddrs = config.info[this.chainLower].CONTRACT_ADDRESS;
            if (stacksAddrs.DeployAddress.toLowerCase() !== deployer.toLowerCase()) {
                logger.stacks.error(`Not support token: ${cId}`);
                return;
            }
            for (const [origin, tokenName] of Object.entries(stacksAddrs)) {
                if (name === tokenName) {
                    params.token = origin;
                    break;
                }
            }
            if (!params.token) {
                logger.stacks.error(`Not support token: ${cId}`);
                return;
            }

            let decodeData = stacks.hexToCV(contractLog.value.hex).data;
            if(cvToValue(decodeData["type"]) !== 'request-swap') {
                logger.stacks.error(`Invalid event type: ${cId}`);
                return;
            }

            if(cvToValue(decodeData["deposit-id"]).toString() === data.uints[2]){
                event = decodeData;
            }
        });

        if(!event || !event["to-chain"] || !event["from-addr"] || !event["to-addr"] || !event["amount"] || !event["decimal"] || !event["deposit-id"]){
            logger.stacks.error("Invalid Transaction (event params)");
            return;
        }

        const toChain = params.toChain = Buffer.from(cvToValue(event["to-chain"]).replace("0x", ""), "hex").toString();
        const toAddr = params.toAddr = cvToValue(event["to-addr"]);
        const amount = cvToValue(event.amount).toString();

        params.fromAddr = createAddress(transaction.sender_address).hash160.add0x().toLowerCase();
        params.fromChain = this.chainName;
        params.uints = [amount, parseInt(cvToValue(event.decimal)), cvToValue(event["deposit-id"]).toString()];
        params.bytes32s = [govInfo.id, data.bytes32s[1]];
        params.data = "0x";

        const latestBlock = await stacks.getLatestBlock();
        if (!latestBlock) {
            logger.stacks.error('No current block data.');
            return;
        }
        // Check deposit block confirmed
        const isConfirmed = parseInt(latestBlock.height) - parseInt(transaction.block_height) >= config.system.stacksConfirmCount;
        if(!isConfirmed){
            logger.stacks.info(`depositId(${params.uints[2]}) is invalid. isConfirmed: ${isConfirmed}`);
            return;
        }

        const toInstance = instances[params.toChain.toLowerCase()];
        if(!toInstance) {
            logger.stacks.error(`${params.toChain} instance is not exist`);
            return;
        }
        await toInstance.validateSwap(data, params);
    }

    async validateSwap(data, params){
        const validator = {address: this.account.address, pk: this.account.pk};

        const orbitHub = instances.hub.getOrbitHub();
        const chainName = this.chainName;
        const govInfo = this.govInfo;
        const info = config.info[this.chainLower];
        const hashMap = this.hashMap;
        const multisigABI = this.multisigABI;

        if(data.bytes32s.length !== 3 || data.uints.length !== 4){
            logger.stacks.info(`Invalid relayed data.`);
            return;
        }

        if(chainName !== params.toChain){
            logger.stacks.error(`Invalid toChain. ${chainName} : ${params.toChain}`);
            return;
        }

        if(!this.isValidAddress(params.toAddr)){
            logger.stacks.error(`Invalid toAddr. ${params.toAddr}`);
            return;
        }

        //////////////////////////////////////
        const txid = data.bytes32s[2];
        let transaction = await stacks.getTransaction(txid).catch();
        if (!transaction || transaction.tx_status !== 'success') {
            logger.stacks.error(`validateSwap error: STACKS transaction ${txid} is not applied to ledger or transaction execution failed.`);
            return;
        }

        const stacksAddrs = info.CONTRACT_ADDRESS;
        if(!stacksAddrs || !stacksAddrs.DeployAddress) return;

        let event;
        transaction.events.forEach(e => {
            if (e.event_type !== "smart_contract_log") {
                return;
            }
            const contractLog = e.contract_log;
            const cId = contractLog.contract_id;
            const [deployer, name] = cId.split(".");
            if (stacksAddrs.DeployAddress.toLowerCase() !== deployer.toLowerCase()) {
                logger.stacks.error(`Not support token: ${cId}`);
                return;
            }

            let find = false;
            for (const [origin, tokenName] of Object.entries(stacksAddrs)) {
                if (name === tokenName) {
                    find = true;
                    break;
                }
            }
            if(!find){
                logger.stacks.error(`Not support token: ${cId}`);
                return;
            }

            let decodeData = stacks.hexToCV(contractLog.value.hex).data;
            if(cvToValue(decodeData["type"]) !== 'add-swap-data') {
                logger.stacks.error(`Invalid event type: ${cId}`);
                return;
            }

            event = decodeData;
        });

        // Check all of swap-data valid
        const amount = parseInt(cvToValue(event.amount));
        if (amount !== parseInt(params.uints[0])) {
            logger.stacks.error(`Invalid amount: (${amount}, ${params.uints[0]})`);
            return;
        }
        const decimals = parseInt(cvToValue(event.decimals));
        if (decimals !== parseInt(params.uints[1])) {
            logger.stacks.error(`Invalid decimals: (${decimals}, ${params.uints[1]})`);
            return;
        }
        const depositId = parseInt(cvToValue(event["deposit-id"]));
        if (depositId !== parseInt(params.uints[2])) {
            logger.stacks.error(`Invalid depositId: (${depositId}, ${params.uints[2]})`);
            return;
        }
        const dataId = parseInt(cvToValue(event["data-id"]));
        if (dataId !== parseInt(data.uints[3])) {
            logger.stacks.error(`Invalid data-id: (${dataId}, ${data.uints[3]})`);
            return;
        }
        const fromAddr = cvToValue(event["from-addr"]);
        if(fromAddr.toLowerCase() !== params.fromAddr.toLowerCase()){
            logger.stacks.error(`Invalid fromAddr: (${fromAddr}, ${params.fromAddr})`);
            return;
        }
        const toAddr = `0x${createAddress(cvToValue(event["to-addr"])).hash160}`;
        if (toAddr !== params.toAddr) {
            logger.stacks.error(`Invalid toAddr: (${toAddr}, ${params.toAddr})`);
            return;
        }
        const fromChain = Buffer.from(cvToValue(event["from-chain"]).replace("0x", ""), "hex").toString();
        if (fromChain !== params.fromChain) {
            logger.stacks.error(`Invalid fromChain: (${fromChain}, ${params.fromChain})`);
            return;
        }
        const govId = cvToValue(event["gov-id"]);
        if (govId !== params.bytes32s[0]) {
            logger.stacks.error(`Invalid govId: (${govId}, ${params.bytes32s[0]})`);
            return;
        }
        const originHash = cvToValue(event["tx-hash"]);
        if (originHash !== params.bytes32s[1]) {
            logger.stacks.error(`Invalid originHash: (${originHash}, ${params.bytes32s[1]})`);
            return;
        }
        const originToken = cvToValue(event.token);
        if (originToken.toLowerCase() !== params.token.toLowerCase()) {
            logger.stacks.error(`Invalid originToken: (${originToken}, ${params.token})`);
            return;
        }
        const hubContract = cvToValue(event["hub-contract"]);
        if (hubContract !== orbitHub.address) {
            logger.stacks.error(`Invalid hubContract: (${hubContract})`);
            return;
        }

        const hash = Britto.sha256sol(packer.packDataHash({
            hubContract: orbitHub.address,
            fromChain: params.fromChain,
            toChain: params.toChain,
            fromAddr: params.fromAddr,
            toAddr: params.toAddr,
            token: params.token,
            bytes32s: [params.bytes32s[0], params.bytes32s[1]],
            uints: params.uints,
            data: params.data,
        }));

        let res = await stacks.readContract(
            info.CONTRACT_ADDRESS.DeployAddress,
            info.CONTRACT_ADDRESS[params.token.toLowerCase()],
            "is-confirmed",
            [bufferCV(Buffer.from(hash.replace("0x",""), "hex"))],
            stacksAddrs.DeployAddress
        );
        if(!res || !res.type || res.type === 3){
            return;
        }

        params.bytes32s.push(data.bytes32s[2]);
        params.uints.push(data.uints[3]);

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
                logger.stacks.error("Cannot Generate account");
                return;
            }

            let hash = Britto.sha256sol(packer.packSwapData({
                hubContract: orbitHub.address,
                fromChain: swapData.fromChain,
                toChain: swapData.toChain,
                fromAddr: swapData.fromAddr,
                toAddr: swapData.toAddr,
                token: swapData.token,
                bytes32s: swapData.bytes32s,
                uints: swapData.uints,
                data: swapData.data,
            }));
            if(hashMap.has(hash.toString('hex').add0x())){
                logger.stacks.error(`Already signed. validated swapHash: ${hash.toString('hex').add0x()}`);
                return;
            }

            let toChainMig = await orbitHub.contract.methods.getBridgeMig(swapData.toChain, govInfo.id).call();
            let contract = new orbitHub.web3.eth.Contract(multisigABI, toChainMig);

            let validators = await contract.methods.getHashValidators(hash.toString('hex').add0x()).call();
            for(var i = 0; i < validators.length; i++){
                if(validators[i].toLowerCase() === validator.address.toLowerCase()){
                    logger.stacks.error(`Already signed. validated swapHash: ${hash}`);
                    return;
                }
            }

            let signature = Britto.signMessage(hash, validator.pk);
            let sigs = STACKSValidator.makeSigs(validator.address, signature);

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
                logger.stacks.error('validateSwap estimateGas error: ' + e.message)
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

        async function applyLimitation(gateKeeper, swapData) {
            let sender = Britto.getRandomPkAddress();
            if(!sender || !sender.pk || !sender.address){
                logger.stacks.error("Cannot Generate account");
                return;
            }

            let hash = Britto.sha256WithEncode(packer.packLimitationData({
                fromChain: swapData.fromChain,
                toChain: swapData.toChain,
                token: swapData.token,
                bytes32s: swapData.bytes32s,
                uints: swapData.uints
            }));
            if(hashMap.has(hash.toString('hex').add0x())){
                logger.stacks.error(`Already signed. validated limitationHash: ${hash.toString('hex').add0x()}`);
                return;
            }

            let hubMig = await orbitHub.contract.methods.getBridgeMig("HUB", govInfo.id).call();
            let migCon = new orbitHub.web3.eth.Contract(multisigABI, hubMig);

            let validators = await migCon.methods.getHashValidators(hash.toString('hex').add0x()).call();
            for(var i = 0; i < validators.length; i++){
                if(validators[i].toLowerCase() === validator.address.toLowerCase()){
                    logger.stacks.error(`Already signed. applyLimitation: ${hash}`);
                    return;
                }
            }

            let signature = Britto.signMessage(hash, validator.pk);
            let sigs = STACKSValidator.makeSigs(validator.address, signature);

            let params = [
                swapData.fromChain,
                swapData.toChain,
                swapData.fromAddr,
                swapData.toAddr,
                swapData.token,
                swapData.bytes32s,
                swapData.uints,
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
                    logger.stacks.error(`applyLimitation error: ${err.message}`);
                    return;
                }

                hashMap.set(hash.toString('hex').add0x(), {
                    txHash: thash,
                    timestamp: parseInt(Date.now() / 1000),
                })

                logger.stacks.info(`applyLimitation: ${thash}`);
            });
        }
    }

    isValidAddress(toAddr){
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
}

module.exports = STACKSValidator;
