const request = require('request-promise');
const IconService = require('icon-sdk-js');
const { IconAmount, IconConverter, IconBuilder, IconWallet, SignedTransaction } = IconService;
const config = require(ROOT + '/config');

const httpProvider = new IconService.HttpProvider(config.icon.api);
const icon = new IconService(httpProvider);

let contractAddress;
let migAddress;
if(config.governance.chain === "ICON"){
    contractAddress = config.governance.address;
    migAddress = config.governance.address;
}
else{
    contractAddress = config.contract.ICON_MAINNET_MINTER;
    migAddress = config.contract.ICON_MULTISIG_CONTRACT;
}

const contract = (new IconService.IconBuilder.CallBuilder()).to(contractAddress);
const mig = (new IconService.IconBuilder.CallBuilder()).to(migAddress);

module.exports.api = icon;
module.exports.contract = contract;
module.exports.contract.address = contractAddress;
module.exports.mig = mig;
module.exports.mig.address = migAddress;
module.exports.converter = IconConverter;

module.exports.toHex = (_data) => {
    return "0x" + IconConverter.toBigNumber(_data).toString(16);
}

module.exports.getWalletByPK = async (_pk) => {
    return IconWallet.loadPrivateKey(_pk);
}

module.exports.getAddressByPK = async (_pk) => {
    return IconWallet.loadPrivateKey(_pk).getAddress();
}

module.exports.getLastBlock = async () => {
    let block = await icon.getLastBlock().execute().catch(e => {
        logger.icon_v2.error("getLastBlock error: " + e.message);
    });

    if(!block)
        return;

    return block;
}

module.exports.getBalance = async (addr) => {
    let balance = await icon.getBalance(addr).execute().catch(e => {
        logger.icon_v2.error("getBalance error: " + e.message);
    })

    return balance;
}

module.exports.getTransactionResult = async (txHash) => {
    let receipt = await icon.getTransactionResult(txHash).execute().catch(e => {
        logger.icon_v2.error("getTransactionResult error: " + e.message);
    });

    if(!receipt)
        return;

    return receipt
}

module.exports.getStepPrice = async () => {
    const governance = (new IconService.IconBuilder.CallBuilder()).to("cx0000000000000000000000000000000000000001");

    let transaction;
    try {
        transaction = await governance.method("getStepPrice").params({}).build();
    }
    catch (e) {
        logger.icon_v2.error("callTransaction build error: " + e.message);
    }

    if(!transaction)
        return;

    let res = await icon.call(transaction).execute().catch(e => {
        logger.icon_v2.error("call error: " + e.message);
    });

    if(!res)
        return;

    return res;
}


module.exports.call = async (contract, method, params) => {
    let transaction;
    try {
        transaction = await contract.method(method).params(params).build();
    }
    catch (e) {
        logger.icon_v2.error("callTransaction build error: " + e.message);
    }

    if(!transaction)
        return;

    let res = await icon.call(transaction).execute().catch(e => {
        logger.icon_v2.error("call error: " + e.message);
    });

    if(!res)
        return;

    return res;
}

module.exports.makeTransferTransaction = async (_from, _to, _value) => {
    const { IcxTransactionBuilder } = IconBuilder;

    const from = _from;
    const to = _to;
    const value = IconAmount.of(_value, IconAmount.Unit.ICX).toLoop();

    const version = IconConverter.toBigNumber(config.icon.version);
    const nid = IconConverter.toBigNumber(config.icon.nid);
    const timestamp = (new Date()).getTime() * 1000;

    const builder = new IcxTransactionBuilder();
    const transaction = builder
        .from(from)
        .to(to)
        .value(value)
        .nid(nid)
        .version(version)
        .timestamp(timestamp)
        .build()

    return transaction;
}

module.exports.makeContractTransaction = async (_from, _to, _value, _method, _params) => {
    const { CallTransactionBuilder } = IconBuilder;

    const from = _from;
    const to = _to;
    const method = _method;
    const params = _params;
    const value = IconAmount.of(_value, IconAmount.Unit.ICX).toLoop();

    const version = IconConverter.toBigNumber(config.icon.version);
    const nid = IconConverter.toBigNumber(config.icon.nid);
    const timestamp = (new Date()).getTime() * 1000;

    const builder = new CallTransactionBuilder();
    const transaction = builder
        .from(from)
        .to(to)
        .value(value)
        .nid(nid)
        .version(version)
        .timestamp(timestamp)
        .method(method)
        .params(params)
        .build()

    return transaction;
}

module.exports.sendTransaction = async (_wallet, _transaction, _stepLimit) => {
    _transaction.stepLimit = parseInt(_stepLimit);

    let signedTransaction = new SignedTransaction(_transaction, _wallet);
    let txHash = await icon.sendTransaction(signedTransaction).execute();

    return txHash;
}

module.exports.estimateStepLimit = async (_transaction) => {
    let transaction = makeRPCTransaction(_transaction);
    return request.post({
        headers: {'Content-Type': 'application/json'},
        url: config.icon.debug,
        body: {
            "jsonrpc": "2.0",
            "id": 1234,
            "method": "debug_estimateStep",
            "params": transaction
        },
        json: true
    })
    .then(body => {
        return body.result;
    });
}

function makeRPCTransaction(_transaction) {
    _transaction.version = "0x" + _transaction.version.toString(16);
    _transaction.nid = "0x" + _transaction.nid.toString(16);
    _transaction.value = "0x" + _transaction.value.toString(16);
    _transaction.timestamp = "0x" + (parseInt(_transaction.timestamp)).toString(16);
    return json_view(_transaction);
}

function json_view(j){
    return JSON.parse(JSON.stringify(j));
}
