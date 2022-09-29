global.logger.hub = require('./logger');

const config = require(ROOT + '/config');
const Britto = require(ROOT + '/lib/britto');

const packer = require("./utils/packer");

class OrbitHub {
    constructor(chainList) {
        if(!chainList || chainList.length === 0){
            throw Error("Invalid chainList");
        }
        this.chainList = chainList;

        const chainName = this.chainName = "HUB";
        this.lastBlockNum = null;

        const govInfo = this.govInfo = config.governance;
        if(!govInfo || !govInfo.chain || !govInfo.address || !govInfo.bytes || !govInfo.id) {
            throw Error('Empty Governance Info');
        }

        const info = config.info.orbit;

        const orbitHub = this.orbitHub = Britto.getNodeConfigBase('orbitHub');
        orbitHub.ws = info.ENDPOINT.socket;
        orbitHub.rpc = info.ENDPOINT.rpc;
        orbitHub.address = info.CONTRACT_ADDRESS.OrbitHubContract;
        orbitHub.abi = Britto.getJSONInterface({filename: 'OrbitHub'});
        orbitHub.gateKeeperABI = Britto.getJSONInterface({filename: 'GateKeeper'});

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

        orbitHub.onconnect = () => {
            this.setChainIds(chainList);
            this.startSubscription(orbitHub, this.eventList);
        };

        orbitHub.ondisconnect = () => {
            logger.hub.info(`On disconnected: clear ${orbitHub.ws} subscription !`);
            orbitHub.web3.eth.clearSubscriptions();
        };

        global.monitor.setNodeConnectStatus(chainName, orbitHub.ws, "connecting");
        new Britto(orbitHub, chainName).connectWeb3();

        this.hashMap = new Map();
        this.flushHashMap();

        this.chainIds = {};
        this.subscribers = [];
    }

    registerSubscriber(node, eventList) {
        this.subscribers.push({node, eventList});
    }

    startSubscription(node, eventList) {
        this.subscribeNewBlock(node.web3, blockNumber => {
            global.monitor.setBlockNumber(this.chainName, blockNumber);
            this.getPastLogs(blockNumber, node, eventList);
        });
    }

    subscribeNewBlock(web3, callback) {
        web3.eth.subscribe('newBlockHeaders', (err, res) => {
            if (err)
                return logger.hub.error('subscribeNewBlock subscribe error: ' + err.message);

            if (!res.number) {
                return;
            }

            if (!this.lastBlockNum) {
                this.lastBlockNum = res.number - 1;
            }

            global.monitor.setBlockTime();

            let start = this.lastBlockNum + 1;
            let end = res.number;
            this.lastBlockNum = end;

            for (let i = start; i <= end; i++) {
                if (callback) callback(i);

            }
        })
    }

    getPastLogs(blockNumber, nodeConfig, eventList) {
        let options = {
            fromBlock: blockNumber,
            toBlock: blockNumber
        };

        return new Promise((resolve, reject) => {
            try {
                if(!nodeConfig || !nodeConfig.contract || !eventList) reject();

                nodeConfig.web3.eth.getPastLogs(options, (err, logs) => {
                    if (err) return reject(err);
                    if (logs.length === 0) resolve();

                    for(let subscriber of this.subscribers){
                        if(!subscriber.node || !subscriber.node.contract || !subscriber.eventList) continue;

                        this.parseLogs(subscriber.node.contract, [...logs], subscriber.eventList);
                    }

                    resolve(this.parseLogs(nodeConfig.contract, [...logs], eventList));
                }).catch(e => {
                    reject(e)
                });
            } catch (e) {
                reject(e)
            }
        });
    }

    parseLogs(contract, logs, eventList) {
        let receipts = [];
        for(let log of logs){
            if(log.address.toLowerCase() !== contract._address.toLowerCase()) continue;

            let receipt = contract._decodeEventABI.bind({
                name: "ALLEVENTS",
                jsonInterface: contract._jsonInterface
            })(log);
            receipts.push(receipt);
        }

        for(let receipt of receipts){
            let target = eventList.find(e => e.name === receipt.event);
            if(!target) continue;

            target.callback(receipt);
        }

        return receipts;
    }

    receiveSwapRelay(event) {
        if(event.returnValues.bytes32s[0].toLowerCase() !== this.govInfo.id.toLowerCase()) return;
        if(event.address.toLowerCase() !== this.orbitHub.address.toLowerCase()) return;

        let returnValues = {
            block: event.blockNumber,
            fromChain: event.returnValues.fromChain,
            bytes32s: event.returnValues.bytes32s,
            uints: event.returnValues.uints
        };

        const hash = Britto.sha256sol(packer.packRelayedData({
            fromChain: returnValues.fromChain,
            bytes32s: returnValues.bytes32s,
            uints: event.returnValues.uints.slice(2)
        })).toString('hex').add0x();

        let obj = this.hashMap.get(hash);
        if(!obj){
            this.hashMap.set(hash, { timestamp: parseInt(Date.now() / 1000), count: 1 });
        }
        else{
            obj.count = obj.count + 1;

            if(obj.count > 2){  // applyLimitation + validateSwap
                logger.hub.info(`Already relayed. ${hash} : ${obj.count}`);
                return;
            }
        }

        const fromInstance = instances[returnValues.fromChain.toLowerCase()];
        if(!fromInstance) {
            logger.hub.error(`${returnValues.fromChain} instance is not exist`);
            return;
        }
        fromInstance.validateRelayedData(returnValues);
    }

    receiveSwapNFTRelay(event) {
        if(event.returnValues.bytes32s[0].toLowerCase() !== this.govInfo.id.toLowerCase()) return;
        if(event.address.toLowerCase() !== this.orbitHub.address.toLowerCase()) return;

        let returnValues = {
            block: event.blockNumber,
            fromChain: event.returnValues.fromChain,
            bytes32s: event.returnValues.bytes32s,
            uints: event.returnValues.uints
        };

        const hash = Britto.sha256sol(packer.packRelayedData({
            fromChain: returnValues.fromChain,
            bytes32s: returnValues.bytes32s,
            uints: event.returnValues.uints.slice(2)
        })).toString('hex').add0x();

        if(this.hashMap.has(hash)){
            logger.hub.info(`Already relayed. ${hash}`);
            return;
        }
        this.hashMap.set(hash, { timestamp: parseInt(Date.now() / 1000) });

        const fromInstance = instances[returnValues.fromChain.toLowerCase()];
        if(!fromInstance) {
            logger.hub.error(`${returnValues.fromChain} instance is not exist`);
            return;
        }
        fromInstance.validateRelayedNFTData(returnValues);
    }

    flushHashMap() {
        setTimeout(this.flushHashMap.bind(this), 1000 * 20);

        const now = parseInt(Date.now() / 1000);
        for (let [hash, obj] of this.hashMap.entries()) {
            if (obj.timestamp + 30 < now) {
                this.hashMap.delete(hash);
            }
        }
    }

    getOrbitHub() {
        return this.orbitHub;
    }

    getChainIds() {
        return this.chainIds;
    }

    setChainIds() {
        const orbitHub = this.orbitHub;
        const chainList = this.chainList;

        for(let chain of chainList){
            chain = chain.replace(/-v[1-9]$/, '').toUpperCase();
            const chainId = Britto.sha256sol(packer.packChainId({
                hubContract: orbitHub.address,
                chain: chain
            })).toString('hex').add0x();

            this.chainIds[chain] = chainId;
        }
    }
}

module.exports = OrbitHub;
