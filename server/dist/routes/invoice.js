import { Router } from "express";
import { InvoiceCtrl } from "../controllers/invoice.js";
import { CheckActiveSubscription } from "../middleware/action.js";
import { AuthMiddleware } from "../middleware/auth.js";
const router = Router();
router
    .route("/all")
    .get([AuthMiddleware, CheckActiveSubscription], InvoiceCtrl.getInvoices);
router.route("/summary").get([AuthMiddleware], InvoiceCtrl.invoiceSummary);
router
    .route("/:invoiceNo")
    .get([AuthMiddleware, CheckActiveSubscription], InvoiceCtrl.getInvoice);
router
    .route("/create")
    .post([AuthMiddleware, CheckActiveSubscription], InvoiceCtrl.createInvoice);
router
    .route("/:invoiceNo/resend")
    .post([AuthMiddleware, CheckActiveSubscription], InvoiceCtrl.resendInvoice);
router
    .route("/:invoiceNo/:planId/recordPay")
    .patch([AuthMiddleware, CheckActiveSubscription], InvoiceCtrl.recordPayment);
router
    .route("/:invoiceNo/:planId/:paymentId/markPaid")
    .patch([AuthMiddleware, CheckActiveSubscription], InvoiceCtrl.markAsPaid);
export default router;
