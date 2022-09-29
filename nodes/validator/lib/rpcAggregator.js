const Britto = require("./britto");

Britto.setAdd0x();
Britto.setRemove0x();

class RPCAggregator {
  chainId;
  chainName;
  pool = [];

  constructor(_chainName, _chainId) {
    this.chainName = _chainName;
    this.chainId = _chainId;
  }

  addRpc(url, {
    name = "mainnet",
    address,
    abi,
  } = {}) {
    const node = Britto.getNodeConfigBase(name);
    node.rpc = url;
    node.address = address;
    node.abi = abi;
    global.monitor.setNodeConnectStatus(`${this.chainName}_${this.pool.length}`, node.rpc, "connecting");
    new Britto(node, `${this.chainName}_${this.pool.length}`).connectWeb3();
    this.pool.push(node);
  }

  async addRpcWithBritto(node) {
    this.pool.push(node);
    let block = await node.web3.eth.getBlock("latest").catch(e => {console.log(e)});
    return !block ? false : true;
  }

  length() {
    return this.pool.length;
  }

  async select() {
    let bn = 0;
    let electedIndex;

    for(let i=0; i<this.pool.length; i++) {
      const node = this.pool[i];
      if (!node.isConnected) {
        continue;
      }

      const curBlockNumber = await node.web3.eth.getBlockNumber().catch( e => {
        logger.error(`[RPC_AGGREGATOR] getBlockNumber:${e}`);
      });
      if(!curBlockNumber || parseInt(curBlockNumber) < bn) {
        continue;
      }

      bn = parseInt(curBlockNumber);
      electedIndex = i;
    }
    const elected = this.pool[electedIndex];
    if (elected) {
      global.monitor.setNodeElectionStatus(elected.peggingType, elected.rpc, bn);
    }

    return elected;
  }

  async getNodes() {
    return [...this.pool];
  }
}

module.exports = RPCAggregator;
