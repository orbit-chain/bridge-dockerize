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

router.get("/confirm/:chain/:migAddr/:transactionId", async function (req, res, next) {
    const chain = req.body && req.body.chain || req.params && req.params.chain;
    const mig = req.body && req.body.migAddr || req.params && req.params.migAddr;
    const tid = req.body && req.body.transactionId || req.params && req.params.transactionId;
    return res.json(await govInstance.confirmTransaction(chain, mig, tid));
})

router.get("/confirmRange/:chain/:migAddr/:start/:end", async function (req, res, next) {
    const chain = req.body && req.body.chain || req.params && req.params.chain;
    const mig = req.body && req.body.migAddr || req.params && req.params.migAddr;
    const start = req.body && req.body.start || req.params && req.params.start;
    const end = req.body && req.body.end || req.params && req.params.end;
    return res.json(await govInstance.confirmTransactionByRange(chain, mig, start, end));
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
