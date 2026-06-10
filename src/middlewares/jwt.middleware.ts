import * as jwt from "jsonwebtoken";
import { Request, Response, NextFunction } from "express";
import { getConfig } from "../config/env";
import { BlacklistedToken } from "../models/BlacklistedToken";
import User from "../models/User";
import Worker from "../models/Workers";

const config = getConfig();

export interface TokenPayload extends jwt.JwtPayload {
    id: string;
    username?: string;
    role?: string;
    type: 'user' | 'worker' | 'admin';
}

export interface AuthRequest extends Request {
    tokenPayload?: TokenPayload;
    token?: string;
}

const ACCOUNT_DEACTIVATED_MESSAGE = "Your account has been deactivated by admin.";

const isAccountStatusExempt = (req: Request) => {
    const path = req.originalUrl.split("?")[0] || req.path;
    return [
        "/api/v1/users/me/status",
        "/api/v1/workers/me/status",
        "/api/v1/users/logout",
        "/api/v1/workers/logout",
        "/api/v1/notifications/remove-token",
    ].includes(path);
};

const sendAccountDeactivated = (res: Response, account: { isActive?: boolean; deactivationReason?: string; deactivatedAt?: Date | null }) => {
    return res.status(423).json({
        success: false,
        code: "ACCOUNT_DEACTIVATED",
        message: ACCOUNT_DEACTIVATED_MESSAGE,
        data: {
            isActive: false,
            deactivationReason: account.deactivationReason || "Account deactivated by admin. Please contact support for details.",
            deactivatedAt: account.deactivatedAt || null,
        }
    });
};

const ensureTokenAccountActive = async (req: AuthRequest, res: Response) => {
    if (isAccountStatusExempt(req)) return true;
    const payload = req.tokenPayload;
    if (!payload || payload.type === "admin") return true;

    if (payload.type === "user") {
        const user = await User.findById(payload.id).select("isActive deactivationReason deactivatedAt");
        if (!user) {
            res.status(401).json({ message: "Account not found" });
            return false;
        }
        if (!user.isActive) {
            sendAccountDeactivated(res, user);
            return false;
        }
    }

    if (payload.type === "worker") {
        const worker = await Worker.findById(payload.id).select("isActive deactivationReason deactivatedAt");
        if (!worker) {
            res.status(401).json({ message: "Account not found" });
            return false;
        }
        if (!worker.isActive) {
            sendAccountDeactivated(res, worker);
            return false;
        }
    }

    return true;
};

const jwtAuthMiddleware = async (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!config.jwtSecret) {
        console.error("JWT_SECRET is not configured");
        res.status(500).json({ error: "Internal server error" });
        return;
    }

    const authorization = req.headers.authorization;

    if (!authorization || !authorization.startsWith("Bearer ")) {
        res.status(401).json({ message: "Token Not Found" });
        return;
    }

    const token = authorization.split(" ")[1];

    if (!token) {
        res.status(401).json({ message: "Invalid Token Format" });
        return;
    }

    const secret = config.jwtSecret;

    try {
        // Check if token is blacklisted
        const isBlacklisted = await BlacklistedToken.findOne({ token });
        if (isBlacklisted) {
            res.status(401).json({ message: "Token has been revoked/logged out" });
            return;
        }

        const decodedToken = jwt.verify(token, secret) as TokenPayload;
        req.tokenPayload = decodedToken;
        req.token = token;
        const canContinue = await ensureTokenAccountActive(req, res);
        if (!canContinue) return;
        next();
    } catch (error) {
        console.error("JWT verification failed:", error);
        res.status(401).json({ message: "Invalid Token" });
    }
};

const generateToken = (payload: TokenPayload) => {
    if (!config.jwtSecret) {
        throw new Error("JWT_SECRET is not configured");
    }
    return jwt.sign({ ...payload }, config.jwtSecret, { expiresIn: config.jwtExpiresIn as any });
};

const generateRefreshToken = (payload: TokenPayload) => {
    if (!config.refreshTokenSecret) {
        throw new Error("REFRESH_TOKEN_SECRET is not configured");
    }
    return jwt.sign({ ...payload }, config.refreshTokenSecret, { expiresIn: config.refreshTokenExpiresIn as any });
};

const verifyRefreshToken = (token: string) => {
    if (!config.refreshTokenSecret) {
        throw new Error("REFRESH_TOKEN_SECRET is not configured");
    }
    try {
        return jwt.verify(token, config.refreshTokenSecret) as TokenPayload;
    } catch (error) {
        return null;
    }
};

/**
 * Utility function to blacklist a token upon logout
 * @param token The JWT token to blacklist
 */
export const blacklistToken = async (token: string): Promise<boolean> => {
    try {
        const decoded = jwt.decode(token) as jwt.JwtPayload;
        let expiresAt = new Date();
        
        if (decoded && decoded.exp) {
            // Set expiration to 5 seconds past token expiration to account for clock skew
            expiresAt = new Date((decoded.exp * 1000) + 5000);
        } else {
            // Default 24 hours if no expiration in token
            expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
        }

        await BlacklistedToken.findOneAndUpdate(
            { token },
            { token, expiresAt },
            { upsert: true, new: true }
        );
        return true;
    } catch (error) {
        console.error("Error blacklisting token:", error);
        return false;
    }
};

/**
 * Middleware to restrict access to Standard Users only
 */
export const userAuthMiddleware = (req: AuthRequest, res: Response, next: NextFunction) => {
    jwtAuthMiddleware(req, res, () => {
        if (req.tokenPayload?.type !== 'user') {
            return res.status(403).json({ message: "Forbidden: User access required" });
        }
        next();
    });
};

/**
 * Middleware to restrict access to Workers only
 */
export const workerAuthMiddleware = (req: AuthRequest, res: Response, next: NextFunction) => {
    jwtAuthMiddleware(req, res, () => {
        if (req.tokenPayload?.type !== 'worker') {
            return res.status(403).json({ message: "Forbidden: Worker access required" });
        }
        next();
    });
};

export { jwtAuthMiddleware, generateToken, generateRefreshToken, verifyRefreshToken };
