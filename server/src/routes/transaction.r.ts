import { Router } from "express";
import { TransactionsCtrl } from "../controllers/transaction.c";
import { AdminMiddleware } from "../middleware/admin.m";
import { AuthMiddleware } from "../middleware/auth.m";

const router = Router();

router
	.route("/products/sold")
	.get(AuthMiddleware, TransactionsCtrl.getSoldProducts);
router
	.route("/products/swap")
	.get(AuthMiddleware, TransactionsCtrl.getSwapProducts);

router
	.route("/products/:sku/sell")
	.post(AuthMiddleware, TransactionsCtrl.sellProduct);
router
	.route("/products/bulkSell")
	.post(AuthMiddleware, TransactionsCtrl.sellProducts);
router
	.route("/products/:sku/swap")
	.post(AuthMiddleware, TransactionsCtrl.swapProduct);

router
	.route("/products/:transactionId/sold")
	.get(AuthMiddleware, TransactionsCtrl.getSoldTransactionByID);
router
	.route("/products/:transactionId/swap")
	.get(AuthMiddleware, TransactionsCtrl.getSwapTransactionByID);

router
	.route("/products/:itemId/item")
	.get(AuthMiddleware, TransactionsCtrl.getProductByItemID);

router
	.route("/products/updatePrice")
	.patch(
		[AdminMiddleware, AuthMiddleware],
		TransactionsCtrl.updateProductBalance
	);

export default router;
