import { Router } from "express";
import { AuthMiddleware } from "../middleware/auth.m";
import { AdminMiddleware } from "../middleware/admin.m";
import { InvoiceCtrl } from "../controllers/invoice.c";
import { CheckActiveSubscription } from "../middleware/action.m";

const router = Router();

router
  .route("/all")
  .get([AdminMiddleware, CheckActiveSubscription], InvoiceCtrl.getInvoices);

router
  .route("/:invoiceNo")
  .get([AdminMiddleware, CheckActiveSubscription], InvoiceCtrl.getInvoice);

router
  .route("/create")
  .post([AuthMiddleware, CheckActiveSubscription], InvoiceCtrl.createInvoice);

router
  .route("/:invoiceNo/resend")
  .patch([AuthMiddleware, CheckActiveSubscription], InvoiceCtrl.resendInvoice);

router
  .route("/:invoiceNo/recordPay")
  .patch([AuthMiddleware, CheckActiveSubscription], InvoiceCtrl.recordPayment);

router
  .route("/:invoiceNo/markPaid")
  .patch([AuthMiddleware, CheckActiveSubscription], InvoiceCtrl.markAsPaid);

export default router;
