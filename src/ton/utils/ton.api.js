const TonWeb = require("tonweb");
const request = require("request-promise");

const nacl = TonWeb.utils.nacl;
const DEFAULT_WALLET_VERSION = "v3R2";

const { beginCell, beginDict, Cell, Slice, toNano, TupleSlice } = require("ton");
const { CellMessage, InternalMessage, CommonMessageInfo, SendMode, Wallet, ExternalMessage } = require("ton");
const { Address, TonClient, WalletContract, WalletV3R2Source, contractAddress, parseDict, parseTransaction } = require("ton");

require("dotenv").config();

const BN = require("bn.js");
function makeBN(str) {
    return typeof(str) !== 'string' || !str.startsWith("0x") ? new BN(str) : new BN(str.replace("0x",""), 'hex');
}

class TonAPI {
    constructor(endpoint) {
        if(!endpoint || !endpoint.rpc) throw "Ton endpoint is missing"
        if(!process.env.TON_API_KEY) throw "Ton api key is missing"

        this.rpc = endpoint.rpc;
        this.apiKey = process.env.TON_API_KEY;

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
        let tx;
        try{
            let res = await this.tonWeb.getTransactions(address, 1, lt, hash, undefined).catch(e => {});
            if(!res || res.length !== 1) return;

            tx = res[0];
        } catch(e) {}

        return tx;
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
        let addrInfo = await this.tonWeb.provider.getAddressInfo(address).catch(e => {});
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

    async getTransactionAddress(multiSig, tid) {
        let transactionAddress;
        try {
            const txAddrStack = await this.tonWeb.provider.call(multiSig, 'get_transaction_address', [["num", tid.toString(10)]]);
            if(!txAddrStack) return;

            const txAddrSlice = new TupleSlice(txAddrStack.stack);
            transactionAddress = txAddrSlice.readCell().beginParse().readAddress()?.toFriendly();
        } catch (e) {}

        return transactionAddress;
    }

    async getTransactionData(transactionAddress) {
        let data;
        try {
            const dataStack = await this.tonWeb.provider.call(transactionAddress, 'get_transaction_data', []);
            if(!dataStack) return;

            const tupleSlice = new TupleSlice(dataStack.stack);

            const destination = tupleSlice.readCell().beginParse().readAddress()?.toFriendly();
            const amount = new BN(tupleSlice.readBigNumber().toString("hex"), 'hex').toString(10);
            const payload = tupleSlice.readCell().toString();

            data = { destination, amount, payload };
        } catch (e) {}

        return data;
    }

    async getTransactionConfig(transactionAddress) {
        let config;
        try {
            const configStack = await this.tonWeb.provider.call(transactionAddress, "get_config", []);
            if(!configStack) return;

            const tupleSlice = new TupleSlice(configStack.stack);

            const multisigAddress = tupleSlice.readCell().beginParse().readAddress()?.toFriendly();
            const transactionId = new BN(tupleSlice.readBigNumber().toString("hex"), 'hex').toString(10);
            const required = new BN(tupleSlice.readBigNumber().toString("hex"), 'hex').toString(10);
            const confirmation = new BN(tupleSlice.readBigNumber().toString("hex"), 'hex').toString(10);

            let confirmedValidators = [];
            if(configStack.stack[4][0] === "cell"){
                const valiAddrsCell = tupleSlice.readCell();
                const valiAddrsSlice = valiAddrsCell.beginParse();
                const valiAddrsDict = parseDict(valiAddrsSlice, 256, (slice) => { return slice.readRemaining(); });
                for(let [validatorHash, ] of valiAddrsDict.entries()){
                    validatorHash = (new BN(validatorHash)).toString("hex").padStart(64, "0");
                    confirmedValidators.push(Address.parse(`0:${validatorHash}`).toFriendly());
                }
            }

            config = { required, confirmation, confirmedValidators };
        } catch (e) {}

        return config;
    }

    async parseTransaction(data) {
        let description;

        try {
            let cell = Cell.fromBoc(Buffer.from(data,'base64').toString('hex'))[0].beginParse();
            let res = parseTransaction(0, cell);
            description = res.description;
        } catch (e) {
            logger.ton.error(`parseTransaction error`);
        }

        return description;
    }

    async confirmTransaction(pk, mig, tid) {
        const walletKey = nacl.sign.keyPair.fromSeed(Buffer.from(pk.replace("0x",""),'hex'));
        const walletContract = WalletContract.create(this.ton, WalletV3R2Source.create({ publicKey: walletKey.publicKey, workchain: 0 }));

        const message = beginCell()
            .storeUint(0x4159fc10, 32)
            .storeUint(0, 64)
            .storeUint(parseInt(tid), 256)
            .endCell();

        return await this.sendInternalMessageWithWallet({
            walletContract: walletContract,
            secretKey: walletKey.secretKey,
            to: Address.parseFriendly(mig).address,
            value: toNano(0.1), // TODO: estimate
            bounce: true,
            body: message,
        });
    }

    async sendInternalMessageWithWallet(params) {
        const message = params.body ? new CellMessage(params.body) : undefined;
        const seqno = await params.walletContract.getSeqNo();

        const transfer = params.walletContract.createTransfer({
            secretKey: params.secretKey,
            seqno: seqno,
            sendMode: SendMode.PAY_GAS_SEPARATLY + SendMode.IGNORE_ERRORS,
            order: new InternalMessage({
                to: params.to,
                value: params.value,
                bounce: params.bounce,
                body: new CommonMessageInfo({
                    body: message,
                }),
            }),
        });

        await params.walletContract.client.sendExternalMessage(params.walletContract, transfer);

        for (let attempt = 0; attempt < 10; attempt++) {
            console.log(`Try ${attempt + 1} time(s)`);
            await (new Promise((resolve) => setTimeout(resolve, 2000)));

            const seqnoAfter = await params.walletContract.getSeqNo();
            if (seqnoAfter > seqno) return seqnoAfter;
        }

        return;
    }
}

module.exports = TonAPI;
