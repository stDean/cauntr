import { Router } from "express";
import { AuthController } from "../controllers/auth.c";
import { validateCompanyRegistration } from "../middleware/validateRegistration.m";
import { checkExistingCompany } from "../middleware/checkExistingCompany.m";

const router = Router();

router
	.route("/registerCompany")
	.post(
		[validateCompanyRegistration, checkExistingCompany],
		AuthController.createCompany
	);
router.route("/verifyOtp").post(AuthController.verifyOTP);

export default router;
