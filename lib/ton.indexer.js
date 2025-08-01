/************************************************************************
 * NOTE
 * This code block was cloned from TonWeb version 0.0.66.
 * The main change is the replacement of the TonCenter API from v2 to v3.
 ************************************************************************/
const {Cell} = require("tonweb-latest").boc;
const {base64ToBytes} = require("tonweb-latest").utils;
const { Address } = require("ton");

if (typeof fetch === 'undefined') {
    fetch = require('node-fetch');
}

const SHARD_ID_ALL = '-9223372036854775808'; // 0x8000000000000000

class HttpProvider {
  /**
   * @param host? {string}
   * @param options? {{apiKey: string}}
   */
  constructor(host, options) {
    this.host = host || "https://toncenter.com/api/v3";
    this.options = options || {};
  }

  /**
   * @private
   * @param apiUrl   {string}
   * @param method   {string}
   * @param query    {URLSearchParams}
   * @return {Promise<any>}
   */
  sendGet(apiUrl, method, query) {
    const headers = {
      'accept': 'application/json'
    };
    if (this.options.apiKey) {
      headers['X-API-Key'] = this.options.apiKey;
    }

    return fetch(`${apiUrl}/${method}?${query.toString()}`, {
      method: 'GET',
      headers: headers,
    })
    .then((response) => response.json())
    .then((result) => result.error ? Promise.reject(result.error) : result);
  }

  /**
   * @private
   * @param apiUrl   {string}
   * @param method   {string}
   * @param request   {json}
   * @return {Promise<any>}
   */
  sendPost(apiUrl, method, request) {
    const headers = {
      'accept': 'application/json',
      'Content-Type': 'application/json'
    };
    if (this.options.apiKey) {
      headers['X-API-Key'] = this.options.apiKey;
    }

    return fetch(`${apiUrl}/${method}`, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(request)
    })
    .then((response) => response.json())
    .then((result) => result.error ? Promise.reject(result.error) : result);
  }

  /**
   * @param method    {string}
   * @param params    {any}  todo: Array<any>
   * @return {Promise<any>}
   */
  send(method, params) {
    if (["estimateFee","message","runGetMethod"].includes(method)) {
      return this.sendPost(
        this.host,
        method,
        params,
      );
    }
    return this.sendGet(
      this.host,
      method,
      new URLSearchParams(params)
    );
  }

  /**
   * Use this method to get information about address: balance, code, data, last_transaction_id.
   * @param address {string}
   */
  async getAddressInfo(address, use_v2=false) {
    return this.send('addressInformation', {address: address, use_v2});
  }

  /**
   * Similar to previous one but tries to parse additional information for known contract types. This method is based on generic.getAccountState thus number of recognizable contracts may grow. For wallets we recommend to use getWalletInformation.
   * @param address {string}
   */
  async getExtendedAddressInfo(address) {
    return Promise.reject("v3 indexer doesn't support this api. try to use getAddressInfo");
  }

  /**
   * Use this method to retrieve wallet information, this method parse contract state and currently supports more wallet types than getExtendedAddressInformation: simple wallet, stadart wallet and v3 wallet.
   * @param address {string}
   */
  async getWalletInfo(address, use_v2=false) {
    return this.send('walletInformation', {address: address, use_v2});
  }

  /**
   * Use this method to get transaction history of a given address.
   * @param address   {string}
   * @param limit?    {number}
   * @param lt?    {number | string}
   * @param hash?    {string}
   * @param to_lt?    {number | string}
   * @return array of transaction object
   */
  async getTransactions(account, limit = 20, lt = undefined, hash = undefined, offset = 0) {
    let params = {limit, offset};
    if (account) {
      params.account = account;
    }
    if (lt) {
      params.lt = lt;
    }
    if (hash) {
      params.hash = hash;
    }
    const result = await this.send("transactions", params);
    result.transactions.forEach(t => {
      t.transaction_id = {
        hash: t.hash,
        lt: t.lt
      };

      let split = t.in_msg.source.split(":");
      let addressTon = new Address(split[0], Buffer.from(split[1], "hex"));
      t.in_msg.source = addressTon.toFriendly();
      split = t.in_msg.destination.split(":");
      addressTon = new Address(split[0], Buffer.from(split[1], "hex"));
      t.in_msg.destination = addressTon.toFriendly();
      t.in_msg.message = t.in_msg.message_content.decoded && t.in_msg.message_content.decoded.comment;

      t.out_msgs.forEach(msg => {
        if (msg.source) {
          let split = msg.source.split(":");
          let addressTon = new Address(split[0], Buffer.from(split[1], "hex"));
          msg.source = addressTon.toFriendly();
        } else {
          msg.source = "";
        }
        if (msg.destination) {
          let split = msg.destination.split(":");
          let addressTon = new Address(split[0], Buffer.from(split[1], "hex"));
          msg.destination = addressTon.toFriendly();
        } else {
          msg.destination = "";
        }
        if (!msg.value) {
          msg.value = "0";
        }
        msg.msg_data = msg.message_content;
      })

      t.fee = t.total_fees;
    });
    return result.transactions;
  };

  /**
   * Use this method to get balance (in nanograms) of a given address.
   * @param address {string}
   */
  async getBalance(address) {
    return Promise.reject("v3 indexer doesn't support this api. try to use getAddressInfo");
  }

  /**
   * Use this method to send serialized boc file: fully packed and serialized external message.
   * @param base64 {string} base64 of boc bytes Cell.toBoc
   */
  async sendBoc(base64) {
    return this.send("message", {'boc': base64});
  };

  /**
   * @deprecated
   */
  async sendQuery(query) {
    return Promise.reject("v3 indexer doesn't support this api. try to use sendBoc");
  };

  /**
   * @param query     object as described https://toncenter.com/api/test/v2/#estimateFee
   * @return fees object
   */
  async getEstimateFee(query) {
    return this.send("estimateFee", query);
  };

  /**
   * Invoke get-method of smart contract
   * todo: think about throw error if result.exit_code !== 0 (the change breaks backward compatibility)
   * @param address   {string}    contract address
   * @param method   {string | number}        method name or method id
   * @param params?   Array of stack elements: [['num',3], ['cell', cell_object], ['slice', slice_object]]
   */
  async call(address, method, params = []) {
    const result = await this.send('runGetMethod', {
        address: address,
        method: method,
        stack: params,
    });
    const conv = [];
    for (const element of result.stack) {
      if (element.type === "num") {
        conv.push([element.type, element.value]);
      }
      if (element.type === "cell") {
        conv.push([element.type, {bytes: element.value}]);
      }
    }
    result.stack = conv;
    return result;
  }

  /**
   * Invoke get-method of smart contract
   * @param address   {string}    contract address
   * @param method   {string | number}        method name or method id
   * @param params?   Array of stack elements: [['num',3], ['cell', cell_object], ['slice', slice_object]]
   */
  async call2(address, method, params = []) {
    return Promise.reject("v3 indexer doesn't support this api. try to use call");
  }

  /**
   * Returns network config param
   * @param configParamId {number}
   * @return {Cell}
   */
  async getConfigParam(configParamId) {
    return Promise.reject("v3 indexer no longer to support this api.");
  }

  /**
   * Returns ID's of last and init block of masterchain
   */
  async getMasterchainInfo() {
    return this.send('masterchainInfo', {});
  }

  /**
   * Returns ID's of shardchain blocks included in this masterchain block
   * @param masterchainBlockNumber {number}
   */
  async getBlockShards(masterchainBlockNumber) {
    const result = await this.send('masterchainBlockShards', {
      seqno: masterchainBlockNumber,
      limit: 100,
    });
    result.shards = result.blocks;
    return result;
  }

  /**
   * Returns transactions hashes included in this block
   * @param workchain {number}
   * @param shardId   {string}
   * @param shardBlockNumber  {number}
   * @param limit? {number}
   * @param afterLt? {number} pivot transaction LT to start with
   * @param addressHash? {string} take the account address where the pivot transaction took place, convert it to raw format and take the part of the address without the workchain (address hash)
   */
  async getBlockTransactions(workchain, shardId, shardBlockNumber, limit, afterLt, addressHash=undefined) {
    if (addressHash) {
      return Promise.reject("v3 indexer no longer to support this api with addressHash");
    }
    return this.send('getBlockTransactions', {
      workchain,
      shard: shardId,
      seqno: shardBlockNumber,
      limit,
      start_lt: afterLt
    });
  }

  /**
   * Returns transactions hashes included in this masterhcain block
   * @param masterchainBlockNumber  {number}
   * @param limit? {number}
   * @param afterLt? {number | string} pivot transaction LT to start with
   * @param addressHash? {string}  take the account address where the pivot transaction took place, convert it to raw format and take the part of the address without the workchain (address hash)
   */
  async getMasterchainBlockTransactions(masterchainBlockNumber, limit, afterLt, addressHash=undefined) {
    return this.getBlockTransactions(-1, SHARD_ID_ALL, masterchainBlockNumber, limit, afterLt, addressHash);
  }

  /**
   * Returns block header and his previous blocks ID's
   * @param workchain {number}
   * @param shardId   {string}
   * @param shardBlockNumber  {number}
   */
  async getBlockHeader(workchain, shardId, shardBlockNumber) {
    return this.send('blocks', {
      workchain: workchain,
      shard: shardId,
      seqno: shardBlockNumber
    });
  }

  /**
   * Returns masterchain block header and his previous block ID
   * @param masterchainBlockNumber  {number}
   */
  async getMasterchainBlockHeader(masterchainBlockNumber) {
    return this.getBlockHeader(-1, SHARD_ID_ALL, masterchainBlockNumber);
  }
}

HttpProvider.SHARD_ID_ALL = SHARD_ID_ALL;

module.exports.default = HttpProvider;