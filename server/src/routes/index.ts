import { Router } from "express";
import AuthRouter from "./auth";
import SubscriptionRouter from "./subscription";
import InventoryRouter from "./inventory";
import TransactionsRouter from "./transaction";
import UsersRouter from "./user";
import InvoiceRouter from "./invoice"

const router = Router();

router.use("/auth", AuthRouter);
router.use("/sub", SubscriptionRouter);
router.use("/inventory", InventoryRouter);
router.use("/transaction", TransactionsRouter);
router.use("/users", UsersRouter);
router.use("/invoice", InvoiceRouter);

export default router;
