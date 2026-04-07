import { z, ZodError } from 'zod';
import { Request, Response, NextFunction } from 'express';
import { ValidationError } from '../utils/ApiError';

type ZodSchema = z.ZodTypeAny;

const validate = (schema: ZodSchema) => {
    return (req: Request, res: Response, next: NextFunction): void => {
        try {
            req.body = schema.parse(req.body);
            next();
        } catch (err) {
            if (err instanceof ZodError) {
                const errors = err.issues.map(e => ({
                    field: e.path.join('.'),
                    message: e.message
                }));

                // 🪵 Log validation errors to console for easier debugging
                console.warn("Validation Error [Zod]:", JSON.stringify(errors, null, 2));

                return next(new ValidationError('Validation failed', errors));
            }

            next(err);
        }
    };
};

export default validate;