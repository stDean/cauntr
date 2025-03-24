import { Router } from "express";
import { AuthMiddleware } from "../middleware/auth.m";
import { AdminMiddleware } from "../middleware/admin.m";
import { UserCtrl } from "../controllers/users.c";
import { SubscriptionMiddleware } from "../middleware/action.m";

const router = Router();

// ===========================================================================
// USER
// ===========================================================================
router
  .route("/create")
  .post(
    [AuthMiddleware, AdminMiddleware, SubscriptionMiddleware],
    UserCtrl.createUser
  );

router.route("/all").get([AuthMiddleware, AdminMiddleware], UserCtrl.getUsers);

router
  .route("/:id/updateRole")
  .patch(
    [AuthMiddleware, AdminMiddleware, SubscriptionMiddleware],
    UserCtrl.updateUserRole
  );

router
  .route("/updateAcct")
  .patch(
    [AuthMiddleware, AdminMiddleware, SubscriptionMiddleware],
    UserCtrl.updateCompanyAccount
  );

router
  .route("/getAcct")
  .get([AuthMiddleware, AdminMiddleware], UserCtrl.getCompanyAccount);

router
  .route("/:id")
  .get(AuthMiddleware, UserCtrl.getUser)
  .patch([AuthMiddleware, SubscriptionMiddleware], UserCtrl.updateUserProfile)
  .delete(
    [AuthMiddleware, AdminMiddleware, SubscriptionMiddleware],
    UserCtrl.deleteUser
  );

// ===========================================================================
// CUSTOMER
// ===========================================================================
router
  .route("/customers/create")
  .post(
    [AuthMiddleware, AdminMiddleware, SubscriptionMiddleware],
    UserCtrl.createCustomer
  );

router.route("/customers/all").get([AuthMiddleware], UserCtrl.getCustomers);

router
  .route("/customers/:id")
  .get([AuthMiddleware, AdminMiddleware], UserCtrl.getCustomer)
  .patch(
    [AuthMiddleware, AdminMiddleware, SubscriptionMiddleware],
    UserCtrl.updateCustomer
  );

// ===========================================================================
// DEBTOR
// ===========================================================================

router.route("/debtors/all").get([AuthMiddleware], UserCtrl.getDebtors);
router
  .route("/debtors/:id")
  .get([AuthMiddleware, AdminMiddleware], UserCtrl.getDebtor);

// ===========================================================================
// SUPPLIER
// ===========================================================================
router
  .route("/suppliers/create")
  .post(
    [AuthMiddleware, AdminMiddleware, SubscriptionMiddleware],
    UserCtrl.createSupplier
  );

router.route("/suppliers/all").get([AuthMiddleware], UserCtrl.getSuppliers);

router
  .route("/suppliers/:id")
  .get([AuthMiddleware, AdminMiddleware], UserCtrl.getSupplier)
  .patch(
    [AuthMiddleware, AdminMiddleware, SubscriptionMiddleware],
    UserCtrl.updateSupplier
  )
  .delete(
    [AuthMiddleware, AdminMiddleware, SubscriptionMiddleware],
    UserCtrl.deleteSupplier
  );

export default router;
