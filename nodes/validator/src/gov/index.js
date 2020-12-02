global.logger.gov = require('./logger');

const config = require(ROOT + '/config');
const Britto = require(ROOT + '/lib/britto');
const txSender = require(ROOT + '/lib/txsender');
const api = require(ROOT + '/lib/api');
const Caver = require('caver-js');
const abiDecoder = require('abi-decoder');

let account = {};
let initialized;

let chainNode = {
    "eth": null,
    "orbit": null,
    "klaytn": null
};

const ochain = Britto.getNodeConfigBase('ochain');
const ethereum = Britto.getNodeConfigBase('ethereum');
const klaytn = Britto.getNodeConfigBase('klaytn');

function initialize(_account) {
    if (initialized)
        throw "Already Intialized";

    if (!_account || !_account.address || !_account.pk)
        throw 'Invalid Ethereum Wallet Account';

    account = _account;

    ochain.ws = config.rpc.OCHAIN_WS;
    ochain.rpc = config.rpc.OCHAIN_RPC;
    ochain.abi = Britto.getJSONInterface('MessageMultiSigWallet.abi');

    ethereum.rpc = config.rpc.ETH_MAINNET_RPC;
    ethereum.abi = Britto.getJSONInterface('MessageMultiSigWallet.abi');

    klaytn.rpc = config.klaytn.KLAYTN_RPC;
    klaytn.abi = Britto.getJSONInterface('MessageMultiSigWallet.abi');

    abiDecoder.addABI(Britto.getJSONInterface('Governance.abi'));

    ochain.onconnect = () => {
        initialized = true;
        chainNode["orbit"] = ochain;
    };

    new Britto(ochain, 'GOV_OCHAIN').connectWeb3();
    new Britto(ethereum, 'GOV_ETHEREUM').connectWeb3();
    new Britto(klaytn, 'GOV_KLAYTN').connectWeb3();

    Britto.setAdd0x();
    Britto.setRemove0x();

    klaytn.caver = new Caver(config.klaytn.KLAYTN_RPC);

    chainNode["eth"] = ethereum;
    chainNode["klaytn"] = klaytn;
}

async function getPendingTransaction(chain, multisig, transactionId) {
    if(!chainNode[chain.toLowerCase()]){
        return {
            "errm": "Invalid Chain",
            "data": "NotFoundError: Invalid Chain"
        }
    }

    return await _getPendingTransaction(chainNode[chain.toLowerCase()], {
        multisig,
        transactionId,
    })
}

async function _getPendingTransaction(node, data) {
    if (!initialized) {
        return;
    }

    let _node = {...node};
    let mig = new node.web3.eth.Contract(_node.abi, data.multisig);

    let transaction = await mig.methods.transactions(data.transactionId).call();
    if(transaction.destination === "0x0000000000000000000000000000000000000000"){
        return {
            "errm": "Invalid Transaction Id",
            "data": "NotFoundError: Can't find transaction"
        }
    }

    let destinationContract = "Unknown Contract";
    for (var c in config.contract){
        if(!config.contract[c])
            continue;

        if(config.contract[c].toLowerCase() === transaction.destination){
            destinationContract = c;
            break;
        }
    }

    if(transaction.destination.toLowerCase() === config.governance.address.toLowerCase()){
        destinationContract = config.governance.chain + " Vault";
    }

    transaction.destinationContract = destinationContract;

    let decodedData = abiDecoder.decodeMethod(transaction.data);
    if(!decodedData){
        decodedData = "Unknown Transaction Call Data";
    }

    transaction.decodedData = decodedData;

    return transaction;
}

async function confirmTransaction(chain, multisig, transactionId) {
    if(!chainNode[chain.toLowerCase()]){
        return {
            "errm": "Invalid Chain",
            "data": "NotFoundError: Invalid Chain"
        }
    }

    return await _confirmTransaction(chainNode[chain.toLowerCase()], {
        multisig,
        transactionId,
        validator: {address: account.address, pk: account.pk},
    })
}

async function _confirmTransaction(node, data) {
    if (!initialized) {
        return;
    }

    let validator = {...data.validator} || {};
    delete data.validator;

    async function confirm() {
        let params = [
            data.transactionId
        ];

        let txOptions = {
            from: validator.address,
            gasPrice: node.web3.utils.toHex('0'),
            to: data.multisig
        };

        let gasPrice;
        if (node.name === 'orbit'){
            gasPrice = 0;
        }

        if (node.name === 'ethereum') {
            gasPrice = await getCurrentGas().catch(e => {return;});
        }

        if (node.name === 'klaytn') {
            gasPrice = await node.web3.eth.getGasPrice().catch(e => {return;});
        }

        if(!gasPrice){
            return {
                "errm": "getGasPrice Error",
                "data": 'confirmTransaction getGasPrice error'
            };
        }

        txOptions.gasPrice = gasPrice;

        let _node = {...node};

        let contract = new node.web3.eth.Contract(_node.abi, data.multisig);
        let gasLimit = await contract.methods.confirmTransaction(data.transactionId).estimateGas(txOptions).catch(e => {
            logger.gov.error('confirmTransaction estimateGas error: ' + e.message)
        });

        if (!gasLimit) {
            return {
                "errm": "EstimateGas Error",
                "data": 'confirmTransaction estimateGas error'
            };
        }

        txOptions.gasLimit = node.web3.utils.toHex(gasLimit);

        if (node.name === 'klaytn') {
            txOptions.type = 'SMART_CONTRACT_EXECUTION';
            txOptions.data = contract.methods.confirmTransaction(data.transactionId).encodeABI();
            txOptions.gas = '7000000';
            txOptions.value = 0;
            delete txOptions.gasLimit;
            delete txOptions.gasPrice;

            let signedTx = await klaytn.caver.klay.accounts.signTransaction(txOptions, '0x' + validator.pk.replace('0x', '')).catch(e => {
                logger.gov.error('Cannot sign klaytn transaction: ' + e.message);
            });

            if (!signedTx){
                return {
                    "errm": "Klaytn Transaction Sign Error",
                    "data": 'Cannot sign klaytn transaction'
                };
            }

            const ret = await klaytn.caver.klay.sendSignedTransaction(signedTx.rawTransaction)
                .on('transactionHash', (thash) => {
                    logger.gov.info('Klaytn Governance confirm Transaction sent: ' + thash);
                });
            global.monitor && global.monitor.setProgress('GOV', 'confirmTransaction');
            return ret;
        }

        let txData = {
            method: 'confirmTransaction',
            args: params,
            options: txOptions
        };

        const ret = await txSender.sendTransaction(_node, txData, {address: validator.address, pk: validator.pk});
        global.monitor && global.monitor.setProgress('GOV', 'confirmTransaction');
        return ret;
    }

    return await confirm();
}

async function validateSigHash(chain, multisig, sigHash) {
    if(!chainNode[chain.toLowerCase()]){
        return {
            "errm": "Invalid Chain",
            "data": "NotFoundError: Invalid Chain"
        }
    }

    return await _validateSigHash(chainNode[chain.toLowerCase()], {
        multisig,
        sigHash,
        validator: {address: account.address, pk: account.pk},
    })
}

async function _validateSigHash(node, data) {
    if (!initialized) {
        return;
    }

    let validator = {...data.validator} || {};
    delete data.validator;

    async function validate() {
        let signature = Britto.signMessage(data.sigHash, validator.pk);

        let params = [
            validator.address,
            data.sigHash,
            signature.v,
            signature.r,
            signature.s
        ];

        let txOptions = {
            from: validator.address,
            gasPrice: node.web3.utils.toHex('0'),
            to: data.multisig
        };

        let gasPrice;
        if (node.name === 'orbit'){
            gasPrice = 0;
        }

        if (node.name === 'ethereum') {
            gasPrice = await getCurrentGas().catch(e => {return;});
        }

        if (node.name === 'klaytn') {
            gasPrice = await node.web3.eth.getGasPrice().catch(e => {return;});
        }

        if(!gasPrice){
            return {
                "errm": "getGasPrice Error",
                "data": 'confirmTransaction getGasPrice error'
            };
        }

        txOptions.gasPrice = gasPrice;

        let _node = {...node};

        let contract = new node.web3.eth.Contract(_node.abi, data.multisig);
        let gasLimit = await contract.methods.validate(...params).estimateGas(txOptions).catch(e => {
            logger.gov.error('validateSigHash estimateGas error: ' + e.message)
        });

        if (!gasLimit) {
            return {
                "errm": "EstimateGas Error",
                "data": 'validateSigHash estimateGas error'
            };
        }

        txOptions.gasLimit = node.web3.utils.toHex(gasLimit);

        if (node.name === 'klaytn') {
            txOptions.type = 'SMART_CONTRACT_EXECUTION';
            txOptions.data = contract.methods.validate(...params).encodeABI();
            txOptions.gas = '7000000';
            txOptions.value = 0;
            delete txOptions.gasLimit;
            delete txOptions.gasPrice;

            let signedTx = await klaytn.caver.klay.accounts.signTransaction(txOptions, '0x' + validator.pk.replace('0x', '')).catch(e => {
                logger.gov.error('Cannot sign klaytn transaction: ' + e.message);
            });

            if (!signedTx){
                return {
                    "errm": "Klaytn Transaction Sign Error",
                    "data": 'Cannot sign klaytn transaction'
                };
            }

            const ret = await klaytn.caver.klay.sendSignedTransaction(signedTx.rawTransaction)
                .on('transactionHash', (thash) => {
                    logger.gov.info('Klaytn Governance validateSigHash Transaction sent: ' + thash);
                });
            global.monitor && global.monitor.setProgress('GOV', 'validateSigHash');
            return ret;
        }

        let txData = {
            method: 'validate',
            args: params,
            options: txOptions
        };

        const ret = await txSender.sendTransaction(_node, txData, {address: validator.address, pk: validator.pk});
        global.monitor && global.monitor.setProgress('GOV', 'validateSigHash');
        return ret;
    }

    return await validate();
}

async function getCurrentGas() {
    let gas = await api.ethGasPrice.request();
    return currentGasPrice = parseInt(((gas.fast * 0.1 + 0.5) * 1.2) * 10 ** 9);
}

module.exports = {
    initialize,
    getPendingTransaction,
    confirmTransaction,
    validateSigHash
}
