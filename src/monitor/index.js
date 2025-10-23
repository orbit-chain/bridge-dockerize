const { VALIDATOR_MONITOR } = require(`${ROOT}/config/${process.env.PROFILE}/endpoints.js`);
const request = require('request');

function ozysReport(url, body) {
    return new Promise((resolve, reject) => {
        const options = {
            method: 'POST',
            json: true,
            body,
        }
        request(url, options, (err, res) => {
            if (err) {
                return reject(err);
            }
            resolve(res.body);
        })
    });
}

class Monitor {
    constructor () {
        this.validatorAddress;
        this.publicKey;
        this.chain;
        this.address = {};
        this.nodeConnect = {};
        this.blockNumber = {};
        this.ibc = {};

        this.lastBlockTime = parseInt(Date.now() / 1000);
        this.connectionHandler();

        if(!VALIDATOR_MONITOR){
            console.log("Validator Monitor set is empty!");
            return;
        }

        for (const [key, value] of Object.entries(VALIDATOR_MONITOR) ) {
            setInterval(() => {
                this.reportMonitorStatus(key, value);
            }, 600 * 1000);
        }
    }

    connectionHandler() {
        setTimeout(this.connectionHandler.bind(this), 1000 * 60);

        const now = parseInt(Date.now() / 1000);
        if(this.lastBlockTime + 60 * 10 < now) process.exit(1);
    }

    static getChainFullName(chain) {
        chain = chain.toUpperCase();

        if(chain.substr(0, 2) === 'GOV' && chain !== 'GOV_OCHAIN')
            return null;

        let fullNames = {
            ETH: 'ethereum',
            ETH_V1: 'ethereum-v1',
            ETH_V2: 'ethereum-v2',
            ETH_MAINNET: 'ethereum_mainnet',
            KLAYTN: 'klaytn',
            KLAYTN_V1: 'klaytn-v1',
            KLAYTN_V2: 'klaytn-v2',
            KLAYTN_MAINNET: 'klaytn_mainnet',
            ICON: 'icon',
            ICON_V1: 'icon-v1',
            ICON_V2: 'icon-v2',
            ICON_MAINNET: 'icon_mainnet',
            XRP: 'xrp',
            BSC: 'bsc',
            HECO: 'heco',
            MATIC: 'matic',
            CELO: 'celo',
            STACKS_LAYER_1: 'stacks_layer_1',
            TON_LAYER_1: 'ton_layer_1'
        };

        return fullNames[chain] || (chain && chain.toLowerCase()) || "";
    }

    reportMonitorStatus(method, data) {
        try {
            switch (method) {
                case "ozys":
                    return ozysReport(data.monitor, this.json());
                default:
                    console.log(`unknown monitor method offered: ${method}`);
                    return;
            }
        } catch (e) {}
    }

    setNodeConnectStatus (chain, address, connectionStatus) {
        if (!chain || !address) {
            return;
        }

        chain = Monitor.getChainFullName(chain);
        if (!chain) {
            return;
        }

        this.nodeConnect[chain] = this.nodeConnect[chain] || {};
        this.nodeConnect[chain].status = connectionStatus;
    }

    setNodeElectionStatus (chain, address, electedBlock) {
        if (!chain || !address) {
            return;
        }

        chain = Monitor.getChainFullName(chain);
        if (!chain) {
            return;
        }

        this.nodeConnect[chain] = this.nodeConnect[chain] || {};
        this.nodeConnect[chain].electedBlock = electedBlock;
    }

    setBlockNumber (chain, block) {
        if (!chain || !block)
            return;

        chain = Monitor.getChainFullName(chain);
        if(!chain)
            return;

        if (!this.blockNumber[chain])
            this.blockNumber[chain] = {}

        this.blockNumber[chain] = block
    }

    setBlockTime() {
        this.lastBlockTime = parseInt(Date.now() / 1000);
    }

    setProgress(chain, func, block) {
        if (!chain || !func || !block)
            return;

        chain = Monitor.getChainFullName(chain);
        if(!chain)
            return;

        if (!this.ibc[chain])
            this.ibc[chain] = {}

        this.ibc[chain][func] = block
    }

    json () {
        return {
            version: VERSION,
            validatorAddress: this.validatorAddress,
            publicKey: this.publicKey,
            chain: this.chain,
            address: this.address,
            nodeConnection: this.nodeConnect,
            lastBlockTime: this.lastBlockTime,
        }
    }
}

module.exports = Monitor;
