import * as jwt from "jsonwebtoken";
import { Request, Response, NextFunction } from "express";
import { getConfig } from "../config/env";


const config = getConfig();


interface AuthRequest extends Request {
    tokenPayload?: string | jwt.JwtPayload;
}


interface TokenPayload {
    id: string;
    username: string;
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


export { jwtAuthMiddleware, generateToken };