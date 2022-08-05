global.logger.evm = require('./logger');

const config = require(ROOT + '/config');
const settings = config.requireEnv("./settings");
const Britto = require(ROOT + '/lib/britto');
const RPCAggregator = require(ROOT + '/lib/rpcAggregator');
const txSender = require(ROOT + '/lib/txsender');
const packer = require('./utils/packer');

const BridgeUtils = require(ROOT + '/lib/bridgeutils');
const bridgeUtils = new BridgeUtils();

const FIX_GAS = 99999999;

const tokenABI = [ { "constant": true, "inputs": [ { "internalType": "address", "name": "", "type": "address" } ], "name": "balanceOf", "outputs": [ { "internalType": "uint256", "name": "", "type": "uint256" } ], "payable": false, "stateMutability": "view", "type": "function" } ];

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
        if (!_account || !_account.address || !_account.pk) {
            throw Error('Invalid Ethereum Wallet Account');
        }

        this.lastBlockNum = null;
        this.eventList = [
            {
                name: 'SwapRelay',
                callback: this.receiveSwapRelay.bind(this),
            },
            {
                name: 'SwapNFTRelay',
                callback: this.receiveSwapNFTRelay.bind(this),
            }
        ];

        const chainName = this.chainName = chain.toUpperCase();
        this.loggerOpt = {
            chain: chainName,
        }
        this.chainLower = chain.toLowerCase();
        this.chainCamel = `${this.chainName[0]}${this.chainName.slice(1).toLowerCase()}`;
        this.account = _account;

        monitor.address[chainName] = this.account.address;

        const govInfo = this.govInfo = config.governance;
        if(!govInfo || !govInfo.chain || !govInfo.address || !govInfo.bytes || !govInfo.id) {
            throw Error('Empty Governance Info');
        }

        const rpcAggregator = this.rpcAggregator = new RPCAggregator(chainName, settings[`${chainName}_CHAIN_ID`]);
        const orbitHub = this.orbitHub = Britto.getNodeConfigBase('orbitHub');

        let brittoConfig = {};
        if (govInfo.chain === chainName) {
            brittoConfig.address = govInfo.address;
            brittoConfig.abi = Britto.getJSONInterface({filename: `${this.chainCamel}Vault.abi`, version: 'v2'});
        } else {
            brittoConfig.address = settings.BridgeAddress[this.chainCamel][`${this.chainCamel}MinterContract`];
            brittoConfig.abi = Britto.getJSONInterface({filename: `${this.chainCamel}Minter.abi`, version: 'v2'});
        }
        const rpc = settings.Endpoints[this.chainCamel].rpc;
        if (Array.isArray(rpc)) {
            for (const url of rpc) {
                rpcAggregator.addRpc(url, brittoConfig);
            }
        } else if (typeof rpc === "string") {
            rpcAggregator.addRpc(rpc, brittoConfig);
        } else {
            throw `Unsupported Endpoints: ${rpc}`;
        }

        orbitHub.ws = config.rpc.OCHAIN_WS;
        orbitHub.rpc = config.rpc.OCHAIN_RPC;
        orbitHub.address = config.contract.ORBIT_HUB_CONTRACT;
        orbitHub.abi = Britto.getJSONInterface({filename: 'OrbitHub.abi', version: 'v2'});

        orbitHub.onconnect = () => { this.startSubscription(orbitHub) };

        global.monitor.setNodeConnectStatus(chainName, orbitHub.ws, "connecting");
        new Britto(orbitHub, chainName).connectWeb3();

        Britto.setAdd0x();
        Britto.setRemove0x();

        orbitHub.multisig.wallet = config.contract[`${chainName}_BRIDGE_MULTISIG`];
        orbitHub.multisig.abi = Britto.getJSONInterface({filename: 'MessageMultiSigWallet.abi', version: 'v2'});
        orbitHub.multisig.contract = new orbitHub.web3.eth.Contract(orbitHub.multisig.abi, orbitHub.multisig.wallet);
    }

    startSubscription(node) {
        this.subscribeNewBlock(node.web3, blockNumber => {
            global.monitor.setBlockNumber(this.chainName, blockNumber);
            this.getEvent(blockNumber, node);
        });
    }

    subscribeNewBlock(web3, callback) {
        web3.eth.subscribe('newBlockHeaders', (err, res) => {
            if (err)
                return logger.evm.error('subscribeNewBlock subscribe error: ' + err.message, this.loggerOpt);

            if (!res.number) {
                return;
            }

            global.monitor.setBlockTime();

            if (!this.lastBlockNum) {
                this.lastBlockNum = res.number - 1;
            }

            let start = this.lastBlockNum + 1;
            let end = res.number;
            this.lastBlockNum = end;

            for (let i = start; i <= end; i++) {
                if (callback)
                    callback(i);
            }
        })
    }

    /**
     * Get events in specific block.
     * @param blockNumber Target block number
     * @param nodeConfig Target chain, node, and contract.
     * @param nameOrArray Event name or list
     * @param callback
     * @returns {Promise<any>}
     */
    getEvent(blockNumber, nodeConfig, nameOrArray, callback) {
        let options = {
            filter: {},
            fromBlock: blockNumber,
            toBlock: blockNumber
        };

        return new Promise((resolve, reject) => {
            let _eventList = this.eventList;
            if (Array.isArray(nameOrArray)) {
                _eventList = nameOrArray;
            } else if (typeof nameOrArray === 'string' && callback) {
                _eventList = [{
                    name: nameOrArray,
                    callback: callback
                }]
            }

            let eventResults = [];
            for (let event of _eventList) {
                nodeConfig.contract.getPastEvents(event.name, options).then(events => {
                    events = events.filter(e => e.returnValues.fromChain === this.chainName && e.returnValues.bytes32s[0] === this.govInfo.id);

                    if (events.length > 0) {
                        logger.evm.info(`[${nodeConfig.name.toUpperCase()}] Get '${event.name}' event from block ${blockNumber}. length: ${events.length}`, this.loggerOpt);
                    }

                    if (event.callback)
                        event.callback(events);

                    eventResults.push(events);
                }).catch(reject);
            }

            resolve(eventResults);
        });
    }

    async parseEvent(blockNumber, nodeConfig, name) {
        let options = {
            filter: {},
            fromBlock: blockNumber,
            toBlock: blockNumber
        };

        let eventResults = await nodeConfig.contract.getPastEvents(name, options);

        global.monitor.setBlockNumber(this.chainName + '_MAINNET', blockNumber);

        return eventResults;
    }

    receiveSwapRelay(events) {
        for (let event of events) {
            if(event.returnValues.bytes32s[0] !== this.govInfo.id){
                continue;
            }

            if(event.returnValues.fromChain !== this.chainName){
                continue;
            }

            let returnValues = {
                fromChain: event.returnValues.fromChain,
                bytes32s: event.returnValues.bytes32s,
                uints: event.returnValues.uints
            };

            this.validateSwap({
                block: event.blockNumber,
                validator: {address: this.account.address, pk: this.account.pk},
                ...returnValues
            })
        }
    }

    async validateSwap(data) {
        let validator = {...data.validator} || {};
        delete data.validator;

        const mainnet = await this.rpcAggregator.select();
        const orbitHub = this.orbitHub;
        const chainName = this.chainName;
        const govInfo = this.govInfo;
        mainnet.web3.eth.getTransactionReceipt(data.bytes32s[1]).then(async receipt => {
            if (!receipt){
                logger.evm.error('No Transaction Receipt.', this.loggerOpt);
                return;
            }


            let events = await this.parseEvent(receipt.blockNumber, mainnet, (govInfo.chain === chainName)? "Deposit" : "SwapRequest");
            if (events.length == 0){
                logger.evm.error('Invalid Transaction.', this.loggerOpt);
                return;
            }

            let params;
            events.forEach(async _event => {
                if(_event.address.toLowerCase() !== mainnet.address.toLowerCase()){
                    return;
                }

                if(_event.transactionHash.toLowerCase() !== data.bytes32s[1].toLowerCase()){
                    return;
                }

                if(_event.returnValues.depositId !== data.uints[2]){
                    return;
                }

                params = _event.returnValues;
            });

            if(!params || !params.toChain || !params.fromAddr || !params.toAddr || !params.token || !params.amount || !params.decimal){
                logger.evm.error("Invalid Transaction (event params)", this.loggerOpt);
                return;
            }

            if(!bridgeUtils.isValidAddress(params.toChain, params.toAddr)){
                logger.evm.error(`Invalid toAddress ( ${params.toChain}, ${params.toAddr} )`, this.loggerOpt);
                return;
            }

            if(params.data && !bridgeUtils.isValidData(params.toChain, params.data)){
                logger.evm.error(`Invalid data ( ${params.toChain}, ${params.data} )`, this.loggerOpt);
                return;
            }

            params.fromChain = chainName;
            params.uints = [params.amount, params.decimal, params.depositId];
            params.bytes32s = [govInfo.id, data.bytes32s[1]];

            let currentBlock = await mainnet.web3.eth.getBlockNumber().catch(e => {
                logger.evm.error('getBlockNumber() execute error: ' + e.message), this.loggerOpt;
            });

            if (!currentBlock)
                return console.error('No current block data.');

            // Check deposit block confirmed
            const confirmCount = config.system[`${this.chainLower}ConfirmCount`] || 24;
            let isConfirmed = currentBlock - Number(receipt.blockNumber) >= confirmCount;

            let curBalance = await monitor.getBalance(params.token);
            if(!curBalance || curBalance === 0 || Number.isNaN(curBalance)){
                logger.evm.error(`getBalance error ( ${params.token})`, this.loggerOpt);
                return;
            }

            let isValidAmount = curBalance >= parseInt(params.amount);

            // 두 조건을 만족하면 valid
            if (isConfirmed && isValidAmount)
                await valid(params);
            else
                console.log(`depositId(${data.uints[2]}) is invalid. isConfirmed: ${isConfirmed}, isValidAmount: ${isValidAmount}`);
        }).catch(e => {
            logger.evm.error('validateSwap error: ' + e.message, this.loggerOpt);
        });

        async function valid(data) {
            let sender = Britto.getRandomPkAddress();
            if(!sender || !sender.pk || !sender.address){
                logger.evm.error("Cannot Generate account", {chain: chainName});
                return;
            }

            if (!data.data) {
                data.data = "0x";
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
                data: data.data,
            }));

            let toChainMig = await orbitHub.contract.methods.getBridgeMig(data.toChain, govInfo.id).call();
            let contract = new orbitHub.web3.eth.Contract(orbitHub.multisig.abi, toChainMig);

            let validators = await contract.methods.getHashValidators(hash.toString('hex').add0x()).call();
            for(var i = 0; i < validators.length; i++){
                if(validators[i].toLowerCase() === validator.address.toLowerCase()){
                    logger.evm.error(`Already signed. validated swapHash: ${hash}`, {chain: chainName});
                    return;
                }
            }

            let signature = Britto.signMessage(hash, validator.pk);

            let sigs = EVMValidator.makeSigs(validator.address, signature);

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
                logger.evm.error('validateSwap estimateGas error: ' + e.message, {chain: chainName})
            });

            if (!gasLimit)
                return;

            txOptions.gasLimit = orbitHub.web3.utils.toHex(FIX_GAS);

            let txData = {
                method: 'validateSwap',
                args: params,
                options: txOptions
            };

            await txSender.sendTransaction(orbitHub, txData, {address: sender.address, pk: sender.pk, timeout: 1});
            global.monitor && global.monitor.setProgress(chainName, 'validateSwap', data.block);
        }
    }

    receiveSwapNFTRelay(events) {
        for (let event of events) {
            if(event.returnValues.bytes32s[0] !== this.govInfo.id){
                continue;
            }

            if(event.returnValues.fromChain !== this.chainName){
                continue;
            }

            let returnValues = {
                fromChain: event.returnValues.fromChain,
                bytes32s: event.returnValues.bytes32s,
                uints: event.returnValues.uints
            };

            this.validateSwapNFT({
                block: event.blockNumber,
                validator: {address: this.account.address, pk: this.account.pk},
                ...returnValues
            })
        }
    }

    async validateSwapNFT(data) {
        let validator = {...data.validator} || {};
        delete data.validator;

        const mainnet = await this.rpcAggregator.select();
        const orbitHub = this.orbitHub;
        const chainName = this.chainName;
        const govInfo = this.govInfo;
        mainnet.web3.eth.getTransactionReceipt(data.bytes32s[1]).then(async receipt => {
            if (!receipt){
                logger.evm.error('No Transaction Receipt.', this.loggerOpt);
                return;
            }

            let events = await parseEvent(receipt.blockNumber, mainnet, (govInfo.chain === chainName)? "DepositNFT" : "SwapRequestNFT");
            if (events.length == 0){
                logger.evm.error('Invalid Transaction.', this.loggerOpt);
                return;
            }

            let params;
            events.forEach(async _event => {
                if(_event.address.toLowerCase() !== mainnet.address.toLowerCase()){
                    return;
                }

                if(_event.transactionHash.toLowerCase() !== data.bytes32s[1].toLowerCase()){
                    return;
                }

                if(_event.returnValues.depositId !== data.uints[2]){
                    return;
                }

                params = _event.returnValues;
            });

            if(!params || !params.toChain || !params.fromAddr || !params.toAddr || !params.token || !params.amount || !params.tokenId){
                logger.evm.error("Invalid Transaction (event params)", this.loggerOpt);
                return;
            }

            if(!bridgeUtils.isValidAddress(params.toChain, params.toAddr)){
                logger.evm.error(`Invalid toAddress ( ${params.toChain}, ${params.toAddr} )`, this.loggerOpt);
                return;
            }

            params.fromChain = chainName;
            params.uints = [params.amount, params.tokenId, params.depositId];
            params.bytes32s = [govInfo.id, data.bytes32s[1]];

            let currentBlock = await mainnet.web3.eth.getBlockNumber().catch(e => {
                logger.evm.error('getBlockNumber() execute error: ' + e.message, this.loggerOpt);
            });

            if (!currentBlock)
                return console.error('No current block data.');

            // Check deposit block confirmed
            const confirmCount = config.system[`${this.chainLower}ConfirmCount`] || 24;
            let isConfirmed = currentBlock - Number(receipt.blockNumber) >= confirmCount;

            // 두 조건을 만족하면 valid
            if (isConfirmed)
                await valid(params);
            else
                console.log('depositId(' + data.uints[2] + ') is invalid.', 'isConfirmed: ' + isConfirmed);
        }).catch(e => {
            logger.evm.error('validateSwapNFT error: ' + e.message, this.loggerOpt);
        });

        async function valid(data) {
            let sender = Britto.getRandomPkAddress();
            if(!sender || !sender.pk || !sender.address){
                logger.evm.error("Cannot Generate account", {chain: chainName});
                return;
            }

            if (!data.data) {
                data.data = "0x";
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

            let toChainMig = await orbitHub.contract.methods.getBridgeMig(data.toChain, govInfo.id).call();
            let contract = new orbitHub.web3.eth.Contract(orbitHub.multisig.abi, toChainMig);

            let validators = await contract.methods.getHashValidators(hash.toString('hex').add0x()).call();
            for(var i = 0; i < validators.length; i++){
                if(validators[i].toLowerCase() === validator.address.toLowerCase()){
                    logger.evm.error(`Already signed. validated swapHash: ${hash}`, {chain: chainName});
                    return;
                }
            }

            let signature = Britto.signMessage(hash, validator.pk);

            let sigs = EVMValidator.makeSigs(validator.address, signature);

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
                logger.evm.error('validateSwapNFT estimateGas error: ' + e.message, {chain: chainName})
            });

            if (!gasLimit)
                return;

            txOptions.gasLimit = orbitHub.web3.utils.toHex(FIX_GAS);

            let txData = {
                method: 'validateSwapNFT',
                args: params,
                options: txOptions
            };

            await txSender.sendTransaction(orbitHub, txData, {address: sender.address, pk: sender.pk, timeout: 1});
            global.monitor && global.monitor.setProgress(chainName, 'validateSwapNFT', data.block);
        }
    }

    async getBalance(tokenAddr) {
        const mainnet = await this.rpcAggregator.select();
        let amount = 0;
        if(tokenAddr === "0x0000000000000000000000000000000000000000"){
            amount = await mainnet.web3.eth.getBalance(this.govInfo.address).catch(e => {
                logger.evm.error(`${tokenAddr} getBalance error : ${e.message}`, this.loggerOpt);
            });
        }
        else{
            const token = new mainnet.web3.eth.Contract(tokenABI, tokenAddr);
            amount = await token.methods.balanceOf(this.govInfo.address).call().catch(e => {
                logger.evm.error(`${tokenAddr} getBalance error : ${e.message}`, this.loggerOpt);
            });
        }
        return parseInt(amount);
    }
}

module.exports = EVMValidator;
