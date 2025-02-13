import { Router } from "express";
import { InventoryCtrl } from "../controllers/inventory.c";
import { AuthMiddleware } from "../middleware/auth.m";
import { AdminMiddleware } from "../middleware/admin.m";

const router = Router();

router.route("/create").post(AuthMiddleware, InventoryCtrl.createProducts);

export default router;
