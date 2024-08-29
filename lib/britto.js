let Web3 = require('web3');
let fs = require('fs');
let ethUtil = require('ethereumjs-util');
let ethAbi = require('ethereumjs-abi');
const EC = require('elliptic').ec;
const ED = require('elliptic').eddsa;
const ethers = require('ethers');
const config = require(ROOT + '/config');

let STORED_PROVIDERS = {};

class WebSocketProviderManager {
    provider;
    host;
    web3Objs = [];
    connCallbacks = [];
    disconnectCallbacks = [];
    intervalObj;
    __tryreconnect = 0;
    isConnected = false;

    constructor(host) {
        this.host = host;
        this.provider = new Web3.providers.WebsocketProvider(host, {
            clientConfig: {
                maxReceivedFrameSize: 100000000,
                maxReceivedMessageSize: 100000000,
            },
            timeout: 20000
        });
        this.intervalObj = setInterval(this.ping.bind(this), 5000);
    }

    addWeb3(web3, connCallback, disconnectCallback) {
        const provider = this.provider;

        this.web3Objs.push(web3);
        if (connCallback) {
            this.connCallbacks.push(connCallback);
        }
        if (disconnectCallback) {
            this.disconnectCallbacks.push(disconnectCallback);
        }

        // callback immediately if connection already opened
        if (provider.connection.readyState === provider.connection.OPEN) {
            this.__tryreconnect = 0;
            this.isConnected = true;
            connCallback();
        }
        this.setConnectionCallback();
    }

    async ping() {
        if (this.web3Objs.length <= 0) {
            return;
        }

        if (this.intervalObj) {
            clearInterval(this.intervalObj);
            this.intervalObj = undefined;
        }

        const web3 = this.web3Objs[0];
        try {
            if (!await web3.eth.net.isListening()) {
                throw Error(`isListening false`);
            }
        } catch (e) {
            this.reconnect();
        } finally {
            if (!this.intervalObj) {
                this.intervalObj = setInterval(this.ping.bind(this), 5000);
            }
        }
    }

    setConnectionCallback() {
        this.provider.on('end', () => {
            if (!this.isConnected) {
                return;
            }
            this.disconnectCallbacks.forEach(callback => { callback(); });

        });
        this.provider.on('close', () => {
            if (!this.isConnected) {
                return;
            }
            this.disconnectCallbacks.forEach(callback => { callback(); });

        });
        this.provider.on('connect', () => {
            this.__tryreconnect = 0;
            this.isConnected = true;
            this.connCallbacks.forEach(callback => { callback(); });
        });
    }

    reconnect() {
        const provider = this.provider;
        provider.removeAllListeners("connect");
        provider.removeAllListeners('end');
        provider.disconnect();
        this.isConnected = false;
        if (this.__tryreconnect >= 3000) {
            logger.info(`Program exit cause web3 connection lost to ${this.host}`);
            process.exit(2);
        }

        this.__tryreconnect++;
        logger.warn(`Try reconnect to ${this.host} (${this.__tryreconnect})`);

        this.provider = new Web3.providers.WebsocketProvider(this.host, {
            clientConfig: {
                maxReceivedFrameSize: 100000000,
                maxReceivedMessageSize: 100000000,
            },
            timeout: 20000
        });
        this.setConnectionCallback();
        this.web3Objs.forEach(web3 => {
            web3.setProvider(this.provider);
        });
    }
}

function getStoredProvider(host, isSocket) {
    if (STORED_PROVIDERS[host]) {
        return STORED_PROVIDERS[host];
    }
    if (isSocket) {
        STORED_PROVIDERS[host] = new WebSocketProviderManager(host);
    } else {
        STORED_PROVIDERS[host] = new Web3.providers.HttpProvider(host);
    }
    return STORED_PROVIDERS[host];
}

// Britto the Pegging Utils with Ethereum web3 and utils.
class Britto {
    static Error() {
        return {
            OKAY: 0,
            INVALID_ADDRESS: 1
        }
    }

    static getWeb3Utils() {
        return Web3.utils;
    }

    static getNodeConfigBase(name) {
        return {
            peggingType: 'Unknown',
            name: name || 'base',
            web3: null,
            contract: null,
            abi: null,
            ws: null,
            address: null,
            multisig: {
                wallet: null,
                abi: null,
                contract: null
            },
            balance: {
                address: null,
                contract: null,
                abi: null
            },
            rollup: {
                address: null,
                contract: null,
                abi: null
            },
            checkInterval: null,
            get isConnected() {
                if (this.ws) {
                    const manager = getStoredProvider(this.ws, true);
                    return manager.isConnected;
                }
                return true;
            },
        }
    }

    constructor(node, peggingType) {
        if (!node)
            throw 'node object is undefined.';
        if (!node.ws && !node.rpc)
            throw 'WebsocketProvider or HttpProvider host is undefined.';
        if (!node.abi)
            throw 'Contract ABI is undefined.';
        node.peggingType = peggingType || '-';
        this.node = node;
    }

    connectWeb3() {
        if (!this.node)
            throw 'node object is undefined.';

        const node = this.node;

        if (logger) {
            logger.info(`[${this.node.peggingType}] ${node.name} web3 connecting to ${node.ws || node.rpc}`);
        }

        this.createWeb3();
        node.contract = new node.web3.eth.Contract(node.abi, node.address);
    }

    async createWeb3() {
        if (!this.node)
            throw 'node object is undefined.';

        const node = this.node;
        if (node.ws) {
            if (!node.ws.includes("wss://")) {
                node.ws = `ws://${node.ws.replace("ws://", "")}`;
            }
            const manager = getStoredProvider(node.ws, true);
            node.web3 = new Web3(manager.provider);
            manager.addWeb3(node.web3, () => {
                logger.info(`[${node.peggingType}] ${node.name} web3 connected to ${node.ws}`);
                node.onconnect();
            }, node.ondisconnect);
            node.checkInterval = setInterval(this.check.bind(this), 1000 * 10);
        } else if (node.rpc) {
            if (!node.rpc.includes("https://")) {
                node.rpc = `http://${node.rpc.replace("http://", "")}`;
            }
            const provider = getStoredProvider(node.rpc);
            node.web3 = new Web3(provider);
            if (node.onconnect) {
                node.onconnect();
            }

            if(config.l2[node.peggingType.split('_')[0].toLowerCase()]) {
                this.extendWeb3(node.web3)
            }

            let block = await node.web3.eth.getBlock("latest").catch(e => {})
            if(!block){
                logger.info(`[${node.peggingType}] ${node.name} web3 disconnected to ${node.rpc}`);
                global.monitor.setNodeConnectStatus(node.peggingType, node.rpc, "disconnected");
            }
            else{
                logger.info(`[${node.peggingType}] ${node.name} web3 connected to ${node.rpc}`);
                global.monitor.setNodeConnectStatus(node.peggingType, node.rpc, "connected");
            }

            node.checkRPCInterval = setInterval(this.checkRPC.bind(this), 1000 * 60 * 10);
        } else {
            throw Error(`UnSupported`);
        }
    }

    extendWeb3(web3) {
        web3.__node = 'geth';
        web3.__extended = true;
        web3.extend({
            property: 'zkevm',
            methods: [{
                name: 'getBatchNumber',
                call: 'zkevm_batchNumber',
                outputFormatter: web3.utils.hexToNumberString
            },
            {
                name: 'getVerifiedBatchNumber',
                call: 'zkevm_verifiedBatchNumber',
                outputFormatter: web3.utils.hexToNumberString
            },
            {
                name: 'getBatchByNumber',
                call: 'zkevm_getBatchByNumber',
                params: 1,
            },
            {
                name: 'getBatchNumberByBlockNumber',
                call: 'zkevm_batchNumberByBlockNumber',
                params: 1,
                inputFormatter: [web3.extend.formatters.inputBlockNumberFormatter],
                outputFormatter: web3.utils.hexToNumberString
            }]
        });
    }

    check() {
        const node = this.node;
        if (node.checkInterval) {
            clearInterval(node.checkInterval);
            node.checkInterval = undefined;
        }

        try {
            const manager = getStoredProvider(node.ws, true);
            global.monitor.setNodeConnectStatus(node.peggingType, node.ws, manager.isConnected === true && manager.__tryreconnect === 0 ? "connected" : "reconnecting");
        } finally {
            if (!node.checkInterval) {
                node.checkInterval = setInterval(this.check.bind(this), 1000 * 10);
            }
        }
    }

    async checkRPC() {
        const node = this.node
        if (node.checkRPCInterval) {
            clearInterval(node.checkRPCInterval);
            node.checkRPCInterval = undefined;
        }

        try {
            let block = await node.web3.eth.getBlock("latest").catch(e => {})
            if(!block){
                global.monitor.setNodeConnectStatus(node.peggingType, node.rpc, "disconnected");
                return;
            }

            global.monitor.setNodeConnectStatus(node.peggingType, node.rpc, "connected");
        } finally {
            if (!node.checkRPCInterval) {
                node.checkRPCInterval = setInterval(this.checkRPC.bind(this), 1000 * 60 * 10);
            }
        }
    }

    static getJSONInterface({filename, path}) {
        if (!filename)
            throw 'Invalid JSON Interface filename.';

        const RUNNING_LEVEL = process.env.PROFILE || 'dev';
        const defaultPath = process.cwd() + '/abi/' + RUNNING_LEVEL;

        return JSON.parse(fs.readFileSync(`${path ? path : defaultPath}/${filename}.abi`, 'utf8'));
    }

    static sha256sol(arr) {
        if (!Array.isArray(arr))
            throw TypeError('Parameter must be the array');

        const types = [], values = [];
        for (let data of arr) {
            if (typeof data !== 'object')
                throw TypeError('Only Object is allowed in the array.');

            let type, value;
            if (data.hasOwnProperty('type') && data.type !== undefined)
                type = data.type;
            else if (data.hasOwnProperty('t') && data.t !== undefined)
                type = data.t;
            else
                throw TypeError('Invalid type.');

            if (data.hasOwnProperty('value') && data.value !== undefined)
                value = data.value;
            else if (data.hasOwnProperty('v') && data.v !== undefined)
                value = data.v;
            else
                throw TypeError('Invalid value.');

            types.push(type);
            values.push(value);
        }

        return '0x' + ethAbi.soliditySHA256(types, values).toString('hex');
    }

    static sha256WithEncode(arr) {
        if (!Array.isArray(arr))
            throw TypeError('Parameter must be the array');

        const types = [], values = [];
        for (let data of arr) {
            if (typeof data !== 'object')
                throw TypeError('Only Object is allowed in the array.');

            let type, value;
            if (data.hasOwnProperty('type') && data.type !== undefined)
                type = data.type;
            else if (data.hasOwnProperty('t') && data.t !== undefined)
                type = data.t;
            else
                throw TypeError('Invalid type.');

            if (data.hasOwnProperty('value') && data.value !== undefined)
                value = data.value;
            else if (data.hasOwnProperty('v') && data.v !== undefined)
                value = data.v;
            else
                throw TypeError('Invalid value.');

            types.push(type);
            values.push(value);
        }

        let packed = ethAbi.rawEncode(types, values);
        let hash = ethUtil.sha256(packed)
        return '0x' + hash.toString('hex');
    }

    static signMessage(str, pk) {
        if (!pk)
            throw 'No Private Key';

        if (typeof pk === 'string')
            pk = ethUtil.toBuffer('0x' + pk.replace('0x', ''));

        let hash = str.replace('0x', '');
        hash = Buffer.from(hash, 'hex');

        let signature = ethUtil.ecsign(hash, pk);

        return {
            message: hash,
            v: '0x' + signature.v.toString(16, 2),
            r: '0x' + signature.r.toString('hex'),
            s: '0x' + signature.s.toString('hex'),
        };
    }

    static ecrecoverHash(hash, v, r, s){
        const echash = ethUtil.toBuffer(hash)
        const vSig = v
        const rSig = ethUtil.toBuffer(r)
        const sSig = ethUtil.toBuffer(s)
        let pub = ethUtil.ecrecover(echash, vSig, rSig, sSig)
        let address = ethUtil.pubToAddress(pub)
        return ('0x' + Buffer.from(address).toString('hex'))
    }

    static signEd25519(str, pk) {
        if(!pk)
            throw 'No Private Key';

        if(Buffer.isBuffer(pk))
            pk = pk.toString('hex');

        pk = pk.replace("0x", "");

        let ed = new ED('ed25519');
        let key = ed.keyFromSecret(pk);

        let hash = str.replace("0x", "");
        hash = Buffer.from(hash, 'hex');

        let signature = key.sign(hash).toHex().toLowerCase();

        return {
            message: hash,
            r: '0x'+signature.slice(0, 64),
            s: '0x'+signature.slice(64)
        }
    }

    static verifyEd25519(message, sig, pub) {
        if(!message || !sig || !pub)
            throw 'Invalid input params';

        if(Buffer.isBuffer(message))
            message = message.toString('hex');
        message = message.remove0x();

        if(Buffer.isBuffer(sig))
            sig = sig.toString('hex');
        sig = sig.remove0x();

        if(Buffer.isBuffer(pub))
            pub = pub.toString('hex');
        pub = pub.remove0x();

        let ed = new ED('ed25519');
        return ed.verify(message, sig, pub);
    }

    static setAdd0x(method) {
        String.prototype[method || 'add0x'] = function () {
            if (Number.isNaN(Number('0x' + this.replace('0x', ''))))
                throw 'Cannot add 0x prefix to Non-number value. got: ' + this;

            return '0x' + this.replace('0x', '');
        }
    }

    static setRemove0x(method) {
        String.prototype[method || 'remove0x'] = function () {
            return this.replace('0x', '');
        }
    }

    // {timeout: ~, address: "0x[0-9a-e]40", pk: "[0-9a-e]64" }
    static getPkAddressPairs(objs) {

        for (var objName of Object.keys(objs)) {

            let ec, key, privkey, pk, pub, pubkey, address;

            try {
                while (!(privkey && privkey.length === 64)) {
                    ec = new EC('secp256k1');
                    key = ec.genKeyPair();
                    privkey = key.getPrivate('hex');
                }
                objs[objName].pk = Buffer.from(privkey, 'hex');;

                pub = key.getPublic();
                pubkey = pub.encode('hex');
                address = ethers.utils.computeAddress('0x' + pubkey);
                objs[objName].address = address.toLowerCase();
            } catch (e) {
                logger.error(e);
                return null;
            }
        }

        return objs;
    }

    static getRandomPkAddress() {

        let ec, key, privkey, pk, pub, pubkey, address;

        try {
            while (!(privkey && privkey.length == 64)) {
                ec = new EC('secp256k1');
                key = ec.genKeyPair();
                privkey = key.getPrivate('hex');
            }
            pk = Buffer.from(privkey, 'hex');

            pub = key.getPublic();
            pubkey = pub.encode('hex');
            address = ethers.utils.computeAddress('0x' + pubkey);
        } catch (e) {
            logger.error(e);
            return null;
        }

        return { address: address, pk: pk };
    }

    static getEd25519Pubkey(pk) {
        try {
            if(Buffer.isBuffer(pk))
                pk = pk.toString('hex');

            pk = pk.replace("0x", "");

            let ed = new ED('ed25519');
            let key = ed.keyFromSecret(pk);

            return "0x" + Buffer.from(key.getPublic()).toString('hex');
        } catch (e) {
            logger.error(e);
            return null;
        }
    }
}

module.exports = Britto;
