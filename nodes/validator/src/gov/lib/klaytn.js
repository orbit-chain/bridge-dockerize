const config = require(ROOT + '/config');
const txSender = require(ROOT + '/lib/txsender');
const Britto = require(ROOT + '/lib/britto');
const Caver = require('caver-js');
const settings = config.requireEnv("./settings");

const errmInvalidTransaction =  {
    "errm": "[KLAYTN] Invalid Transaction Id",
    "data": "NotFoundError: Can't find data"
}

async function init(){
    const klaytn = Britto.getNodeConfigBase('klaytn');

    if(config.klaytn.KLAYTN_ISKAS){
        const option = {
            headers: [
                {name: 'Authorization', value: 'Basic ' + Buffer.from(config.klaytn.KLAYTN_KAS.accessKeyId + ':' + config.klaytn.KLAYTN_KAS.secretAccessKey).toString('base64')},
                {name: 'x-chain-id', value: config.klaytn.KLAYTN_KAS.chainId},
            ]
        }

        klaytn.rpc = config.klaytn.KLAYTN_KAS.rpc;
        klaytn.caver = new Caver(new Caver.providers.HttpProvider(config.klaytn.KLAYTN_KAS.rpc, option));
    }
    else{
        const rpc = config.klaytn.KLAYTN_RPC;
        if (Array.isArray(rpc)) {
            klaytn.rpc = rpc[0];
        } else {
            klaytn.rpc = rpc;
        }
        klaytn.caver = new Caver(klaytn.rpc);
    }
    klaytn.abi = Britto.getJSONInterface({filename: 'MessageMultiSigWallet.abi'});

    let isListening = await klaytn.caver.klay.net.isListening().catch(e => {
        logger.error(e);
        return;
    });

    if(isListening){
        logger.info(`[GOV_KLAYTN] klaytn caver connected to ${klaytn.rpc}`);
    }

    return klaytn;
}

async function _getTransaction(node, data, abiDecoder) {
    let _node = {...node};
    let mig = new _node.caver.klay.Contract(_node.abi, data.multisig);

    let transaction = await mig.methods.transactions(data.transactionId).call().catch(e => {return;});
    if(!transaction || transaction.destination === "0x0000000000000000000000000000000000000000"){
        return errmInvalidTransaction;
    }

    let myAddress = monitor.address["KLAYTN"];
    if(!myAddress){
        return errmInvalidTransaction;
    }

    let confirmedValidatorList = await mig.methods.getConfirmations(data.transactionId).call().catch(e => {return;});
    if(!confirmedValidatorList){
        return errmInvalidTransaction;
    }

    let myConfirmation = false;
    for(let va of confirmedValidatorList){
        if(va.toLowerCase() === myAddress.toLowerCase())
            myConfirmation = true;
    }

    let required = await mig.methods.required().call().catch(e=>{return;});
    if(!required) {
        return errmInvalidTransaction;
    }

    transaction.myAddress = myAddress;
    transaction.myConfirmation = myConfirmation;
    transaction.multisig_requirement = required;
    transaction.confirmedValidatorList = confirmedValidatorList;

    let destinationContract = "Unknown Contract";
    for (var c in config.contract){
        if(!config.contract[c])
            continue;

        if(config.contract[c].toLowerCase() === transaction.destination.toLowerCase() && c.includes("KLAYTN")){
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

async function _confirmTransaction(node, data) {
    let validator = {...data.validator} || {};
    delete data.validator;

    async function confirm() {
        let params = [
            data.transactionId
        ];

        let txOptions = {
            from: validator.address,
            to: data.multisig
        };
        if (settings.KLAYTN_CHAIN_ID) {
            txOptions.chainId = settings.KLAYTN_CHAIN_ID;
        }

        let _node = {...node};

        let contract = new _node.caver.klay.Contract(_node.abi, data.multisig);

        let transaction = await contract.methods.transactions(data.transactionId).call().catch(e => {return;});
        if(!transaction || transaction.destination === "0x0000000000000000000000000000000000000000"){
            return errmInvalidTransaction;
        }

        let required = await contract.methods.required().call().catch(e=>{return;});
        if(!required) {
            return errmInvalidTransaction;
        }

        let confirmedValidatorList = await contract.methods.getConfirmations(data.transactionId).call().catch(e => {return;});
        if(!confirmedValidatorList){
            return errmInvalidTransaction;
        }

        let myConfirmation = false;
        for(let va of confirmedValidatorList){
            if(va.toLowerCase() === validator.address.toLowerCase())
                myConfirmation = true;
        }

        if(myConfirmation || parseInt(required) === parseInt(confirmedValidatorList.length))
            return "Already Confirmed"

        let gasLimit = await contract.methods.confirmTransaction(data.transactionId).estimateGas(txOptions).catch(e => {
            logger.gov.error('confirmTransaction estimateGas error: ' + e.message)
        });

        if (!gasLimit) {
            return {
                "errm": "[KLAYTN] EstimateGas Error",
                "data": 'confirmTransaction estimateGas error'
            };
        }

        txOptions.type = 'SMART_CONTRACT_EXECUTION';
        txOptions.data = contract.methods.confirmTransaction(data.transactionId).encodeABI();
        txOptions.gas = (parseInt(gasLimit) * 2).toString();
        txOptions.value = 0;

        let signedTx = await _node.caver.klay.accounts.signTransaction(txOptions, '0x' + validator.pk.replace('0x', '')).catch(e => {
            logger.gov.error('Cannot sign klaytn transaction: ' + e.message);
        });

        if (!signedTx){
            return {
                "errm": "[KLAYTN] Transaction Sign Error",
                "data": 'Cannot sign klaytn transaction'
            };
        }

        const ret = await _node.caver.klay.sendSignedTransaction(signedTx.rawTransaction)
            .on('transactionHash', (thash) => {
                logger.gov.info('Klaytn Governance confirm Transaction sent: ' + thash);
            });
        global.monitor && global.monitor.setProgress('GOV', 'confirmTransaction');
        return ret.transactionHash;
    }

    return await confirm();
}

module.exports = {
    init,
    _getTransaction,
    _confirmTransaction
}
