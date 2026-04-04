import * as jwt from "jsonwebtoken";
import { Request, Response, NextFunction } from "express";
import { getConfig } from "../config/env";


const config = getConfig();


export interface AuthRequest extends Request {
    tokenPayload?: jwt.JwtPayload | any;
}


export interface TokenPayload {
    id: string;
    username?: string;
    role?: string;
    type: 'user' | 'worker' | 'admin';
}



const jwtAuthMiddleware = (req: AuthRequest, res: Response, next: NextFunction) => {

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
        const decodedToken = jwt.verify(token, secret);
        req.tokenPayload = decodedToken;
        next();
    } catch (error) {
        console.error("JWT verification failed:", error);
        res.status(401).json({ message: "Invalid Token" });
    }

}


const generateToken = (payload: TokenPayload) => {
    if (!config.jwtSecret) {
        throw new Error("JWT_SECRET is not configured");
    }
    return jwt.sign(payload, config.jwtSecret, { expiresIn: "1h" });
}


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


export { jwtAuthMiddleware, generateToken };