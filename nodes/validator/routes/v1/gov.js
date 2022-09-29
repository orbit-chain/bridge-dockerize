const express = require("express");
const router = express.Router();
let govInstance;

//  http://host/v1/gov/
router.get("/", function (req, res, next) {
    res.send("gov");
});

router.get("/getAddress/:chain", async function (req, res, next) {
    const chain = req.body && req.body.chain || req.params && req.params.chain;
    return res.json(await govInstance.getAddress(chain));
})

router.get("/getTransaction/:chain/:migAddr/:transactionId", async function (req, res, next) {
    const chain = req.body && req.body.chain || req.params && req.params.chain;
    const mig = req.body && req.body.migAddr || req.params && req.params.migAddr;
    const tid = req.body && req.body.transactionId || req.params && req.params.transactionId;
    return res.json(await govInstance.getTransaction(chain, mig, tid));
})

router.get("/confirm/:chain/:migAddr/:transactionId/:gasPrice/:chainId", async function (req, res, next) {
    const chain = req.body && req.body.chain || req.params && req.params.chain;
    const mig = req.body && req.body.migAddr || req.params && req.params.migAddr;
    const tid = req.body && req.body.transactionId || req.params && req.params.transactionId;
    const gasPrice = req.body && req.body.gasPrice || req.params && req.params.gasPrice;
    const chainId = req.body && req.body.chainId || req.params && req.params.chainId;
    return res.json(await govInstance.confirmTransaction(chain, mig, tid, gasPrice, chainId));
})

router.get("/confirmRange/:chain/:migAddr/:start/:end/:gasPrice/:chainId", async function (req, res, next) {
    const chain = req.body && req.body.chain || req.params && req.params.chain;
    const mig = req.body && req.body.migAddr || req.params && req.params.migAddr;
    const start = req.body && req.body.start || req.params && req.params.start;
    const end = req.body && req.body.end || req.params && req.params.end;
    const gasPrice = req.body && req.body.gasPrice || req.params && req.params.gasPrice;
    const chainId = req.body && req.body.chainId || req.params && req.params.chainId;
    return res.send(await govInstance.confirmTransactionByRange(chain, mig, start, end, gasPrice, chainId));
})

router.get("/validate/:migAddr/:sigHash", async function (req, res, next) {
    const mig = req.body && req.body.migAddr || req.params && req.params.migAddr;
    const sigHash = req.body && req.body.sigHash || req.params && req.params.sigHash;
    return res.json(await govInstance.validateSigHash(mig, sigHash));
});

function setGovInstance(instance) {
    govInstance = instance;
    return router;
}

module.exports = {
    setGovInstance,
}
