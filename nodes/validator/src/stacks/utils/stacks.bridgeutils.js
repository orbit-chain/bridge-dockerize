const request = require("request-promise");
const config = require(ROOT + '/config');
const settings = config.requireEnv("./settings");
const BridgeUtils = require(ROOT + '/lib/bridgeutils');

const {
  AddressVersion,
  AnchorMode,
  BufferReader,
  deserializeMemoString,
  TransactionVersion,
  addressFromVersionHash,
  addressToString,
  broadcastTransaction,
  callReadOnlyFunction,
  deserializeCV,
  makeUnsignedSTXTokenTransfer,
  nextVerification,
  TransactionSigner,
  makeSigHashPreSign,
} = require("@stacks/transactions");

const {
  StacksTestnet,
  StacksMainnet,
} = require("@stacks/network");

const baseReqObj = {
  headers: {'Content-Type': 'application/json', 'User-Agent': 'OrbitBridge-Request'},
  json: true,
};

class StacksBridgeUtils extends BridgeUtils {
  constructor() {
    super();

    let addressVersion = AddressVersion.MainnetMultiSig;
    let singleAddressVersion = AddressVersion.MainnetSingleSig;
    let transactionVersion = TransactionVersion.Mainnet;
    let network = new StacksMainnet();
    if (settings.Endpoints.Stacks.network === "testnet") {
      addressVersion = AddressVersion.TestnetMultiSig;
      singleAddressVersion = AddressVersion.TestnetSingleSig;
      transactionVersion = TransactionVersion.Testnet;
      network = new StacksTestnet();
    }

    this.AddressVersion = addressVersion;
    this.SingleAddressVersion = singleAddressVersion;
    this.TransactionVersion = transactionVersion;
    this.Network = network;

    let endpoints = settings.Endpoints.Stacks;
    global.monitor.setNodeConnectStatus("stacks", `${endpoints.url}/${endpoints.network ? endpoints.network : "mainnet"}`, "connected");
  }

  hexToCV(hex) {
    if (hex.startsWith('0x'))
        hex = hex.substring(2);
    return deserializeCV(new BufferReader(Buffer.from(hex, 'hex')))
  }

  async getLatestBlock() {
    const response = await request.get({
      url: `${settings.Endpoints.Stacks.url}/extended/v1/block?limit=1`,
      ...baseReqObj,
    }).catch(e => {
      logger.stacks.error(`getTransaction error. tx:${thash}, err:${e.message}`);
    });
    if (!response) {
      return;
    }

    return response.results[0];
  }

  async getTransaction(thash) {
    const tx = await request.get({
      url: `${settings.Endpoints.Stacks.url}/extended/v1/tx/${thash}`,
      ...baseReqObj,
    }).catch(e => {
      logger.stacks.error(`getTransaction error. tx:${thash}, err:${e.message}`);
    });
    if (!tx) {
      return;
    }
    if (tx.token_transfer && tx.token_transfer.memo) {
      let memo = tx.token_transfer.memo.replace("0x", "");
      memo = deserializeMemoString(new BufferReader(Buffer.from(memo, "hex")));
      memo.content = memo.content.replace(/\u0000/g, "");
      tx.token_transfer.memo = memo;
    }
    return tx;
  };

  async getBalance(address) {
    const stx = await request.get({
      url: `${settings.Endpoints.Stacks.url}/extended/v1/address/${address}/stx`,
      ...baseReqObj,
    }).catch(e => {
      logger.stacks.error(`getBalance error. addr:${address}, err:${e.message}`);
    });
    if(!stx)
        return;

    return stx.balance;
  };

  async getNonce(address) {
    const account = await request.get({
      url: `${settings.Endpoints.Stacks.url}/extended/v1/address/${address}/nonces`,
      ...baseReqObj,
    }).catch(e => {
      logger.stacks.error(`getNonce error. addr:${address}, err:${e.message}`);
    });
    if(!account)
        return;

    return account.possible_next_nonce;
  }

  async makeUnsignedSTXTokenTransfer(nonce, publicKeys, quorumCount, toAddr, memo, amount) {
    publicKeys = publicKeys.map(key => { return key.replace("0x",""); });
    const transaction = await makeUnsignedSTXTokenTransfer({
        recipient : toAddr,
        nonce: nonce,
        amount: amount,
        memo: memo,
        numSignatures: parseInt(quorumCount), // number of signature required
        publicKeys: publicKeys, // public key string array with >= numSignatures elements
        network: this.Network,
        anchorMode: AnchorMode.Any,
    }).catch(e => {
        logger.stacks.error(`makeTransaction error. nonce: ${nonce}, err:${e.message}`);
    });
    if(!transaction)
        return;

    return transaction;
  }

  async readContract(contractAddress, contractName, functionName, functionArgs, sender) {
    const ret = await callReadOnlyFunction({
      contractAddress,
      contractName,
      functionName,
      functionArgs,
      network: this.Network,
      senderAddress: sender,
    });
    if (!ret) {
      return;
    }

    return ret;
  }

  async estimateFee(serializedTx) {
    const stx = await request.post({
        url: `${settings.Endpoints.Stacks.url}/extended/v1/fee_rate`,
        ...baseReqObj,
        params: {transaction : serializedTx}
    }).catch(e => {
        logger.stacks.error(`estimateFee error. tx:${serializedTx}, err:${e.message}`);
    });
    if(!stx)
        return;

    return stx.fee_rate;
  }

  getMultiAddressFromHex(hexAddr) {
    return addressToString(addressFromVersionHash(this.AddressVersion, hexAddr.replace("0x", "")));
  }

  getSingleAddressFromHex(hexAddr) {
    return addressToString(addressFromVersionHash(this.SingleAddressVersion, hexAddr.replace("0x", "")));
  }

  async broadcastTransaction(transaction) {
    const res = await broadcastTransaction(transaction.serialize(), settings.Endpoints.Stacks.url).catch(e => {
        logger.stacks.error(`broadcastTransaction fail. err: ${e.message}`);
    });
    if(!res)
      return;

    return res.txid;
  }

  getMemo(data) {
    if (!data) {
      return "";
    }
    return Buffer.from(data.replace("0x",""), 'hex').toString('utf-8');
  }

  getCurrentSigHash(lastSigHash, lastSignature, fee, nonce){
    let res;
    try{
        res = nextVerification(
            lastSigHash.replace("0x",""),
            4, // Standard
            fee,
            nonce,
            1, // Uncompressed
            {data: lastSignature.replace("0x","")} // {00,01}{r}{s}
        )
    } catch(e) {
        logger.stacks.error(`getCrrentSigHash fail. err: ${e.message}`);
        return;
    };
    if(!res)
      return;

    return res.nextSigHash;
  }

  async getInitialSigHash(transaction){
    transaction.auth.spendingCondition.fields = [];
    const signer = new TransactionSigner(transaction);
    if(!signer || !signer.sigHash)
      return;

    return signer.sigHash;
  }

  async getSigHashPreSign(curSigHash, authType, fee, nonce){
    let res;
    try{
        res = makeSigHashPreSign(curSigHash, authType, fee, nonce);
    } catch(e) {
        logger.stacks.error(`makeSigHashPreSign fail. err: ${e.message}`);
        return;
    }
    if(!res)
      return;

    return res;
  }
}

module.exports = StacksBridgeUtils;
