import { Router } from "express";
import AuthRouter from "./auth.r";
import SubscriptionRouter from "./subscription.r";
import InventoryRouter from "./inventory.r";

const router = Router();

router.use("/auth", AuthRouter);
router.use("/sub", SubscriptionRouter);
router.use("/inventory", InventoryRouter);

export default router;
