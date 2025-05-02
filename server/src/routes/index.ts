import { Router } from "express";
import AuthRouter from "./auth.js";
import SubscriptionRouter from "./subscription.js";
import InventoryRouter from "./inventory.js";
import TransactionsRouter from "./transaction.js";
import UsersRouter from "./user.js";
import InvoiceRouter from "./invoice.js"

const router = Router();

router.use("/auth", AuthRouter);
router.use("/sub", SubscriptionRouter);
router.use("/inventory", InventoryRouter);
router.use("/transaction", TransactionsRouter);
router.use("/users", UsersRouter);
router.use("/invoice", InvoiceRouter);

export default router;
