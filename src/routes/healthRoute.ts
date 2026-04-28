import { Router } from "express";
import { getHealth } from "../controllers/healthController";

const router = Router();

/**
 * @description Health check endpoint - checks server and database status
 * @access Public
 */
router.route("/").get(getHealth);

export default router;
