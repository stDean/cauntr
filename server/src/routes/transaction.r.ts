import { Router } from "express";
import { TransactionsCtrl } from "../controllers/transaction.c";
import { AdminMiddleware } from "../middleware/admin.m";
import { AuthMiddleware } from "../middleware/auth.m";
import { SubscriptionMiddleware } from "../middleware/action.m";

const router = Router();

router
  .route("/products/sold")
  .get(AuthMiddleware, TransactionsCtrl.getSoldProducts);
router
  .route("/products/swap")
  .get(AuthMiddleware, TransactionsCtrl.getSwapProducts);

router
  .route("/products/:sku/sell")
  .post([AuthMiddleware, SubscriptionMiddleware], TransactionsCtrl.sellProduct);
router
  .route("/products/bulkSell")
  .post(
    [AuthMiddleware, SubscriptionMiddleware],
    TransactionsCtrl.sellProducts
  );
router
  .route("/products/:sku/swap")
  .post([AuthMiddleware, SubscriptionMiddleware], TransactionsCtrl.swapProduct);

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
  .route("/products/:itemId/updatePrice")
  .patch(
    [AuthMiddleware, AdminMiddleware, SubscriptionMiddleware],
    TransactionsCtrl.updateProductBalance
  );

router
  .route("/products/:itemId/updateSoldPrice")
  .patch(
    [AuthMiddleware, AdminMiddleware, SubscriptionMiddleware],
    TransactionsCtrl.updateSoldPrice
  );

export default router;
