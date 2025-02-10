import { Router } from "express";
import AuthRouter from "./auth.r";
import SubscriptionRouter from "./subscription.r";

const router = Router();

router.use("/auth", AuthRouter);
router.use("/sub", SubscriptionRouter);

export default router;