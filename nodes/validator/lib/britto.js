let Web3 = require('web3');
let fs = require('fs');
let ethUtil = require('ethereumjs-util');
let ethAbi = require('ethereumjs-abi');
const EC = require('elliptic').ec;
const ethers = require('ethers');

let STORED_PROVIDERS = {};

function getStoredProvider(britto) {
    const node = britto.node;
    let isWebSocket = node.ws !== null && node.ws !== undefined;
    let host = node.ws || node.rpc;
    let stored_provider;
    if (isWebSocket) {
        host = host.includes("wss://") ? host : `ws://${host.replace("ws://", "")}`;
        stored_provider = STORED_PROVIDERS[host];
        if (stored_provider) {
            britto.setWeb3ProviderConnectionCallback(stored_provider);
        }
    }
    if (!isWebSocket) {
        host = host.includes("https://")? host : `http://${host.replace("http://", "")}`;
        stored_provider = STORED_PROVIDERS[host];
        if (stored_provider && node.onconnect) {
            node.onconnect();
        }
    }
    return stored_provider;
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
            isConnected: false,
            pingInterval: null
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

        if (logger)
            logger.info(`[${this.node.peggingType}] ${node.name} web3 connecting to ${node.ws || node.rpc}`);

        let provider = this.getProvider();

        node.web3 = new Web3(provider);
        node.__tryreconnect = 0;
        node.contract = new node.web3.eth.Contract(node.abi, node.address);

        if (node.ws) {
            this.node.pingInterval = setInterval(this.ping.bind(this), 5000); // connection check
            // call immediately if connection already opened.
            if (provider.connection.readyState === provider.connection.OPEN) {
                node.__tryreconnect = 0;
                node.isConnected = true;
                logger.info(`[${node.peggingType}] ${node.name} web3 connected to ${node.ws}`);
                if (node.onconnect) {
                    node.onconnect();
                }
            }
        }
    }

    setWeb3ProviderConnectionCallback(provider) {
        const node = this.node;
        function callback() {
            node.__tryreconnect = 0;
            node.isConnected = true;

            logger.info(`[${node.peggingType}] ${node.name} web3 connected to ${node.ws}`);

            if (node.onconnect) {
                node.onconnect();
            }
        }
        provider.on('connect', callback);
        provider.on('end', () => {
            if (node.isConnected && node.ondisconnect) node.ondisconnect();
        });
    }

    getProvider() {
        if (!this.node)
            throw 'node object is undefined.';

        const node = this.node;

        let provider = getStoredProvider(this);
        if (provider) {
            return provider;
        }
        if (node.ws) {
            if (!node.ws.includes("wss://")) {
                node.ws = `ws://${node.ws.replace("ws://", "")}`;
            }
            provider = new Web3.providers.WebsocketProvider(node.ws, {
                clientConfig: {
                    maxReceivedFrameSize: 100000000,
                    maxReceivedMessageSize: 100000000,
                },
                timeout: 20000
            });

            STORED_PROVIDERS[node.ws] = provider;

            this.setWeb3ProviderConnectionCallback(provider);
        } else if (node.rpc) {
            if (!node.rpc.includes("https://")) {
                node.rpc = `http://${node.rpc.replace("http://", "")}`;
            }
            provider = new Web3.providers.HttpProvider(node.rpc);
            STORED_PROVIDERS[node.rpc] = provider;
            node.isConnected = true;
            if (node.onconnect) {
                node.onconnect();
            }
            logger.info(`[${node.peggingType}] ${node.name} web3 connected to ${node.rpc}`);
            global.monitor.setNodeConnectStatus(node.peggingType, node.rpc, "connected");
        }

        return provider;
    }

    async ping() {
        if (!this.node)
            throw 'node object is undefined.';

        const context = this;

        if(this.node.pingInterval){
            clearInterval(this.node.pingInterval);
            this.node.pingInterval = null;
        }

        let isListening;
        try {
            isListening = await this.node.web3.eth.net.isListening();
        } catch (e) {
            isListening = false;
        }
        global.monitor.setNodeConnectStatus(this.node.peggingType, this.node.ws, isListening ? "connected" : "reconnecting");

        if (!isListening) {
            STORED_PROVIDERS[this.node.web3._provider.url] = undefined;
            context.reconnectWeb3();
        }

        if(!this.node.pingInterval){
            this.node.pingInterval = setInterval(this.ping.bind(this), 5000);
        }
    }

    reconnectWeb3() {
        const node = this.node;

        node.web3.currentProvider.removeAllListeners('connect');
        node.web3.currentProvider.removeAllListeners('end');
        node.web3.currentProvider.disconnect();
        node.isConnected = false;

        if (node.__tryreconnect >= 3000) {
            logger.info(`[${node.peggingType}] Program exit cause web3 connection lost to ${node.name} : ${node.ws}`);
            process.exit(2);
            return;
        }

        node.__tryreconnect++;
        logger.warn(`[${node.peggingType}] Try reconnect to ${node.ws} (${node.__tryreconnect})`);
        node.web3.setProvider(this.getProvider());
    }

    static getJSONInterface({filename, path, version}) {
        if (!filename)
            throw 'Invalid JSON Interface filename.';

        if (!process.env.RUNNING_LEVEL && process.env.PROFILE)
            process.env.RUNNING_LEVEL = process.env.PROFILE;

        const RUNNING_LEVEL = process.env.RUNNING_LEVEL || 'dev';
        const defaultPath = process.cwd() + '/abi/' + RUNNING_LEVEL;

        return JSON.parse(fs.readFileSync(`${path ? path : defaultPath}/${version ? version : 'v2'}/${filename}`, 'utf8'));
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
}

module.exports = Britto;
