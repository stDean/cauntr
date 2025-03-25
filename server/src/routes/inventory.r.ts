import { Router } from "express";
import { InventoryCtrl } from "../controllers/inventory.c";
import { AuthMiddleware } from "../middleware/auth.m";
import { AdminMiddleware } from "../middleware/admin.m";
import { CheckActiveSubscription } from "../middleware/action.m";

const router = Router();

router
  .route("/create")
  .post([AuthMiddleware, CheckActiveSubscription], InventoryCtrl.createProduct);
router
  .route("/create/bulk")
  .post(
    [AuthMiddleware, CheckActiveSubscription],
    InventoryCtrl.createProducts
  );

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
    [AuthMiddleware, AdminMiddleware, CheckActiveSubscription],
    InventoryCtrl.getSoftDeletedProductsUsingEvents
  );
router
  .route("/products/:sku/restore")
  .patch(
    [AuthMiddleware, AdminMiddleware, CheckActiveSubscription],
    InventoryCtrl.restoreProductQuantity
  );
router
  .route("/products/:sku/hard")
  .delete(
    [AuthMiddleware, AdminMiddleware, CheckActiveSubscription],
    InventoryCtrl.hardDeleteProduct
  );
router
  .route("/products/hard")
  .delete(
    [AuthMiddleware, AdminMiddleware, CheckActiveSubscription],
    InventoryCtrl.bulkHardDeleteSoftDeletedProducts
  );

router
  .route("/products/:sku")
  .get(AuthMiddleware, InventoryCtrl.getProductBySKU)
  .patch(
    [AuthMiddleware, AdminMiddleware, CheckActiveSubscription],
    InventoryCtrl.updateProduct
  )
  .delete(
    [AuthMiddleware, AdminMiddleware, CheckActiveSubscription],
    InventoryCtrl.softDeleteProduct
  );

export default router;
