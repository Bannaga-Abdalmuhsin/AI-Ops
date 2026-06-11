import { Router, type IRouter } from "express";
import healthRouter from "./health";
import syncRouter from "./sync";
import dataRouter from "./data";
import statsRouter from "./stats";

const router: IRouter = Router();

router.use(healthRouter);
router.use(syncRouter);
router.use(dataRouter);
router.use(statsRouter);

export default router;
