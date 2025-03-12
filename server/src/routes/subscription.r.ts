import { Router } from "express";
import { SubscriptionCtrl } from "../controllers/subscription.c";
import { AuthMiddleware } from "../middleware/auth.m";
import { AdminMiddleware } from "../middleware/admin.m";
import { StripeCtrl } from "../controllers/stripeSubscriptionCtrl";

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

router
	.route("/create")
	.post([AuthMiddleware, AdminMiddleware], StripeCtrl.createSubscription);
router
	.route("/cancel/stripe")
	.post([AuthMiddleware, AdminMiddleware], StripeCtrl.cancelStripeSubscription);
router
	.route("/manage")
	.post([AuthMiddleware, AdminMiddleware], StripeCtrl.manageStripeSubscription);
router
	.route("/all")
	.get([AuthMiddleware, AdminMiddleware], StripeCtrl.getSubDetails);

export default router;
