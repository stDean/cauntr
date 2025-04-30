import { Router } from "express";
import { SubscriptionCtrl } from "../controllers/subscription";
import { AuthMiddleware } from "../middleware/auth";
import { AdminMiddleware } from "../middleware/admin";
import { StripeCtrl } from "../controllers/stripeSubscriptionCtrl";
import { SubscriptionMiddleware } from "../middleware/action";

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
  .post(
    [AuthMiddleware, AdminMiddleware, SubscriptionMiddleware],
    StripeCtrl.createSubscription
  );
router
  .route("/cancel/stripe")
  .post(
    [AuthMiddleware, AdminMiddleware, SubscriptionMiddleware],
    StripeCtrl.cancelStripeSubscription
  );
router
  .route("/manage")
  .post(
    [AuthMiddleware, AdminMiddleware, SubscriptionMiddleware],
    StripeCtrl.manageStripeSubscription
  );
router
  .route("/history")
  .get(
    [AuthMiddleware, AdminMiddleware, SubscriptionMiddleware],
    StripeCtrl.getSubDetails
  );

export default router;
