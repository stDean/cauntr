import { Router } from "express";
import { AuthMiddleware } from "../middleware/auth";
import { AdminMiddleware } from "../middleware/admin";
import { UserCtrl } from "../controllers/users";
import { CheckActiveSubscription } from "../middleware/action";

const router = Router();

// ===========================================================================
// USER
// ===========================================================================
router
  .route("/create")
  .post(
    [AuthMiddleware, AdminMiddleware, CheckActiveSubscription],
    UserCtrl.createUser
  );

router.route("/all").get([AuthMiddleware, AdminMiddleware], UserCtrl.getUsers);

router
  .route("/:id/updateRole")
  .patch(
    [AuthMiddleware, AdminMiddleware, CheckActiveSubscription],
    UserCtrl.updateUserRole
  );

router
  .route("/updateAcct")
  .patch(
    [AuthMiddleware, AdminMiddleware, CheckActiveSubscription],
    UserCtrl.updateCompanyAccount
  );

router
  .route("/getAcct")
  .get([AuthMiddleware, AdminMiddleware], UserCtrl.getCompanyAccount);

router
  .route("/removeBank/:id")
  .delete(
    [AuthMiddleware, AdminMiddleware, CheckActiveSubscription],
    UserCtrl.removeCompanyBank
  );

router
  .route("/:id")
  .get(AuthMiddleware, UserCtrl.getUser)
  .patch([AuthMiddleware, CheckActiveSubscription], UserCtrl.updateUserProfile)
  .delete(
    [AuthMiddleware, AdminMiddleware, CheckActiveSubscription],
    UserCtrl.deleteUser
  );

// ===========================================================================
// CUSTOMER
// ===========================================================================
router
  .route("/customers/create")
  .post(
    [AuthMiddleware, AdminMiddleware, CheckActiveSubscription],
    UserCtrl.createCustomer
  );

router.route("/customers/all").get([AuthMiddleware], UserCtrl.getCustomers);

router
  .route("/customers/:id")
  .get([AuthMiddleware, AdminMiddleware], UserCtrl.getCustomer)
  .patch(
    [AuthMiddleware, AdminMiddleware, CheckActiveSubscription],
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
    [AuthMiddleware, AdminMiddleware, CheckActiveSubscription],
    UserCtrl.createSupplier
  );

router.route("/suppliers/all").get([AuthMiddleware], UserCtrl.getSuppliers);

router
  .route("/suppliers/:id")
  .get([AuthMiddleware, AdminMiddleware], UserCtrl.getSupplier)
  .patch(
    [AuthMiddleware, AdminMiddleware, CheckActiveSubscription],
    UserCtrl.updateSupplier
  )
  .delete(
    [AuthMiddleware, AdminMiddleware, CheckActiveSubscription],
    UserCtrl.deleteSupplier
  );

export default router;
