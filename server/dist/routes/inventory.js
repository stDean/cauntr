import { Router } from "express";
import { InventoryCtrl } from "../controllers/inventory.js";
import { AuthMiddleware } from "../middleware/auth.js";
import { AdminMiddleware } from "../middleware/admin.js";
import { CheckActiveSubscription } from "../middleware/action.js";
const router = Router();
router
    .route("/create")
    .post([AuthMiddleware, CheckActiveSubscription], InventoryCtrl.createProduct);
router
    .route("/create/bulk")
    .post([AuthMiddleware, CheckActiveSubscription], InventoryCtrl.createProducts);
router.route("/banks").get(AuthMiddleware, InventoryCtrl.getAllBanks);
router.route("/banks").post(AuthMiddleware, InventoryCtrl.createAllBanks);
router.route("/dashboard").get(AuthMiddleware, InventoryCtrl.dashboardSummary);
router.route("/summary").get(AuthMiddleware, InventoryCtrl.getInventorySummary);
router.route("/all").get(AuthMiddleware, InventoryCtrl.getAllProducts);
router
    .route("/products/summary")
    .get(AuthMiddleware, InventoryCtrl.getProductCountsByTypeAndBrand);
router
    .route("/related/:type/:brand/:name")
    .get(AuthMiddleware, InventoryCtrl.getProductsByTypeAndBrand);
router.route("/categories").get(AuthMiddleware, InventoryCtrl.getCategories);
router
    .route("/products/soft-deleted")
    .get([AuthMiddleware, AdminMiddleware, CheckActiveSubscription], InventoryCtrl.getSoftDeletedProductsUsingEvents);
router
    .route("/products/:sku/restore")
    .patch([AuthMiddleware, AdminMiddleware, CheckActiveSubscription], InventoryCtrl.restoreProductQuantity);
router
    .route("/products/:sku/hard")
    .delete([AuthMiddleware, AdminMiddleware, CheckActiveSubscription], InventoryCtrl.hardDeleteProduct);
router
    .route("/products/hard")
    .delete([AuthMiddleware, AdminMiddleware, CheckActiveSubscription], InventoryCtrl.bulkHardDeleteSoftDeletedProducts);
router
    .route("/products/:sku")
    .get(AuthMiddleware, InventoryCtrl.getProductBySKU)
    .patch([AuthMiddleware, AdminMiddleware, CheckActiveSubscription], InventoryCtrl.updateProduct)
    .delete([AuthMiddleware, AdminMiddleware, CheckActiveSubscription], InventoryCtrl.softDeleteProduct);
export default router;
