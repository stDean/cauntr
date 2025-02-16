import { Router } from "express";
import { InventoryCtrl } from "../controllers/inventory.c";
import { AuthMiddleware } from "../middleware/auth.m";
import { AdminMiddleware } from "../middleware/admin.m";

const router = Router();

router.route("/create").post(AuthMiddleware, InventoryCtrl.createProduct);
router.route("/create/bulk").post(AuthMiddleware, InventoryCtrl.createProducts);

router
	.route("/summary")
	.get(AuthMiddleware, InventoryCtrl.getProductCountsByTypeAndBrand);
router
	.route("/related/:type/:brand")
	.get(AuthMiddleware, InventoryCtrl.getProductsByTypeAndBrand);

router
	.route("/products/soft-deleted")
	.get(
		[AuthMiddleware, AdminMiddleware],
		InventoryCtrl.getSoftDeletedProductsUsingEvents
	);
router
	.route("/products/:sku/restore")
	.patch(
		[AuthMiddleware, AdminMiddleware],
		InventoryCtrl.restoreProductQuantity
	);

router
	.route("/products/:sku")
	.get(AuthMiddleware, InventoryCtrl.getProductBySKU)
	.patch([AuthMiddleware, AdminMiddleware], InventoryCtrl.updateProduct)
	.delete([AuthMiddleware, AdminMiddleware], InventoryCtrl.softDeleteProduct);

export default router;
