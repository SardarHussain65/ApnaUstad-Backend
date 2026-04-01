import { z, ZodError } from 'zod';
import { Request, Response, NextFunction } from 'express';
import { AppError, ValidationError } from '../utils/ApiError';

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
                return next(new ValidationError('Validation failed', errors));
            }

            next(err);
        }
    };
};

export default validate;