global.logger.gov = require('./logger');

const config = require(ROOT + '/config');
const Britto = require(ROOT + '/lib/britto');
const abiDecoder = require('abi-decoder');

const errmBeforeInitialize = {
    "errm": "Before Initialized",
    "data": "Error: Before Initialized"
};

const errmInvalidChain = {
    "errm": "Invalid Chain",
    "data": "NotFoundError: Invalid Chain"
};

// TODO: non-evm chain
const invalidChainList = ["xrp", "stacks", "stacks_layer_1", "ton", "ton_layer_1"];

class Governance {
    constructor(){
        if(this.initialized)
            throw "Already Initialized";

        const ABI = Britto.getJSONInterface({filename: "Governance"});
        abiDecoder.addABI(ABI);

        this.initialized = true;
    }

    getAddress(chain) {
        if(!this.initialized) return errmBeforeInitialize;

        return monitor.address[chain.toUpperCase()];
    }

    async getTransaction(chain, multisig, transactionId) {
        if(!this.initialized) return errmBeforeInitialize;

        logger.gov.info(`GetTransaction: ${chain}, ${multisig}, ${transactionId}`);

        chain = chain.toLowerCase();
        if(invalidChainList.includes(chain) || !instances[chain]) return errmInvalidChain;

        const instance = instances[chain];
        const res = await instance.getTransaction(multisig, transactionId, abiDecoder);
        return res;
    }

    async confirmTransaction(chain, multisig, transactionId, gasPrice, chainId) {
        if(!this.initialized) return errmBeforeInitialize;

        logger.gov.info(`ConfirmTransaction: ${chain}, ${multisig}, ${transactionId}, ${gasPrice}, ${chainId}`);

        chain = chain.toLowerCase();
        if(invalidChainList.includes(chain) || !instances[chain]) return errmInvalidChain;

        const instance = instances[chain];
        const res = await instance.confirmTransaction(multisig, transactionId, gasPrice, chainId);
        return res;
    }

    async confirmTransactionByRange(chain, multisig, start, end, gasPrice, chainId) {
        if(!this.initialized) return errmBeforeInitialize;

        logger.gov.info(`ConfirmTransactionRange: ${chain}, ${multisig}, ${start}, ${end}, ${gasPrice}, ${chainId}`);

        chain = chain.toLowerCase();
        if(invalidChainList.includes(chain) || !instances[chain]) return errmInvalidChain;

        const instance = instances[chain];

        let res = [];
        for(let i = parseInt(start); i <= parseInt(end); i++){
            let txHash = await instance.confirmTransaction(multisig, i, gasPrice, chainId);
            res.push({
                transactionId: i,
                res: txHash
            })
        }

        return JSON.stringify(res, null, '    ');
    }

    async validateSigHash(multisig, sigHash) {
        if(!this.initialized) return errmBeforeInitialize;
        if(!instances["orbit"]) return errmInvalidChain;

        logger.gov.info(`ValidateSigHash: ${multisig}, ${sigHash}`)

        const instance = instances["orbit"];
        const res = await instance.validateSigHash(multisig, sigHash);
        return res;
    }
}

module.exports = Governance;
