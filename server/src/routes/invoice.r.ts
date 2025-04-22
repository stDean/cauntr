import { Router } from "express";
import { AuthMiddleware } from "../middleware/auth.m";
import { AdminMiddleware } from "../middleware/admin.m";
import { InvoiceCtrl } from "../controllers/invoice.c";
import { CheckActiveSubscription } from "../middleware/action.m";

const router = Router();

router
  .route("/all")
  .get([AuthMiddleware, CheckActiveSubscription], InvoiceCtrl.getInvoices);

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
