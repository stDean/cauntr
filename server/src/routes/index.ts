import { Router } from "express";
import AuthRouter from "./auth.r";
import SubscriptionRouter from "./subscription.r";
import InventoryRouter from "./inventory.r";
import TransactionsRouter from "./transaction.r";
import UsersRouter from "./user.r";
import InvoiceRouter from "./invoice.r"

const router = Router();

router.use("/auth", AuthRouter);
router.use("/sub", SubscriptionRouter);
router.use("/inventory", InventoryRouter);
router.use("/transaction", TransactionsRouter);
router.use("/users", UsersRouter);
router.use("/invoice", InvoiceRouter);

export default router;
