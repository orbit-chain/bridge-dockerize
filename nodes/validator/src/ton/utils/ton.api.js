const TonWeb = require("tonweb");
const request = require("request-promise");

const nacl = TonWeb.utils.nacl;
const DEFAULT_WALLET_VERSION = "v3R2";

const { beginCell, beginDict, Cell, Slice, toNano, TupleSlice } = require("ton");
const { CellMessage, InternalMessage, CommonMessageInfo, SendMode, Wallet, ExternalMessage } = require("ton");
const { Address, TonClient, WalletContract, WalletV3R2Source, contractAddress, parseDict } = require("ton");

const BN = require("bn.js");
function makeBN(str) {
    return typeof(str) !== 'string' || !str.startsWith("0x") ? new BN(str) : new BN(str.replace("0x",""), 'hex');
}

class TonAPI {
    constructor(endpoint) {
        if(!endpoint || !endpoint.rpc || !endpoint.apiKey) return;

        this.rpc = endpoint.rpc;
        this.apiKey = endpoint.apiKey;

        this.ton = new TonClient({endpoint: this.rpc, apiKey: this.apiKey});
        this.tonWeb = new TonWeb(new TonWeb.HttpProvider(this.rpc, {apiKey: this.apiKey}));

        this.tonWeb.checkRPCInterval = setInterval(this.checkRPC.bind(this), 1000 * 60);
    }

    async checkRPC() {
        const rpc = this.rpc;
        const apiKey = this.apiKey;
        const tonWeb = this.tonWeb;
        if(tonWeb.checkRPCInterval) {
            clearInterval(tonWeb.checkRPCInterval);
            tonWeb.checkRPCInterval = undefined;
        }

        try {
            let masterInfo = await tonWeb.provider.getMasterchainInfo().catch(e => {});
            if(!masterInfo || !masterInfo.last || !masterInfo.last.seqno) {
                global.monitor.setNodeConnectStatus("ton", `${rpc}/${apiKey}`, "disconnected");
                return;
            }

            global.monitor.setNodeConnectStatus("ton", `${rpc}/${apiKey}`, "connected");
        } finally {
            if (!tonWeb.checkRPCInterval) {
                tonWeb.checkRPCInterval = setInterval(this.checkRPC.bind(this), 1000 * 60);
            }
        }
    }

    async getTonAccount(pk) {
        const key = Buffer.from(pk.replace("0x", ""), "hex").toString("base64");
        const keyPair = nacl.sign.keyPair.fromSeed(TonWeb.utils.base64ToBytes(key));

        const walletVersion = DEFAULT_WALLET_VERSION;
        const WalletClass = this.tonWeb.wallet.all[walletVersion];
        let walletContract = new WalletClass(this.tonWeb.provider, {
            publicKey: keyPair.publicKey,
            wc: 0
        });

        let account = await walletContract.getAddress().catch(e => {});
        if(!account) return;

        return {
            address: account.toString(true, true, true),
            hashPart: TonWeb.utils.bytesToHex(account.hashPart),
            publicKey: "0x"+Buffer.from(keyPair.publicKey).toString('hex')
        }
    }

    async getHashPart(address) {
        const addressTon = Address.parseFriendly(address);
        if(!addressTon || !addressTon.address || parseInt(addressTon.address.workChain) !== 0) return;

        return "0x"+TonWeb.utils.bytesToHex(addressTon.address.hash);
    }

    async getTransaction(address, hash, lt) {
        let res = await this.tonWeb.getTransactions(address, 1, lt, hash, undefined).catch(e => {console.log(e)});
        if(res.length !== 1) return;

        return res[0];
    }

    async getCurrentBlock() {
        let masterInfo = await this.tonWeb.provider.getMasterchainInfo().catch(e => {});
        if(!masterInfo || !masterInfo.last || !masterInfo.last.seqno) return;

        let masterSeqno = masterInfo.last.seqno;
        let blockShards = await this.tonWeb.provider.getBlockShards(masterSeqno).catch(e => {});
        if(!blockShards || !blockShards.shards) return;

        let blockNumber;
        for(let shard of blockShards.shards){
            if(shard.workchain !== 0) continue;

            blockNumber = shard.seqno;
        }

        return blockNumber;
    }

    async getTransactionBlock(address, lt) {
        let addrInfo = await this.tonWeb.provider.getAddressInfo(address).catch(e => {console.log(e)});
        if(!addrInfo || !addrInfo.block_id || !addrInfo.block_id.shard) {
            logger.ton.error("getAddressInfo error.");
            return;
        }

        let addrShard = addrInfo.block_id.shard;
        let lookupHost = `${this.rpc.replace("/jsonRPC","")}/lookupBlock?workchain=0&shard=${addrShard}&lt=${lt}`
        let res = await request.get(lookupHost).catch(e => {});
        if(!res) {
            logger.ton.error("lookupBlock error.");
            return;
        }

        res = JSON.parse(res);
        if(!res.ok || !res.result || !res.result.seqno) {
            logger.ton.error("lookupBlock parsing error.");
            return;
        }

        return res.result.seqno;
    }

    async getMultisigData(vault) {
        let res = await this.tonWeb.provider.call(vault, 'get_multisig_data', []).catch(e => {});
        if(!res || res.exit_code !== 0) return;

        const stack = res.stack;
        const tupleSlice = new TupleSlice(stack);

        const required = tupleSlice.readNumber();

        const pubCell = tupleSlice.readCell();
        const pubSlice = pubCell.beginParse();

        const pubdict = parseDict(pubSlice, 256, (slice) => { return slice; });
        let pubkeys = [];
        for(let [pub, ] of pubdict.entries()){
            pub = "0x"+(new BN(pub)).toString('hex').padStart(64,0);
            pubkeys.push(pub);
        }

        return { required, pubkeys }
    }
}

module.exports = TonAPI;
