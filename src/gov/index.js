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

const invalidChainList = ["xrp", "stacks", "stacks_layer_1"];

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

    async getTransaction(chain, transactionId) {
        if(!this.initialized) return errmBeforeInitialize;

        logger.gov.info(`GetTransaction: ${chain}, ${transactionId}`);

        chain = chain.toLowerCase();
        if(invalidChainList.includes(chain) || !instances[chain]) return errmInvalidChain;

        const instance = instances[chain];
        const res = await instance.getTransaction(transactionId, abiDecoder);
        return res;
    }

    async confirmTransaction(chain, transactionId, gasPrice, chainId) {
        if(!this.initialized) return errmBeforeInitialize;

        logger.gov.info(`ConfirmTransaction: ${chain}, ${transactionId}, ${gasPrice}, ${chainId}`);

        chain = chain.toLowerCase();
        if(invalidChainList.includes(chain) || !instances[chain]) return errmInvalidChain;

        const instance = instances[chain];
        const res = await instance.confirmTransaction(transactionId, gasPrice, chainId);
        return res;
    }

    async confirmTransactionByRange(chain, start, end, gasPrice, chainId) {
        if(!this.initialized) return errmBeforeInitialize;

        logger.gov.info(`ConfirmTransactionRange: ${chain}, ${start}, ${end}, ${gasPrice}, ${chainId}`);

        chain = chain.toLowerCase();
        if(invalidChainList.includes(chain) || !instances[chain]) return errmInvalidChain;

        const instance = instances[chain];

        let res = [];
        for(let i = parseInt(start); i <= parseInt(end); i++){
            let txHash = await instance.confirmTransaction(i, gasPrice, chainId);
            res.push({
                transactionId: i,
                res: txHash
            })
        }

        return JSON.stringify(res, null, '    ');
    }

    async validateSigHash(sigHash) {
        if(!this.initialized) return errmBeforeInitialize;

        logger.gov.info(`ValidateSigHash: ${sigHash}`)

        if(sigHash.length !== 66) return "Invalid Input Hash";
        let signature = Britto.signMessage(sigHash, process.env.VALIDATOR_PK);

        return {
            validator: monitor.validatorAddress,
            sigHash,
            v: signature.v,
            r: signature.r,
            s: signature.s,
        };
    }

    // deprecated
    /*
    async validateEd25519SigHash(sigHash) {
        if(!this.initialized) return errmBeforeInitialize;
        if(!instances["orbit"]) return errmInvalidChain;

        logger.gov.info(`validateEd25519SigHash: ${sigHash}`)

        const instance = instances["orbit"];
        const res = await instance.validateEd25519SigHash(multisig, sigHash);
        return res;
    }
    */
}

module.exports = Governance;
