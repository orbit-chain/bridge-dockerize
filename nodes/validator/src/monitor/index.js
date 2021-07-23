const settings = require(`${ROOT}/config`).requireEnv("./settings");
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
        this.address = {};
        this.nodeConnect = {};
        this.blockNumber = {};
        this.ibc = {};

        if(!settings.VALIDATOR_MONITOR){
            console.log("Validator Monitor set is empty!");
            return;
        }

        for (const [key, value] of Object.entries(settings.VALIDATOR_MONITOR) ) {
            if (!value.Interval) {
                value.Interval = 10 * 1000;
            }
            setInterval(() => {
                this.reportMonitorStatus(key, value);
            }, value.Interval);
        }
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
            ORBIT: 'orbit',
            XRP: 'xrp',
            BSC: 'bsc',
            HECO: 'heco',
            MATIC: 'matic',
        };

        return fullNames[chain] || '';
    }

    reportMonitorStatus(method, data) {
        try {
            switch (method) {
                case "Ozys":
                    ozysReport(data.Endpoint, this.json());
                    break;
                default:
                    console.log(`unknown monitor method offered: ${method}`);
                    break;
            }
        } catch (e) {
            //console.log(e);
        }
    }

    setNodeConnectStatus (chain, address, connectionStatus) {
        if (!chain || !address) {
            return;
        }

        chain = Monitor.getChainFullName(chain);
        if (!chain) {
            return;
        }

        if (!this.nodeConnect[chain]) {
            this.nodeConnect[chain] = {};
        }
        this.nodeConnect[chain][address] = {connectionStatus};
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
            address: this.address,
            nodeConnection: this.nodeConnect,
            orbitBlockNumber: this.blockNumber,
            ibc: this.ibc,
        }
    }
}

module.exports = Monitor;
