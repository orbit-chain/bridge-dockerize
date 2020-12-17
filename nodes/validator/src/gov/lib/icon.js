const config = require(ROOT + '/config');
const errmInvalidTransaction = {
    "errm": "[ICON] Invalid Transaction Id",
    "data": "NotFoundError: Can't find transaction"
}

async function _getTransaction(node, data) {
    let iconNode = {...node};
    let mig = await iconNode.getCallBuilder(data.multisig);

    let transaction = await iconNode.call(mig, "getTransactionInfo", {"_transactionId": data.transactionId}).catch(e=>{return;});
    if(!transaction || !transaction._destination){
        return errmInvalidTransaction;
    }

    let myAddress = monitor.address["ICON"];

    let confirmationCount = await iconNode.call(mig, "getConfirmationCount", {"_transactionId": data.transactionId}).catch(e=>{return;});
    if(!confirmationCount){
        return errmInvalidTransaction;
    }

    let confirmedValidatorList = await iconNode.call(mig, "getConfirmations", {"_offset": "0", "_count": confirmationCount, "_transactionId": data.transactionId}).catch(e=>{return;});
    if(!confirmedValidatorList){
        return errmInvalidTransaction;
    }

    let myConfirmation = false;
    for(let va of confirmedValidatorList){
        if(va.toLowerCase() === myAddress.toLowerCase())
            myConfirmation = true;
    }

    let required = await iconNode.call(mig, "getRequirement", {}).catch(e=>{return;});
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

        if(config.contract[c].toLowerCase() === transaction._destination.toLowerCase()){
            destinationContract = c;
            break;
        }
    }

    if(transaction._destination.toLowerCase() === config.governance.address.toLowerCase()){
        destinationContract = config.governance.chain + " Vault";
    }

    transaction.destinationContract = destinationContract;
    transaction.method = transaction._method;
    transaction.params = JSON.parse(transaction._params);

    return transaction;
}

async function _confirmTransaction(node, data) {
    let validator = {...data.validator} || {};
    delete data.validator;

    let iconNode = {...node};

    let sender = await iconNode.getWalletByPK(validator.pk);

    let from = await sender.getAddress();
    let to = data.multisig;
    let method = "confirmTransaction";

    let params = {
        _transactionId: data.transactionId
    }

    let transaction = await iconNode.makeContractTransaction(from, to, 0, method, params).catch(e=>{return;});
    if(!transaction){
        return {
            "errm": "[ICON] Transaction Builder error",
            "data": "Transaction Builder error"
        }
    }

    let stepLimit = await iconNode.estimateStepLimit(transaction).catch(e=>{return;});
    if(!stepLimit){
        return {
            "errm": "[ICON] EstimateGas Error",
            "data": 'confirmTransaction estimateGas error'
        };
    }

    let txHash = await iconNode.sendTransaction(sender, transaction, stepLimit).catch(e=>{return e});
    return txHash;
}

module.exports = {
    _getTransaction,
    _confirmTransaction
}
