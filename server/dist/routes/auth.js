import { Router } from "express";
import { AuthController } from "../controllers/auth.js";
import { validateCompanyRegistration } from "../middleware/validateRegistration.js";
import { checkExistingCompany } from "../middleware/checkExistingCompany.js";
const router = Router();
router
    .route("/registerCompany")
    .post([validateCompanyRegistration, checkExistingCompany], AuthController.createCompanyStripe);
router.route("/verifyOtp").post(AuthController.verifyOTPStripe);
router
    .route("/resendRegistrationOTP")
    .post(AuthController.resendRegistrationOTP);
router.route("/login").post(AuthController.login);
router.route("/forgotPassword").post(AuthController.forgotPassword);
router.route("/resendOtp").post(AuthController.resendOTP);
router.route("/resetPassword").post(AuthController.resetPassword);
export default router;
