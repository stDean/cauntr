import { Router } from "express";
import { InventoryCtrl } from "../controllers/inventory.c";
import { AuthMiddleware } from "../middleware/auth.m";
import { AdminMiddleware } from "../middleware/admin.m";
import { SubscriptionMiddleware } from "../middleware/action.m";

const router = Router();

router
  .route("/create")
  .post([AuthMiddleware, SubscriptionMiddleware], InventoryCtrl.createProduct);
router
  .route("/create/bulk")
  .post([AuthMiddleware, SubscriptionMiddleware], InventoryCtrl.createProducts);

router.route("/summary").get(AuthMiddleware, InventoryCtrl.getInventorySummary);
router
  .route("/products/summary")
  .get(AuthMiddleware, InventoryCtrl.getProductCountsByTypeAndBrand);
router
  .route("/related/:type/:brand")
  .get(AuthMiddleware, InventoryCtrl.getProductsByTypeAndBrand);

router
  .route("/products/soft-deleted")
  .get(
    [AuthMiddleware, AdminMiddleware, SubscriptionMiddleware],
    InventoryCtrl.getSoftDeletedProductsUsingEvents
  );
router
  .route("/products/:sku/restore")
  .patch(
    [AuthMiddleware, AdminMiddleware, SubscriptionMiddleware],
    InventoryCtrl.restoreProductQuantity
  );
router
  .route("/products/:sku/hard")
  .delete(
    [AuthMiddleware, AdminMiddleware, SubscriptionMiddleware],
    InventoryCtrl.hardDeleteProduct
  );
router
  .route("/products/hard")
  .delete(
    [AuthMiddleware, AdminMiddleware, SubscriptionMiddleware],
    InventoryCtrl.bulkHardDeleteSoftDeletedProducts
  );

router
  .route("/products/:sku")
  .get(AuthMiddleware, InventoryCtrl.getProductBySKU)
  .patch(
    [AuthMiddleware, AdminMiddleware, SubscriptionMiddleware],
    InventoryCtrl.updateProduct
  )
  .delete(
    [AuthMiddleware, AdminMiddleware, SubscriptionMiddleware],
    InventoryCtrl.softDeleteProduct
  );

export default router;
