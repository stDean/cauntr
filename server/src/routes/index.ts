import { Router } from "express";
import AuthRouter from "./auth.r";

const router = Router();

router.use("/auth", AuthRouter);

export default router;