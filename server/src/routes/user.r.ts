import { Router } from "express";
import { AuthMiddleware } from "../middleware/auth.m";
import { AdminMiddleware } from "../middleware/admin.m";
import { UserCtrl } from "../controllers/users.c";

const router = Router();

// ===========================================================================
// USER
// ===========================================================================
router
	.route("/create")
	.post([AuthMiddleware, AdminMiddleware], UserCtrl.createUser);

router.route("/all").get([AuthMiddleware, AdminMiddleware], UserCtrl.getUsers);

router
	.route("/:id/updateRole")
	.patch([AuthMiddleware, AdminMiddleware], UserCtrl.updateUserRole);

router
	.route("/updateAcct")
	.patch([AuthMiddleware, AdminMiddleware], UserCtrl.updateCompanyAccount);

router
	.route("/getAcct")
	.get([AuthMiddleware, AdminMiddleware], UserCtrl.getCompanyAccount);

router
	.route("/:id")
	.get(AuthMiddleware, UserCtrl.getUser)
	.patch(AuthMiddleware, UserCtrl.updateUserProfile)
	.delete([AuthMiddleware, AdminMiddleware], UserCtrl.deleteUser);

// ===========================================================================
// CUSTOMER
// ===========================================================================
router
	.route("/customers/create")
	.post([AuthMiddleware, AdminMiddleware], UserCtrl.createCustomer);

router.route("/customers/all").get([AuthMiddleware], UserCtrl.getCustomers);

router
	.route("/customers/:id")
	.get([AuthMiddleware, AdminMiddleware], UserCtrl.getCustomer)
	.patch([AuthMiddleware, AdminMiddleware], UserCtrl.updateCustomer);

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
	.post([AuthMiddleware, AdminMiddleware], UserCtrl.createSupplier);

router.route("/suppliers/all").get([AuthMiddleware], UserCtrl.getSuppliers);

router
	.route("/suppliers/:id")
	.get([AuthMiddleware, AdminMiddleware], UserCtrl.getSupplier)
	.patch([AuthMiddleware, AdminMiddleware], UserCtrl.updateSupplier)
	.delete([AuthMiddleware, AdminMiddleware], UserCtrl.deleteSupplier);

export default router;
