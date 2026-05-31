import { Router } from "express";
import { workerAuthMiddleware } from "../middlewares/jwt.middleware";
import { handleWalletProofUpload } from "../middlewares/multer.middleware";
import {
    createTopUpRequest,
    getMyTopUpRequests,
    getMyWallet,
    getPaymentMethods,
    getTransactions,
    rechargeMyWallet
} from "../controllers/walletController";

const router = Router();

router.get('/my-wallet', workerAuthMiddleware, getMyWallet);
router.get('/payment-methods', workerAuthMiddleware, getPaymentMethods);
router.get('/topups', workerAuthMiddleware, getMyTopUpRequests);
router.post('/topups', workerAuthMiddleware, handleWalletProofUpload, createTopUpRequest);
router.get('/transactions', workerAuthMiddleware, getTransactions);
router.post('/recharge', workerAuthMiddleware, rechargeMyWallet);

export default router;
