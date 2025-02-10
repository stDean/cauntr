import { Router } from "express";
import { SubscriptionCtrl } from "../controllers/subscription.c";
import { AuthMiddleware } from "../middleware/auth.m";
import { AdminMiddleware } from "../middleware/admin.m";

const router = Router();

router
	.route("/update")
	.post([AuthMiddleware, AdminMiddleware], SubscriptionCtrl.updateSubscription);
router
	.route("/cancel")
	.post([AuthMiddleware, AdminMiddleware], SubscriptionCtrl.cancelSubscription);
router
	.route("/reactivate")
	.post(
		[AuthMiddleware, AdminMiddleware],
		SubscriptionCtrl.reactivateSubscription
	);

export default router;
